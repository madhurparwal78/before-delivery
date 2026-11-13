// Cluster-local time handling. The one place that resolves a local wall-clock time
// in a cluster's IANA zone, including the gap and overlap rule for clock changes.

export const DAY_INDEX: Record<string, number> = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };

const WEEKDAY_NAMES = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

// Offset (ms) the zone is ahead of UTC at the given instant.
export function zoneOffsetMs(zone: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(at);
  const map: Record<string, string> = {};
  for (const part of parts) map[part.type] = part.value;
  const asUTC = Date.UTC(
    Number(map.year), Number(map.month) - 1, Number(map.day),
    Number(map.hour) % 24, Number(map.minute), Number(map.second),
  );
  return asUTC - at.getTime();
}

// Local wall-clock ms of an instant in the zone.
function wallMs(zone: string, at: Date): number {
  return at.getTime() + zoneOffsetMs(zone, at);
}

// Convert a local wall-clock time in `zone` to a UTC instant.
// Gap: a time that does not exist moves forward by the length of the gap.
// Overlap: a time that occurs twice uses the earlier occurrence.
export function localToInstant(zone: string, y: number, m: number, d: number, hh: number, mm: number): Date {
  const wall = Date.UTC(y, m - 1, d, hh, mm, 0, 0);
  const o0 = zoneOffsetMs(zone, new Date(wall));
  const t1 = new Date(wall - o0);
  const o1 = zoneOffsetMs(zone, t1);
  if (o1 === o0 && wallMs(zone, t1) === wall) {
    // t1 reads back as the wanted wall time. It may be the later of two
    // occurrences; prefer the earlier one when the clocks went back.
    const PROBE = 3 * 3600_000;
    const oBefore = zoneOffsetMs(zone, new Date(t1.getTime() - PROBE));
    if (oBefore > o1) {
      const earlier = new Date(wall - oBefore);
      if (zoneOffsetMs(zone, earlier) === oBefore && wallMs(zone, earlier) === wall) return earlier;
    }
    return t1;
  }
  // The wall time does not exist (gap) or the naive guess straddled a transition.
  const PROBE = 3 * 3600_000;
  const oBefore = zoneOffsetMs(zone, new Date(t1.getTime() - PROBE));
  const oAfter = zoneOffsetMs(zone, new Date(t1.getTime() + PROBE));
  if (oBefore !== oAfter) {
    const shifted = new Date(wall - oBefore);
    const oShifted = zoneOffsetMs(zone, shifted);
    if (oShifted === oBefore && wallMs(zone, shifted) === wall) return shifted; // earlier occurrence
    const gap = oAfter - oBefore;
    if (oShifted === oAfter && wallMs(zone, shifted) === wall + gap) return shifted; // moved forward by the gap
  }
  return t1;
}

// Convert an instant to cluster local parts.
export function instantToLocal(zone: string, at: Date): { y: number; m: number; d: number; hh: number; mm: number; weekday: number } {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hour12: false, weekday: 'short',
  });
  const parts = dtf.formatToParts(at);
  const map: Record<string, string> = {};
  for (const part of parts) map[part.type] = part.value;
  const weekdayNames: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  return {
    y: Number(map.year),
    m: Number(map.month),
    d: Number(map.day),
    hh: Number(map.hour) % 24,
    mm: Number(map.minute),
    weekday: weekdayNames[map.weekday] ?? -1,
  };
}

// Cluster time format: YYYY-MM-DD HH:mm Europe/London
export function clusterTimeString(zone: string, at: Date): string {
  const l = instantToLocal(zone, at);
  return `${pad(l.y)}-${pad(l.m)}-${pad(l.d)} ${pad(l.hh)}:${pad(l.mm)} ${zone}`;
}

// Local date-time without the zone suffix: YYYY-MM-DD HH:mm
export function localTimeString(zone: string, at: Date): string {
  const l = instantToLocal(zone, at);
  return `${pad(l.y)}-${pad(l.m)}-${pad(l.d)} ${pad(l.hh)}:${pad(l.mm)}`;
}

export function pad(n: number): string {
  return String(n).padStart(2, '0');
}

// The single rule that decides whether an instant falls inside a weekly window
// in the cluster's zone. Start inclusive, end exclusive, 24:00 is next midnight.
export function windowContains(zone: string, days: string[], startHHMM: string, endHHMM: string, at: Date): boolean {
  const l = instantToLocal(zone, at);
  const dayName = WEEKDAY_NAMES[l.weekday];
  if (!dayName || !days.includes(dayName)) return false;
  const minutes = l.hh * 60 + l.mm;
  const [sh, sm] = startHHMM.split(':').map(Number);
  const [eh, em] = endHHMM.split(':').map(Number);
  return minutes >= sh * 60 + sm && minutes < eh * 60 + em;
}

export interface WindowOpening {
  window_id: string;
  label: string;
  opens_at: Date;
  closes_at: Date;
}

// Next `count` openings whose opens_at is at or after `from`, chronological.
export function nextOpenings(
  zone: string,
  windows: { id: string; label: string; days: string[]; start: string; end: string }[],
  from: Date,
  count: number,
): WindowOpening[] {
  if (windows.length === 0) return [];
  const seen = new Map<string, WindowOpening>();
  const local = instantToLocal(zone, from);
  let day = new Date(localToInstant(zone, local.y, local.m, local.d, 0, 0));
  for (let i = 0; i < 62; i++) {
    for (const w of windows) {
      const l = instantToLocal(zone, day);
      const dayName = WEEKDAY_NAMES[l.weekday];
      if (!dayName || !w.days.includes(dayName)) continue;
      const [sh, sm] = w.start.split(':').map(Number);
      const [eh, em] = w.end.split(':').map(Number);
      const opens = localToInstant(zone, l.y, l.m, l.d, sh, sm);
      if (opens.getTime() < from.getTime()) continue;
      const closes = eh === 24 && em === 0
        ? nextLocalMidnight(zone, l.y, l.m, l.d)
        : localToInstant(zone, l.y, l.m, l.d, eh, em);
      seen.set(`${w.id}|${opens.toISOString()}`, { window_id: w.id, label: w.label, opens_at: opens, closes_at: closes });
    }
    if (seen.size >= count) break;
    const nl = instantToLocal(zone, new Date(day.getTime() + 24 * 3600_000));
    day = new Date(localToInstant(zone, nl.y, nl.m, nl.d, 0, 0));
  }
  return [...seen.values()].sort((a, b) => a.opens_at.getTime() - b.opens_at.getTime()).slice(0, count);
}

function nextLocalMidnight(zone: string, y: number, m: number, d: number): Date {
  const base = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  const next = new Date(base + 24 * 3600_000);
  const l = instantToLocal('UTC', next);
  return localToInstant(zone, l.y, l.m, l.d, 0, 0);
}
