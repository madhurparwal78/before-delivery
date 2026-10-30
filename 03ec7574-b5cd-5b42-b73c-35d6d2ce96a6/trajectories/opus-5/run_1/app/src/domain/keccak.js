const MASK = (1n << 64n) - 1n;

const ROUND_CONSTANTS = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n
];

const ROTATIONS = [
  [0, 36, 3, 41, 18],
  [1, 44, 10, 45, 2],
  [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56],
  [27, 20, 39, 8, 14]
];

function rotate(value, offset) {
  if (offset === 0) return value;
  const shift = BigInt(offset);
  return ((value << shift) | (value >> (64n - shift))) & MASK;
}

function permute(state) {
  for (let round = 0; round < 24; round += 1) {
    const c = new Array(5);
    for (let x = 0; x < 5; x += 1) {
      c[x] = state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20];
    }
    for (let x = 0; x < 5; x += 1) {
      const d = c[(x + 4) % 5] ^ rotate(c[(x + 1) % 5], 1);
      for (let y = 0; y < 5; y += 1) state[x + 5 * y] ^= d;
    }
    const b = new Array(25).fill(0n);
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        b[y + 5 * ((2 * x + 3 * y) % 5)] = rotate(state[x + 5 * y], ROTATIONS[x][y]);
      }
    }
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        state[x + 5 * y] = b[x + 5 * y] ^ (~b[((x + 1) % 5) + 5 * y] & b[((x + 2) % 5) + 5 * y]) & MASK;
      }
    }
    state[0] ^= ROUND_CONSTANTS[round];
  }
}

/** Keccak-256 with the original Keccak padding, as Ethereum uses for EIP-55. */
export function keccak256(input) {
  const message = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  const rate = 136;
  const padded = Buffer.alloc(Math.floor(message.length / rate + 1) * rate);
  message.copy(padded);
  padded[message.length] = 0x01;
  padded[padded.length - 1] |= 0x80;

  const state = new Array(25).fill(0n);
  for (let offset = 0; offset < padded.length; offset += rate) {
    for (let i = 0; i < rate / 8; i += 1) {
      state[i] ^= padded.readBigUInt64LE(offset + i * 8);
    }
    permute(state);
  }

  const out = Buffer.alloc(32);
  for (let i = 0; i < 4; i += 1) out.writeBigUInt64LE(state[i], i * 8);
  return out;
}
