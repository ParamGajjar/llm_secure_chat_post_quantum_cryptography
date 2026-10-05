const crypto = require('crypto');

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

module.exports = { deriveAesKey };