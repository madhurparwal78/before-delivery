import { createHash, randomBytes } from 'node:crypto';

export const DECIMALS = { usdc: 6n, eth: 18n };

// Exact integer of base units for one whole unit of an asset.
export function scaleOf(asset) {
  return 10n ** DECIMALS[asset];
}

// Amounts are exact base-unit integers, held as BigInt end to end. No Number
// ever touches an amount.

export class AmountError extends Error {
  constructor(code, field) {
    super(code);
    this.code = code;
    this.field = field;
  }
}

const MAX_WHOLE = 1000000000n;

export function parseAmount(value, asset, field, { allowZero = false } = {}) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value)) {
    throw new AmountError('INVALID_AMOUNT', field);
  }
  const [whole, frac = ''] = value.split('.');
  const digits = DECIMALS[asset];
  if (frac.length > Number(digits)) throw new AmountError('AMOUNT_PRECISION', field);
  if (whole.length > 10 || (whole.length === 10 && BigInt(whole) > MAX_WHOLE)) {
    throw new AmountError('AMOUNT_TOO_LARGE', field);
  }
  let raw = BigInt(whole) * 10n ** digits;
  if (frac) raw += BigInt(frac) * 10n ** (digits - BigInt(frac.length));
  if (raw === 0n && !allowZero) throw new AmountError('AMOUNT_NOT_POSITIVE', field);
  return raw;
}

export function parseApprovalFloor(value, asset, field) {
  return parseAmount(value, asset, field, { allowZero: true });
}

export function rawToDisplay(raw, asset) {
  const scale = scaleOf(asset);
  const neg = raw < 0n;
  let n = neg ? -raw : raw;
  const whole = n / scale;
  let frac = (n % scale).toString().padStart(Number(DECIMALS[asset]), '0').replace(/0+$/, '');
  const s = frac ? `${whole}.${frac}` : `${whole}`;
  return neg ? `-${s}` : s;
}

export function rawToString(raw) {
  return raw.toString();
}

// Canonical conversion for ledger/display of numeric columns coming from pg.
export function numToBigInt(v) {
  if (typeof v === 'bigint') return v;
  return BigInt(v.replace(/\.0+$/, ''));
}

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
export const ID_PREFIXES = {
  org: 'org_', mem: 'mem_', key: 'key_', wal: 'wal_', pol: 'pol_',
  agg: 'agg_', kq: 'kq_', int: 'int_', dep: 'dep_', evt: 'evt_', con: 'con_',
};

export function newId(prefix) {
  const bytes = randomBytes(20);
  let s = ID_PREFIXES[prefix];
  for (let i = 0; i < 20; i++) s += ID_ALPHABET[bytes[i] % 36];
  return s;
}

export function newToken() {
  return randomBytes(32).toString('base64url');
}

export function sha256Hex(input) {
  return createHash('sha256').update(input).digest('hex');
}

export function hashPassword(password, salt) {
  return sha256Hex(`${salt}:${password}`);
}

export function verifyPassword(password, salt, hash) {
  return hashPassword(password, salt) === hash;
}

export function newSalt() {
  return randomBytes(16).toString('hex');
}

export function newRequestId() {
  return crypto.randomUUID();
}

export function newAppId() {
  const bytes = randomBytes(12);
  let s = 'app_';
  for (let i = 0; i < 12; i++) s += ID_ALPHABET[bytes[i] % 36];
  return s;
}

export function newWebhookSecret() {
  return `whsec_${randomBytes(16).toString('hex')}`;
}

export function txHash(intentId) {
  return `0x${sha256Hex(`corvo-tx:${intentId}`)}`;
}

export function walletAddress(walletId) {
  return `0x${sha256Hex(`corvo:${walletId}`).slice(0, 40)}`;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function formatTs(d) {
  return `${d.toISOString().slice(0, 19)}Z`;
}

export function formatTsMinutes(d) {
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}
