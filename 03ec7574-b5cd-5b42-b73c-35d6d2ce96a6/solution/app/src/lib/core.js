import crypto from 'node:crypto';
import { keccak256Hex } from './keccak.js';

export class ApiError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// ---------------------------------------------------------------- amounts
export const DECIMALS = { usdc: 6, eth: 18 };
const AMOUNT_RE = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;
const MAX_WHOLE = 1000000000n;

// Parses a request amount string into exact base units; every refusal names its field.
export function parseAmount(value, asset, field = 'amount', { allowZero = false } = {}) {
  if (typeof value !== 'string' || !AMOUNT_RE.test(value)) {
    throw new ApiError(422, 'INVALID_AMOUNT', 'Enter an amount like 1250 or 0.5', { field });
  }
  const places = DECIMALS[asset];
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > places) {
    throw new ApiError(422, 'AMOUNT_PRECISION', `This asset allows at most ${places} decimal places.`, { field });
  }
  const unit = 10n ** BigInt(places);
  const raw = BigInt(whole) * unit + BigInt(fraction.padEnd(places, '0') || '0');
  if (raw === 0n && !allowZero) {
    throw new ApiError(422, 'AMOUNT_NOT_POSITIVE', 'The amount must be greater than zero.', { field });
  }
  if (raw > MAX_WHOLE * unit) {
    throw new ApiError(422, 'AMOUNT_TOO_LARGE', 'The amount may not exceed 1000000000 whole units.', { field });
  }
  return raw;
}

// The integer part, then a dot and the fraction without trailing zeros when the fraction is not zero.
export function formatAmount(raw, asset) {
  const places = DECIMALS[asset];
  const value = BigInt(raw);
  const unit = 10n ** BigInt(places);
  const fraction = value % unit;
  const whole = (value / unit).toString();
  if (fraction === 0n) return whole;
  return `${whole}.${fraction.toString().padStart(places, '0').replace(/0+$/, '')}`;
}

// ---------------------------------------------------------------- addresses
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function walletAddress(walletId) {
  return `0x${sha256Hex(`corvo:${walletId}`).slice(0, 40)}`;
}

export function checksumAddress(lower) {
  const hex = lower.slice(2);
  const hash = keccak256Hex(hex);
  return `0x${[...hex].map((ch, i) => (Number.parseInt(hash[i], 16) >= 8 ? ch.toUpperCase() : ch)).join('')}`;
}

// 'ok' with the lowercase form, or the refusal code for the value.
export function readAddress(value) {
  if (typeof value !== 'string' || !ADDRESS_RE.test(value)) return { code: 'INVALID_ADDRESS' };
  const hex = value.slice(2);
  const lower = `0x${hex.toLowerCase()}`;
  const mixed = hex !== hex.toLowerCase() && hex !== hex.toUpperCase();
  if (mixed && checksumAddress(lower) !== value) return { code: 'INVALID_ADDRESS_CHECKSUM' };
  return { code: 'ok', address: lower };
}

export const ADDRESS_MESSAGES = {
  INVALID_ADDRESS: 'An address is 0x followed by 40 hex digits.',
  INVALID_ADDRESS_CHECKSUM: 'This mixed-case address does not match its EIP-55 checksum.',
};

export function txHash(intentId) {
  return `0x${sha256Hex(`corvo-tx:${intentId}`)}`;
}

// ---------------------------------------------------------------- hashing, secrets and ids
export function sha256Hex(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

export function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString('hex');
}

// Ids are a prefix and 20 lowercase letters or digits: a time-ordered part, then a random part.
let lastTick = 0;
export function newId(prefix) {
  const tick = Math.max(Date.now() * 1000, lastTick + 1);
  lastTick = tick;
  const random = [...crypto.randomBytes(9)].map((b) => (b % 36).toString(36)).join('');
  return `${prefix}_${tick.toString(36).padStart(11, '0')}${random}`;
}

export function hashPassword(password) {
  const salt = randomHex(16);
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function checkPassword(password, stored) {
  const [, salt, hash] = String(stored).split('$');
  const candidate = crypto.scryptSync(String(password), salt, 32);
  return crypto.timingSafeEqual(candidate, Buffer.from(hash, 'hex'));
}

// Keys sorted at every depth, separators "," and ":", non-ASCII written as itself.
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

export function hmacBase64(secret, text) {
  return crypto.createHmac('sha256', Buffer.from(secret, 'utf8')).update(text, 'utf8').digest('base64');
}

// ---------------------------------------------------------------- time
// Server time in whole seconds; every stored timestamp is truncated to the second.
export function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

export function toDate(seconds) {
  return new Date(seconds * 1000);
}

export function toSeconds(value) {
  return Math.floor(new Date(value).getTime() / 1000);
}

// YYYY-MM-DDTHH:MM:SSZ
export function iso(value) {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
