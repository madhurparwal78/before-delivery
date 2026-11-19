// Occurrences: the single place gathering occurrence times, statuses and
// reminder timing are decided, from the world's clock.
import { formatDisplay, nextWeeklyOccurrence, resolveLocal, localStringIn, ZONES } from './zones';

export interface Occurrence {
  startsAt: string;
  startsLocal: string;
  display: string;
  status: 'upcoming' | 'open' | 'ended';
  note: string | null;
}

export interface GatheringRow {
  id: string;
  community_id: string;
  title: string;
  starts_local: string;
  duration_minutes: number;
  recurrence: string;
  limit_count: number;
}

export function occurrenceStatus(startsAt: Date, now: Date, durationMinutes: number): 'upcoming' | 'open' | 'ended' {
  const start = startsAt.getTime();
  const end = start + durationMinutes * 60000;
  if (now.getTime() >= end) return 'ended';
  if (now.getTime() >= start - 15 * 60000) return 'open';
  return 'upcoming';
}

// Lists up to 8 occurrences from the earliest not ended.
export async function occurrencesOf(gathering: GatheringRow, communityZone: string, viewerZone: string, now: Date): Promise<Occurrence[]> {
  const out: Occurrence[] = [];
  if (gathering.recurrence === 'none') {
    const first = resolveLocal(communityZone, gathering.starts_local);
    const status = occurrenceStatus(first.utc, now, gathering.duration_minutes);
    out.push({
      startsAt: first.utc.toISOString(),
      startsLocal: gathering.starts_local,
      display: formatDisplay(viewerZone, first.utc),
      status,
      note: first.note,
    });
    return out;
  }
  // Walk occurrences until we have 8 from the earliest not ended.
  let current = resolveLocal(communityZone, gathering.starts_local);
  const keep = (occ: { utc: Date; note: string | null }): void => {
    const status = occurrenceStatus(occ.utc, now, gathering.duration_minutes);
    out.push({
      startsAt: occ.utc.toISOString(),
      startsLocal: localStringIn(communityZone, occ.utc),
      display: formatDisplay(viewerZone, occ.utc),
      status,
      note: occ.note,
    });
  };
  let first = true;
  let foundNotEnded = false;
  for (let i = 0; i < 200 && out.length < 8; i++) {
    const status = occurrenceStatus(current.utc, now, gathering.duration_minutes);
    if (status !== 'ended') foundNotEnded = true;
    if (foundNotEnded) {
      keep(current);
      if (out.length >= 8) break;
    }
    first = false;
    void first;
    current = nextWeeklyOccurrence(communityZone, current);
  }
  return out;
}

export async function gatheringOccurrenceStarts(gathering: GatheringRow, communityZone: string, after: Date, limit: number): Promise<Date[]> {
  const out: Date[] = [];
  let current = resolveLocal(communityZone, gathering.starts_local);
  for (let i = 0; i < 500 && out.length < limit; i++) {
    if (current.utc.getTime() >= after.getTime() - 8 * 86400000) out.push(current.utc);
    current = nextWeeklyOccurrence(communityZone, current);
  }
  return out;
}

export async function firstUpcomingOccurrence(gathering: GatheringRow, communityZone: string, now: Date): Promise<{ utc: Date; note: string | null } | null> {
  let current = resolveLocal(communityZone, gathering.starts_local);
  for (let i = 0; i < 500; i++) {
    if (current.utc.getTime() > now.getTime() - gathering.duration_minutes * 60000) return current;
    current = nextWeeklyOccurrence(communityZone, current);
  }
  return null;
}

export function displayOf(occ: { utc: Date }, viewerZone: string): string {
  return formatDisplay(viewerZone, occ.utc);
}

export { formatDisplay, resolveLocal, ZONES, localStringIn };
