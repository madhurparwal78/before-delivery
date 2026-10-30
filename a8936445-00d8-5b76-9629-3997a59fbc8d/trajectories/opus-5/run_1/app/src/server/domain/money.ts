/** Half-up rounding for non-negative values. */
export function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}

export function stationTimeCents(minutes: number, hourlyRateCents: number): number {
  return roundHalfUp((minutes * hourlyRateCents) / 60);
}

export function percentOfCents(amountCents: number, percent: number): number {
  return roundHalfUp((amountCents * percent) / 100);
}

export function percentOfMinutes(minutes: number, percent: number): number {
  return roundHalfUp((minutes * percent) / 100);
}

export function formatDollars(amountCents: number): string {
  const sign = amountCents < 0 ? '-' : '';
  const absolute = Math.abs(amountCents);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}

export function formatAmount(amountCents: number): string {
  return `$${formatDollars(amountCents)}`;
}

export function formatHoursMinutes(minutes: number): string {
  const sign = minutes < 0 ? '-' : '';
  const absolute = Math.abs(minutes);
  return `${sign}${Math.floor(absolute / 60)}:${String(absolute % 60).padStart(2, '0')}`;
}
