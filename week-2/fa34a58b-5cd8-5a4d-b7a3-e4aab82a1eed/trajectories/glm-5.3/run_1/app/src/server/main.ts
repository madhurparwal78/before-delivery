import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import express, { type Request, type Response, type NextFunction } from 'express';
import { WebSocketServer } from 'ws';
import { readConfig, publicDir } from './config.js';
import { pg } from './db.js';
import { applySchema, seed } from './schema.js';
import * as dom from './domain.js';
import { apiError, type ErrorCode } from './errors.js';
import { hubNow } from './hubclock.js';
import { initStorage, initMailer, storage, mailer } from './services.js';
import * as engine from './engine.js';
import { queueNotice, drainOutbox } from './notices.js';
import { addDays, dayOf, dayEndUTC, dayStartUTC, dayHours, isoOf, localParts, longDate, offsetAt, pad, parseISO, parseWall, validDay, wallOf } from '../domain/time.js';

const app = express();
const cfg = readConfig();

let ready = false;

// ── Boundary: same origin, size limits, content types ──────────────────────

const JSON_LIMIT = 65_536;
const CLIP_LIMIT = 20_000_000;

app.disable('x-powered-by');

function sameOrigin(req: Request): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers.host;
  if (!host) return false;
  try {
    const o = new URL(origin);
    return o.host === host;
  } catch {
    return false;
  }
}

app.use((req: Request, res: Response, next: NextFunction) => {
  const writeMethod = req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE';
  if (writeMethod && !sameOrigin(req)) {
    res.status(403).json(apiError('forbidden_origin').body);
    return;
  }
  next();
});

// Raw body capture for clip bytes; JSON for the rest. app.use does not match
// route parameters, so the path is checked directly.
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.method !== 'PUT' || !/^\/api\/sim\/clips\/[^/]+\/bytes$/.test(req.path)) {
    next();
    return;
  }
  const ct = req.headers['content-type'] ?? '';
  if (!ct.startsWith('application/octet-stream')) {
    res.status(415).json(apiError('unsupported_media_type').body);
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  let over = false;
  req.on('data', (c: Buffer) => {
    size += c.length;
    if (size > CLIP_LIMIT) {
      over = true;
      req.removeAllListeners('data');
      res.status(413).json(apiError('too_large').body);
      req.resume();
      return;
    }
    chunks.push(c);
  });
  req.on('end', () => {
    if (over) return;
    (req as unknown as { rawBody: Buffer }).rawBody = Buffer.concat(chunks);
    next();
  });
});

app.use(express.json({ limit: JSON_LIMIT, type: 'application/json' }));

// Reject wrong content types on JSON endpoints; the clip bytes path has its
// own content type.
app.use('/api', (req: Request, res: Response, next: NextFunction) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') { next(); return; }
  // Mounted at /api, so req.path excludes the mount prefix.
  if (/^\/sim\/clips\/[^/]+\/bytes$/.test(req.path)) { next(); return; }
  const ct = req.headers['content-type'] ?? '';
  if (!ct.startsWith('application/json')) {
    res.status(415).json(apiError('unsupported_media_type').body);
    return;
  }
  next();
});

// JSON parse errors become bad_json.
app.use((err: Error & { type?: string; status?: number }, _req: Request, res: Response, next: NextFunction) => {
  if (err.type === 'entity.parse.failed' || err.status === 400 || err instanceof SyntaxError) {
    res.status(400).json(apiError('bad_json').body);
    return;
  }
  if (err.type === 'entity.too.large') {
    res.status(413).json(apiError('too_large').body);
    return;
  }
  next(err);
});

// ── Helpers ────────────────────────────────────────────────────────────────

function wantJSON(res: Response, code: ErrorCode, fields?: Record<string, string>, subs?: Record<string, string>): void {
  const e = apiError(code, fields, subs);
  res.status(e.status).json(e.body);
}

function parseJSONBody(raw: unknown): Record<string, unknown> | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  return null;
}

/** Canonical JSON form: keys sorted, so jsonb round-trips compare equal. */
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v !== null && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) out[k] = canonical((v as Record<string, unknown>)[k]);
    return out;
  }
  return v;
}

const TIMESTAMPS = { light: ['on', 'brightness'], plug: ['on'], thermostat: ['setpoint_f', 'current_f'], camera: [] } as const;

// ── Health ─────────────────────────────────────────────────────────────────

app.get('/api/health', (_req: Request, res: Response) => {
  if (ready) {
    res.json({ status: 'ok' });
  } else {
    res.status(503).json({ status: 'starting' });
  }
});

// ── Status ──────────────────────────────────────────────────────────────────

app.get('/api/status', async (_req: Request, res: Response) => {
  res.json(await engine.statusPayload());
});

// ── Plan ────────────────────────────────────────────────────────────────────

app.get('/api/plan', async (req: Request, res: Response) => {
  const day = typeof req.query.day === 'string' ? req.query.day : dayOf(hubNow());
  if (!validDay(day)) { wantJSON(res, 'invalid', { day: 'Use a date like 2026-11-01.' }); return; }
  const start = dayStartUTC(day);
  const end = dayEndUTC(day);
  const all = await dom.schedules();
  const sched = dom.scheduleForDay(day, all);
  const versionFrom = dom.versionFromOf(sched, day);
  const rooms = await dom.rooms();
  const ownersAtStart = await dom.ownersAll(start);
  const startOwners = rooms.map((r) => {
    const o = ownersAtStart.get(r.id)!;
    return { room_id: r.id, scene_id: o.scene_id, since: o.source === 'none' ? null : isoOf(o.since), source: o.source, guest_scene_id: o.guest_scene_id };
  });

  // Changes: scheduled occurrences, guest starts, guest ends, ordered by at.
  interface Change { at: string; local: string; offset: string; source: 'schedule' | 'guest' | 'guest_end'; schedule_id: string | null; version_from: string | null; slot_id: string | null; slot_time: string | null; guest_scene_id: string | null; scene_id: string; room_ids: string[] }
  const changes: Change[] = [];
  const occs = dom.occurrencesForDay(day, sched);
  const guestByRoom = new Map<string, dom.GuestRec[]>();
  const gAll = await dom.guestScenes();
  for (const g of gAll) {
    const list = guestByRoom.get(g.room_id) ?? [];
    list.push(g);
    guestByRoom.set(g.room_id, list);
  }
  for (const occ of occs) {
    const atLocal = wallOf(occ.at);
    // Rooms held by a guest scene at this instant are left out.
    const roomIds: string[] = [];
    for (const r of occ.room_ids) {
      const guests = guestByRoom.get(r) ?? [];
      const held = guests.some((g) => (g.state === 'scheduled' || g.state === 'active') && g.starts_at <= occ.at && g.ends_at > occ.at);
      if (!held) roomIds.push(r);
    }
    changes.push({
      at: isoOf(occ.at), local: `${pad(atLocal.hh)}:${pad(atLocal.mm)}`, offset: fmtOffsetOf(occ.at), source: 'schedule', schedule_id: sched.id, version_from: versionFrom, slot_id: occ.slot_id, slot_time: occ.slot_time, guest_scene_id: null, scene_id: occ.scene_id, room_ids: roomIds,
    });
  }
  for (const g of gAll) {
    const withinDay = g.starts_at >= start && g.starts_at < end;
    if (withinDay && g.state !== 'cancelled' && g.state !== 'ended') {
      changes.push({ at: isoOf(g.starts_at), local: localWall(g.starts_at), offset: fmtOffsetOf(g.starts_at), source: 'guest', schedule_id: null, version_from: null, slot_id: null, slot_time: null, guest_scene_id: g.id, scene_id: g.scene_id, room_ids: [g.room_id] });
    }
    const endWithinDay = g.ends_at >= start && g.ends_at < end;
    if (endWithinDay && (g.state === 'ended' || g.state === 'active' || g.state === 'scheduled')) {
      const schedScene = await scheduledSceneAt(g.room_id, g.ends_at);
      if (schedScene !== null) {
        changes.push({ at: isoOf(g.ends_at), local: localWall(g.ends_at), offset: fmtOffsetOf(g.ends_at), source: 'guest_end', schedule_id: null, version_from: null, slot_id: null, slot_time: null, guest_scene_id: g.id, scene_id: schedScene, room_ids: [g.room_id] });
      }
    }
  }
  changes.sort((a, b) => a.at.localeCompare(b.at) === 0 ? 0 : (Date.parse(a.at) - Date.parse(b.at)));

  // Hour marks.
  const hours = dayHours(day);
  const hourMarks: { at: string; label: string; abbr: string }[] = [];
  for (let h = 0; h < hours; h++) {
    const t = start + h * 3_600_000;
    const p = localParts(t);
    const label = pad(p.h);
    hourMarks.push({ at: isoOf(t), label, abbr: abbrOfLocal(p.off) });
  }

  res.json({
    day,
    schedule_id: sched.id,
    hours,
    start: isoOf(start),
    end: isoOf(end),
    hour_marks: hourMarks,
    rooms: rooms.map((r) => ({ room_id: r.id, name: r.name, order: r.order })),
    start_owners: startOwners,
    changes,
  });
});

function fmtOffsetOf(t: number): string {
  const o = offsetAt(t);
  const sign = o < 0 ? '-' : '+';
  const a = Math.abs(o);
  return `${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

function abbrOfLocal(off: number): string {
  return off === -300 ? 'CDT' : 'CST';
}

function localWall(t: number): string {
  const p = localParts(t);
  return `${pad(p.h)}:${pad(p.mi)}`;
}

async function scheduledSceneAt(roomId: string, t: number): Promise<string | null> {
  const o = await dom.ownerOf(roomId, t);
  return o.source === 'schedule' ? o.scene_id : null;
}

// ── Rooms / Scenes / Schedules ──────────────────────────────────────────────

app.get('/api/rooms', async (_req: Request, res: Response) => {
  res.json({ rooms: await dom.rooms() });
});

app.get('/api/scenes', async (_req: Request, res: Response) => {
  res.json({ scenes: await dom.scenes() });
});

const TINTS = ['amber', 'honey', 'ember', 'rose', 'dusk', 'candle'];

function sceneFields(body: Record<string, unknown>): { fields: Record<string, string>; name: string; tint: string; brightness: number; setpoint_f: number | null } | null {
  const fields: Record<string, string> = {};
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name.length < 1 || name.length > 40) fields['name'] = 'Give the scene a name of 1 to 40 characters.';
  const tint = typeof body.tint === 'string' ? body.tint : '';
  if (!TINTS.includes(tint)) fields['tint'] = 'Choose one of the six tints.';
  const brightness = body.brightness;
  if (typeof brightness !== 'number' || !Number.isInteger(brightness) || brightness < 0 || brightness > 100) fields['brightness'] = 'Brightness is a whole number from 0 to 100.';
  const brightnessNum = typeof brightness === 'number' ? brightness : 0;
  const sp = body.setpoint_f;
  let setpoint_f: number | null = null;
  if (typeof sp === 'number') {
    if (!Number.isInteger(sp) || sp < 60 || sp > 80) fields['setpoint_f'] = 'Setpoint is a whole number from 60 to 80.';
    else setpoint_f = sp;
  }
  if (Object.keys(fields).length) return null;
  return { fields, name, tint, brightness: brightnessNum, setpoint_f };
}

app.post('/api/scenes', async (req: Request, res: Response) => {
  const body = parseJSONBody(req.body);
  if (!body) { wantJSON(res, 'bad_json'); return; }
  const parsed = sceneFields(body);
  if (!parsed) {
    const fields: Record<string, string> = {};
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (name.length < 1 || name.length > 40) fields['name'] = 'Give the scene a name of 1 to 40 characters.';
    const tint = typeof body.tint === 'string' ? body.tint : '';
    if (!TINTS.includes(tint)) fields['tint'] = 'Choose one of the six tints.';
    const brightness = body.brightness;
    if (typeof brightness !== 'number' || !Number.isInteger(brightness) || brightness < 0 || brightness > 100) fields['brightness'] = 'Brightness is a whole number from 0 to 100.';
    const sp = body.setpoint_f;
    if (sp !== undefined && sp !== null && (typeof sp !== 'number' || !Number.isInteger(sp) || sp < 60 || sp > 80)) fields['setpoint_f'] = 'Setpoint is a whole number from 60 to 80.';
    const dupe = await pg.query('SELECT 1 FROM scenes WHERE lower(name) = lower($1)', [name]);
    if (name.length >= 1 && dupe.rowCount) fields['name'] = 'Another scene already uses this name.';
    wantJSON(res, 'invalid', fields);
    return;
  }
  const dupe = await pg.query('SELECT 1 FROM scenes WHERE lower(name) = lower($1)', [parsed.name]);
  if (dupe.rowCount) { wantJSON(res, 'invalid', { name: 'Another scene already uses this name.' }); return; }
  const order = await pg.query('SELECT coalesce(max(sort_order), -1) + 1 AS o FROM scenes');
  const id = `scene-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await pg.query('INSERT INTO scenes (id, name, tint, brightness, setpoint_f, sort_order) VALUES ($1, $2, $3, $4, $5, $6)', [id, parsed.name, parsed.tint, parsed.brightness, parsed.setpoint_f, order.rows[0]!.o]);
  const scene = (await dom.scenes()).find((s) => s.id === id)!;
  await engine.broadcastScene(scene as unknown as Record<string, unknown>);
  res.status(201).json({ scene });
});

app.put('/api/scenes/:id', async (req: Request, res: Response) => {
  const body = parseJSONBody(req.body);
  if (!body) { wantJSON(res, 'bad_json'); return; }
  const existing = await pg.query('SELECT id FROM scenes WHERE id = $1', [req.params.id]);
  if (!existing.rowCount) { wantJSON(res, 'not_found'); return; }
  const parsed = sceneFields(body);
  if (!parsed) {
    const fields: Record<string, string> = {};
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (name.length < 1 || name.length > 40) fields['name'] = 'Give the scene a name of 1 to 40 characters.';
    const tint = typeof body.tint === 'string' ? body.tint : '';
    if (!TINTS.includes(tint)) fields['tint'] = 'Choose one of the six tints.';
    const brightness = body.brightness;
    if (typeof brightness !== 'number' || !Number.isInteger(brightness) || brightness < 0 || brightness > 100) fields['brightness'] = 'Brightness is a whole number from 0 to 100.';
    const sp = body.setpoint_f;
    if (sp !== undefined && sp !== null && (typeof sp !== 'number' || !Number.isInteger(sp) || sp < 60 || sp > 80)) fields['setpoint_f'] = 'Setpoint is a whole number from 60 to 80.';
    const dupe = await pg.query('SELECT 1 FROM scenes WHERE lower(name) = lower($1) AND id <> $2', [name, req.params.id]);
    if (name.length >= 1 && dupe.rowCount) fields['name'] = 'Another scene already uses this name.';
    wantJSON(res, 'invalid', fields);
    return;
  }
  const dupe = await pg.query('SELECT 1 FROM scenes WHERE lower(name) = lower($1) AND id <> $2', [parsed.name, req.params.id]);
  if (dupe.rowCount) { wantJSON(res, 'invalid', { name: 'Another scene already uses this name.' }); return; }
  await pg.query('UPDATE scenes SET name = $2, tint = $3, brightness = $4, setpoint_f = $5 WHERE id = $1', [req.params.id, parsed.name, parsed.tint, parsed.brightness, parsed.setpoint_f]);
  const scene = (await dom.scenes()).find((s) => s.id === req.params.id)!;
  await engine.broadcastScene(scene as unknown as Record<string, unknown>);
  res.json({ scene });
});

app.get('/api/schedules', async (_req: Request, res: Response) => {
  res.json({ schedules: await dom.schedules() });
});

app.get('/api/schedules/:id', async (req: Request, res: Response) => {
  const s = await dom.schedule(req.params.id);
  if (!s) { wantJSON(res, 'not_found'); return; }
  res.json({ schedule: s });
});

interface SlotInput { time: string; scene_id: string; room_ids: string[] }

app.put('/api/schedules/:id', async (req: Request, res: Response) => {
  const body = parseJSONBody(req.body);
  if (!body) { wantJSON(res, 'bad_json'); return; }
  const s = await dom.schedule(req.params.id);
  if (!s) { wantJSON(res, 'not_found'); return; }
  const fields: Record<string, string> = {};
  const revision = body.revision;
  if (typeof revision !== 'number' || !Number.isInteger(revision)) fields['revision'] = 'Reload the schedule before saving.';
  const from = typeof body.from === 'string' ? body.from : '';
  const today = dayOf(hubNow());
  if (!validDay(from)) fields['from'] = 'Use a date like 2026-11-09.';
  else if (from < today) fields['from'] = 'Choose today or a later day.';
  else if (from > addDays(today, 366)) fields['from'] = 'Choose a day within the next 366 days.';
  const slotsIn = body.slots;
  if (!Array.isArray(slotsIn) || slotsIn.length < 1 || slotsIn.length > 48) {
    fields['slots'] = 'A schedule has 1 to 48 slots.';
  }
  const parsedSlots: SlotInput[] = [];
  if (Array.isArray(slotsIn)) {
    const knownRooms = new Set((await dom.rooms()).map((r) => r.id));
    const knownScenes = new Set((await dom.scenes()).map((sc) => sc.id));
    const seenSameTime = new Map<string, Set<string>>();
    slotsIn.forEach((raw: unknown, i: number) => {
      const sl = raw as Record<string, unknown>;
      const time = typeof sl.time === 'string' ? sl.time : '';
      if (!/^\d{2}:\d{2}$/.test(time) || time >= '24:00') { fields[`slots.${i}.time`] = 'Use a 24-hour time like 06:10.'; return; }
      const sceneId = typeof sl.scene_id === 'string' ? sl.scene_id : '';
      if (!knownScenes.has(sceneId)) { fields[`slots.${i}.scene_id`] = 'Choose a scene.'; return; }
      const roomIds = Array.isArray(sl.room_ids) ? (sl.room_ids as unknown[]) : [];
      if (roomIds.length < 1 || roomIds.some((r) => typeof r !== 'string' || !knownRooms.has(r))) { fields[`slots.${i}.room_ids`] = 'Choose at least one room.'; return; }
      const setForTime = seenSameTime.get(time) ?? new Set<string>();
      for (const r of roomIds as string[]) {
        if (setForTime.has(r)) fields[`slots.${i}.time`] = 'Two slots at the same time cannot share a room.';
      }
      for (const r of roomIds as string[]) setForTime.add(r);
      seenSameTime.set(time, setForTime);
      parsedSlots.push({ time, scene_id: sceneId, room_ids: roomIds as string[] });
    });
  }
  if (Object.keys(fields).length) { wantJSON(res, 'invalid', fields); return; }

  // Revision check and write in one transaction.
  const ok = await pg.query('BEGIN').then(async () => {
    const cur = await pg.query('SELECT revision FROM schedules WHERE id = $1 FOR UPDATE', [req.params.id]);
    const curRev = cur.rows[0]!.revision as number;
    if (curRev !== revision) {
      await pg.query('ROLLBACK');
      return false;
    }
    await pg.query('UPDATE schedules SET revision = revision + 1 WHERE id = $1', [req.params.id]);
    await pg.query('DELETE FROM slots WHERE schedule_id = $1 AND from_day = $2', [req.params.id, from]);
    for (const slot of parsedSlots) {
      await pg.query('INSERT INTO slots (id, schedule_id, from_day, time_str, scene_id, room_ids) VALUES ($1, $2, $3, $4, $5, $6)', [
        `${req.params.id}:${from}:${slot.time}:${Math.random().toString(36).slice(2, 8)}`, req.params.id, from, slot.time, slot.scene_id, JSON.stringify(slot.room_ids),
      ]);
    }
    await pg.query('INSERT INTO schedule_versions (schedule_id, from_day) VALUES ($1, $2) ON CONFLICT (schedule_id, from_day) DO NOTHING', [req.params.id, from]);
    await pg.query('COMMIT');
    return true;
  }).catch(async () => { await pg.query('ROLLBACK'); return false; });
  if (!ok) { wantJSON(res, 'schedule_changed'); return; }

  const updated = await dom.schedule(req.params.id)!;
  await engine.broadcastSchedule(req.params.id, updated!.revision);
  // If today's owner changed, apply and announce.
  const t = hubNow();
  await applyOwnerChanges(t);
  // Queue a schedule-change notice if the effect instant has passed.
  await engine.queueScheduleNoticeForSave(req.params.id, from, t);
  res.json({ schedule: updated });
});

async function applyOwnerChanges(t: number): Promise<void> {
  const owners = await dom.ownersAll(t);
  for (const [roomId, o] of owners) {
    if (o.source !== 'none' && o.scene_id) {
      await engine.applySceneAndAnnounce(roomId, o.scene_id, t);
    }
  }
}

// ── Devices ─────────────────────────────────────────────────────────────────

app.get('/api/devices', async (req: Request, res: Response) => {
  const roomId = typeof req.query.room_id === 'string' ? req.query.room_id : undefined;
  res.json({ devices: (await dom.devices(roomId)).map(engine.serializeDevice) });
});

app.put('/api/devices/:id/state', async (req: Request, res: Response) => {
  const body = parseJSONBody(req.body);
  if (!body) { wantJSON(res, 'bad_json'); return; }
  const d = await pg.query('SELECT id, name, room_id, kind, online, state, revision, updated_at FROM devices WHERE id = $1', [req.params.id]);
  if (!d.rowCount) { wantJSON(res, 'not_found'); return; }
  const device = d.rows[0] as { id: string; name: string; room_id: string; kind: string; online: boolean; state: Record<string, unknown>; revision: number; updated_at: Date };
  const fields: Record<string, string> = {};
  const kind = device.kind as 'light' | 'plug' | 'thermostat' | 'camera';
  if (kind === 'camera') {
    if (Object.keys(body).length > 0) fields['state'] = 'This device has no such setting.';
    if (Object.keys(fields).length) { wantJSON(res, 'invalid', fields); return; }
  }
  const allowed = TIMESTAMPS[kind];
  const updates: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (!allowed.includes(k as never)) { fields[k] = 'This device has no such setting.'; continue; }
    if (k === 'on') {
      if (typeof v !== 'boolean') { fields['on'] = 'Use true or false.'; continue; }
      updates.on = v;
    } else if (k === 'brightness') {
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 100) { fields['brightness'] = 'Brightness is a whole number from 1 to 100.'; continue; }
      updates.brightness = v;
    } else if (k === 'setpoint_f') {
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 60 || v > 80) { fields['setpoint_f'] = 'Setpoint is a whole number from 60 to 80.'; continue; }
      updates.setpoint_f = v;
    }
  }
  if (Object.keys(updates).length === 0 && Object.keys(fields).length === 0) { wantJSON(res, 'invalid', { state: 'This device has no such setting.' }); return; }
  if (Object.keys(fields).length) { wantJSON(res, 'invalid', fields); return; }
  if (!device.online) { wantJSON(res, 'device_offline', undefined, { 'Device name': device.name }); return; }
  let newState = { ...device.state };
  if (kind === 'light') {
    if ('brightness' in updates) {
      newState = { ...newState, brightness: updates.brightness as number };
      if (!('on' in updates)) newState = { ...newState, on: true };
    }
    if ('on' in updates) newState = { ...newState, on: updates.on as boolean };
  } else if (kind === 'plug') {
    newState = { on: updates.on as boolean };
  } else if (kind === 'thermostat') {
    newState = { ...newState, setpoint_f: updates.setpoint_f as number };
  }
  const upd = await pg.query('UPDATE devices SET state = $2, revision = revision + 1, updated_at = $3 WHERE id = $1 RETURNING state, revision, updated_at', [req.params.id, JSON.stringify(newState), new Date()]);
  const out = { ...device, state: upd.rows[0]!.state, revision: upd.rows[0]!.revision, updated_at: upd.rows[0]!.updated_at.getTime() };
  await engine.broadcastDevice(out);
  res.json({ device: engine.serializeDevice(out) });
});

// ── Guest scenes ────────────────────────────────────────────────────────────

app.get('/api/guest-scenes', async (_req: Request, res: Response) => {
  const gs = await dom.guestScenes();
  res.json({ guest_scenes: gs.map(engine.serializeGuest) });
});

app.post('/api/guest-scenes', async (req: Request, res: Response) => {
  const body = parseJSONBody(req.body);
  if (!body) { wantJSON(res, 'bad_json'); return; }
  const key = typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'] : null;
  if (key !== null && !/^[\x21-\x7E]{1,100}$/.test(key)) { wantJSON(res, 'invalid', { 'Idempotency-Key': 'Use 1 to 100 visible characters.' }); return; }

  // Idempotent replay first: same key and body returns the first answer.
  if (key) {
    const stored = await pg.query('SELECT body, status, answer FROM idempotency_keys WHERE key = $1', [key]);
    if (stored.rowCount) {
      const row = stored.rows[0] as { body: Record<string, unknown>; status: number; answer: unknown };
      // jsonb does not preserve key order, so both sides are canonicalised.
      if (JSON.stringify(canonical(row.body)) !== JSON.stringify(canonical(body))) { wantJSON(res, 'idempotency_conflict'); return; }
      res.status(row.status).json(row.answer);
      return;
    }
  }

  const fields: Record<string, string> = {};
  const rooms = await dom.rooms();
  const scenes = await dom.scenes();
  const roomId = typeof body.room_id === 'string' ? body.room_id : '';
  if (!rooms.some((r) => r.id === roomId)) fields['room_id'] = 'Choose a room.';
  const sceneId = typeof body.scene_id === 'string' ? body.scene_id : '';
  if (!scenes.some((s) => s.id === sceneId)) fields['scene_id'] = 'Choose a scene.';
  const now = hubNow();
  let startsAt: number | null = null;
  if (body.starts_at !== null && body.starts_at !== undefined) {
    const p = typeof body.starts_at === 'string' ? parseWall(body.starts_at) : null;
    if (p === null) fields['starts_at'] = 'Use a date and time like 2026-11-07T11:00.';
    else if (p === 'skipped') fields['starts_at'] = 'That time is skipped when clocks spring forward. Choose another time.';
    else if (p < Math.floor(now / 60_000) * 60_000) fields['starts_at'] = 'Start now or later.';
    else startsAt = p;
  }
  let endsAt: number | null = null;
  const e = typeof body.ends_at === 'string' ? parseWall(body.ends_at) : null;
  if (e === null) fields['ends_at'] = 'Use a date and time like 2026-11-07T11:00.';
  else if (e === 'skipped') fields['ends_at'] = 'That time is skipped when clocks spring forward. Choose another time.';
  else endsAt = e;
  if (startsAt !== null && endsAt !== null) {
    if (endsAt <= startsAt) fields['ends_at'] = 'End after the start.';
    else if (endsAt - startsAt > 14 * 86_400_000) fields['ends_at'] = 'A guest scene can last at most 14 days.';
  }
  if (Object.keys(fields).length) { wantJSON(res, 'invalid', fields); return; }

  const start = startsAt ?? now;
  // Overlap check after validation.
  const overlap = await pg.query(`SELECT 1 FROM guest_scenes WHERE room_id = $1 AND state IN ('scheduled','active') AND NOT (ends_at <= $2 OR starts_at >= $3)`, [roomId, new Date(start), new Date(endsAt!)]);
  if (overlap.rowCount) { wantJSON(res, 'guest_overlap', undefined, { Room: dom.roomName(rooms, roomId) }); return; }

  const id = `guest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const state = startsAt === null || startsAt <= now ? 'active' : 'scheduled';
  await pg.query('INSERT INTO guest_scenes (id, room_id, scene_id, starts_at, ends_at, state) VALUES ($1, $2, $3, $4, $5, $6)', [id, roomId, sceneId, new Date(start), new Date(endsAt!), state]);
  const g = await dom.guestById(id)!;
  const answer = { guest_scene: engine.serializeGuest(g!) };
  if (key) {
    await pg.query('INSERT INTO idempotency_keys (key, body, status, answer, created_at) VALUES ($1, $2, $3, $4, $5)', [key, JSON.stringify(body), 201, JSON.stringify(answer), new Date()]);
  }
  if (state === 'active') {
    await engine.broadcastGuestScene(g!);
    await engine.applySceneAndAnnounce(roomId, sceneId, hubNow());
    await engine.broadcastStatus();
  } else {
    await engine.broadcastGuestScene(g!);
  }
  res.status(201).json(answer);
});

app.post('/api/guest-scenes/:id/cancel', async (req: Request, res: Response) => {
  const g = await dom.guestById(req.params.id);
  if (!g) { wantJSON(res, 'not_found'); return; }
  if (g.state === 'ended' || g.state === 'cancelled') { wantJSON(res, 'guest_scene_closed'); return; }
  const cur = await pg.query(`UPDATE guest_scenes SET state = 'cancelled', cancelled_at = $2 WHERE id = $1 AND state IN ('scheduled','active') RETURNING *`, [req.params.id, new Date(hubNow())]);
  if (!cur.rowCount) { wantJSON(res, 'guest_scene_closed'); return; }
  const updated = await dom.guestById(req.params.id)!;
  await engine.broadcastGuestScene(updated!);
  await engine.applySceneAndAnnounce(g.room_id, null, hubNow());
  await engine.broadcastStatus();
  res.json({ guest_scene: engine.serializeGuest(updated!) });
});

// ── Runs / Clips ────────────────────────────────────────────────────────────

app.get('/api/runs', async (req: Request, res: Response) => {
  const day = typeof req.query.day === 'string' ? req.query.day : dayOf(hubNow());
  if (!validDay(day)) { wantJSON(res, 'invalid', { day: 'Use a date like 2026-11-01.' }); return; }
  const r = await pg.query('SELECT id, schedule_id, version_from, slot_id, slot_time, ran_at, scene_id, room_ids FROM runs WHERE ran_day = $1 ORDER BY ran_at', [day]);
  res.json({
    day,
    runs: (r.rows as { id: string; schedule_id: string; version_from: Date; slot_id: string; slot_time: string; ran_at: Date; scene_id: string; room_ids: string[] }[]).map((x) => ({
      id: x.id, schedule_id: x.schedule_id, version_from: x.version_from.toISOString().slice(0, 10), slot_id: x.slot_id, slot_time: x.slot_time, ran_at: isoOf(x.ran_at.getTime()), scene_id: x.scene_id, room_ids: x.room_ids,
    })),
  });
});

app.get('/api/clips', async (req: Request, res: Response) => {
  const day = typeof req.query.day === 'string' ? req.query.day : dayOf(hubNow());
  if (!validDay(day)) { wantJSON(res, 'invalid', { day: 'Use a date like 2026-11-01.' }); return; }
  const r = await pg.query('SELECT c.id, c.camera_id, d.name AS camera_name, c.recorded_at, c.day, c.declared_size, c.stored_size, c.state, c.object_key FROM clips c JOIN devices d ON d.id = c.camera_id WHERE c.day = $1 ORDER BY c.recorded_at', [day]);
  res.json({ day, clips: r.rows.map(serializeClipRow) });
});

function serializeClipRow(x: { id: string; camera_id: string; camera_name: string; recorded_at: Date; day: Date; declared_size: string | number; stored_size: string | number | null; state: string; object_key: string }): Record<string, unknown> {
  return {
    id: x.id, camera_id: x.camera_id, camera_name: x.camera_name, recorded_at: isoOf(x.recorded_at.getTime()),
    day: x.day.toISOString().slice(0, 10), declared_size: Number(x.declared_size), stored_size: x.stored_size === null ? null : Number(x.stored_size),
    state: x.state, playable: x.state === 'stored', object_key: x.object_key,
  };
}

app.get('/api/clips/:id', async (req: Request, res: Response) => {
  const r = await pg.query('SELECT c.id, c.camera_id, d.name AS camera_name, c.recorded_at, c.day, c.declared_size, c.stored_size, c.state, c.object_key FROM clips c JOIN devices d ON d.id = c.camera_id WHERE c.id = $1', [req.params.id]);
  if (!r.rowCount) { wantJSON(res, 'not_found'); return; }
  res.json({ clip: serializeClipRow(r.rows[0]!) });
});

app.get('/api/clips/:id/media', async (req: Request, res: Response) => {
  const r = await pg.query('SELECT id, state, object_key, stored_size FROM clips WHERE id = $1', [req.params.id]);
  if (!r.rowCount) { wantJSON(res, 'not_found'); return; }
  const clip = r.rows[0] as { id: string; state: string; object_key: string; stored_size: number | null };
  if (clip.state !== 'stored') { wantJSON(res, 'clip_not_playable'); return; }
  if (storage.status() === 'down') { wantJSON(res, 'storage_unavailable'); return; }
  try {
    const bytes = await storage.get(clip.object_key);
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Length', String(bytes.length));
    res.end(bytes);
  } catch {
    wantJSON(res, 'storage_unavailable');
  }
});

// ── Notices ────────────────────────────────────────────────────────────────

app.get('/api/notices', async (_req: Request, res: Response) => {
  const ns = await import('./notices.js');
  res.json({ notices: await ns.notices() });
});

// ── Simulation API ─────────────────────────────────────────────────────────

app.get('/api/sim/clock', (_req: Request, res: Response) => {
  res.json({ now: isoOf(hubNow()) });
});

app.put('/api/sim/clock', async (req: Request, res: Response) => {
  const body = parseJSONBody(req.body);
  if (!body) { wantJSON(res, 'bad_json'); return; }
  const t = typeof body.now === 'string' ? parseISO(body.now) : null;
  if (t === null) { wantJSON(res, 'invalid', { now: 'Use a time like 2026-11-01T01:29:55-05:00.' }); return; }
  await engine.clockMoved(t);
  res.json({ now: isoOf(hubNow()) });
});

app.post('/api/sim/devices/:id/report', async (req: Request, res: Response) => {
  const body = parseJSONBody(req.body);
  if (!body) { wantJSON(res, 'bad_json'); return; }
  const d = await pg.query('SELECT id, name, room_id, kind, online, state, revision, updated_at FROM devices WHERE id = $1', [req.params.id]);
  if (!d.rowCount) { wantJSON(res, 'not_found'); return; }
  const device = d.rows[0] as { id: string; name: string; room_id: string; kind: string; online: boolean; state: Record<string, unknown>; revision: number; updated_at: Date };
  const fields: Record<string, string> = {};
  const hasOnline = 'online' in body;
  const hasState = 'state' in body;
  if (!hasOnline && !hasState) { wantJSON(res, 'invalid', { body: 'Send online or state.' }); return; }
  let newState = { ...device.state };
  if (hasState) {
    const st = body.state;
    if (typeof st !== 'object' || st === null || Array.isArray(st)) { wantJSON(res, 'invalid', { body: 'Send online or state.' }); return; }
    const kind = device.kind as 'light' | 'plug' | 'thermostat' | 'camera';
    const allowed = TIMESTAMPS[kind];
    for (const [k, v] of Object.entries(st as Record<string, unknown>)) {
      if (!allowed.includes(k as never)) { fields[`state.${k}`] = 'This device has no such setting.'; continue; }
      if (k === 'on' && typeof v !== 'boolean') { fields['state.on'] = 'Use true or false.'; continue; }
      if (k === 'brightness' && (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 100)) { fields['state.brightness'] = 'Brightness is a whole number from 1 to 100.'; continue; }
      if (k === 'setpoint_f' && (typeof v !== 'number' || !Number.isInteger(v) || v < 60 || v > 80)) { fields['state.setpoint_f'] = 'Setpoint is a whole number from 60 to 80.'; continue; }
      if (k === 'current_f' && (typeof v !== 'number' || !Number.isInteger(v) || v < 32 || v > 122)) { fields['state.current_f'] = 'Reading is a whole number from 32 to 122.'; continue; }
      newState = { ...newState, [k]: v };
    }
    if (Object.keys(st as Record<string, unknown>).length === 0 && kind === 'camera') { wantJSON(res, 'invalid', { body: 'Send online or state.' }); return; }
  }
  if (Object.keys(fields).length) { wantJSON(res, 'invalid', fields); return; }
  const online = hasOnline && typeof body.online === 'boolean' ? body.online : device.online;
  if (hasOnline && typeof body.online !== 'boolean') { wantJSON(res, 'invalid', { body: 'Send online or state.' }); return; }
  const upd = await pg.query('UPDATE devices SET online = $2, state = $3, revision = revision + 1, updated_at = $4 WHERE id = $1 RETURNING state, revision, updated_at', [req.params.id, online, JSON.stringify(newState), new Date()]);
  const out = { ...device, online, state: upd.rows[0]!.state, revision: upd.rows[0]!.revision, updated_at: upd.rows[0]!.updated_at.getTime() };
  await engine.broadcastDevice(out);
  res.json({ device: engine.serializeDevice(out) });
});

app.post('/api/sim/cameras/:device_id/clips', async (req: Request, res: Response) => {
  const body = parseJSONBody(req.body);
  if (!body) { wantJSON(res, 'bad_json'); return; }
  const d = await pg.query('SELECT id, kind FROM devices WHERE id = $1', [req.params.device_id]);
  if (!d.rowCount) { wantJSON(res, 'not_found'); return; }
  if ((d.rows[0] as { kind: string }).kind !== 'camera') { wantJSON(res, 'not_found'); return; }
  const fields: Record<string, string> = {};
  const recordedAt = typeof body.recorded_at === 'string' ? parseISO(body.recorded_at) : null;
  if (recordedAt === null) fields['recorded_at'] = 'Use a time like 2026-11-01T01:29:55-05:00.';
  const declared = body.declared_size;
  if (typeof declared !== 'number' || !Number.isInteger(declared) || declared < 1 || declared > 20_000_000) fields['declared_size'] = 'Declared size is a whole number of bytes from 1 to 20,000,000.';
  if (Object.keys(fields).length) { wantJSON(res, 'invalid', fields); return; }
  const id = `clip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const day = dayOf(recordedAt!);
  const objectKey = `clips/${req.params.device_id}/${day}/${id}.mp4`;
  await pg.query('INSERT INTO clips (id, camera_id, recorded_at, day, declared_size, state, object_key) VALUES ($1, $2, $3, $4, $5, $6, $7)', [id, req.params.device_id, new Date(recordedAt!), day, declared, 'announced', objectKey]);
  const clip = await clipById(id);
  await engine.broadcastClip(clip!);
  res.status(201).json({ clip });
});

async function clipById(id: string): Promise<Record<string, unknown> | null> {
  const r = await pg.query('SELECT c.id, c.camera_id, d.name AS camera_name, c.recorded_at, c.day, c.declared_size, c.stored_size, c.state, c.object_key FROM clips c JOIN devices d ON d.id = c.camera_id WHERE c.id = $1', [id]);
  if (!r.rowCount) return null;
  return serializeClipRow(r.rows[0]!);
}

app.put('/api/sim/clips/:id/bytes', async (req: Request, res: Response) => {
  const raw = (req as unknown as { rawBody?: Buffer }).rawBody;
  const r = await pg.query('SELECT id, state, declared_size, object_key FROM clips WHERE id = $1', [req.params.id]);
  if (!r.rowCount) { wantJSON(res, 'not_found'); return; }
  const clip = r.rows[0] as { id: string; state: string; declared_size: string; object_key: string };
  if (clip.state === 'stored' || clip.state === 'size_mismatch') { wantJSON(res, 'clip_closed'); return; }
  if (storage.status() === 'down') {
    await pg.query(`UPDATE clips SET state = 'storing' WHERE id = $1`, [req.params.id]);
    const c = await clipById(req.params.id);
    if (c) await engine.broadcastClip(c);
    wantJSON(res, 'storage_unavailable');
    return;
  }
  await pg.query(`UPDATE clips SET state = 'storing' WHERE id = $1`, [req.params.id]);
  const cStoring = await clipById(req.params.id);
  if (cStoring) await engine.broadcastClip(cStoring);
  try {
    await storage.put(clip.object_key, raw!);
    const size = await storage.head(clip.object_key);
    const declared = Number(clip.declared_size);
    if (size !== declared) {
      await storage.remove(clip.object_key);
      await pg.query(`UPDATE clips SET state = 'size_mismatch' WHERE id = $1`, [req.params.id]);
      const c = await clipById(req.params.id);
      if (c) await engine.broadcastClip(c);
      wantJSON(res, 'size_mismatch', undefined, { 'stored size': String(size), 'declared size': String(declared) });
      return;
    }
    await pg.query(`UPDATE clips SET state = 'stored', stored_size = $2 WHERE id = $1`, [req.params.id, size]);
    const c = await clipById(req.params.id);
    if (c) await engine.broadcastClip(c);
    // Motion notice.
    const detail = await pg.query('SELECT camera_id, recorded_at FROM clips WHERE id = $1', [req.params.id]);
    const { camera_id, recorded_at } = detail.rows[0] as { camera_id: string; recorded_at: Date };
    const name = (await pg.query('SELECT name FROM devices WHERE id = $1', [camera_id])).rows[0] as { name: string };
    const p = localParts(recorded_at.getTime());
    const subject = `Motion on ${name.name}`;
    const bodyTxt = `${name.name} recorded motion at ${pad(p.h)}:${pad(p.mi)}:${pad(p.s)} on ${longDate(dayOf(recorded_at.getTime()))}. The clip is stored on the hub (${size} bytes).`;
    await queueNotice(`motion:${req.params.id}`, 'motion', subject, bodyTxt);
    res.json({ clip: c });
  } catch {
    const c = await clipById(req.params.id);
    if (c) await engine.broadcastClip(c);
    wantJSON(res, 'storage_unavailable');
  }
});

// ── 404 for unknown API paths ──────────────────────────────────────────────

app.use('/api', (_req: Request, res: Response) => {
  wantJSON(res, 'not_found');
});

// ── Static pages ───────────────────────────────────────────────────────────

const FORBIDDEN = new Set(['/run.json', '/package.json', '/package-lock.json', '/.env', '/tsconfig.json', '/vite.config.ts', '/third_party_notices.md']);

app.get('*', (req: Request, res: Response) => {
  const p = decodeURIComponent(req.path);
  if (FORBIDDEN.has(p.toLowerCase()) || p.startsWith('/src/') || p.startsWith('/node_modules/') || p.startsWith('/dist/')) {
    wantJSON(res, 'not_found');
    return;
  }
  if (p === '/') {
    res.setHeader('Location', '/plan');
    res.status(302);
    res.end();
    return;
  }
  if (p === '/plan' || p === '/schedules' || p === '/scenes' || p === '/guests' || p === '/log' || p === '/notices') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(indexHTML());
    return;
  }
  const file = path.join(publicDir, p);
  if (!file.startsWith(publicDir + path.sep) && file !== publicDir) { wantJSON(res, 'not_found'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { wantJSON(res, 'not_found'); return; }
    const ext = path.extname(file).toLowerCase();
    const mime = ext === '.js' ? 'text/javascript' : ext === '.css' ? 'text/css' : ext === '.html' ? 'text/html; charset=utf-8' : ext === '.svg' ? 'image/svg+xml' : ext === '.woff2' ? 'font/woff2' : ext === '.mp4' ? 'video/mp4' : 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.send(data);
  });
});

function indexHTML(): string {
  const assets = fs.readdirSync(path.join(publicDir, 'assets')).filter((f) => f.endsWith('.js'));
  const css = fs.readdirSync(path.join(publicDir, 'assets')).filter((f) => f.endsWith('.css'));
  const jsTag = assets.length ? `<script type="module" src="/assets/${assets[0]}"></script>` : '';
  const cssTag = css.length ? `<link rel="stylesheet" href="/assets/${css[0]}">` : '';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Gablework Nightplan</title>${cssTag}</head><body><div id="root"></div>${jsTag}</body></html>`;
}

// ── HTTP server with WebSocket ─────────────────────────────────────────────

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

function socketsAdd(ws: import('ws').WebSocket): void {
  (engine.sockets as unknown as { add(ws: import('ws').WebSocket): void }).add(ws);
  // The status stream starts with the current status on connect.
  void engine.statusPayload().then((p) => ws.send(JSON.stringify({ type: 'status', ...p })));
  ws.on('close', () => (engine.sockets as unknown as { remove(ws: import('ws').WebSocket): void }).remove(ws));
}

server.on('upgrade', (req: http.IncomingMessage, socket: import('node:stream').Duplex, head: Buffer) => {
  const origin = req.headers.origin;
  const host = req.headers.host;
  // Only a foreign Origin is refused; non-browser clients send none.
  if (origin && host && new URL(origin).host !== host) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  if (req.url !== '/api/socket') {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }
  // In no-server mode the upgrade callback is the wiring point; the
  // 'connection' event is not emitted.
  wss.handleUpgrade(req, socket, head, (ws) => socketsAdd(ws));
});

// ── Boot ───────────────────────────────────────────────────────────────────

async function boot(): Promise<void> {
  initStorage(cfg.s3);
  initMailer({ host: cfg.smtp.host, port: cfg.smtp.port, from: cfg.mailFrom });
  server.listen(cfg.port, '0.0.0.0', () => {
    console.log(`Nightplan listening on ${cfg.port}`);
  });
  // Retry PostgreSQL until it answers; health stays 503 until then.
  for (;;) {
    try {
      await pg.connect();
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  await applySchema();
  await seed();
  await storage.check();
  await mailer.check();
  ready = true;
  void engine.broadcastStatus();

  // Tick engine: once a second.
  setInterval(() => { void engine.tick().catch(() => {}); }, 1000);
  // Service health: every 5 seconds.
  setInterval(() => { void (async () => { const was = { s: storage.status(), m: mailer.status() }; await storage.check(); await mailer.check(); if (was.s !== storage.status() || was.m !== mailer.status()) await engine.broadcastStatus(); })().catch(() => {}); }, 5000);
  // Outbox drain: every 2 seconds (notices go out within 10 seconds).
  setInterval(() => { void drainOutbox().catch(() => {}); }, 2000);
}

void boot();
