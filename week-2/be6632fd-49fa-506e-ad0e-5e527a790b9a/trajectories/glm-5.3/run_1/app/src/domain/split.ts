// The largest-remainder split: each stockist gets its proportional share rounded
// down, leftover pieces go one each by largest fractional remainder with ties to
// the earliest request. Decided here alone.
export interface SplitRequest { id: string; requested: number; requestedAt: number | string; }
export interface SplitResult { id: string; quantity: number; }

export function largestRemainderSplit(edition: number, requests: SplitRequest[]): Map<string, number> {
  const result = new Map<string, number>();
  if (requests.length === 0) return result;
  const total = requests.reduce((s, r) => s + r.requested, 0);
  if (total <= edition) {
    for (const r of requests) result.set(r.id, r.requested);
    return result;
  }
  const rows = requests.map(r => {
    const exact = (edition * r.requested) / total;
    const floor = Math.floor(exact);
    return { id: r.id, requested: r.requested, requestedAt: r.requestedAt, floor, frac: exact - floor };
  });
  for (const r of rows) result.set(r.id, r.floor);
  let leftover = edition - rows.reduce((s, r) => s + r.floor, 0);
  // Ties go to the earliest request.
  const byNeed = [...rows].sort((a, b) =>
    b.frac - a.frac || (typeof a.requestedAt === 'number' ? a.requestedAt - (b.requestedAt as number) : String(a.requestedAt).localeCompare(String(b.requestedAt))));
  for (const r of byNeed) {
    if (leftover <= 0) break;
    if (r.frac > 0 || leftover > 0) {
      result.set(r.id, (result.get(r.id) ?? 0) + 1);
      leftover -= 1;
    }
  }
  // Any remainder left after fractional hand-out goes to the earliest requests.
  for (const r of byNeed) {
    if (leftover <= 0) break;
    result.set(r.id, (result.get(r.id) ?? 0) + 1);
    leftover -= 1;
  }
  return result;
}
