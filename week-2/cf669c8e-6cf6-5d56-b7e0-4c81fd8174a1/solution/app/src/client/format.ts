import type { Units } from '../shared/types.js';

export { money } from '../shared/money.js';

/** Millimetres (a decimal string or number with at most one decimal) as `3.0 mm` or `0.118 in`. */
export function length(mm: string | number, units: Units): string {
  if (units === 'metric') return `${typeof mm === 'number' ? mm.toFixed(1) : mm} mm`;
  const tenths = Math.round(Number(mm) * 10);
  return `${inchesFromTenths(tenths)} in`;
}

/** inches = mm / 25.4, three decimals, rounded half up, computed on integers. */
function inchesFromTenths(tenths: number): string {
  const thousandths = Math.floor((Math.abs(tenths) * 1000 * 2 + 254) / (254 * 2));
  const whole = Math.floor(thousandths / 1000);
  return `${tenths < 0 ? '-' : ''}${whole}.${String(thousandths % 1000).padStart(3, '0')}`;
}
