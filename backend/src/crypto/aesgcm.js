const crypto = require('crypto');

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

module.exports = { encrypt, decrypt, IV_LENGTH, TAG_LENGTH };