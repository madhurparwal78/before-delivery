import type { App } from './api.js';
import type { Ctx } from './http.js';
import { ApiError, fieldErrors, notFound, stateConflict, forbidden, tooLarge, unsupportedMediaType } from './errors.js';
import { isRecord, str, whole, bool, lengthOf } from './validate.js';
import { computePassage, haversineNm, type Anchorage, type LegInput } from '../shared/passage.js';
import * as base from '../shared/bases.js';
import type { Base } from '../shared/bases.js';
import { parseMultipart, readRawBody } from './http.js';
import { putObject, StorageUnavailable } from './minio.js';
import { parseImage } from './photos.js';
import type { YachtDb } from './endpoints-holds.js';
import { getYacht } from './endpoints-holds.js';
import { checkRestRules, type Slot } from './rota.js';
import { daySlots } from '../shared/bases.js';

const LOG_LIMIT = 2000000;
const LOG_ENVELOPE = 100000;

// ---------------- passages ----------------

async function anchoragesFor(app: App, ws: string): Promise<Anchorage[]> {
  const rows = await app.pool.query('SELECT id, name, base, latitude, longitude FROM anchorages WHERE workspace_slug = $1 ORDER BY sort_order', [ws]);
  return rows.rows.map((r) => ({ id: r.id, name: r.name, base: r.base as Base, latitude: r.latitude, longitude: r.longitude }));
}

function speedKn(v: unknown): string | null {
  if (typeof v !== 'number' && typeof v !== 'string') return null;
  const d = Number(v);
  if (!Number.isFinite(d)) return null;
  if (d < 4 || d > 12) return null;
  const rounded = Math.round(d * 2) / 2;
  return rounded.toFixed(1);
}

export async function passagesList(app: App, ctx: Ctx, ws: string): Promise<unknown> {
  const member = await app.requireStaff(ctx, ws, ['fleet_director', 'captain', 'crew_member']);
  const yachtSlug = ctx.query.get('yachtSlug');
  const params: unknown[] = [ws];
  let sql = 'SELECT * FROM passages WHERE workspace_slug = $1';
  if (yachtSlug) {
    params.push(yachtSlug);
    sql += ` AND yacht_slug = $${params.length}`;
  }
  sql += ' ORDER BY departs_at';
  const rows = await app.pool.query(sql, params);
  const out = [];
  for (const p of rows.rows) {
    if (member.role === 'crew_member') {
      if (p.yacht_slug !== member.yacht_slug || p.status !== 'sent') continue;
    }
    out.push(await passageToApi(app, ws, p));
  }
  return { passages: out };
}

export async function passageGet(app: App, ctx: Ctx, ws: string, id: string): Promise<unknown> {
  const member = await app.requireStaff(ctx, ws, ['fleet_director', 'captain', 'crew_member']);
  const rows = await app.pool.query('SELECT * FROM passages WHERE id = $1 AND workspace_slug = $2', [id, ws]);
  const p = rows.rows[0];
  if (!p) throw notFound();
  if (member.role === 'crew_member') {
    if (p.yacht_slug !== member.yacht_slug) throw notFound();
    if (p.status !== 'sent') throw notFound();
  }
  return { passage: await passageToApi(app, ws, p) };
}

async function passageToApi(app: App, ws: string, p: any): Promise<unknown> {
  const legs = await app.pool.query('SELECT * FROM passage_legs WHERE passage_id = $1 ORDER BY idx', [p.id]);
  const yacht = await getYacht(app, ws, p.yacht_slug, true);
  const anchorages = await anchoragesFor(app, ws);
  const map = new Map(anchorages.map((a) => [a.id, a]));
  const departsWall = wallOf(base.localParts(p.base === 'split' ? 'split' : 'lavrio', { ms: p.departs_at.getTime() }));
  const legInputs: LegInput[] = legs.rows.map((l) => ({ toAnchorageId: l.to_anchorage_id, speedKn: l.speed_kn }));
  const computed = computePassage(
    {
      anchorages: map,
      startAnchorageId: p.start_anchorage_id,
      startChargePct: p.start_charge_pct,
      departsAt: { ms: p.departs_at.getTime() },
      params: { batteryKwh: yacht.battery_kwh, hotelKw: yacht.hotel_kw, solarKw: yacht.solar_kw, dragKwPerKnCubed: yacht.drag_kw_per_kn_cubed },
    },
    legInputs,
  );
  return {
    id: p.id,
    yachtSlug: p.yacht_slug,
    name: p.name,
    status: p.status,
    base: p.base,
    startAnchorageId: p.start_anchorage_id,
    departureDate: p.departure_date,
    departureTime: p.departure_time,
    departsAt: base.instToIso({ ms: p.departs_at.getTime() }),
    startChargePct: p.start_charge_pct,
    legs: computed.legs.map((l) => ({
      index: l.index,
      fromAnchorageId: l.fromAnchorageId,
      toAnchorageId: l.toAnchorageId,
      speedKn: Number(l.speedKn),
      distanceNm: Number(l.distanceNm),
      departsAt: l.departsAt,
      arrivesAt: l.arrivesAt,
      arrivalBase: l.arrivalBase,
      arrivalChargePct: l.arrivalChargePct,
      reserve: l.reserve,
    })),
    minChargePct: computed.minChargePct,
    updatedAt: base.instToIso({ ms: p.updated_at.getTime() }),
  };
}

function wallOf(p: { hour: number; minute: number }): string {
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

interface PassageBody {
  name: string;
  startAnchorageId: string;
  departureDate: string;
  departureTime: string;
  startChargePct: number;
  legs: LegInput[];
}

function parsePassageBody(body: Record<string, unknown>, yacht: YachtDb): { parsed: PassageBody } | { errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const name = str(body.name) ?? '';
  const startAnchorageId = str(body.startAnchorageId) ?? '';
  const departureDate = str(body.departureDate) ?? '';
  const departureTime = str(body.departureTime) ?? '';
  const startChargePct = whole(body.startChargePct);
  if (lengthOf(name) < 1 || lengthOf(name) > 80) errors.name = 'This field is required.';
  if (!startAnchorageId) errors.startAnchorageId = 'Choose one of the listed options.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(departureDate)) errors.departureDate = 'Enter a date as YYYY-MM-DD.';
  if (!/^\d{2}:\d{2}$/.test(departureTime)) errors.departureTime = 'Enter a time as HH:MM.';
  if (startChargePct === null || startChargePct < 0 || startChargePct > 100) errors.startChargePct = 'Enter a whole number from 0 to 100.';
  const legsIn = Array.isArray(body.legs) ? body.legs : [];
  if (legsIn.length > 12) errors.legs = 'Use at most 12 legs.';
  const legs: LegInput[] = [];
  legsIn.forEach((raw, i) => {
    if (!isRecord(raw)) return;
    const to = str(raw.toAnchorageId) ?? '';
    const speed = speedKn(raw.speedKn);
    if (!to) errors[`legs.${i}.toAnchorageId`] = 'Choose one of the listed options.';
    if (speed === null) errors[`legs.${i}.speedKn`] = 'Choose a speed from 4.0 to 12.0 kn in 0.5 kn steps.';
    legs.push({ toAnchorageId: to, speedKn: speed ?? '6.0' });
  });
  if (Object.keys(errors).length > 0) return { errors };
  return { parsed: { name, startAnchorageId, departureDate, departureTime, startChargePct: startChargePct!, legs } };
}

function departureInstant(baseZone: Base, date: string, time: string): { utcMs: number | null } {
  const d = base.parseYmd(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!d || !t) return { utcMs: null };
  const wall = base.wallToUtc(baseZone, d.year, d.month, d.day, Number(t[1]), Number(t[2]));
  return { utcMs: wall.utcMs };
}

export async function passagesCreate(app: App, ctx: Ctx, ws: string): Promise<unknown> {
  const member = await app.requireStaff(ctx, ws, ['fleet_director', 'captain']);
  const body = await app.readJsonBody(ctx);
  const yachtSlug = str(body.yachtSlug);
  if (!yachtSlug) throw fieldErrors({ yachtSlug: 'Choose one of the listed options.' });
  const yacht = await getYacht(app, ws, yachtSlug, true);
  const anchorages = await anchoragesFor(app, ws);
  const anchorageIds = new Set(anchorages.map((a) => a.id));
  const result = parsePassageBody(body, yacht);
  if ('errors' in result) throw fieldErrors(result.errors);
  const parsed = result.parsed;
  if (!anchorageIds.has(parsed.startAnchorageId)) throw fieldErrors({ startAnchorageId: 'Choose one of the listed options.' });
  for (let i = 0; i < parsed.legs.length; i++) {
    if (!anchorageIds.has(parsed.legs[i].toAnchorageId)) throw fieldErrors({ [`legs.${i}.toAnchorageId`]: 'Choose one of the listed options.' });
  }
  const dep = departureInstant(yacht!.base, parsed.departureDate, parsed.departureTime);
  if (dep.utcMs === null) {
    throw fieldErrors({ departureTime: "That time doesn't exist here — the clocks go forward an hour." });
  }
  const id = 'passage-' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
  const client = await app.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO passages (id, workspace_slug, yacht_slug, name, status, base, start_anchorage_id, departure_date, departure_time, departs_at, start_charge_pct, updated_at)
       VALUES ($1,$2,$3,$4,'draft',$5,$6,$7,$8,$9,$10,now())`,
      [id, ws, yachtSlug, parsed.name, yacht.base, parsed.startAnchorageId, parsed.departureDate, parsed.departureTime, new Date(dep.utcMs), parsed.startChargePct],
    );
    for (let i = 0; i < parsed.legs.length; i++) {
      await client.query('INSERT INTO passage_legs (id, passage_id, idx, to_anchorage_id, speed_kn) VALUES ($1,$2,$3,$4,$5)', ['leg-' + Math.random().toString(36).slice(2, 12), id, i, parsed.legs[i].toAnchorageId, parsed.legs[i].speedKn]);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  const fresh = await app.pool.query('SELECT * FROM passages WHERE id = $1', [id]);
  return { passage: await passageToApi(app, ws, fresh.rows[0]) };
}

export async function passagePut(app: App, ctx: Ctx, ws: string, id: string): Promise<unknown> {
  const member = await app.requireStaff(ctx, ws, ['fleet_director', 'captain']);
  const rows = await app.pool.query('SELECT * FROM passages WHERE id = $1 AND workspace_slug = $2', [id, ws]);
  const p = rows.rows[0];
  if (!p) throw notFound();
  const body = await app.readJsonBody(ctx);
  const yacht = await getYacht(app, ws, p.yacht_slug, true);
  const anchorages = await anchoragesFor(app, ws);
  const anchorageIds = new Set(anchorages.map((a) => a.id));
  const result = parsePassageBody(body, yacht);
  if ('errors' in result) throw fieldErrors(result.errors);
  const parsed = result.parsed;
  if (!anchorageIds.has(parsed.startAnchorageId)) throw fieldErrors({ startAnchorageId: 'Choose one of the listed options.' });
  for (let i = 0; i < parsed.legs.length; i++) {
    if (!anchorageIds.has(parsed.legs[i].toAnchorageId)) throw fieldErrors({ [`legs.${i}.toAnchorageId`]: 'Choose one of the listed options.' });
  }
  const dep = departureInstant(yacht!.base, parsed.departureDate, parsed.departureTime);
  if (dep.utcMs === null) {
    throw fieldErrors({ departureTime: "That time doesn't exist here — the clocks go forward an hour." });
  }
  const client = await app.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM passage_legs WHERE passage_id = $1', [id]);
    for (let i = 0; i < parsed.legs.length; i++) {
      await client.query('INSERT INTO passage_legs (id, passage_id, idx, to_anchorage_id, speed_kn) VALUES ($1,$2,$3,$4,$5)', ['leg-' + Math.random().toString(36).slice(2, 12), id, i, parsed.legs[i].toAnchorageId, parsed.legs[i].speedKn]);
    }
    await client.query(
      `UPDATE passages SET name = $1, start_anchorage_id = $2, departure_date = $3, departure_time = $4, departs_at = $5, start_charge_pct = $6, status = 'draft', updated_at = now() WHERE id = $7`,
      [parsed.name, parsed.startAnchorageId, parsed.departureDate, parsed.departureTime, new Date(dep.utcMs), parsed.startChargePct, id],
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  const fresh = await app.pool.query('SELECT * FROM passages WHERE id = $1', [id]);
  return { passage: await passageToApi(app, ws, fresh.rows[0]) };
}

export async function passageSend(app: App, ctx: Ctx, ws: string, id: string): Promise<unknown> {
  await app.requireStaff(ctx, ws, ['fleet_director', 'captain']);
  const rows = await app.pool.query('SELECT * FROM passages WHERE id = $1 AND workspace_slug = $2', [id, ws]);
  const p = rows.rows[0];
  if (!p) throw notFound();
  const api = await passageToApi(app, ws, p);
  const legs = (api as any).legs as Array<{ reserve: string }>;
  if (legs.length === 0) throw stateConflict('no_legs');
  const below = legs.findIndex((l) => l.reserve === 'below_reserve');
  if (below !== -1) throw stateConflict('below_reserve', { legIndex: below });
  await app.pool.query("UPDATE passages SET status = 'sent', updated_at = now() WHERE id = $1", [id]);
  const fresh = await app.pool.query('SELECT * FROM passages WHERE id = $1', [id]);
  return { passage: await passageToApi(app, ws, fresh.rows[0]) };
}

// ---------------- rota ----------------

export async function rotaGet(app: App, ctx: Ctx, ws: string, yachtSlug: string): Promise<unknown> {
  const member = await app.requireStaff(ctx, ws, ['fleet_director', 'captain', 'crew_member']);
  const yacht = await getYacht(app, ws, yachtSlug, true);
  if (member.role === 'crew_member' && member.yacht_slug !== yachtSlug) throw notFound();
  const weekStart = ctx.query.get('weekStart') ?? '';
  if (!base.isSaturday(yacht.base, weekStart)) throw fieldErrors({ weekStart: 'Choose a Saturday.' });
  const crew = await app.pool.query('SELECT id, name, position FROM crew WHERE yacht_slug = $1 ORDER BY sort_order', [yachtSlug]);
  const slots: Slot[] = [];
  for (let d = 0; d < 7; d++) {
    const date = base.addDays(weekStart, d);
    for (const s of base.daySlots(yacht.base, date)) {
      slots.push({ startsAtMs: s.startsAt.ms, endsAtMs: s.startsAt.ms + 1800000, label: s.label, date, repeated: s.repeated });
    }
  }
  const saved = await app.pool.query('SELECT version, saved_by, saved_at, work FROM rotas WHERE yacht_slug = $1 AND week_start = $2', [yachtSlug, weekStart]);
  const row = saved.rows[0];
  const savedByName = row?.saved_by ? (await app.pool.query('SELECT name FROM members WHERE id = $1', [row.saved_by])).rows[0]?.name ?? null : null;
  const work: Record<string, string[]> = row?.work ?? {};
  return {
    yachtSlug,
    weekStart,
    base: yacht.base,
    version: row?.version ?? 0,
    savedBy: savedByName,
    savedAt: row?.saved_at ? base.instToIso({ ms: row.saved_at.getTime() }) : null,
    crew: crew.rows,
    slots: slots.map((s) => ({ startsAt: base.instToIso({ ms: s.startsAtMs }), date: s.date, label: s.label })),
    work: Object.fromEntries(Object.entries(work).map(([k, v]) => [k, v])),
  };
}

export async function rotaPut(app: App, ctx: Ctx, ws: string, yachtSlug: string): Promise<unknown> {
  const member = await app.requireStaff(ctx, ws, ['fleet_director', 'captain']);
  const yacht = await getYacht(app, ws, yachtSlug, true);
  const weekStart = ctx.query.get('weekStart') ?? '';
  if (!base.isSaturday(yacht.base, weekStart)) throw fieldErrors({ weekStart: 'Choose a Saturday.' });
  const body = await app.readJsonBody(ctx);
  const version = whole(body.version);
  const workIn = isRecord(body.work) ? body.work : null;
  if (version === null) throw fieldErrors({ version: 'Enter a whole number from 0 to 1000000.' });
  const crew = await app.pool.query('SELECT id, name, position FROM crew WHERE yacht_slug = $1 ORDER BY sort_order', [yachtSlug]);
  const crewIds = new Set(crew.rows.map((c) => c.id));
  if (!workIn) throw fieldErrors({ work: 'This field is required.' });
  // Build the slot list for the week.
  const slots: Array<{ startsAtMs: number; endsAtMs: number; label: string; date: string; repeated: boolean }> = [];
  for (let d = 0; d < 7; d++) {
    const date = base.addDays(weekStart, d);
    for (const s of base.daySlots(yacht.base, date)) {
      slots.push({ startsAtMs: s.startsAt.ms, endsAtMs: s.startsAt.ms + 1800000, label: s.label, date, repeated: s.repeated });
    }
  }
  const validStarts = new Set(slots.map((s) => base.instToIso({ ms: s.startsAtMs })));
  const crewWork: Array<{ id: string; name: string; slotStarts: Set<number> }> = [];
  const errors: Record<string, string> = {};
  const workOut: Record<string, string[]> = {};
  for (const c of crew.rows) {
    const list = workIn[c.id];
    const starts = new Set<number>();
    if (Array.isArray(list)) {
      for (const item of list) {
        const inst = str(item);
        if (inst === null || !validStarts.has(inst)) {
          errors.work = 'Use slot start times inside this week.';
          break;
        }
        starts.add(Date.parse(inst));
      }
    }
    workOut[c.id] = [...starts].map((ms) => base.instToIso({ ms }));
    crewWork.push({ id: c.id, name: c.name, slotStarts: starts });
  }
  if (Object.keys(errors).length > 0) throw fieldErrors(errors);
  // Stale check first.
  const client = await app.pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query('SELECT version, saved_by, saved_at FROM rotas WHERE yacht_slug = $1 AND week_start = $2 FOR UPDATE', [yachtSlug, weekStart]);
    const storedVersion = current.rows[0]?.version ?? 0;
    if (storedVersion !== version) {
      await client.query('ROLLBACK');
      const saverName = current.rows[0]?.saved_by ? (await app.pool.query('SELECT name FROM members WHERE id = $1', [current.rows[0].saved_by])).rows[0]?.name ?? null : null;
      throw new ApiError(412, { error: 'stale_rota', savedBy: saverName, savedAt: current.rows[0]?.saved_at ? base.instToIso({ ms: current.rows[0].saved_at.getTime() }) : null });
    }
    // Rest-rule check.
    const violation = checkRestRules(slots, crewWork);
    if (violation) {
      await client.query('ROLLBACK');
      throw new ApiError(422, { error: 'rest_rule', crewId: violation.crewId, crewName: violation.crewName, rule: violation.rule, windowStart: violation.windowStart, windowEnd: violation.windowEnd });
    }
    if (current.rows[0]) {
      await client.query('UPDATE rotas SET version = version + 1, saved_by = $1, saved_at = now(), work = $2 WHERE yacht_slug = $3 AND week_start = $4', [member.id, JSON.stringify(workOut), yachtSlug, weekStart]);
    } else {
      await client.query('INSERT INTO rotas (yacht_slug, week_start, version, saved_by, saved_at, work) VALUES ($1,$2,1,$3,now(),$4)', [yachtSlug, weekStart, member.id, JSON.stringify(workOut)]);
    }
    await client.query('COMMIT');
  } catch (e) {
    if (e instanceof ApiError) throw e;
    try { await client.query('ROLLBACK'); } catch { /* nothing */ }
    throw e;
  } finally {
    client.release();
  }
  const fresh = await app.pool.query('SELECT version, saved_by, saved_at, work FROM rotas WHERE yacht_slug = $1 AND week_start = $2', [yachtSlug, weekStart]);
  const row = fresh.rows[0];
  const savedByName = row.saved_by ? (await app.pool.query('SELECT name FROM members WHERE id = $1', [row.saved_by])).rows[0]?.name ?? null : null;
  return {
    yachtSlug,
    weekStart,
    base: yacht.base,
    version: row.version,
    savedBy: savedByName,
    savedAt: base.instToIso({ ms: row.saved_at.getTime() }),
    crew: crew.rows,
    slots: slots.map((s) => ({ startsAt: base.instToIso({ ms: s.startsAtMs }), date: s.date, label: s.label })),
    work: Object.fromEntries(Object.entries(row.work).map(([k, v]) => [k, v])),
  };
}
