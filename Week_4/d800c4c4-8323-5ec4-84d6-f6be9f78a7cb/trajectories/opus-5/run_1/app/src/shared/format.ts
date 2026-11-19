/** Money leaves the server as integer cents and is printed in exactly one way. */
export function formatDollars(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  const whole = Math.floor(absolute / 100);
  const fraction = String(absolute % 100).padStart(2, '0');
  return `${sign}${whole.toLocaleString('en-US')}.${fraction}`;
}

export function overdueLine(openDaysLate: number, lateFeeSoFarCents: number): string {
  const days = openDaysLate === 1 ? '1 open day late' : `${openDaysLate} open days late`;
  return `Overdue — ${days}, $${formatDollars(lateFeeSoFarCents)} so far`;
}

export function openDaysPhrase(openDays: number): string {
  return openDays === 1 ? '1 open day late' : `${openDays} open days late`;
}

export function capitaliseWeekday(weekday: string): string {
  return weekday.charAt(0).toUpperCase() + weekday.slice(1);
}
