/** `$1,234.50` from integer cents. */
export function formatMoney(cents: number): string {
  const negative = cents < 0;
  const absolute = Math.abs(cents);
  const whole = Math.trunc(absolute / 100);
  const fraction = String(absolute % 100).padStart(2, '0');
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}$${grouped}.${fraction}`;
}

/** `7.6` from integer tenths of a frame. */
export function formatTenths(tenths: number): string {
  return `${Math.trunc(tenths / 10)}.${Math.abs(tenths % 10)}`;
}

