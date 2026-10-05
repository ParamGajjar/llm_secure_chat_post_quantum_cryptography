// AES-256-GCM via Web Crypto. Wire format is base64 for iv, ciphertext and tag.
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
}