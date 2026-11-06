import { exactUnits, formatUnits, roundHalfEven } from './decimal.js';

export const QUANTITY_SCALE = 3;
export const MONEY_SCALE = 2;

const QUANTITY_MIN = 1n; // 0.001
const QUANTITY_MAX = 9999999n; // 9999.999
const UNIT_COST_MAX = 9999999n; // 99999.99
const AMOUNT_LIMIT = 9999999n; // 99999.99
const PERCENT_MAX = 2500n; // 25.00

/** Quantities and costs are only ever read from plain, unsigned decimal strings. */
export function readQuantity(value: unknown): bigint | null {
  if (typeof value !== 'string') return null;
  const units = exactUnits(value, QUANTITY_SCALE);
  if (units === null || units < QUANTITY_MIN || units > QUANTITY_MAX) return null;
  if (value.startsWith('-')) return null;
  return units;
}

export function readUnitCost(value: unknown): bigint | null {
  if (typeof value !== 'string') return null;
  const units = exactUnits(value, MONEY_SCALE);
  if (units === null || units < 0n || units > UNIT_COST_MAX) return null;
  if (value.startsWith('-')) return null;
  return units;
}

export function readChangeOrderAmount(value: unknown): bigint | null {
  if (typeof value !== 'string') return null;
  const units = exactUnits(value, MONEY_SCALE);
  if (units === null || units === 0n) return null;
  if (units > AMOUNT_LIMIT || units < -AMOUNT_LIMIT) return null;
  return units;
}

export function readContingencyPercent(value: unknown): bigint | null {
  if (typeof value !== 'string') return null;
  const units = exactUnits(value, MONEY_SCALE);
  if (units === null || units < 0n || units > PERCENT_MAX) return null;
  if (value.startsWith('-')) return null;
  return units;
}

export function formatQuantity(units: bigint | null): string | null {
  return units === null ? null : formatUnits(units, QUANTITY_SCALE);
}

export function formatMoney(units: bigint | null): string | null {
  return units === null ? null : formatUnits(units, MONEY_SCALE);
}

/** quantity x unit cost, computed exactly then rounded half to even to cents. */
export function lineTotal(quantity: bigint | null, unitCost: bigint | null): bigint {
  if (quantity === null || unitCost === null) return 0n;
  const product = quantity * unitCost; // units of 10^-5
  return roundHalfEven(product, 1000n);
}

/** (base) x percent / 100, rounded half to even to cents, never below zero. */
export function contingencyAmount(base: bigint, percentUnits: bigint): bigint {
  if (base < 0n) return 0n;
  return roundHalfEven(base * percentUnits, 10000n);
}
