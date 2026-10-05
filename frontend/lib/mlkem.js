// Browser-side ML-KEM-768 via @noble/post-quantum (pure JS, FIPS 203).
// import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';
import { ml_kem768 } from '@noble/post-quantum/ml-kem';

// Client encapsulates against the server's public key.
// Returns the ciphertext to send back and the shared secret (never sent over the wire).
export function encapsulate(publicKeyBytes) {
  const { cipherText, sharedSecret } = ml_kem768.encapsulate(publicKeyBytes);
  return { cipherText, sharedSecret };
}