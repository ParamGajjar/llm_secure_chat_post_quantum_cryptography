const express = require('express');
const router = express.Router();
const sessions = require('../services/sessionStore');
const aes = require('../crypto/aesgcm');
const { askLLM } = require('../services/openrouter');

// Conversation history per session (plaintext kept only server-side, in memory)
const MAX_HISTORY = 20;

router.post('/', async (req, res, next) => {
  try {
    const { sessionId, iv, ciphertext, tag } = req.body || {};
    const session = sessions.get(sessionId);

    if (!session) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }
    if (!session.established || !session.aesKey) {
      // Never accept or send plaintext without an established PQC session
      return res.status(403).json({ error: 'Secure session not established' });
    }
    if (!iv || !ciphertext || !tag) {
      return res.status(400).json({ error: 'iv, ciphertext and tag required' });
    }

    const aad = sessionId; // binds the ciphertext to this session
    const userText = aes.decrypt(session.aesKey, { iv, ciphertext, tag }, aad);

    session.history = session.history || [];
    session.history.push({ role: 'user', content: userText });
    session.history = session.history.slice(-MAX_HISTORY);

    const reply = await askLLM(session.history);
    session.history.push({ role: 'assistant', content: reply });
    session.history = session.history.slice(-MAX_HISTORY);

    // Encrypt the response with the same session key, using a fresh IV
    const enc = aes.encrypt(session.aesKey, reply, aad);

    res.json({
      sessionId,
      iv: enc.iv,
      ciphertext: enc.ciphertext,
      tag: enc.tag,
      debug: {
        inboundCiphertextBytes: Buffer.from(ciphertext, 'base64').length,
        outboundCiphertextBytes: Buffer.from(enc.ciphertext, 'base64').length,
        plaintextReceivedBytes: Buffer.byteLength(userText, 'utf8'),
        llmForwarded: true,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;