/**
 * SHA-256 for the exhibit upload. `crypto.subtle` is used when the page is a
 * secure context; otherwise this implementation hashes the bytes instead.
 */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

function hashBytes(bytes: Uint8Array): string {
  const state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const bitLength = bytes.length * 8;
  const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(padded.length - 4, bitLength >>> 0);

  const schedule = new Uint32Array(64);
  for (let block = 0; block < padded.length; block += 64) {
    for (let index = 0; index < 16; index += 1) {
      schedule[index] = view.getUint32(block + index * 4);
    }
    for (let index = 16; index < 64; index += 1) {
      const a = schedule[index - 15] as number;
      const b = schedule[index - 2] as number;
      const s0 = rotateRight(a, 7) ^ rotateRight(a, 18) ^ (a >>> 3);
      const s1 = rotateRight(b, 17) ^ rotateRight(b, 19) ^ (b >>> 10);
      schedule[index] =
        ((schedule[index - 16] as number) + s0 + (schedule[index - 7] as number) + s1) >>> 0;
    }
    let [h0, h1, h2, h3, h4, h5, h6, h7] = state as unknown as number[];
    for (let index = 0; index < 64; index += 1) {
      const S1 = rotateRight(h4 as number, 6) ^ rotateRight(h4 as number, 11) ^ rotateRight(h4 as number, 25);
      const choose = ((h4 as number) & (h5 as number)) ^ (~(h4 as number) & (h6 as number));
      const temp1 =
        ((h7 as number) + S1 + choose + (K[index] as number) + (schedule[index] as number)) >>> 0;
      const S0 = rotateRight(h0 as number, 2) ^ rotateRight(h0 as number, 13) ^ rotateRight(h0 as number, 22);
      const majority =
        ((h0 as number) & (h1 as number)) ^ ((h0 as number) & (h2 as number)) ^ ((h1 as number) & (h2 as number));
      const temp2 = (S0 + majority) >>> 0;
      h7 = h6;
      h6 = h5;
      h5 = h4;
      h4 = ((h3 as number) + temp1) >>> 0;
      h3 = h2;
      h2 = h1;
      h1 = h0;
      h0 = (temp1 + temp2) >>> 0;
    }
    state[0] = ((state[0] as number) + (h0 as number)) >>> 0;
    state[1] = ((state[1] as number) + (h1 as number)) >>> 0;
    state[2] = ((state[2] as number) + (h2 as number)) >>> 0;
    state[3] = ((state[3] as number) + (h3 as number)) >>> 0;
    state[4] = ((state[4] as number) + (h4 as number)) >>> 0;
    state[5] = ((state[5] as number) + (h5 as number)) >>> 0;
    state[6] = ((state[6] as number) + (h6 as number)) >>> 0;
    state[7] = ((state[7] as number) + (h7 as number)) >>> 0;
  }
  return Array.from(state)
    .map((word) => word.toString(16).padStart(8, '0'))
    .join('');
}

export async function sha256OfBlob(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  if (typeof crypto !== 'undefined' && crypto.subtle !== undefined) {
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }
  return hashBytes(new Uint8Array(buffer));
}
