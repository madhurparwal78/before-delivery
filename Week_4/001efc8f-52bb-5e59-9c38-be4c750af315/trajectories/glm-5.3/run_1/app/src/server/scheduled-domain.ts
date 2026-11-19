import type { AppServices } from './context';
import { toLocalIso } from './datetime';

interface ScheduledRow {
  id: string;
  channel_id: string;
  workspace_id: string;
  created_by: string;
  text: string;
  state: string;
  repeat: string;
  local_date: string;
  local_time: string;
  next_fire_at: Date | null;
  last_fired_at: Date | null;
  fired_count: number;
  last_message_id: string | null;
}

function iso(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * The local-time-to-instant conversion and the scheduled post states, in one
 * place. Gap rule: a nonexistent local time moves forward by the gap.
 * Overlap: first occurrence.
 */
export function localTimeToInstant(zone: string, localDate: string, localTime: string, now: Date): Date {
  const [y, mo, d] = localDate.split('-').map(Number);
  const [h, mi] = localTime.split(':').map(Number);
  const naive = Date.UTC(y, mo - 1, d, h, mi, 0);
  const dayStart = new Date(naive - 15 * 3600000);
  const dayEnd = new Date(naive + 15 * 3600000);
  const offAt = (instant: Date): number => {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' });
    const name = fmt.formatToParts(instant).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+00:00';
    const m = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(name);
    if (!m) return 0;
    const sign = m[1] === '-' ? -1 : 1;
    return sign * (Number(m[2]) * 60 + Number(m[3] ?? 0));
  };
  const offsets = new Set<number>([offAt(dayStart), offAt(dayEnd)]);
  const candidates: number[] = [];
  for (const off of offsets) {
    const at = naive - off * 60000;
    const probe = new Date(at);
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const parts = fmt.formatToParts(probe);
    const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '0';
    const hh = get('hour') === '24' ? '00' : get('hour');
    if (Number(get('year')) === y && Number(get('month')) === mo && Number(get('day')) === d
      && Number(hh) === h && Number(get('minute')) === mi) {
      candidates.push(at);
    }
  }
  if (candidates.length === 0) {
    // Spring gap: reading the time with the day's earlier offset lands exactly
    // at the far edge of the jump (02:30 CST = 03:30 CDT at the same instant).
    const offBefore = offAt(dayStart);
    return new Date(naive - offBefore * 60000);
  }
  candidates.sort((a, b) => a - b);
  // Overlap: the first occurrence is the earlier instant.
  return new Date(candidates[0]);
}

/** The next weekly occurrence: exactly 7 local days later at the same wall-clock time. */
export function nextWeeklyAfter(zone: string, previous: Date, hour: number, minute: number): Date | null {
  const probeFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  // Walk whole weeks; each probe is 7 days after the previous fire instant.
  for (let week = 1; week <= 3; week += 1) {
    const probe = new Date(previous.getTime() + week * 7 * 86400000);
    const local = probeFmt.format(probe);
    const candidate = localTimeToInstant(zone, local, `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`, previous);
    if (candidate.getTime() > previous.getTime()) return candidate;
  }
  return null;
}

export async function buildScheduledView(services: AppServices, row: ScheduledRow): Promise<Record<string, unknown>> {
  const zone = (await services.db.pool.query('SELECT time_zone FROM workspaces WHERE id = $1', [row.workspace_id])).rows[0].time_zone;
  const upcomingLocal: string[] = [];
  if (row.state === 'scheduled') {
    if (row.repeat === 'weekly') {
      let cursor = row.next_fire_at as Date | null;
      for (let i = 0; i < 3 && cursor; i += 1) {
        upcomingLocal.push(toLocalIso(zone, cursor));
        const [h, m] = row.local_time.split(':').map(Number);
        cursor = nextWeeklyAfter(zone, cursor, h, m);
      }
    } else {
      upcomingLocal.push(toLocalIso(zone, row.next_fire_at as Date));
    }
  }
  return {
    id: row.id,
    channel_id: row.channel_id,
    text: row.text,
    state: row.state,
    repeat: row.repeat,
    local_date: row.local_date,
    local_time: row.local_time,
    time_zone: zone,
    next_fire_at: row.next_fire_at ? iso(row.next_fire_at) : null,
    next_fire_local: row.next_fire_at ? toLocalIso(zone, row.next_fire_at) : null,
    upcoming_local: upcomingLocal,
    fired_count: row.fired_count,
    last_message_id: row.last_message_id,
  };
}
