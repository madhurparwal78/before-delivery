// Money travels as integer cents; this renders cents as "$<dollars>" with a comma between thousands and two
// decimals, without floats.
export function formatPrice(cents: number): string {
  const whole = String(Math.trunc(cents / 100)).replace(/\B(?=(\d{3})+$)/g, ",");
  const rest = String(cents % 100).padStart(2, "0");
  return `$${whole}.${rest}`;
}
