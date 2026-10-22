const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Int16Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) LOOKUP[ALPHABET.charCodeAt(i)] = i;

/** Bytes to a base64 string. Works the same in the browser and in Node. */
export function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    parts.push(
      ALPHABET[(n >> 18) & 63],
      ALPHABET[(n >> 12) & 63],
      i + 1 < bytes.length ? ALPHABET[(n >> 6) & 63] : '=',
      i + 2 < bytes.length ? ALPHABET[n & 63] : '=',
    );
  }
  return parts.join('');
}

/** A base64 string back to bytes. Throws on anything that isn't valid base64. */
export function base64ToBytes(text: string): Uint8Array {
  if (text.length % 4 !== 0) throw new RangeError('invalid base64: length is not a multiple of 4');
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  const bytes = new Uint8Array((text.length / 4) * 3 - padding);
  let o = 0;
  for (let i = 0; i < text.length; i += 4) {
    let n = 0;
    for (let k = 0; k < 4; k++) {
      const ch = text.charCodeAt(i + k);
      const v = text[i + k] === '=' ? 0 : ch < 128 ? LOOKUP[ch] : -1;
      if (v < 0) throw new RangeError('invalid base64: unexpected character');
      n = (n << 6) | v;
    }
    if (o < bytes.length) bytes[o++] = (n >> 16) & 255;
    if (o < bytes.length) bytes[o++] = (n >> 8) & 255;
    if (o < bytes.length) bytes[o++] = n & 255;
  }
  return bytes;
}

export function floatsToBase64(values: Float32Array): string {
  return bytesToBase64(new Uint8Array(values.buffer, values.byteOffset, values.byteLength));
}

export function base64ToFloats(text: string): Float32Array {
  const bytes = base64ToBytes(text);
  if (bytes.length % 4 !== 0) throw new RangeError('invalid float data: wrong length');
  // Copy into a fresh buffer so the floats are aligned.
  return new Float32Array(bytes.slice().buffer);
}
