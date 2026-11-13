/** Integer cents as dollars with thousands commas and two decimals, for example $1,204.50. */
export function formatDollars(cents: number): string {
  const whole = Math.trunc(Math.abs(cents) / 100);
  const fraction = String(Math.abs(cents) % 100).padStart(2, "0");
  return `${cents < 0 ? "-" : ""}$${String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`;
}
