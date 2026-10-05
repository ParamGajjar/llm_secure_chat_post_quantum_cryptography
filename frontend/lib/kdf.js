// HKDF-SHA256 via Web Crypto. Must match the server's derivation exactly.
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
}