import jsSha3 from 'js-sha3';
import { walletAddress } from './core.js';

const { keccak256 } = jsSha3;

export class AddressError extends Error {
  constructor(code, field) {
    super(code);
    this.code = code;
    this.field = field;
  }
}

// EIP-55 checksum: keccak-256 of the lowercase hex.
export function toChecksum(addrLower) {
  const hex = addrLower.slice(2);
  const hash = keccak256(hex);
  let out = '0x';
  for (let i = 0; i < 40; i++) {
    const nibble = parseInt(hash[i], 16);
    out += nibble >= 8 ? hex[i].toUpperCase() : hex[i];
  }
  return out;
}

export function normalizeAddress(value, field) {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new AddressError('INVALID_ADDRESS', field);
  }
  const body = value.slice(2);
  const hasUpper = /[A-F]/.test(body);
  const hasLower = /[a-f]/.test(body);
  if (hasUpper && hasLower && value !== toChecksum(`0x${body.toLowerCase()}`)) {
    throw new AddressError('INVALID_ADDRESS_CHECKSUM', field);
  }
  return `0x${body.toLowerCase()}`;
}

export function isAddressShape(value) {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
}

export function validChecksum(value) {
  return value === toChecksum(`0x${value.slice(2).toLowerCase()}`);
}

export { walletAddress };
