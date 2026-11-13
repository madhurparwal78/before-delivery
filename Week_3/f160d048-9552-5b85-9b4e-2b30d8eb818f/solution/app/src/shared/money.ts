export function formatRupees(amount: number): string {
  const digits = String(Math.trunc(amount));
  if (digits.length <= 3) return `₹${digits}`;
  const tail = digits.slice(-3);
  let head = digits.slice(0, -3);
  const groups: string[] = [];
  while (head.length > 2) {
    groups.unshift(head.slice(-2));
    head = head.slice(0, -2);
  }
  if (head) groups.unshift(head);
  return `₹${groups.join(",")},${tail}`;
}

export function formatRange(low: number, high: number): string {
  return `${formatRupees(low)} – ${formatRupees(high)}`;
}
