// Money is integer cents everywhere. Dollar strings are built by integer arithmetic,
// never through floating point.

export function dollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(cents));
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  return `${sign}$${whole}.${frac < 10 ? "0" : ""}${frac}`;
}

// Plain dollars for CSV: positive, two decimals, no sign.
export function dollarsPlain(cents: number): string {
  const abs = Math.abs(Math.trunc(cents));
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  return `${whole}.${frac < 10 ? "0" : ""}${frac}`;
}

// Amount value for a JSON body consumed by Kill Bill (dollars, two decimals).
export function dollarsJson(cents: number): string {
  const abs = Math.abs(Math.trunc(cents));
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  return `${cents < 0 ? "-" : ""}${whole}.${frac < 10 ? "0" : ""}${frac}`;
}
