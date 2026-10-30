// Clashes compare real instants: two sessions clash when their intervals overlap; a session ending at
// the instant another starts does not clash with it.

type Interval = { id: string; startsAt: number; endsAt: number };

function clashes(a: Interval, b: Interval): boolean {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}

/** Every clashing pair among the given sessions, each pair once, in input order. */
export function clashPairs(items: readonly Interval[]): [string, string][] {
  const pairs: [string, string][] = [];
  items.forEach((a, i) => items.slice(i + 1).forEach((b) => { if (clashes(a, b)) pairs.push([a.id, b.id]); }));
  return pairs;
}
