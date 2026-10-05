const express = require('express');
const router = express.Router();
const { generateKeyPair, decapsulate } = require('../crypto/mlkem');
const { deriveAesKey } = require('../crypto/kdf');
const sessions = require('../services/sessionStore');

// Step 1: server generates an ML-KEM keypair for this session and returns the public key.
router.post('/init', (req, res, next) => {
  try {
    const { publicKey, secretKey } = generateKeyPair();
    const sessionId = sessions.create({ secretKey, aesKey: null, established: false });
    res.json({
      sessionId,
      algorithm: 'ML-KEM-768',
      publicKey: Buffer.from(publicKey).toString('base64'),
    });
  } catch (err) {
    next(err);
  }
});

// Step 2: browser sends the ML-KEM ciphertext; server decapsulates and derives the AES key.
router.post('/complete', (req, res, next) => {
  try {
    const { sessionId, cipherText } = req.body || {};
    const session = sessions.get(sessionId);
    if (!session) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }
    if (session.established) {
      return res.status(409).json({ error: 'Session already established' });
    }
    if (typeof cipherText !== 'string') {
      return res.status(400).json({ error: 'cipherText required' });
    }

    const sharedSecret = decapsulate(Buffer.from(cipherText, 'base64'), session.secretKey);
    const aesKey = deriveAesKey(sharedSecret, sessionId);

    // Discard the ML-KEM secret key and shared secret; keep only the derived AES key.
    sessions.update(sessionId, { secretKey: null, aesKey, established: true });
    res.json({ sessionId, established: true, algorithm: 'ML-KEM-768 + HKDF-SHA256 + AES-256-GCM' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;