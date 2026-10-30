// Keccak-256 with the original Keccak padding (0x01), as Ethereum uses it; not NIST SHA3-256.
const MASK = (1n << 64n) - 1n;
const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n, 0x000000000000808bn,
  0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n, 0x000000000000008an, 0x0000000000000088n,
  0x0000000080008009n, 0x000000008000000an, 0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n,
  0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
// Rotation offsets indexed by x + 5y.
const ROT = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];
const RATE = 136;

const rotl = (v, n) => (n === 0 ? v : ((v << BigInt(n)) | (v >> BigInt(64 - n))) & MASK);

function permute(a) {
  const b = new Array(25);
  const c = new Array(5);
  for (let round = 0; round < 24; round += 1) {
    for (let x = 0; x < 5; x += 1) c[x] = a[x] ^ a[x + 5] ^ a[x + 10] ^ a[x + 15] ^ a[x + 20];
    for (let x = 0; x < 5; x += 1) {
      const d = c[(x + 4) % 5] ^ rotl(c[(x + 1) % 5], 1);
      for (let y = 0; y < 25; y += 5) a[x + y] ^= d;
    }
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) b[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(a[x + 5 * y], ROT[x + 5 * y]);
    }
    for (let y = 0; y < 25; y += 5) {
      for (let x = 0; x < 5; x += 1) a[x + y] = b[x + y] ^ (~b[((x + 1) % 5) + y] & MASK & b[((x + 2) % 5) + y]);
    }
    a[0] ^= RC[round];
  }
}

export function keccak256Hex(text) {
  const input = Buffer.from(text, 'utf8');
  const padded = Buffer.alloc((Math.floor(input.length / RATE) + 1) * RATE);
  input.copy(padded);
  padded[input.length] ^= 0x01;
  padded[padded.length - 1] ^= 0x80;
  const state = new Array(25).fill(0n);
  for (let offset = 0; offset < padded.length; offset += RATE) {
    for (let i = 0; i < RATE / 8; i += 1) state[i] ^= padded.readBigUInt64LE(offset + i * 8);
    permute(state);
  }
  const out = Buffer.alloc(32);
  for (let i = 0; i < 4; i += 1) out.writeBigUInt64LE(state[i], i * 8);
  return out.toString('hex');
}
