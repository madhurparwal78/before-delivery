/** Formats integer paise with Indian digit grouping: no decimals on whole rupees, two otherwise. */
export function rupees(paise: number): string {
  const whole = Math.trunc(paise / 100);
  const rest = paise % 100;
  const digits = String(whole);
  const tail = digits.slice(-3);
  const head = digits.slice(0, -3);
  const grouped = head ? `${head.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${tail}` : tail;
  return `₹${grouped}${rest ? `.${String(rest).padStart(2, "0")}` : ""}`;
}
