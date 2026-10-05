// import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';
import { ml_kem768 } from '@noble/post-quantum/ml-kem';
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
    this.onLog('ML-KEM encapsulate', `ciphertext ${cipherText.length} bytes`);

    await post('/api/session/complete', {
      sessionId: this.sessionId,
      cipherText: btoa(String.fromCharCode(...cipherText)),
    });

    // ---- 2. Key derivation (HKDF-SHA256, same parameters as the server) ----
    this.aesKey = await deriveAesKey(sharedSecret, this.sessionId);
    this.onLog('HKDF-SHA256', 'derived AES-256 key (not shown)');

    this.established = true;
    this.onLog('Session established', `id ${this.sessionId.slice(0, 8)}…`);
    return { sessionId: this.sessionId };
  }

  // ---- 3–9. Message encryption, transport, decryption ----
  async sendMessage(plaintext) {
    if (!this.established) throw new Error('Secure session not established');
    const t0 = performance.now();

    // 3. Encrypt outgoing message (AES-256-GCM, AAD = sessionId)
    const enc = await encrypt(this.aesKey, plaintext, this.sessionId);
    const tEnc = performance.now();
    this.onLog('AES-GCM encrypt', `${enc.byteLength} bytes ciphertext`);

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
}