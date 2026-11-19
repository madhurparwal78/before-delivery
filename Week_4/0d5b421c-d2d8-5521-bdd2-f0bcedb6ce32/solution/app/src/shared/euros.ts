// Money is integer euro cents everywhere; it becomes text only here, at the edge.

export function formatEuros(cents: number): string {
  const whole = Math.trunc(cents / 100);
  const rest = String(cents % 100).padStart(2, "0");
  return `${whole}.${rest}`;
}
