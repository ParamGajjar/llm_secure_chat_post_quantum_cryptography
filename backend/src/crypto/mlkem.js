// Thin wrapper around @noble/post-quantum ML-KEM-768 (FIPS 203).
// We do not implement any lattice math here; we only call the library.
// const { ml_kem768 } = require('@noble/post-quantum/ml-kem.js');
const { ml_kem768 } = require('@noble/post-quantum/ml-kem');

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

module.exports = { generateKeyPair, decapsulate };