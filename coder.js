const fs = require('fs');
const path = require('path');

const files = {
  "backend/package.json": `{
  "name": "pqc-chat-backend",
  "version": "1.0.0",
  "private": true,
  "type": "commonjs",
  "main": "src/server.js",
  "scripts": {
    "start": "node src/server.js",
    "dev": "node --watch src/server.js"
  },
  "dependencies": {
    "@noble/post-quantum": "^0.2.1",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.19.2"
  }
}`,

  "backend/src/server.js": `require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const express = require('express');
const cors = require('cors');
const sessionRoutes = require('./routes/session');
const chatRoutes = require('./routes/chat');
const healthRoutes = require('./routes/health');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors({ origin: process.env.FRONTEND_ORIGIN || 'http://localhost:3000' }));
app.use(express.json({ limit: '1mb' }));

app.use('/api/health', healthRoutes);
app.use('/api/session', sessionRoutes);
app.use('/api/chat', chatRoutes);

// Generic error handler: never leak internals, never fall back to plaintext
app.use((err, req, res, _next) => {
  console.error('[server error]', err.message);
  res.status(err.status || 500).json({ error: err.publicMessage || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(\`PQC chat backend listening on http://localhost:\${PORT}\`);
});`,

  "backend/src/crypto/mlkem.js": `// Thin wrapper around @noble/post-quantum ML-KEM-768 (FIPS 203).
// We do not implement any lattice math here; we only call the library.
const { ml_kem768 } = require('@noble/post-quantum/ml-kem.js');

function generateKeyPair() {
  try {
    const { publicKey, secretKey } = ml_kem768.keygen();
    return { publicKey, secretKey };
  } catch (err) {
    const e = new Error('ML-KEM key generation failed');
    e.status = 500;
    e.publicMessage = 'PQC initialization failed';
    e.cause = err;
    throw e;
  }
}

function decapsulate(cipherText, secretKey) {
  try {
    return ml_kem768.decapsulate(cipherText, secretKey);
  } catch (err) {
    const e = new Error('ML-KEM decapsulation failed');
    e.status = 400;
    e.publicMessage = 'Invalid key-establishment ciphertext';
    e.cause = err;
    throw e;
  }
}

module.exports = { generateKeyPair, decapsulate };`,

  "backend/src/crypto/kdf.js": `const crypto = require('crypto');

// HKDF-SHA256 (RFC 5869). Derives a 32-byte AES-256 key from the ML-KEM shared secret.
// The info label binds the key to this protocol and purpose.
const INFO = Buffer.from('pqc-chat v1 aes-256-gcm message key');

function deriveAesKey(sharedSecret, sessionId) {
  return Buffer.from(
    crypto.hkdfSync(
      'sha256',
      Buffer.from(sharedSecret),
      Buffer.from(sessionId),   // salt: unique per session
      Buffer.concat([INFO, Buffer.from(sessionId)]),
      32
    )
  );
}

module.exports = { deriveAesKey };`,

  "backend/src/crypto/aesgcm.js": `const crypto = require('crypto');

const IV_LENGTH = 12;   // 96-bit IV, recommended for GCM
const TAG_LENGTH = 16;  // 128-bit auth tag

// Plaintext/ciphertext are base64 strings on the wire.
function encrypt(key, plaintext, aad) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LENGTH });
  if (aad) cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('base64'),
    ciphertext: ct.toString('base64'),
    tag: tag.toString('base64'),
  };
}

function decrypt(key, { iv, ciphertext, tag }, aad) {
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(iv, 'base64'),
      { authTagLength: TAG_LENGTH }
    );
    if (aad) decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    const pt = Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64')),
      decipher.final(), // throws if the tag does not verify
    ]);
    return pt.toString('utf8');
  } catch (err) {
    const e = new Error('AES-GCM authentication failed');
    e.status = 400;
    e.publicMessage = 'Message failed authentication (tampered or wrong key)';
    e.cause = err;
    throw e;
  }
}

module.exports = { encrypt, decrypt, IV_LENGTH, TAG_LENGTH };`,

  "backend/src/services/sessionStore.js": `// In-memory session store. Fine for a demo; a real deployment would use Redis or similar.
const crypto = require('crypto');
const TTL_MS = 30 * 60 * 1000; // 30 minutes

const sessions = new Map();

function create(data) {
  const id = crypto.randomUUID();
  sessions.set(id, { ...data, createdAt: Date.now(), expiresAt: Date.now() + TTL_MS });
  return id;
}

function get(id) {
  const s = sessions.get(id);
  if (!s) return null;
  if (Date.now() > s.expiresAt) {
    sessions.delete(id);
    return null;
  }
  return s;
}

function update(id, patch) {
  const s = get(id);
  if (!s) return null;
  Object.assign(s, patch);
  return s;
}

function remove(id) {
  sessions.delete(id);
}

// Periodic cleanup of expired sessions
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) if (now > s.expiresAt) sessions.delete(id);
}, 60 * 1000).unref();

module.exports = { create, get, update, remove };`,

  "backend/src/services/openrouter.js": `const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

async function askLLM(messages) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    const e = new Error('OPENROUTER_API_KEY missing');
    e.status = 500;
    e.publicMessage = 'Server is missing its LLM API key';
    throw e;
  }

  let res;
  try {
    res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: \`Bearer \${apiKey}\`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.FRONTEND_ORIGIN || 'http://localhost:3000',
        'X-Title': 'PQC Secure Chat Demo',
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini',
        messages,
      }),
    });
  } catch (err) {
    const e = new Error('Network error contacting OpenRouter');
    e.status = 502;
    e.publicMessage = 'Could not reach the LLM provider';
    e.cause = err;
    throw e;
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const e = new Error(\`OpenRouter \${res.status}: \${body.slice(0, 200)}\`);
    e.status = 502;
    e.publicMessage = \`LLM provider error (HTTP \${res.status})\`;
    throw e;
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== 'string') {
    const e = new Error('Unexpected OpenRouter response shape');
    e.status = 502;
    e.publicMessage = 'Unexpected response from LLM provider';
    throw e;
  }
  return text;
}

module.exports = { askLLM };`,

  "backend/src/routes/health.js": `const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    status: 'ok',
    pqc: 'ML-KEM-768',
    symmetric: 'AES-256-GCM',
    openrouterKeyConfigured: Boolean(process.env.OPENROUTER_API_KEY),
    model: process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini',
  });
});

module.exports = router;`,

  "backend/src/routes/session.js": `const express = require('express');
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

module.exports = router;`,

  "backend/src/routes/chat.js": `const express = require('express');
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

module.exports = router;`,

  "frontend/package.json": `{
  "name": "pqc-chat-frontend",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3000",
    "build": "next build",
    "start": "next start -p 3000"
  },
  "dependencies": {
    "@noble/post-quantum": "^0.2.1",
    "next": "14.2.5",
    "react": "18.3.1",
    "react-dom": "18.3.1"
  }
}`,

  "frontend/next.config.js": `/** @type {import('next').NextConfig} */
module.exports = { reactStrictMode: true };`,

  "frontend/app/layout.js": `import './globals.css';

export const metadata = {
  title: 'Post-Quantum Secure AI Chat',
  description: 'AI chat protected by ML-KEM + AES-256-GCM',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}`,

  "frontend/app/globals.css": `* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: system-ui, -apple-system, sans-serif;
  background: #0f1115;
  color: #e6e6e6;
  height: 100vh;
}
.layout { display: grid; grid-template-columns: 1fr 300px; height: 100vh; }
.chat { display: flex; flex-direction: column; min-width: 0; }
.header { padding: 12px 16px; border-bottom: 1px solid #222; display: flex; align-items: center; gap: 12px; }
.badge { font-size: 12px; padding: 4px 8px; border-radius: 999px; background: #123; color: #7fd; }
.badge.off { background: #331; color: #fd7; }
.messages { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
.msg { max-width: 75%; padding: 10px 14px; border-radius: 12px; white-space: pre-wrap; line-height: 1.45; }
.msg.user { align-self: flex-end; background: #2b5cff; color: white; }
.msg.assistant { align-self: flex-start; background: #1d2028; }
.msg.error { align-self: center; background: #4a1d1d; color: #ffb4b4; font-size: 13px; }
.input-row { display: flex; gap: 8px; padding: 12px; border-top: 1px solid #222; }
.input-row textarea { flex: 1; resize: none; height: 56px; padding: 10px; border-radius: 8px; border: 1px solid #333; background: #161a21; color: #eee; font: inherit; }
.input-row button { padding: 0 18px; border-radius: 8px; border: none; background: #2b5cff; color: white; cursor: pointer; font: inherit; }
.input-row button:disabled { opacity: .5; cursor: not-allowed; }
.loading { align-self: flex-start; color: #888; font-size: 13px; }
.panel { border-left: 1px solid #222; padding: 16px; font-size: 13px; overflow-y: auto; background: #0b0d11; }
.panel h3 { margin: 0 0 10px; font-size: 14px; }
.panel dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 10px; margin: 0; }
.panel dt { color: #888; }
.panel dd { margin: 0; word-break: break-all; }
.panel .log { margin-top: 16px; }
.panel .log div { padding: 4px 0; border-bottom: 1px solid #1a1d24; }
.btn-new { padding: 6px 12px; border-radius: 6px; border: 1px solid #333; background: transparent; color: #ddd; cursor: pointer; }`,

  "frontend/app/page.js": `'use client';
import { useState, useRef, useEffect } from 'react';
import ChatWindow from '../components/ChatWindow';
import MessageInput from '../components/MessageInput';
import SecurityPanel from '../components/SecurityPanel';
import { ChatClient } from '../lib/chatClient';

export default function Home() {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState({ established: false, sessionId: null, error: null });
  const [metrics, setMetrics] = useState({ log: [] });
  const clientRef = useRef(null);

  const log = (step, detail) =>
    setMetrics((m) => ({ ...m, log: [...m.log.slice(-40), { t: new Date().toLocaleTimeString(), step, detail }] }));

  async function startSession() {
    setStatus({ established: false, sessionId: null, error: null });
    setMessages([]);
    setMetrics({ log: [] });
    const client = new ChatClient({ onLog: log });
    clientRef.current = client;
    try {
      const info = await client.handshake();
      setStatus({ established: true, sessionId: info.sessionId, error: null });
    } catch (err) {
      setStatus({ established: false, sessionId: null, error: err.message });
    }
  }

  useEffect(() => { startSession(); }, []);

  async function send(text) {
    if (!clientRef.current?.established) {
      setMessages((m) => [...m, { role: 'error', content: 'No secure session. Start a new chat.' }]);
      return;
    }
    setMessages((m) => [...m, { role: 'user', content: text }]);
    setLoading(true);
    try {
      const { reply, timings } = await clientRef.current.sendMessage(text);
      setMessages((m) => [...m, { role: 'assistant', content: reply }]);
      setMetrics((m) => ({ ...m, last: timings }));
    } catch (err) {
      setMessages((m) => [...m, { role: 'error', content: err.message }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="layout">
      <div className="chat">
        <div className="header">
          <strong>PQC Secure Chat</strong>
          <span className={\`badge \${status.established ? '' : 'off'}\`}>
            {status.established ? '🔒 ML-KEM session active' : status.error ? '⚠ Session failed' : 'Establishing…'}
          </span>
          <button className="btn-new" onClick={startSession}>New chat</button>
        </div>
        <ChatWindow messages={messages} loading={loading} />
        <MessageInput onSend={send} disabled={loading || !status.established} />
      </div>
      <SecurityPanel status={status} metrics={metrics} />
    </div>
  );
}`,

  "frontend/components/ChatWindow.js": `'use client';
import { useEffect, useRef } from 'react';

export default function ChatWindow({ messages, loading }) {
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);

  return (
    <div className="messages">
      {messages.map((m, i) => (
        <div key={i} className={\`msg \${m.role}\`}>{m.content}</div>
      ))}
      {loading && <div className="loading">AI is thinking…</div>}
      <div ref={endRef} />
    </div>
  );
}`,

  "frontend/components/MessageInput.js": `'use client';
import { useState } from 'react';

export default function MessageInput({ onSend, disabled }) {
  const [text, setText] = useState('');

  function submit() {
    const t = text.trim();
    if (!t || disabled) return;
    setText('');
    onSend(t);
  }

  return (
    <div className="input-row">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
        placeholder="Type a message (Enter to send, Shift+Enter for newline)"
        disabled={disabled}
      />
      <button onClick={submit} disabled={disabled}>Send</button>
    </div>
  );
}`,

  "frontend/components/SecurityPanel.js": `'use client';

export default function SecurityPanel({ status, metrics }) {
  const t = metrics.last;
  return (
    <aside className="panel">
      <h3>Security / Debug</h3>
      <dl>
        <dt>PQC algorithm</dt><dd>ML-KEM-768 (FIPS 203)</dd>
        <dt>Symmetric</dt><dd>AES-256-GCM</dd>
        <dt>KDF</dt><dd>HKDF-SHA256</dd>
        <dt>Session</dt><dd>{status.established ? 'Established' : 'Not established'}</dd>
        <dt>Session ID</dt><dd>{status.sessionId ? status.sessionId.slice(0, 8) + '…' : '—'}</dd>
        <dt>Encrypt</dt><dd>{t ? \`\${t.encryptMs} ms\` : '—'}</dd>
        <dt>Decrypt (reply)</dt><dd>{t ? \`\${t.decryptMs} ms\` : '—'}</dd>
        <dt>Round trip</dt><dd>{t ? \`\${t.roundTripMs} ms\` : '—'}</dd>
        <dt>Ciphertext out</dt><dd>{t ? \`\${t.outBytes} bytes\` : '—'}</dd>
        <dt>Ciphertext in</dt><dd>{t ? \`\${t.inBytes} bytes\` : '—'}</dd>
      </dl>
      <div className="log">
        <strong>Event log</strong>
        {metrics.log.slice().reverse().map((e, i) => (
          <div key={i}><span style={{ color: '#888' }}>{e.t}</span> {e.step}{e.detail ? \` — \${e.detail}\` : ''}</div>
        ))}
      </div>
    </aside>
  );
}`,

  "frontend/lib/mlkem.js": `// Browser-side ML-KEM-768 via @noble/post-quantum (pure JS, FIPS 203).
import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';

// Client encapsulates against the server's public key.
// Returns the ciphertext to send back and the shared secret (never sent over the wire).
export function encapsulate(publicKeyBytes) {
  const { cipherText, sharedSecret } = ml_kem768.encapsulate(publicKeyBytes);
  return { cipherText, sharedSecret };
}`,

  "frontend/lib/kdf.js": `// HKDF-SHA256 via Web Crypto. Must match the server's derivation exactly.
const enc = new TextEncoder();
const INFO_PREFIX = 'pqc-chat v1 aes-256-gcm message key';

export async function deriveAesKey(sharedSecret, sessionId) {
  const baseKey = await crypto.subtle.importKey('raw', sharedSecret, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: enc.encode(sessionId),
      info: enc.encode(INFO_PREFIX + sessionId),
    },
    baseKey,
    256
  );
  return crypto.subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}`,

  "frontend/lib/aesgcm.js": `// AES-256-GCM via Web Crypto. Wire format is base64 for iv, ciphertext and tag.
const enc = new TextEncoder();
const dec = new TextDecoder();

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function encrypt(key, plaintext, aad) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const out = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: enc.encode(aad), tagLength: 128 },
    key,
    enc.encode(plaintext)
  ));
  // Web Crypto appends the 16-byte tag to the ciphertext; split it for the wire format.
  const ct = out.slice(0, out.length - 16);
  const tag = out.slice(out.length - 16);
  return { iv: b64(iv), ciphertext: b64(ct), tag: b64(tag), byteLength: ct.length };
}

export async function decrypt(key, { iv, ciphertext, tag }, aad) {
  const ct = unb64(ciphertext);
  const t = unb64(tag);
  const joined = new Uint8Array(ct.length + t.length);
  joined.set(ct);
  joined.set(t, ct.length);
  try {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: unb64(iv), additionalData: enc.encode(aad), tagLength: 128 },
      key,
      joined
    );
    return dec.decode(pt);
  } catch {
    throw new Error('Response failed authentication');
  }
}`,

  "frontend/lib/api.js": `export const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:4000';

export async function post(path, body) {
  let res;
  try {
    res = await fetch(\`\${API_BASE}\${path}\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Network failure: cannot reach backend');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || \`Request failed (\${res.status})\`);
  return data;
}`,

  "frontend/lib/chatClient.js": `import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';
import { deriveAesKey } from './kdf';
import { encrypt, decrypt } from './aesgcm';
import { post, API_BASE } from './api';

// Orchestrates: handshake (ML-KEM) → key derivation (HKDF) → message crypto (AES-GCM).
export class ChatClient {
  constructor({ onLog = () => {} } = {}) {
    this.onLog = onLog;
    this.sessionId = null;
    this.aesKey = null;
    this.established = false;
  }

  // ---- 1. Key establishment ----
  async handshake() {
    this.onLog('Handshake start', 'requesting server ML-KEM public key');
    const init = await post('/api/session/init', {});
    this.sessionId = init.sessionId;
    const serverPk = Uint8Array.from(atob(init.publicKey), (c) => c.charCodeAt(0));

    // Client-side ML-KEM encapsulation: produces ciphertext + shared secret.
    const { cipherText, sharedSecret } = ml_kem768.encapsulate(serverPk);
    this.onLog('ML-KEM encapsulate', \`ciphertext \${cipherText.length} bytes\`);

    await post('/api/session/complete', {
      sessionId: this.sessionId,
      cipherText: btoa(String.fromCharCode(...cipherText)),
    });

    // ---- 2. Key derivation (HKDF-SHA256, same parameters as the server) ----
    this.aesKey = await deriveAesKey(sharedSecret, this.sessionId);
    this.onLog('HKDF-SHA256', 'derived AES-256 key (not shown)');

    this.established = true;
    this.onLog('Session established', \`id \${this.sessionId.slice(0, 8)}…\`);
    return { sessionId: this.sessionId };
  }

  // ---- 3–9. Message encryption, transport, decryption ----
  async sendMessage(plaintext) {
    if (!this.established) throw new Error('Secure session not established');
    const t0 = performance.now();

    // 3. Encrypt outgoing message (AES-256-GCM, AAD = sessionId)
    const enc = await encrypt(this.aesKey, plaintext, this.sessionId);
    const tEnc = performance.now();
    this.onLog('AES-GCM encrypt', \`\${enc.byteLength} bytes ciphertext\`);

    // 4–5. Send ciphertext to backend (backend decrypts, calls OpenRouter, encrypts reply)
    this.onLog('POST /api/chat', 'sending ciphertext only');
    const data = await post('/api/chat', { sessionId: this.sessionId, ...enc });

    // 8–9. Decrypt response
    const tDec0 = performance.now();
    const reply = await decrypt(this.aesKey, data, this.sessionId);
    const tDec1 = performance.now();
    this.onLog('AES-GCM decrypt', 'reply authenticated and decrypted');

    return {
      reply,
      timings: {
        encryptMs: (tEnc - t0).toFixed(1),
        decryptMs: (tDec1 - tDec0).toFixed(1),
        roundTripMs: (tDec1 - t0).toFixed(0),
        outBytes: data.debug?.outboundCiphertextBytes ?? '—',
        inBytes: enc.byteLength,
      },
    };
  }
}`,

  ".env.example": `OPENROUTER_API_KEY=sk-or-v1-your-key-here
OPENROUTER_MODEL=openai/gpt-4o-mini
PORT=4000
FRONTEND_ORIGIN=http://localhost:3000`,

  "README.md": `# Post-Quantum Secure AI Chat

An educational demo in which chat messages are protected with **post-quantum cryptography** on the way from the browser to an Express backend, which then forwards plaintext to an LLM via OpenRouter.

## Setup and Run

\`\`\`bash
# Install Dependencies
cd backend && npm install
cd ../frontend && npm install

# Setup environment
cp .env.example .env

# Run Backend (Terminal 1)
cd backend && npm run dev

# Run Frontend (Terminal 2)
cd frontend && npm run dev
\`\`\`
`
};

Object.entries(files).forEach(([filepath, content]) => {
  const dirname = path.dirname(filepath);
  if (dirname !== '.') {
    fs.mkdirSync(dirname, { recursive: true });
  }
  fs.writeFileSync(filepath, content.trim());
  console.log(`Created: ${filepath}`);
});

console.log("\nProject structure generation complete!");