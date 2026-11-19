import { q, one } from './db.js';

// The single business clock. Stored in Postgres as (real_start, business_start,
// offset). now = real elapsed since last set + anchor.
//
// Layout: on first call, insert a row anchored so that now equals
// CELMATE_START_AT (or the real time at first start). The clock route replaces
// the anchor. Between reads it advances in real time from the anchor.

interface ClockRow { real_anchor: string; business_anchor: string }

let cachedAnchor: { realAnchor: number; businessAnchor: number } | null = null;
let anchorPromise: Promise<{ realAnchor: number; businessAnchor: number }> | null = null;

function toMs(t: string): number { return Date.parse(t); }
function toIso(ms: number): string { return new Date(ms).toISOString().replace(/(\.\d{3})Z$/, '$1Z'); }

export function instant(ms: number): string {
  return new Date(ms).toISOString();
}

async function loadAnchor(): Promise<{ realAnchor: number; businessAnchor: number }> {
  const startAt = process.env.CELMATE_START_AT;
  const real = Date.now();
  const business = startAt ? Date.parse(startAt) : real;
  await q(
    `insert into business_clock (id, started_at, offset_ms, real_at)
     values (1, $1, $2, $3)
     on conflict (id) do nothing`,
    [toIso(business), 0, toIso(real)]
  );
  const row = await one<{ real_at: string; offset_ms: string }>('select real_at, offset_ms from business_clock where id = 1');
  if (!row) return { realAnchor: real, businessAnchor: business };
  // business now = started_at + offset + (real_now - real_at)
  const base = await one<{ started_at: string }>('select started_at from business_clock where id = 1');
  const businessBase = toMs(base!.started_at) + Number(row.offset_ms);
  const realAt = toMs(row.real_at);
  return { realAnchor: realAt, businessAnchor: businessBase };
}

export async function nowMs(): Promise<number> {
  if (!anchorPromise) {
    anchorPromise = loadAnchor().then((a) => { cachedAnchor = a; return a; }).catch((e) => { anchorPromise = null; throw e; });
  }
  const a = await anchorPromise;
  return a.businessAnchor + (Date.now() - a.realAnchor);
}

export async function now(): Promise<string> {
  return instant(await nowMs());
}

/** Advance the stored clock by seconds, or set it to an instant. */
export async function moveClock(params: { advanceSeconds?: number; set?: string }): Promise<string> {
  await nowMs(); // ensure the row exists
  if (params.advanceSeconds !== undefined) {
    await q(`update business_clock set offset_ms = offset_ms + $1 where id = 1`, [params.advanceSeconds * 1000]);
  } else if (params.set) {
    const target = Date.parse(params.set);
    const row = await one<{ now_ms: string }>(
      `select (started_at + offset_ms * interval '1 millisecond') as now_ms from business_clock where id = 1`
    );
    const current = toMs(row!.now_ms);
    const delta = target - current;
    if (delta < 0) return 'invalid';
    await q(`update business_clock set offset_ms = offset_ms + $1 where id = 1`, [delta]);
  }
  anchorPromise = null;
  cachedAnchor = null;
  return now();
}

export function businessElapsed(a: string, b: string): number { return toMs(b) - toMs(a); }
export { toMs as parseInstant, toIso as toIsoInstant };
