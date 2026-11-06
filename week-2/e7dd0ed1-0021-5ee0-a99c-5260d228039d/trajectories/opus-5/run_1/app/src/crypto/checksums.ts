import * as crypto from 'node:crypto';
import * as zlib from 'node:zlib';

export type ChecksumAlgorithm = 'crc32' | 'crc32c' | 'sha1' | 'sha256';

export const checksumAlgorithms: ChecksumAlgorithm[] = ['crc32', 'crc32c', 'sha1', 'sha256'];

const crc32cTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? (value >>> 1) ^ 0x82f63b78 : value >>> 1;
    table[i] = value >>> 0;
  }
  return table;
})();

function crc32c(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = (crc32cTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)) >>> 0;
  return (crc ^ 0xffffffff) >>> 0;
}

function beUint32(value: number): Buffer {
  const out = Buffer.alloc(4);
  out.writeUInt32BE(value >>> 0, 0);
  return out;
}

export function checksumDigest(algorithm: ChecksumAlgorithm, bytes: Buffer): Buffer {
  switch (algorithm) {
    case 'crc32':
      return beUint32(zlib.crc32(bytes));
    case 'crc32c':
      return beUint32(crc32c(bytes));
    case 'sha1':
      return crypto.createHash('sha1').update(bytes).digest();
    case 'sha256':
      return crypto.createHash('sha256').update(bytes).digest();
  }
}

export function checksumBase64(algorithm: ChecksumAlgorithm, bytes: Buffer): string {
  return checksumDigest(algorithm, bytes).toString('base64');
}

export function checksumLength(algorithm: ChecksumAlgorithm): number {
  return algorithm === 'crc32' || algorithm === 'crc32c' ? 4 : algorithm === 'sha1' ? 20 : 32;
}

export function isValidChecksumValue(algorithm: ChecksumAlgorithm, value: string): boolean {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  let decoded: Buffer;
  try {
    decoded = Buffer.from(value, 'base64');
  } catch {
    return false;
  }
  return decoded.toString('base64') === value && decoded.length === checksumLength(algorithm);
}
