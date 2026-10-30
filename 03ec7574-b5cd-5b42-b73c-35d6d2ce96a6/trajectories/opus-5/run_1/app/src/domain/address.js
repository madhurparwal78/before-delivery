import { createHash } from 'node:crypto';
import { keccak256 } from './keccak.js';

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export class AddressError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export function walletAddress(walletId) {
  return `0x${createHash('sha256').update(`corvo:${walletId}`).digest('hex').slice(0, 40)}`;
}

export function toChecksumAddress(address) {
  const body = address.slice(2).toLowerCase();
  const hash = keccak256(body).toString('hex');
  let out = '0x';
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    out += char >= 'a' && char <= 'f' && parseInt(hash[i], 16) >= 8 ? char.toUpperCase() : char;
  }
  return out;
}

/** Accepts all-lowercase, all-uppercase or correctly checksummed mixed case, and returns lowercase. */
export function normaliseAddress(value) {
  if (typeof value !== 'string' || !ADDRESS_PATTERN.test(value)) throw new AddressError('INVALID_ADDRESS');
  const body = value.slice(2);
  const isLower = body === body.toLowerCase();
  const isUpper = body === body.toUpperCase();
  if (!isLower && !isUpper && toChecksumAddress(value) !== value) throw new AddressError('INVALID_ADDRESS_CHECKSUM');
  return value.toLowerCase();
}

export function txHash(intentId) {
  return `0x${createHash('sha256').update(`corvo-tx:${intentId}`).digest('hex')}`;
}
