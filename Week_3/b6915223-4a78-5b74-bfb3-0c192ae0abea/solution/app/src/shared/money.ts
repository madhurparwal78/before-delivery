// Money is whole tenths of a million everywhere; this is the only place it becomes text.
export function formatTenths(tenths: number): string {
  const sign = tenths < 0 ? "-" : "";
  const magnitude = Math.abs(tenths);
  return `${sign}${Math.trunc(magnitude / 10)}.${magnitude % 10}`;
}
