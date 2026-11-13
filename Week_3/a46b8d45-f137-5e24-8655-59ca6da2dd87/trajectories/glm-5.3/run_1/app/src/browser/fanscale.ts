// The fan's scale attribute: 1 − 0.25 × s with exactly 3 decimals, half-up.
export function fanScale(s: number): string {
  const exact = 1 - 0.25 * s;
  const scaled = Math.floor(exact * 1000 + 0.5 + 1e-9);
  const units = Math.floor(scaled / 1000);
  const rest = scaled % 1000;
  return `${units}.${String(rest).padStart(3, '0')}`;
}
