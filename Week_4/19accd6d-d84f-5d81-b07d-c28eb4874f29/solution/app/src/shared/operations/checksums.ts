import { utf8Bytes } from "../bytes";

/** The message padded to whole 64-byte blocks: a 0x80 byte, zeros, then the bit length in 8 bytes. */
function padded(input: Uint8Array, littleEndian: boolean): DataView {
  const length = (Math.floor((input.length + 8) / 64) + 1) * 64;
  const block = new Uint8Array(length);
  block.set(input);
  block[input.length] = 0x80;
  const view = new DataView(block.buffer);
  const bits = input.length * 8;
  const high = Math.floor(bits / 0x100000000);
  const low = bits >>> 0;
  if (littleEndian) {
    view.setUint32(length - 8, low, true);
    view.setUint32(length - 4, high, true);
  } else {
    view.setUint32(length - 8, high);
    view.setUint32(length - 4, low);
  }
  return view;
}

function wordsHex(words: readonly number[], littleEndian: boolean): Uint8Array {
  const view = new DataView(new ArrayBuffer(words.length * 4));
  words.forEach((word, index) => view.setUint32(index * 4, word, littleEndian));
  let hex = "";
  for (let i = 0; i < view.byteLength; i++) hex += view.getUint8(i).toString(16).padStart(2, "0");
  return utf8Bytes(hex);
}

function rotateLeft(value: number, bits: number): number {
  return (value << bits) | (value >>> (32 - bits));
}

const MD5_SHIFTS = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
const MD5_CONSTANTS = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) | 0);

export function md5(input: Uint8Array): Uint8Array {
  const view = padded(input, true);
  const state = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  const words = new Int32Array(16);
  for (let offset = 0; offset < view.byteLength; offset += 64) {
    for (let i = 0; i < 16; i++) words[i] = view.getInt32(offset + i * 4, true);
    let [a, b, c, d] = state as [number, number, number, number];
    for (let i = 0; i < 64; i++) {
      const round = i >> 4;
      let mix: number;
      let index: number;
      if (round === 0) {
        mix = (b & c) | (~b & d);
        index = i;
      } else if (round === 1) {
        mix = (d & b) | (~d & c);
        index = (5 * i + 1) & 15;
      } else if (round === 2) {
        mix = b ^ c ^ d;
        index = (3 * i + 5) & 15;
      } else {
        mix = c ^ (b | ~d);
        index = (7 * i) & 15;
      }
      const sum = (a + mix + (MD5_CONSTANTS[i] as number) + (words[index] as number)) | 0;
      a = d;
      d = c;
      c = b;
      b = (b + rotateLeft(sum, MD5_SHIFTS[(round << 2) | (i & 3)] as number)) | 0;
    }
    state[0] = ((state[0] as number) + a) | 0;
    state[1] = ((state[1] as number) + b) | 0;
    state[2] = ((state[2] as number) + c) | 0;
    state[3] = ((state[3] as number) + d) | 0;
  }
  return wordsHex(state.map((word) => word >>> 0), true);
}

export function sha1(input: Uint8Array): Uint8Array {
  const view = padded(input, false);
  const state = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  const words = new Int32Array(80);
  for (let offset = 0; offset < view.byteLength; offset += 64) {
    for (let i = 0; i < 16; i++) words[i] = view.getInt32(offset + i * 4);
    for (let i = 16; i < 80; i++) {
      words[i] = rotateLeft((words[i - 3] as number) ^ (words[i - 8] as number) ^ (words[i - 14] as number) ^ (words[i - 16] as number), 1);
    }
    let [a, b, c, d, e] = state as [number, number, number, number, number];
    for (let i = 0; i < 80; i++) {
      let mix: number;
      let constant: number;
      if (i < 20) {
        mix = (b & c) | (~b & d);
        constant = 0x5a827999;
      } else if (i < 40) {
        mix = b ^ c ^ d;
        constant = 0x6ed9eba1;
      } else if (i < 60) {
        mix = (b & c) | (b & d) | (c & d);
        constant = 0x8f1bbcdc;
      } else {
        mix = b ^ c ^ d;
        constant = 0xca62c1d6;
      }
      const next = (rotateLeft(a, 5) + mix + e + constant + (words[i] as number)) | 0;
      e = d;
      d = c;
      c = rotateLeft(b, 30);
      b = a;
      a = next;
    }
    state[0] = ((state[0] as number) + a) | 0;
    state[1] = ((state[1] as number) + b) | 0;
    state[2] = ((state[2] as number) + c) | 0;
    state[3] = ((state[3] as number) + d) | 0;
    state[4] = ((state[4] as number) + e) | 0;
  }
  return wordsHex(state.map((word) => word >>> 0), false);
}

const SHA256_CONSTANTS = new Int32Array([
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

export function sha256(input: Uint8Array): Uint8Array {
  const view = padded(input, false);
  const state = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const words = new Int32Array(64);
  for (let offset = 0; offset < view.byteLength; offset += 64) {
    for (let i = 0; i < 16; i++) words[i] = view.getInt32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const w15 = words[i - 15] as number;
      const w2 = words[i - 2] as number;
      const s0 = rotateRight(w15, 7) ^ rotateRight(w15, 18) ^ (w15 >>> 3);
      const s1 = rotateRight(w2, 17) ^ rotateRight(w2, 19) ^ (w2 >>> 10);
      words[i] = (words[i - 16] as number) + s0 + (words[i - 7] as number) + s1;
    }
    let [a, b, c, d, e, f, g, h] = state as [number, number, number, number, number, number, number, number];
    for (let i = 0; i < 64; i++) {
      const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const first = (h + s1 + choose + (SHA256_CONSTANTS[i] as number) + (words[i] as number)) | 0;
      const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const second = (s0 + majority) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + first) | 0;
      d = c;
      c = b;
      b = a;
      a = (first + second) | 0;
    }
    [a, b, c, d, e, f, g, h].forEach((word, index) => {
      state[index] = ((state[index] as number) + word) | 0;
    });
  }
  return wordsHex(state.map((word) => word >>> 0), false);
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/** The CRC-32 (IEEE) of the bytes as an unsigned number. */
export function crc32Value(input: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < input.length; i++) crc = (CRC_TABLE[(crc ^ (input[i] as number)) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function crc32(input: Uint8Array): Uint8Array {
  return utf8Bytes(crc32Value(input).toString(16).padStart(8, "0"));
}
