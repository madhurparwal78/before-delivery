export function isoUtc(date: Date): string {
  return `${date.toISOString().slice(0, 19)}Z`;
}
