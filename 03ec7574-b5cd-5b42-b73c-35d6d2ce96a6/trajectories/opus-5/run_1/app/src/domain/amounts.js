export const ASSET_DECIMALS = { usdc: 6, eth: 18 };
export const ASSETS = Object.keys(ASSET_DECIMALS);

const AMOUNT_PATTERN = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;
const MAX_WHOLE_UNITS = 1000000000n;

export class AmountError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export function decimalsFor(asset) {
  return ASSET_DECIMALS[asset];
}

/**
 * Parses the pinned string form of an amount into exact base units.
 * `allowZero` is used by approval_floor, the one field that accepts zero.
 */
export function parseAmount(value, asset, { allowZero = false } = {}) {
  if (typeof value !== 'string' || !AMOUNT_PATTERN.test(value)) throw new AmountError('INVALID_AMOUNT');
  const decimals = decimalsFor(asset);
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > decimals) throw new AmountError('AMOUNT_PRECISION');
  const raw = BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction + '0'.repeat(decimals)).slice(0, decimals) || '0');
  if (raw === 0n && !allowZero) throw new AmountError('AMOUNT_NOT_POSITIVE');
  if (raw > MAX_WHOLE_UNITS * 10n ** BigInt(decimals)) throw new AmountError('AMOUNT_TOO_LARGE');
  return raw;
}

export function formatAmount(raw, asset) {
  const decimals = decimalsFor(asset);
  const value = BigInt(raw);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const scale = 10n ** BigInt(decimals);
  const whole = abs / scale;
  const fraction = (abs % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

export function isRawIntegerString(value) {
  return typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value);
}

/** Policy comparison values arrive as a JSON integer or a digit string. */
export function policyIntegerValue(value) {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0) return null;
    return BigInt(value);
  }
  if (isRawIntegerString(value)) return BigInt(value);
  return null;
}
