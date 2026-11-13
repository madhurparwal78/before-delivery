import { Router, type Request, type Response } from 'express';

import { pool } from './db.js';
import { config } from './config.js';
import { KB_COOKIE, route, sha256 } from './http.js';
import { ApiError, forbidden, notFound, oneField, storageUnavailable, tooLarge, validation, liveUnavailable } from './errors.js';
import { hashPassword, uid, uid32, verifyPassword } from './ids.js';
import { requireAuth, roomOf, validateOpId } from './auth.js';
import { getObject, putObject, deleteObject, minioAvailable, minioGet, minioPut } from './minio.js';
import { publish, roomChannel, sessionChannel, valkeyAvailable, redis, guard } from './valkey.js';
import { takeLock, lockHeld, releaseLock } from './locks.js';
import { asNodeLike, chainSorted, nodeJson, placementJson, roomJson, roomNodes, roomPlacements, roomStats } from './room-service.js';
import { buildDebrief, sendDebrief } from './debrief.js';
import { subscribeRoom, subscribeSession } from './pubsub.js';
import {
  fireAutomatic, fullSession, loadSession, settleSession,
} from './session-service.js';
import { chainOrder, createsLoop, prerequisitesValid, availability } from '../shared/chain.js';
import { canTransition } from '../shared/playtest-state.js';
import type { NodeKind } from '../shared/types.js';

const router = Router();
export default router;

/* ---------------------------------------------------------------- helpers */


async function recordChange(
  roomId: string, workspaceId: string, userId: string,
  kind: 'create' | 'update' | 'delete' | 'move' | 'undo' | 'restore',
  placementId: string | null, opId: string | null,
  client: { query: (q: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> },
  body: unknown = null
): Promise<number> {
  const rev = await client.query(
    `UPDATE rooms SET revision = revision + 1 WHERE id = $1 RETURNING revision`,
    [roomId]
  );
  const revision = rev.rows[0].revision as number;
  await client.query(
    `INSERT INTO room_changes (room_id, revision, op_id, kind, placement_id, user_id)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [roomId, revision, opId, kind, placementId, userId]
  );
  if (opId) {
    await client.query(
      `INSERT INTO change_log (workspace_id, op_id, room_id, revision, kind, placement_id, user_id, status, body)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [workspaceId, opId, roomId, revision, kind, placementId, userId, 200, JSON.stringify(body ?? null)]
    );
  }
  return revision;
}

/** Replay lookup: workspace-wide op ids, after 404 and 403 checks. */
async function replayLookup(workspaceId: string, opId: string): Promise<{ status: number; body: string } | null> {
  const r = await pool.query(
    `SELECT status, body FROM change_log WHERE workspace_id = $1 AND op_id = $2`,
    [workspaceId, opId]
  );
  return r.rows.length ? { status: r.rows[0].status as number, body: r.rows[0].body as string } : null;
}

async function opIdInOtherRoom(workspaceId: string, opId: string, roomId: string): Promise<boolean> {
  const r = await pool.query(
    `SELECT 1 FROM change_log WHERE workspace_id = $1 AND op_id = $2 AND room_id <> $3`,
    [workspaceId, opId, roomId]
  );
  return !!r.rows.length;
}

async function activeSessionOf(roomId: string): Promise<{ id: string; state: string; host_user_id: string } | null> {
  const r = await pool.query(
    `SELECT id, state, host_user_id FROM sessions WHERE room_id = $1 AND state IN ('lobby','running') ORDER BY created_at DESC LIMIT 1`,
    [roomId]
  );
  return r.rows[0] ?? null;
}

async function refuseDuringPlaytest(roomId: string): Promise<void> {
  const active = await activeSessionOf(roomId);
  if (active?.state === 'running') throw new ApiError(409, 'playtest_running');
}



/* ------------------------------------------------------------------ auth */

router.post('/auth/signup', route(async (req, res) => {
  const { email, password, displayName, venueName } = req.body ?? {};
  const fields: Record<string, string> = {};
  if (typeof email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fields.email = 'must be an email';
  if (typeof password !== 'string' || password.length < 10 || password.length > 200) fields.password = 'must be 10 to 200 characters';
  if (typeof displayName !== 'string' || displayName.length < 1 || displayName.length > 60) fields.displayName = 'must be 1 to 60 characters';
  if (typeof venueName !== 'string' || venueName.length < 1 || venueName.length > 60) fields.venueName = 'must be 1 to 60 characters';
  if (Object.keys(fields).length) throw validation(fields);

  const lower = email.toLowerCase();
  const taken = await pool.query(`SELECT 1 FROM users WHERE email_lower = $1`, [lower]);
  if (taken.rows.length) { res.status(409).json({ error: 'email_taken' }); return; }

  const workspaceId = uid();
  const userId = uid();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`INSERT INTO workspaces (id, name) VALUES ($1,$2)`, [workspaceId, venueName]);
    await client.query(
      `INSERT INTO users (id, workspace_id, email, email_lower, password_hash, display_name, role)
       VALUES ($1,$2,$3,$4,$5,$6,'owner')`,
      [userId, workspaceId, email, lower, hashPassword(password), displayName]
    );
    // Five starter rooms for every new workspace
    const { starterRooms } = await import('./seed-data.js');
    for (const room of starterRooms()) {
      const roomId = uid();
      await client.query(
        `INSERT INTO rooms (id, workspace_id, name, starter, width_mm, depth_mm, height_mm, scene_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [roomId, workspaceId, room.name, room.starter, room.widthMm, room.depthMm, room.heightMm, []]
      );
      const order: string[] = [];
      for (const p of room.placements) {
        const pid = uid();
        order.push(pid);
        await client.query(
          `INSERT INTO placements (id, room_id, kind, label, entry, x_mm, y_mm, z_mm, rotation_deg, width_mm, depth_mm, height_mm)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [pid, roomId, p.kind, p.label, p.kind === 'door' && room.placements[0] === p, p.x, p.y, p.z, p.rotation ?? 0, p.w, p.d, p.h]
        );
      }
      await client.query(`UPDATE rooms SET scene_order = $2 WHERE id = $1`, [roomId, order]);
      for (const n of room.nodes) {
        const pid = order[room.placements.findIndex((p) => p.id === n.placementId)] ?? null;
        const prereqIds: string[] = [];
        for (const need of n.needs) {
          const idx = room.nodes.findIndex((x) => x.id === need);
          prereqIds.push(`__node_${idx}`);
        }
        await client.query(
          `INSERT INTO trigger_nodes (id, room_id, title, kind, placement_id, answer, prerequisites)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [uid(), roomId, n.title, n.kind, pid, n.answer, []]
        );
      }
      // fix prerequisite references now that ids exist
      const ids = await client.query(`SELECT id, created_at FROM trigger_nodes WHERE room_id = $1 ORDER BY created_at`, [roomId]);
      const byOrder = room.nodes.map((_, i) => ids.rows[i].id as string);
      for (const n of room.nodes) {
        const prereqIds = n.needs.map((need) => byOrder[room.nodes.findIndex((x) => x.id === need)]);
        await client.query(`UPDATE trigger_nodes SET prerequisites = $2 WHERE id = $1`, [byOrder[room.nodes.findIndex((x) => x.id === n.id)], prereqIds]);
      }
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    client.release();
    throw e;
  }
  client.release();

  const token = uid32();
  await pool.query(`INSERT INTO sessions_auth (token, user_id, expires_at) VALUES ($1,$2, now() + interval '30 days')`, [token, userId]);
  res.cookie(KB_COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 30 * 24 * 3600 * 1000 });
  res.status(201).json({
    user: { id: userId, email, displayName, role: 'owner' },
    workspace: { id: workspaceId, name: venueName },
  });
}));

router.post('/auth/login', route(async (req, res) => {
  const { email, password } = req.body ?? {};
  const r = await pool.query(`SELECT * FROM users WHERE email_lower = $1`, [(email ?? '').toLowerCase()]);
  if (!r.rows.length || !verifyPassword(String(password ?? ''), r.rows[0].password_hash)) {
    throw new ApiError(401, 'invalid_credentials');
  }
  const token = uid32();
  await pool.query(`INSERT INTO sessions_auth (token, user_id, expires_at) VALUES ($1,$2, now() + interval '30 days')`, [token, r.rows[0].id]);
  res.cookie(KB_COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 30 * 24 * 3600 * 1000 });
  res.json({
    user: { id: r.rows[0].id, email: r.rows[0].email, displayName: r.rows[0].display_name, role: r.rows[0].role },
    workspace: { id: r.rows[0].workspace_id, name: '' },
  });
}));

router.post('/auth/logout', route(async (req, res) => {
  const token = req.cookies?.kb_session;
  if (token) await pool.query(`DELETE FROM sessions_auth WHERE token = $1`, [token]);
  res.clearCookie(KB_COOKIE, { path: '/' });
  res.status(204).end();
}));

router.get('/me', route(async (req, res) => {
  const a = requireAuth(req);
  const ws = await pool.query(`SELECT name FROM workspaces WHERE id = $1`, [a.user.workspaceId]);
  res.json({
    user: { id: a.user.id, email: a.user.email, displayName: a.user.displayName, role: a.user.role },
    workspace: { id: a.user.workspaceId, name: ws.rows[0]?.name ?? '' },
  });
}));

/* ----------------------------------------------------------------- rooms */

router.get('/rooms', route(async (req, res) => {
  const a = requireAuth(req);
  const r = await pool.query(
    `SELECT r.* FROM rooms r WHERE r.workspace_id = $1 ORDER BY lower(r.name), r.id`,
    [a.user.workspaceId]
  );
  const rooms = [];
  for (const row of r.rows) {
    rooms.push(roomJson(row, await roomStats(row.id)));
  }
  res.json({ rooms });
}));

router.post('/rooms', route(async (req, res) => {
  const a = requireAuth(req);
  const { name, widthMm, depthMm, heightMm } = req.body ?? {};
  const fields: Record<string, string> = {};
  if (typeof name !== 'string' || name.length < 1 || name.length > 60) fields.name = 'must be 1 to 60 characters';
  const dims = [
    ['widthMm', widthMm, 1000, 30000],
    ['depthMm', depthMm, 1000, 30000],
    ['heightMm', heightMm, 2000, 6000],
  ] as const;
  for (const [field, v, lo, hi] of dims) {
    if (!Number.isInteger(v) || v < lo || v > hi) fields[field] = `must be ${lo} to ${hi}`;
  }
  if (Object.keys(fields).length) throw validation(fields);

  const taken = await pool.query(
    `SELECT 1 FROM rooms WHERE workspace_id = $1 AND lower(name) = lower($2)`,
    [a.user.workspaceId, name]
  );
  if (taken.rows.length) { res.status(409).json({ error: 'name_taken' }); return; }

  const id = uid();
  await pool.query(
    `INSERT INTO rooms (id, workspace_id, name, starter, width_mm, depth_mm, height_mm, scene_order)
     VALUES ($1,$2,$3,false,$4,$5,$6,'{}')`,
    [id, a.user.workspaceId, name, widthMm, depthMm, heightMm]
  );
  const row = await pool.query(`SELECT * FROM rooms WHERE id = $1`, [id]);
  res.status(201).json({ room: roomJson({ ...row.rows[0], has_thumbnail: false }, await roomStats(id)) });
}));

router.get('/rooms/:roomId', route(async (req, res) => {
  const a = requireAuth(req);
  await roomOf(req.params.roomId, a.user.workspaceId);
  const roomId = req.params.roomId;
  const [roomRow, placements, nodes] = await Promise.all([
    pool.query(`SELECT r.* FROM rooms r WHERE r.id = $1`, [roomId]),
    roomPlacements(roomId),
    roomNodes(roomId),
  ]);
  const active = await activeSessionOf(roomId);
  const latest = await pool.query(
    `SELECT id FROM sessions WHERE room_id = $1 AND state IN ('running','ended') ORDER BY
       CASE WHEN state = 'running' THEN 0 ELSE 1 END, started_at DESC NULLS LAST, created_at DESC LIMIT 1`,
    [roomId]
  );
  const session = active ? (await fullSession(active.id))?.session ?? null : null;
  res.json({
    room: roomJson(roomRow.rows[0], await roomStats(roomId)),
    placements: placements.map((p) => placementJson(p as unknown as Record<string, unknown>)),
    nodes: chainSorted(nodes as unknown as Record<string, unknown>[]).map((n) => nodeJson(n as unknown as Record<string, unknown>)),
    sceneOrder: roomRow.rows[0].scene_order as string[],
    activeSession: session,
    latestSessionId: latest.rows[0]?.id ?? null,
  });
}));

router.patch('/rooms/:roomId', route(async (req, res) => {
  const a = requireAuth(req);
  const roomId = req.params.roomId;
  await roomOf(roomId, a.user.workspaceId);
  const body = req.body ?? {};
  if (body.version === undefined || !Number.isInteger(body.version)) throw oneField('version', 'required');
  await refuseDuringPlaytest(roomId);
  const cur = await pool.query(`SELECT * FROM rooms WHERE id = $1`, [roomId]);
  if (cur.rows[0].version !== body.version) {
    res.status(412).json({ error: 'stale_version', current: roomJson({ ...cur.rows[0], has_thumbnail: false }, await roomStats(roomId)) });
    return;
  }
  const fields: Record<string, string> = {};
  const updates: string[] = [];
  const params: unknown[] = [roomId];
  const set = (col: string, v: unknown) => { params.push(v); updates.push(`${col} = $${params.length}`); };
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || body.name.length < 1 || body.name.length > 60) fields.name = 'must be 1 to 60 characters';
  }
  const dims = [
    ['widthMm', body.widthMm, 1000, 30000],
    ['depthMm', body.depthMm, 1000, 30000],
    ['heightMm', body.heightMm, 2000, 6000],
  ] as const;
  for (const [field, v, lo, hi] of dims) {
    if (v !== undefined && (!Number.isInteger(v) || v < lo || v > hi)) fields[field] = `must be ${lo} to ${hi}`;
  }
  if (Object.keys(fields).length) throw validation(fields);
  if (body.name !== undefined) set('name', body.name);
  if (body.widthMm !== undefined) set('width_mm', body.widthMm);
  if (body.depthMm !== undefined) set('depth_mm', body.depthMm);
  if (body.heightMm !== undefined) set('height_mm', body.heightMm);

  // Shrinking so a placement falls outside answers 422 on the dimension.
  const placements = await roomPlacements(roomId);
  if (body.widthMm !== undefined && placements.some((p) => p.xMm + 0 > body.widthMm || p.widthMm > body.widthMm)) {
    throw oneField('widthMm', 'placements outside the room');
  }
  if (body.depthMm !== undefined && placements.some((p) => p.zMm > body.depthMm || p.depthMm > body.depthMm)) {
    throw oneField('depthMm', 'placements outside the room');
  }
  if (body.heightMm !== undefined && placements.some((p) => p.yMm > body.heightMm || p.heightMm > body.heightMm)) {
    throw oneField('heightMm', 'placements outside the room');
  }

  if (updates.length) {
    updates.push(`version = version + 1`);
    await pool.query(`UPDATE rooms SET ${updates.join(', ')} WHERE id = $1`, params);
  }
  await recordChange(roomId, a.user.workspaceId, a.user.id, 'update', null, req.header('Op-Id') ?? null, pool);
  const row = await pool.query(`SELECT r.* FROM rooms r WHERE r.id = $1`, [roomId]);
  res.json({ room: roomJson(row.rows[0], await roomStats(roomId)) });
}));

/** Thumbnail PNG body, up to 500,000 bytes (DP-27, DP-09). */
router.put('/rooms/:roomId/thumbnail', route(async (req, res) => {
  const a = requireAuth(req);
  const roomId = req.params.roomId;
  await roomOf(roomId, a.user.workspaceId);
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const buf = Buffer.concat(chunks);
  if (buf.length > config.limits.thumbnail) throw tooLarge();
  const isPng = buf.length > 8 && buf.subarray(1, 4).toString('ascii') === 'PNG';
  if (!isPng) throw oneField('file', 'must be a PNG');
  const ok = await minioPut(`thumbnails/${roomId}.png`, buf, 'image/png');
  if (!ok) throw storageUnavailable();
  await pool.query(`UPDATE rooms SET has_thumbnail = true WHERE id = $1`, [roomId]);
  res.status(204).end();
}));

router.get('/rooms/:roomId/thumbnail', route(async (req, res) => {
  const a = requireAuth(req);
  const roomId = req.params.roomId;
  await roomOf(roomId, a.user.workspaceId);
  const room = await pool.query(`SELECT has_thumbnail FROM rooms WHERE id = $1`, [roomId]);
  if (!room.rows[0]?.has_thumbnail) { res.status(404).json({ error: 'not_found' }); return; }
  const buf = await minioGet(`thumbnails/${roomId}.png`);
  if (buf === null || buf === false) throw storageUnavailable();
  res.status(200).type('image/png').end(buf);
}));

/* ----------------------------------------------------------- placements */

function placementBody(body: Record<string, unknown>, room: { width_mm: number; depth_mm: number; height_mm: number }): { fields: Record<string, string>; values: Record<string, number | string | boolean | null> } {
  const fields: Record<string, string> = {};
  const values: Record<string, number | string | boolean | null> = {};
  const isInt = (v: unknown): v is number => Number.isInteger(v);
  if (values !== undefined) { /* noop for type clarity */ }
  if (body.xMm !== undefined && (!isInt(body.xMm) || body.xMm < 0 || body.xMm > room.width_mm)) fields.xMm = 'must be 0 to the room width';
  if (body.zMm !== undefined && (!isInt(body.zMm) || body.zMm < 0 || body.zMm > room.depth_mm)) fields.zMm = 'must be 0 to the room depth';
  if (body.yMm !== undefined && (!isInt(body.yMm) || body.yMm < 0 || body.yMm > room.height_mm)) fields.yMm = 'must be 0 to the room height';
  const sizes = [
    ['widthMm', 'width_mm', room.width_mm],
    ['depthMm', 'depth_mm', room.depth_mm],
    ['heightMm', 'height_mm', room.height_mm],
  ] as const;
  for (const [field, , max] of sizes) {
    if (body[field] !== undefined && (!isInt(body[field] as number) || (body[field] as number) < 10 || (body[field] as number) > max)) {
      fields[field] = `must be 10 to ${max}`;
    }
  }
  if (body.rotationDeg !== undefined && (!isInt(body.rotationDeg) || body.rotationDeg < 0 || body.rotationDeg > 359)) {
    fields.rotationDeg = 'must be 0 to 359';
  }
  if (body.label !== undefined && (typeof body.label !== 'string' || body.label.length < 1 || body.label.length > 60)) {
    fields.label = 'must be 1 to 60 characters';
  }
  for (const k of ['xMm', 'yMm', 'zMm', 'widthMm', 'depthMm', 'heightMm', 'rotationDeg']) {
    if (body[k] !== undefined) values[k] = body[k] as number;
  }
  if (body.label !== undefined) values.label = body.label as string;
  return { fields, values };
}

const PLACEMENT_COLS: Record<string, string> = {
  xMm: 'x_mm', yMm: 'y_mm', zMm: 'z_mm',
  widthMm: 'width_mm', depthMm: 'depth_mm', heightMm: 'height_mm',
  rotationDeg: 'rotation_deg', label: 'label',
};

router.post('/rooms/:roomId/placements', route(async (req, res) => {
  const a = requireAuth(req);
  const roomId = req.params.roomId;
  await roomOf(roomId, a.user.workspaceId);
  await refuseDuringPlaytest(roomId);
  const body = req.body ?? {};
  const room = (await pool.query(`SELECT * FROM rooms WHERE id = $1`, [roomId])).rows[0];
  const kind = body.kind;
  if (kind !== 'door' && kind !== 'box' && kind !== 'cylinder' && kind !== 'prop') {
    throw oneField('kind', 'must be door, box, cylinder or prop');
  }
  let propRow: Record<string, unknown> | null = null;
  if (kind === 'prop') {
    if (typeof body.propId !== 'string' || !body.propId) throw oneField('propId', 'required for prop');
    const pr = await pool.query(`SELECT * FROM props WHERE id = $1 AND workspace_id = $2`, [body.propId, a.user.workspaceId]);
    if (!pr.rows.length) throw oneField('propId', 'unknown prop');
    propRow = pr.rows[0];
  } else if (body.propId !== undefined && body.propId !== null) {
    throw oneField('propId', 'only props may set propId');
  }

  const merged = {
    kind,
    label: body.label,
    entry: kind === 'door' ? !!body.entry : undefined,
    xMm: body.xMm ?? 0,
    yMm: body.yMm ?? 0,
    zMm: body.zMm ?? 0,
    widthMm: body.widthMm ?? (propRow ? propRow.width_mm : 500),
    depthMm: body.depthMm ?? (propRow ? propRow.depth_mm : 500),
    heightMm: body.heightMm ?? (propRow ? propRow.height_mm : 500),
    rotationDeg: body.rotationDeg ?? 0,
  };
  if (typeof merged.label !== 'string' || merged.label.length < 1 || merged.label.length > 60) {
    throw oneField('label', 'must be 1 to 60 characters');
  }
  if (body.entry !== undefined && kind !== 'door') throw oneField('entry', 'only doors may set entry');
  const { fields, values } = placementBody(merged as Record<string, unknown>, room);
  if (Object.keys(fields).length) throw validation(fields);
  values.label = merged.label;

  const id = uid();
  await pool.query(
    `INSERT INTO placements (id, room_id, kind, label, prop_id, entry, x_mm, y_mm, z_mm, rotation_deg, width_mm, depth_mm, height_mm)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [id, roomId, kind, merged.label, propRow ? (propRow.id as string) : null, !!merged.entry,
     merged.xMm, merged.yMm, merged.zMm, merged.rotationDeg, merged.widthMm, merged.depthMm, merged.heightMm]
  );
  if (merged.entry) {
    await pool.query(
      `UPDATE placements SET entry = false WHERE room_id = $1 AND kind = 'door' AND id <> $2`,
      [roomId, id]
    );
  }
  await pool.query(`UPDATE rooms SET scene_order = scene_order || $2 WHERE id = $1`, [roomId, [id]]);
  await recordChange(roomId, a.user.workspaceId, a.user.id, 'create', id, req.header('Op-Id') ?? null, pool);
  const row = (await pool.query(`SELECT * FROM placements WHERE id = $1`, [id])).rows[0];
  const placement = placementJson(row);
  await publish(roomChannel(roomId), JSON.stringify({ event: 'placement', data: { placement } }));
  res.status(201).json({ placement });
}));

router.patch('/rooms/:roomId/placements/:placementId', route(async (req, res) => {
  const a = requireAuth(req);
  const roomId = req.params.roomId;
  await roomOf(roomId, a.user.workspaceId);
  const placementId = req.params.placementId;
  const opId = req.header('Op-Id') ?? null;
  validateOpId(opId ?? undefined);

  // replay first, after 404/403 checks
  const tomb = await pool.query(`SELECT label, deleted_by, deleted_by_name FROM deleted_placements WHERE room_id = $1 AND placement_id = $2`, [roomId, placementId]);
  const exists = await pool.query(`SELECT 1 FROM placements WHERE id = $1 AND room_id = $2 AND deleted_at IS NULL`, [placementId, roomId]);
  if (!exists.rows.length) {
    if (tomb.rows.length) {
      const t = tomb.rows[0];
      throw new ApiError(410, 'placement_deleted', undefined, {
        label: t.label, deletedBy: { userId: t.deleted_by, displayName: t.deleted_by_name },
      });
    }
    throw notFound();
  }
  if (opId) {
    const replay = await replayLookup(a.user.workspaceId, opId);
    if (replay) {
      if (await opIdInOtherRoom(a.user.workspaceId, opId, roomId)) { res.status(409).json({ error: 'op_id_reused' }); return; }
      const entry = (await pool.query(`SELECT * FROM change_log WHERE workspace_id = $1 AND op_id = $2`, [a.user.workspaceId, opId])).rows[0];
      if (entry.room_id !== roomId || entry.placement_id !== placementId) { res.status(409).json({ error: 'op_id_reused' }); return; }
      res.status(replay.status).json(JSON.parse(replay.body));
      return;
    }
  }
  await refuseDuringPlaytest(roomId);
  const holder = await lockHeld(roomId, 'placement', placementId);
  if (holder && holder.userId !== a.user.id) {
    res.status(409).json({ error: 'locked', holder, expiresInSeconds: config.lockTtl });
    return;
  }
  const body = req.body ?? {};
  if (!Number.isInteger(body.version)) throw oneField('version', 'required');
  const cur = (await pool.query(`SELECT * FROM placements WHERE id = $1`, [placementId])).rows[0];
  if (cur.version !== body.version) {
    res.status(412).json({ error: 'stale_version', current: placementJson(cur) });
    return;
  }
  const room = (await pool.query(`SELECT * FROM rooms WHERE id = $1`, [roomId])).rows[0];
  if (body.entry !== undefined && cur.kind !== 'door') throw oneField('entry', 'only doors may set entry');
  const { fields, values } = placementBody(body, room);
  if (Object.keys(fields).length) throw validation(fields);

  const updates: string[] = [];
  const params: unknown[] = [placementId];
  for (const [k, col] of Object.entries(PLACEMENT_COLS)) {
    if (values[k] !== undefined) { params.push(values[k]); updates.push(`${col} = $${params.length}`); }
  }
  if (body.entry !== undefined && cur.kind === 'door') {
    params.push(!!body.entry); updates.push(`entry = $${params.length}`);
  }
  updates.push(`version = version + 1`);
  await pool.query(`UPDATE placements SET ${updates.join(', ')} WHERE id = $1`, params);
  if (body.entry === true) {
    await pool.query(`UPDATE placements SET entry = false WHERE room_id = $1 AND kind = 'door' AND id <> $2`, [roomId, placementId]);
  }
  const row = (await pool.query(`SELECT * FROM placements WHERE id = $1`, [placementId])).rows[0];
  const placement = placementJson(row);
  const rev = (await pool.query(`SELECT revision FROM rooms WHERE id = $1`, [roomId])).rows[0].revision;
  const respBody = { placement, revision: rev };
  await recordChange(roomId, a.user.workspaceId, a.user.id, 'update', placementId, opId, pool, respBody);
  // undo journal
  const changed: string[] = Object.keys(values);
  const prev: Record<string, unknown> = {};
  for (const k of changed) prev[k] = cur[PLACEMENT_COLS[k]];
  if (changed.length) {
    await pool.query(
      `INSERT INTO undo_entries (room_id, user_id, placement_id, label, fields, prev_values) VALUES ($1,$2,$3,$4,$5,$6)`,
      [roomId, a.user.id, placementId, cur.label, JSON.stringify(changed), JSON.stringify(prev)]
    );
  }
  await publish(roomChannel(roomId), JSON.stringify({ event: 'placement', data: { placement } }));
  res.json(respBody);
}));

router.delete('/rooms/:roomId/placements/:placementId', route(async (req, res) => {
  const a = requireAuth(req);
  const roomId = req.params.roomId;
  await roomOf(roomId, a.user.workspaceId);
  const placementId = req.params.placementId;
  const opId = req.header('Op-Id') ?? null;
  validateOpId(opId ?? undefined);
  const cur = (await pool.query(`SELECT * FROM placements WHERE id = $1 AND room_id = $2 AND deleted_at IS NULL`, [placementId, roomId]));
  if (!cur.rows.length) {
    const tomb = await pool.query(`SELECT * FROM deleted_placements WHERE room_id = $1 AND placement_id = $2`, [roomId, placementId]);
    if (tomb.rows.length) {
      const t = tomb.rows[0];
      throw new ApiError(410, 'placement_deleted', undefined, {
        label: t.label, deletedBy: { userId: t.deleted_by, displayName: t.deleted_by_name },
      });
    }
    throw notFound();
  }
  if (opId) {
    const replay = await replayLookup(a.user.workspaceId, opId);
    if (replay && (await opIdInOtherRoom(a.user.workspaceId, opId, roomId) || true) ) {
      const entry = (await pool.query(`SELECT * FROM change_log WHERE workspace_id = $1 AND op_id = $2`, [a.user.workspaceId, opId])).rows[0];
      if (!entry || entry.room_id !== roomId || entry.placement_id !== placementId) { res.status(409).json({ error: 'op_id_reused' }); return; }
      res.status(replay.status).end(replay.body === 'null' ? undefined : undefined);
      return;
    }
  }
  await refuseDuringPlaytest(roomId);
  const holder = await lockHeld(roomId, 'placement', placementId);
  if (holder && holder.userId !== a.user.id) {
    res.status(409).json({ error: 'locked', holder, expiresInSeconds: config.lockTtl });
    return;
  }
  const label = cur.rows[0].label as string;
  await pool.query(`DELETE FROM placements WHERE id = $1`, [placementId]);
  await pool.query(
    `INSERT INTO deleted_placements (room_id, placement_id, label, deleted_by, deleted_by_name)
     VALUES ($1,$2,$3,$4,$5) ON CONFLICT (room_id, placement_id) DO UPDATE SET label = EXCLUDED.label`,
    [roomId, placementId, label, a.user.id, a.user.displayName]
  );
  await pool.query(`UPDATE trigger_nodes SET placement_id = NULL WHERE placement_id = $1`, [placementId]);
  await pool.query(`UPDATE rooms SET scene_order = array_remove(scene_order, $2) WHERE id = $1`, [roomId, placementId]);
  await recordChange(roomId, a.user.workspaceId, a.user.id, 'delete', placementId, opId, pool);
  await pool.query(`DELETE FROM undo_entries WHERE room_id = $1 AND placement_id = $2`, [roomId, placementId]);
  await publish(roomChannel(roomId), JSON.stringify({ event: 'placement', data: { deletedId: placementId } }));
  await publish(roomChannel(roomId), JSON.stringify({ event: 'lock', data: { released: { targetType: 'placement', targetId: placementId } } }));
  res.status(204).end();
}));

/* ----------------------------------------------------------------- nodes */

router.post('/rooms/:roomId/nodes', route(async (req, res) => {
  const a = requireAuth(req);
  const roomId = req.params.roomId;
  await roomOf(roomId, a.user.workspaceId);
  await refuseDuringPlaytest(roomId);
  const body = req.body ?? {};
  const fields: Record<string, string> = {};
  if (typeof body.title !== 'string' || body.title.length < 1 || body.title.length > 60) fields.title = 'must be 1 to 60 characters';
  const kind = body.kind;
  if (kind !== 'puzzle' && kind !== 'lock' && kind !== 'cue' && kind !== 'exit') fields.kind = 'must be puzzle, lock, cue or exit';
  if (body.answer !== undefined && body.answer !== null && (typeof body.answer !== 'string' || body.answer.length < 1 || body.answer.length > 40)) {
    fields.answer = 'must be 1 to 40 characters';
  }
  if (body.answer && kind !== 'puzzle' && kind !== 'exit') fields.answer = 'only puzzle and exit nodes may set an answer';
  if (Object.keys(fields).length) throw validation(fields);

  const existing = await roomNodes(roomId);
  const ids = new Set(existing.map((n) => n.id));
  if (kind === 'exit' && existing.some((n) => n.kind === 'exit')) throw oneField('kind', 'room already has an exit');

  let placementId: string | null = null;
  if (body.placementId !== undefined && body.placementId !== null) {
    const p = await pool.query(`SELECT id FROM placements WHERE id = $1 AND room_id = $2 AND deleted_at IS NULL`, [body.placementId, roomId]);
    if (!p.rows.length) throw oneField('placementId', 'unknown placement');
    placementId = body.placementId as string;
  }
  let prereq: string[] = [];
  if (Array.isArray(body.prerequisites)) {
    prereq = body.prerequisites;
    if (!prerequisitesValid('', prereq, ids)) throw oneField('prerequisites', 'unknown node');
    if (!prereq.every((p: string) => ids.has(p))) throw oneField('prerequisites', 'unknown node');
  } else if (body.prerequisites !== undefined) {
    throw oneField('prerequisites', 'must be a list');
  }
  if (createsLoop(asNodeLike(existing as unknown as Record<string, unknown>[]), '', prereq)) {
    throw oneField('prerequisites', 'would create a loop');
  }

  const id = uid();
  await pool.query(
    `INSERT INTO trigger_nodes (id, room_id, title, kind, placement_id, answer, prerequisites)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, roomId, body.title, kind, placementId, body.answer ?? null, prereq]
  );
  await recordChange(roomId, a.user.workspaceId, a.user.id, 'update', null, req.header('Op-Id') ?? null, pool);
  const row = (await pool.query(`SELECT * FROM trigger_nodes WHERE id = $1`, [id])).rows[0];
  const node = nodeJson(row);
  await publish(roomChannel(roomId), JSON.stringify({ event: 'node', data: { node } }));
  res.status(201).json({ node });
}));

router.patch('/rooms/:roomId/nodes/:nodeId', route(async (req, res) => {
  const a = requireAuth(req);
  const roomId = req.params.roomId;
  await roomOf(roomId, a.user.workspaceId);
  const nodeId = req.params.nodeId;
  await refuseDuringPlaytest(roomId);
  const holder = await lockHeld(roomId, 'node', nodeId);
  if (holder && holder.userId !== a.user.id) {
    res.status(409).json({ error: 'locked', holder, expiresInSeconds: config.lockTtl });
    return;
  }
  const body = req.body ?? {};
  if (!Number.isInteger(body.version)) throw oneField('version', 'required');
  const cur = (await pool.query(`SELECT * FROM trigger_nodes WHERE id = $1 AND room_id = $2`, [nodeId, roomId])).rows[0];
  if (!cur) throw notFound();
  if (cur.version !== body.version) {
    res.status(412).json({ error: 'stale_version', current: nodeJson(cur) });
    return;
  }
  const existing = await roomNodes(roomId);
  const fields: Record<string, string> = {};
  if (body.title !== undefined && (typeof body.title !== 'string' || body.title.length < 1 || body.title.length > 60)) {
    fields.title = 'must be 1 to 60 characters';
  }
  let kind = cur.kind as NodeKind;
  if (body.kind !== undefined) {
    if (body.kind !== 'puzzle' && body.kind !== 'lock' && body.kind !== 'cue' && body.kind !== 'exit') {
      fields.kind = 'must be puzzle, lock, cue or exit';
    } else { kind = body.kind; }
  }
  let answer: string | null | undefined = cur.answer as string | null;
  if (body.answer !== undefined) {
    if (body.answer === null) answer = null;
    else if (typeof body.answer === 'string' && body.answer.length >= 1 && body.answer.length <= 40) answer = body.answer;
    else { fields.answer = 'must be 1 to 40 characters'; answer = undefined; }
    if (answer && kind !== 'puzzle' && kind !== 'exit') fields.answer = 'only puzzle and exit nodes may set an answer';
  }
  if (kind === 'exit' && body.kind === 'exit' && cur.kind !== 'exit' && existing.some((n) => n.kind === 'exit')) {
    fields.kind = 'room already has an exit';
  }
  let placementId = cur.placement_id as string | null;
  if (body.placementId !== undefined) {
    if (body.placementId === null) placementId = null;
    else {
      const p = await pool.query(`SELECT id FROM placements WHERE id = $1 AND room_id = $2 AND deleted_at IS NULL`, [body.placementId, roomId]);
      if (!p.rows.length) throw oneField('placementId', 'unknown placement');
      placementId = body.placementId as string;
    }
  }
  let prereq = cur.prerequisites as string[];
  if (body.prerequisites !== undefined) {
    if (!Array.isArray(body.prerequisites)) throw oneField('prerequisites', 'must be a list');
    prereq = body.prerequisites as string[];
    const ids = new Set(existing.map((n) => n.id));
    if (!prerequisitesValid(nodeId, prereq, ids)) throw oneField('prerequisites', 'must be nodes of this room');
    const merged = existing.map((n) => (n.id === nodeId ? { ...n, prerequisites: prereq } : n));
    if (createsLoop(asNodeLike(merged as unknown as Record<string, unknown>[]), nodeId, prereq)) {
      throw oneField('prerequisites', 'would create a loop');
    }
  }
  if (Object.keys(fields).length) throw validation(fields);

  await pool.query(
    `UPDATE trigger_nodes SET title = $2, kind = $3, placement_id = $4, answer = $5, prerequisites = $6, version = version + 1 WHERE id = $1`,
    [nodeId, body.title ?? cur.title, kind, placementId, answer ?? null, prereq]
  );
  await recordChange(roomId, a.user.workspaceId, a.user.id, 'update', null, req.header('Op-Id') ?? null, pool);
  const row = (await pool.query(`SELECT * FROM trigger_nodes WHERE id = $1`, [nodeId])).rows[0];
  const node = nodeJson(row);
  await publish(roomChannel(roomId), JSON.stringify({ event: 'node', data: { node } }));
  res.json({ node });
}));

router.delete('/rooms/:roomId/nodes/:nodeId', route(async (req, res) => {
  const a = requireAuth(req);
  const roomId = req.params.roomId;
  await roomOf(roomId, a.user.workspaceId);
  const nodeId = req.params.nodeId;
  await refuseDuringPlaytest(roomId);
  const holder = await lockHeld(roomId, 'node', nodeId);
  if (holder && holder.userId !== a.user.id) {
    res.status(409).json({ error: 'locked', holder, expiresInSeconds: config.lockTtl });
    return;
  }
  const cur = await pool.query(`SELECT * FROM trigger_nodes WHERE id = $1 AND room_id = $2`, [nodeId, roomId]);
  if (!cur.rows.length) throw notFound();
  await pool.query(`DELETE FROM trigger_nodes WHERE id = $1`, [nodeId]);
  await pool.query(`UPDATE trigger_nodes SET prerequisites = array_remove(prerequisites, $1) WHERE room_id = $2`, [nodeId, roomId]);
  await recordChange(roomId, a.user.workspaceId, a.user.id, 'delete', null, req.header('Op-Id') ?? null, pool);
  await publish(roomChannel(roomId), JSON.stringify({ event: 'node', data: { deletedId: nodeId } }));
  res.status(204).end();
}));

/* ----------------------------------------------------------------- locks */

router.post('/rooms/:roomId/locks', route(async (req, res) => {
  const a = requireAuth(req);
  const roomId = req.params.roomId;
  await roomOf(roomId, a.user.workspaceId);
  const body = req.body ?? {};
  if (body.targetType !== 'placement' && body.targetType !== 'node') throw oneField('targetType', 'must be placement or node');
  if (typeof body.targetId !== 'string' || !body.targetId) throw oneField('targetId', 'required');
  const table = body.targetType === 'placement' ? 'placements' : 'trigger_nodes';
  const exists = await pool.query(`SELECT id FROM ${table} WHERE id = $1 AND room_id = $2 AND deleted_at IS NULL`, [body.targetId, roomId]).catch(() => null);
  if (exists && !exists.rows.length) throw notFound();
  const cur = await pool.query(`SELECT id FROM ${table} WHERE id = $1 AND room_id = $2`, [body.targetId, roomId]);
  if (!cur.rows.length) throw notFound();

  const takeOver = !!body.takeOver;
  const result = await takeLock(roomId, body.targetType, body.targetId, a.user.id, takeOver);
  if (!result.ok && result.holder) {
    res.status(409).json({ error: 'locked', holder: result.holder, expiresInSeconds: config.lockTtl });
    return;
  }
  const lock = { targetType: body.targetType, targetId: body.targetId, holder: { userId: a.user.id, displayName: a.user.displayName }, expiresInSeconds: config.lockTtl };
  const prior = takeOver && result.holder && result.holder.userId !== a.user.id ? result.holder : undefined;
  await publish(roomChannel(roomId), JSON.stringify({ event: 'lock', data: prior ? { lock, takenFrom: prior } : { lock } }));
  res.json({ lock });
}));

router.delete('/rooms/:roomId/locks/:targetType/:targetId', route(async (req, res) => {
  const a = requireAuth(req);
  const roomId = req.params.roomId;
  await roomOf(roomId, a.user.workspaceId);
  const { targetType, targetId } = req.params;
  if (targetType !== 'placement' && targetType !== 'node') throw oneField('targetType', 'must be placement or node');
  const result = await releaseLock(roomId, targetType, targetId, a.user.id);
  if (!result.ok && result.holder) {
    res.status(409).json({ error: 'locked', holder: result.holder, expiresInSeconds: config.lockTtl });
    return;
  }
  await publish(roomChannel(roomId), JSON.stringify({ event: 'lock', data: { released: { targetType, targetId } } }));
  res.status(204).end();
}));

/* ----------------------------------------------------------------- props */

const SAFE_EXT = (ct: string) => (ct === 'model/gltf-binary' ? 'glb' : 'gltf');

function disposition(name: string, ct: string): string {
  const ext = SAFE_EXT(ct);
  const ascii = name.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  const enc = Buffer.from(name, 'utf8').toString('binary')
    .split('').map((ch) => {
      const c = ch.charCodeAt(0);
      const safe = /[A-Za-z0-9!#$&+.^_`|~-]/.test(ch);
      if (safe) return ch;
      return '%' + c.toString(16).toUpperCase().padStart(2, '0');
    }).join('');
  return `attachment; filename="${ascii}.${ext}"; filename*=UTF-8''${enc}.${ext}`;
}

router.post('/props', route(async (req, res) => {
  const a = requireAuth(req);
  const { default: busboy } = await import('busboy');
  const bb = busboy({ headers: req.headers, limits: { fileSize: config.limits.propFile } });
  const parts: Record<string, unknown> = {};
  let file: Buffer | null = null;
  let truncated = false;
  bb.on('field', (name, val) => { parts[name] = val; });
  bb.on('file', (_name, stream, _info) => {
    const chunks: Buffer[] = [];
    stream.on('data', (c: Buffer) => chunks.push(c));
    stream.on('limit', () => { truncated = true; });
    stream.on('end', () => { file = Buffer.concat(chunks); });
  });
  const end = new Promise<void>((resolve) => bb.on('close', () => resolve()));
  const failed = new Promise<never>((_, reject) => bb.on('error', reject));
  req.pipe(bb);
  await Promise.race([end, failed]);
  if (truncated) throw tooLarge();
  const buf0 = file as Buffer | null;
  if (buf0 !== null && buf0.length > config.limits.propFile) throw tooLarge();
  if (!file) throw oneField('file', 'required');

  const buf = file as Buffer;
  const isGlb = buf.length > 12 && buf.subarray(0, 4).toString('ascii') === 'glTF' && buf[4] === 2;
  let isGltf = false;
  if (!isGlb) {
    try {
      const json = JSON.parse(buf.toString('utf8'));
      isGltf = json?.asset?.version === '2.0';
    } catch { isGltf = false; }
  }
  if (!isGlb && !isGltf) throw oneField('file', 'not a glTF 2.0 file');

  const fields: Record<string, string> = {};
  const name = String(parts.name ?? '');
  if (name.length < 1 || name.length > 60) fields.name = 'must be 1 to 60 characters';
  const dims: Record<string, unknown> = {};
  for (const k of ['widthMm', 'depthMm', 'heightMm']) {
    const v = Number(parts[k]);
    dims[k] = v;
    if (!Number.isInteger(v) || v < 10 || v > 30000) fields[k] = 'must be 10 to 30000 mm';
  }
  if (Object.keys(fields).length) throw validation(fields);

  const contentType = isGlb ? 'model/gltf-binary' : 'model/gltf+json';
  const id = uid();
  const digest = sha256(buf);
  const key = `props/${id}.${SAFE_EXT(contentType)}`;
  if (!minioAvailable()) throw storageUnavailable();
  try {
    await putObject(key, buf, contentType);
  } catch {
    throw storageUnavailable();
  }
  await pool.query(
    `INSERT INTO props (id, workspace_id, name, width_mm, depth_mm, height_mm, content_type, bytes, sha256)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, a.user.workspaceId, name, dims.widthMm, dims.depthMm, dims.heightMm, contentType, buf.length, digest]
  );
  res.status(201).json({
    prop: { id, name, widthMm: dims.widthMm, depthMm: dims.depthMm, heightMm: dims.heightMm, contentType, bytes: buf.length, sha256: digest, fileUrl: `/api/props/${id}/file` },
  });
}));

router.get('/props', route(async (req, res) => {
  const a = requireAuth(req);
  const r = await pool.query(`SELECT * FROM props WHERE workspace_id = $1 ORDER BY created_at DESC, id`, [a.user.workspaceId]);
  res.json({
    props: r.rows.map((row) => ({
      id: row.id, name: row.name, widthMm: row.width_mm, depthMm: row.depth_mm, heightMm: row.height_mm,
      contentType: row.content_type, bytes: row.bytes, sha256: row.sha256, fileUrl: `/api/props/${row.id}/file`,
    })),
  });
}));

async function serveStored(buf: Buffer, contentType: string, name: string, req: Request, res: Response): Promise<void> {
  const etag = `"${sha256(buf)}"`;
  if (req.headers['if-none-match'] === etag) {
    res.status(304).set('ETag', etag).end();
    return;
  }
  res.status(200)
    .set('ETag', etag)
    .set('Content-Type', contentType)
    .set('Content-Length', String(buf.length))
    .set('Content-Disposition', disposition(name, contentType))
    .end(buf);
}

router.get('/props/:propId/file', route(async (req, res) => {
  const a = requireAuth(req);
  const row = await pool.query(`SELECT * FROM props WHERE id = $1 AND workspace_id = $2`, [req.params.propId, a.user.workspaceId]);
  if (!row.rows.length) throw notFound();
  const prop = row.rows[0];
  const ext = SAFE_EXT(prop.content_type);
  const buf = await getObject(`props/${prop.id}.${ext}`);
  if (buf === null) throw storageUnavailable();
  await serveStored(buf, prop.content_type, prop.name, req, res);
}));

router.delete('/props/:propId', route(async (req, res) => {
  const a = requireAuth(req);
  const row = await pool.query(`SELECT * FROM props WHERE id = $1 AND workspace_id = $2`, [req.params.propId, a.user.workspaceId]);
  if (!row.rows.length) throw notFound();
  const used = await pool.query(`SELECT 1 FROM placements WHERE prop_id = $1 AND deleted_at IS NULL LIMIT 1`, [req.params.propId]);
  if (used.rows.length) { res.status(409).json({ error: 'prop_in_use' }); return; }
  const ext = SAFE_EXT(row.rows[0].content_type);
  await pool.query(`DELETE FROM props WHERE id = $1`, [req.params.propId]);
  await deleteObject(`props/${req.params.propId}.${ext}`);
  res.status(204).end();
}));

/* -------------------------------------------------------------- versions */

async function versionJson(row: Record<string, unknown>): Promise<import('../shared/types.js').Version> {
  return {
    id: row.id as string,
    roomId: row.room_id as string,
    number: Number(row.number),
    label: row.label as string,
    state: row.state as 'frozen' | 'superseded',
    supersededBy: row.superseded_by === null ? null : Number(row.superseded_by),
    frozenAt: new Date(row.frozen_at as Date).toISOString(),
    stats: row.stats as import('../shared/types.js').ChainFigures,
    packUrl: row.pack_token ? `${config.publicUrl}/pack/${row.pack_token}` : null,
  };
}

router.get('/rooms/:roomId/versions', route(async (req, res) => {
  const a = requireAuth(req);
  const roomId = req.params.roomId;
  await roomOf(roomId, a.user.workspaceId);
  const r = await pool.query(
    `SELECT v.*, t.token AS pack_token FROM versions v LEFT JOIN build_tokens t ON t.version_id = v.id AND t.revoked = false
     WHERE v.room_id = $1 ORDER BY v.number DESC`,
    [roomId]
  );
  const versions = [] as import('../shared/types.js').Version[];
  for (const row of r.rows) versions.push(await versionJson(row));
  res.json({ versions });
}));

router.post('/rooms/:roomId/versions', route(async (req, res) => {
  const a = requireAuth(req);
  const roomId = req.params.roomId;
  await roomOf(roomId, a.user.workspaceId);
  if (a.user.role !== 'owner') throw forbidden();
  const idemKey = req.header('Idempotency-Key') ?? null;
  if (idemKey !== null && (idemKey.length < 1 || idemKey.length > 64)) throw oneField('idempotencyKey', 'must be 1 to 64 characters');
  const body = req.body ?? {};
  if (typeof body.label !== 'string' || body.label.length < 1 || body.label.length > 80) {
    throw oneField('label', 'must be 1 to 80 characters');
  }
  const bodyHash = sha256(Buffer.from(JSON.stringify(body))).slice(0, 32);

  if (idemKey) {
    const prior = await pool.query(
      `SELECT * FROM idempotency_keys WHERE workspace_id = $1 AND key = $2`,
      [a.user.workspaceId, idemKey]
    );
    if (prior.rows.length) {
      const p = prior.rows[0];
      if (p.body_hash !== bodyHash || p.path !== req.path) {
        res.status(409).json({ error: 'idempotency_key_reused' });
        return;
      }
      res.status(p.status).json(JSON.parse(p.body));
      return;
    }
  }

  const result = await (await import('./freeze.js')).freezeRoom(roomId, a.user, body.label);
  if (!result.ok) { res.status(503).json({ error: 'storage_unavailable' }); return; }

  if (idemKey) {
    await pool.query(
      `INSERT INTO idempotency_keys (workspace_id, key, method, path, body_hash, status, body)
       VALUES ($1,$2,$3,$4,$5,201,$6) ON CONFLICT (workspace_id, key) DO NOTHING`,
      [a.user.workspaceId, idemKey, 'POST', req.path, bodyHash, JSON.stringify({ version: result.version })]
    );
  }

  // version events: the new one and the superseded one
  await publish(roomChannel(roomId), JSON.stringify({ event: 'version', data: { version: result.version } }));
  if (result.superseded) {
    await publish(roomChannel(roomId), JSON.stringify({ event: 'version', data: { version: result.superseded } }));
  }
  res.status(201).json({ version: result.version });
}));

router.post('/versions/:versionId/link', route(async (req, res) => {
  const a = requireAuth(req);
  const row = await pool.query(
    `SELECT v.*, r.workspace_id FROM versions v JOIN rooms r ON r.id = v.room_id WHERE v.id = $1`,
    [req.params.versionId]
  );
  if (!row.rows.length || row.rows[0].workspace_id !== a.user.workspaceId) throw notFound();
  if (a.user.role !== 'owner') throw forbidden();
  const token = uid32();
  await pool.query(`UPDATE build_tokens SET revoked = true WHERE version_id = $1`, [req.params.versionId]);
  await pool.query(`INSERT INTO build_tokens (token, version_id) VALUES ($1,$2)`, [token, req.params.versionId]);
  const version = await versionJson({ ...row.rows[0], pack_token: token });
  await publish(roomChannel(row.rows[0].room_id), JSON.stringify({ event: 'version', data: { version } }));
  res.status(201).json({ packUrl: version.packUrl });
}));

router.delete('/versions/:versionId/link', route(async (req, res) => {
  const a = requireAuth(req);
  const row = await pool.query(
    `SELECT v.*, r.workspace_id FROM versions v JOIN rooms r ON r.id = v.room_id WHERE v.id = $1`,
    [req.params.versionId]
  );
  if (!row.rows.length || row.rows[0].workspace_id !== a.user.workspaceId) throw notFound();
  if (a.user.role !== 'owner') throw forbidden();
  await pool.query(`UPDATE build_tokens SET revoked = true WHERE version_id = $1`, [req.params.versionId]);
  const version = await versionJson({ ...row.rows[0], pack_token: null });
  await publish(roomChannel(row.rows[0].room_id), JSON.stringify({ event: 'version', data: { version } }));
  res.status(204).end();
}));

/* ------------------------------------------------------------ playtests */

function utcLine(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

router.post('/playtests', route(async (req, res) => {
  const a = requireAuth(req);
  if (a.user.role !== 'owner') throw forbidden();
  const body = req.body ?? {};
  if (typeof body.roomId !== 'string' || !body.roomId) throw oneField('roomId', 'required');
  await roomOf(body.roomId, a.user.workspaceId);
  const starts = new Date(body.startsAt);
  if (Number.isNaN(starts.getTime()) || typeof body.startsAt !== 'string' || !/Z|[+-]\d{2}:?\d{2}$/.test(body.startsAt)) {
    throw oneField('startsAt', 'not a valid time');
  }
  const nowMs = Date.now();
  if (starts.getTime() < nowMs - 5 * 60_000 || starts.getTime() > nowMs + 30 * 86400_000) {
    throw oneField('startsAt', 'must be between 5 minutes ago and 30 days ahead');
  }
  const id = uid();
  await pool.query(
    `INSERT INTO sessions (id, room_id, kind, state, host_user_id, starts_at, duration_seconds)
     VALUES ($1,$2,'remote','scheduled',$3,$4,$5)`,
    [id, body.roomId, a.user.id, starts.toISOString(), config.playtestDuration]
  );
  const full = await fullSession(id);
  res.status(201).json({ session: full?.session });
}));

router.post('/rooms/:roomId/walk-in', route(async (req, res) => {
  const a = requireAuth(req);
  const roomId = req.params.roomId;
  await roomOf(roomId, a.user.workspaceId);
  if (!valkeyAvailable()) throw liveUnavailable();
  const busy = await activeSessionOf(roomId);
  if (busy) { res.status(409).json({ error: 'room_busy' }); return; }
  const id = uid();
  await pool.query(
    `INSERT INTO sessions (id, room_id, kind, state, host_user_id, starts_at, started_at, duration_seconds)
     VALUES ($1,$2,'walk_in','running',$3,now(),now(),$4)`,
    [id, roomId, a.user.id, config.playtestDuration]
  );
  const nodes = await roomNodes(roomId);
  const anyExit = nodes.find((n) => n.kind === 'exit');
  const started = new Date();
  if (anyExit || nodes.some((n) => n.kind === 'lock' || n.kind === 'cue')) {
    await fireAutomatic(id, started);
  }
  const full = await fullSession(id);
  await publish(roomChannel(roomId), JSON.stringify({ event: 'session', data: { session: full?.session } }));
  await publish(sessionChannel(id), JSON.stringify({ event: 'session', data: { session: full?.session } }));
  res.status(201).json({ session: full?.session });
}));

async function canControl(sessionRow: { host_user_id: string }, a: ReturnType<typeof requireAuth>): Promise<void> {
  const owner = a.user.role === 'owner';
  const host = sessionRow.host_user_id === a.user.id;
  if (!owner && !host) throw forbidden();
}

router.post('/playtests/:id/:action(open|start|end|cancel)', route(async (req, res) => {
  const a = requireAuth(req);
  const action = req.params.action;
  const loaded = await loadSession(req.params.id);
  if (!loaded) throw notFound();
  const room = await pool.query(`SELECT workspace_id FROM rooms WHERE id = $1`, [loaded.row.room_id]);
  if (room.rows[0].workspace_id !== a.user.workspaceId) throw notFound();
  await canControl(loaded.row, a);

  const from = loaded.row.state;
  const to = action === 'open' ? 'lobby' : action === 'start' ? 'running' : action === 'end' ? 'ended' : 'cancelled';
  if (!canTransition(from, to)) {
    res.status(409).json({ error: 'invalid_transition', state: from });
    return;
  }
  if ((action === 'open' || action === 'start') && !valkeyAvailable()) throw liveUnavailable();
  if (action === 'open' || action === 'start') {
    const busy = await activeSessionOf(loaded.row.room_id);
    if (busy && busy.id !== loaded.row.id) { res.status(409).json({ error: 'room_busy' }); return; }
  }
  if (action === 'start') {
    await pool.query(`UPDATE sessions SET state = 'running', started_at = now() WHERE id = $1`, [loaded.row.id]);
    await fireAutomatic(loaded.row.id, new Date());
  } else if (action === 'end') {
    await settleSession(loaded.row.id);
    const fresh = await loadSession(loaded.row.id);
    if (fresh && fresh.row.state === 'running') {
      const startedAt = fresh.row.started_at ?? new Date();
      const elapsed = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
      await pool.query(
        `UPDATE sessions SET state = 'ended', ended_at = now(), outcome = 'stopped', duration_seconds = LEAST(duration_seconds, $2) WHERE id = $1`,
        [loaded.row.id, Math.max(elapsed, 0)]
      );
      await sendDebrief(loaded.row.id);
    }
  } else if (action === 'cancel') {
    await pool.query(`UPDATE sessions SET state = 'cancelled', ended_at = now() WHERE id = $1`, [loaded.row.id]);
  } else {
    await pool.query(`UPDATE sessions SET state = 'lobby' WHERE id = $1`, [loaded.row.id]);
  }
  const full = await fullSession(loaded.row.id);
  await publish(roomChannel(loaded.row.room_id), JSON.stringify({ event: 'session', data: { session: full?.session } }));
  await publish(sessionChannel(loaded.row.id), JSON.stringify({ event: 'session', data: { session: full?.session } }));
  res.json({ session: full?.session });
}));

router.get('/playtests/:id', route(async (req, res) => {
  const a = requireAuth(req);
  const loaded = await loadSession(req.params.id);
  if (!loaded) throw notFound();
  const room = await pool.query(`SELECT workspace_id FROM rooms WHERE id = $1`, [loaded.row.room_id]);
  if (room.rows[0].workspace_id !== a.user.workspaceId) throw notFound();
  if (loaded.row.state === 'running') await settleSession(loaded.row.id);
  const full = await fullSession(req.params.id);
  res.json({ session: full?.session });
}));

router.get('/rooms/:roomId/playtests', route(async (req, res) => {
  const a = requireAuth(req);
  const roomId = req.params.roomId;
  await roomOf(roomId, a.user.workspaceId);
  const r = await pool.query(`SELECT id FROM sessions WHERE room_id = $1 ORDER BY created_at DESC, id`, [roomId]);
  const sessions = [];
  for (const row of r.rows) {
    const full = await fullSession(row.id);
    if (full) sessions.push(full.session);
  }
  res.json({ sessions });
}));

router.post('/playtests/:id/invites', route(async (req, res) => {
  const a = requireAuth(req);
  const loaded = await loadSession(req.params.id);
  if (!loaded) throw notFound();
  const room = await pool.query(`SELECT workspace_id FROM rooms WHERE id = $1`, [loaded.row.room_id]);
  if (room.rows[0].workspace_id !== a.user.workspaceId) throw notFound();
  await canControl(loaded.row, a);
  if (!['scheduled', 'lobby', 'running'].includes(loaded.row.state)) {
    res.status(409).json({ error: 'session_closed' });
    return;
  }
  const email = String(req.body?.email ?? '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw oneField('email', 'must be an email');
  const dup = await pool.query(
    `SELECT 1 FROM invites WHERE session_id = $1 AND lower(email) = lower($2) AND revoked = false`,
    [loaded.row.id, email]
  );
  if (dup.rows.length) throw oneField('email', 'already invited');
  const count = await pool.query(
    `SELECT count(*) AS n FROM invites WHERE session_id = $1 AND revoked = false`,
    [loaded.row.id]
  );
  if (Number(count.rows[0].n) >= 6) { res.status(409).json({ error: 'roster_full' }); return; }

  const inviteId = uid();
  const token = uid32();
  await pool.query(
    `INSERT INTO invites (id, session_id, email, token) VALUES ($1,$2,$3,$4)`,
    [inviteId, loaded.row.id, email, token]
  );
  const subject = `Playtest invite: ${loaded.roomName}`;
  const body = `Starts ${utcLine(new Date(loaded.row.starts_at))} UTC\n${config.publicUrl}/play/${token}`;
  await pool.query(
    `INSERT INTO emails (id, kind, recipient, subject, body, session_id, invite_id, status, attempts, next_attempt)
     VALUES ($1,'invite',$2,$3,$4,$5,$6,'queued',0,now())`,
    [uid32(), email, subject, body, loaded.row.id, inviteId]
  );
  const { attemptEmails } = await import('./mailer-queue.js');
  attemptEmails();
  const ok = await (async () => {
    const e = await pool.query(`SELECT status FROM emails WHERE invite_id = $1`, [inviteId]);
    return (e.rows[0]?.status as string) === 'sent' ? 'sent' : 'queued';
  })();
  res.status(201).json({
    invite: { id: inviteId, email, emailStatus: ok, joinUrl: `${config.publicUrl}/play/${token}` },
  });
}));

router.delete('/playtests/:id/invites/:inviteId', route(async (req, res) => {
  const a = requireAuth(req);
  const loaded = await loadSession(req.params.id);
  if (!loaded) throw notFound();
  const room = await pool.query(`SELECT workspace_id FROM rooms WHERE id = $1`, [loaded.row.room_id]);
  if (room.rows[0].workspace_id !== a.user.workspaceId) throw notFound();
  await canControl(loaded.row, a);
  const r = await pool.query(
    `UPDATE invites SET revoked = true WHERE id = $1 AND session_id = $2 RETURNING id`,
    [req.params.inviteId, req.params.id]
  );
  if (!r.rows.length) throw notFound();
  const full = await fullSession(req.params.id);
  await publish(roomChannel(loaded.row.room_id), JSON.stringify({ event: 'session', data: { session: full?.session } }));
  res.status(204).end();
}));

router.post('/playtests/:id/invites/:inviteId/resend', route(async (req, res) => {
  const a = requireAuth(req);
  const loaded = await loadSession(req.params.id);
  if (!loaded) throw notFound();
  const room = await pool.query(`SELECT workspace_id FROM rooms WHERE id = $1`, [loaded.row.room_id]);
  if (room.rows[0].workspace_id !== a.user.workspaceId) throw notFound();
  await canControl(loaded.row, a);
  const invite = await pool.query(
    `SELECT * FROM invites WHERE id = $1 AND session_id = $2 AND revoked = false`,
    [req.params.inviteId, req.params.id]
  );
  if (!invite.rows.length) throw notFound();
  const subject = `Playtest invite: ${loaded.roomName}`;
  const body = `Starts ${utcLine(new Date(loaded.row.starts_at))} UTC\n${config.publicUrl}/play/${invite.rows[0].token}`;
  await pool.query(
    `INSERT INTO emails (id, kind, recipient, subject, body, session_id, invite_id, status, attempts, next_attempt)
     VALUES ($1,'invite',$2,$3,$4,$5,$6,'queued',0,now())`,
    [uid32(), invite.rows[0].email, subject, body, req.params.id, req.params.inviteId]
  );
  const { attemptEmails } = await import('./mailer-queue.js');
  attemptEmails();
  const e = await pool.query(`SELECT status FROM emails WHERE invite_id = $1 ORDER BY created_at DESC LIMIT 1`, [req.params.inviteId]);
  const status = (e.rows[0]?.status as string) === 'sent' ? 'sent' : 'queued';
  res.status(202).json({
    invite: { id: req.params.inviteId, email: invite.rows[0].email, emailStatus: status, joinUrl: `${config.publicUrl}/play/${invite.rows[0].token}` },
  });
}));

router.post('/playtests/:id/hints', route(async (req, res) => {
  const a = requireAuth(req);
  const loaded = await loadSession(req.params.id);
  if (!loaded) throw notFound();
  const room = await pool.query(`SELECT workspace_id FROM rooms WHERE id = $1`, [loaded.row.room_id]);
  if (room.rows[0].workspace_id !== a.user.workspaceId) throw notFound();
  await canControl(loaded.row, a);
  if (loaded.row.state !== 'running') { res.status(409).json({ error: 'session_not_running' }); return; }
  if (!valkeyAvailable()) throw liveUnavailable();
  const text = String(req.body?.text ?? '').trim();
  if (text.length < 1 || text.length > 280) throw oneField('text', 'must be 1 to 280 characters');
  if (loaded.row.last_hint_at) {
    const since = Math.floor((Date.now() - new Date(loaded.row.last_hint_at).getTime()) / 1000);
    if (since < config.hintCooldown) {
      res.status(429).json({ error: 'hint_cooldown', retryAfterSeconds: config.hintCooldown - since });
      return;
    }
  }
  await pool.query(`INSERT INTO hints (session_id, text) VALUES ($1,$2)`, [req.params.id, text]);
  await pool.query(`UPDATE sessions SET last_hint_at = now() WHERE id = $1`, [req.params.id]);
  const hintCount = await pool.query(`SELECT count(*) AS n FROM hints WHERE session_id = $1`, [req.params.id]);
  const payload = {
    sessionId: req.params.id,
    text,
    sentAt: new Date().toISOString(),
    hintsUsed: Number(hintCount.rows[0].n),
    hintCooldownSeconds: config.hintCooldown,
  };
  await publish(roomChannel(loaded.row.room_id), JSON.stringify({ event: 'hint', data: payload }));
  await publish(sessionChannel(req.params.id), JSON.stringify({ event: 'hint', data: payload }));
  res.status(201).json({ hint: { text, sentAt: payload.sentAt }, hintCooldownSeconds: config.hintCooldown });
}));

router.post('/playtests/:id/solves', route(async (req, res) => {
  const a = requireAuth(req);
  const loaded = await loadSession(req.params.id);
  if (!loaded) throw notFound();
  const room = await pool.query(`SELECT workspace_id FROM rooms WHERE id = $1`, [loaded.row.room_id]);
  if (room.rows[0].workspace_id !== a.user.workspaceId) throw notFound();
  await canControl(loaded.row, a);
  if (!valkeyAvailable()) throw liveUnavailable();
  const result = await solveNode(req.params.id, req.body?.nodeId, req.body?.answer, a.user.displayName);
  if ('error' in result) {
    const { status, body } = result.error;
    res.status(status).json(body);
    return;
  }
  res.json(result.body);
}));

router.get('/playtests/:id/debrief', route(async (req, res) => {
  const a = requireAuth(req);
  const loaded = await loadSession(req.params.id);
  if (!loaded) throw notFound();
  const room = await pool.query(`SELECT workspace_id FROM rooms WHERE id = $1`, [loaded.row.room_id]);
  if (room.rows[0].workspace_id !== a.user.workspaceId) throw notFound();
  if (loaded.row.state !== 'ended') { res.status(409).json({ error: 'session_not_ended' }); return; }
  const debrief = await buildDebrief(req.params.id);
  res.json(debrief);
}));

/* Solving shared by host and tester routes. */
async function solveNode(
  sessionId: string, nodeId: unknown, answer: unknown, solvedBy: string | null
): Promise<{ body: unknown } | { error: { status: number; body: unknown } }> {
  const loaded = await loadSession(sessionId);
  if (!loaded) return { error: { status: 404, body: { error: 'not_found' } } };
  if (loaded.row.state !== 'running') {
    return { error: { status: 409, body: { error: 'session_not_running' } } };
  }
  if (typeof nodeId !== 'string') return { error: { status: 422, body: { error: 'validation', errors: { nodeId: 'required' } } } };
  const node = await pool.query(`SELECT * FROM trigger_nodes WHERE id = $1 AND room_id = $2`, [nodeId, loaded.row.room_id]);
  if (!node.rows.length) return { error: { status: 404, body: { error: 'not_found' } } };
  const n = node.rows[0];
  if (n.kind === 'lock' || n.kind === 'cue') {
    return { error: { status: 422, body: { error: 'validation', errors: { nodeId: 'fires on its own' } } } };
  }
  const solvedRows = await pool.query(`SELECT DISTINCT node_id FROM session_solves WHERE session_id = $1`, [sessionId]);
  const solved = new Set(solvedRows.rows.map((r) => r.node_id as string));
  if (solved.has(nodeId)) {
    const full = await fullSession(sessionId);
    return { body: { session: full?.session, alreadySolved: true } };
  }
  if (!n.prerequisites.every((p: string) => solved.has(p))) {
    return { error: { status: 409, body: { error: 'prerequisites_unsolved' } } };
  }
  if (n.answer !== null && typeof n.answer === 'string') {
    const given = String(answer ?? '').trim().toLowerCase();
    if (given !== n.answer.trim().toLowerCase()) {
      return { error: { status: 422, body: { error: 'validation', errors: { answer: 'incorrect' } } } };
    }
  }
  const startedAt = loaded.row.started_at ?? new Date();
  const elapsed = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  await pool.query(
    `INSERT INTO session_solves (session_id, node_id, title, elapsed_seconds, solved_by) VALUES ($1,$2,$3,$4,$5)`,
    [sessionId, nodeId, n.title, elapsed, solvedBy]
  );
  await fireAutomatic(sessionId, startedAt);
  if (n.kind === 'exit') {
    await pool.query(`UPDATE sessions SET state = 'ended', ended_at = now(), outcome = 'escaped' WHERE id = $1`, [sessionId]);
    await sendDebrief(sessionId);
  }
  const full = await fullSession(sessionId);
  await publish(roomChannel(loaded.row.room_id), JSON.stringify({ event: 'session', data: { session: full?.session } }));
  await publish(sessionChannel(sessionId), JSON.stringify({ event: 'session', data: { session: full?.session } }));
  const { roomStats } = await import('./room-service.js');
  const stats = await roomStats(loaded.row.room_id);
  const solvePayload = JSON.stringify({ event: 'solve', data: { sessionId, nodeId, title: n.title, elapsedSeconds: elapsed, solvedBy, stats } });
  await publish(roomChannel(loaded.row.room_id), solvePayload);
  await publish(sessionChannel(sessionId), solvePayload);
  return { body: { session: full?.session, alreadySolved: false } };
}

/* ------------------------------------------------------------ tester API */

async function inviteByToken(token: string): Promise<{ row: { id: string; session_id: string; revoked: boolean; joined: boolean; display_name: string | null } } | null> {
  const r = await pool.query(`SELECT * FROM invites WHERE token = $1`, [token]);
  return r.rows.length ? { row: r.rows[0] } : null;
}

async function playBody(inviteRow: { id: string; session_id: string; joined: boolean; display_name: string | null }): Promise<unknown> {
  const full = await fullSession(inviteRow.session_id);
  if (!full) throw notFound();
  const roomId = full.row.room_id;
  const [roomRow, placements, nodes] = await Promise.all([
    pool.query(`SELECT * FROM rooms WHERE id = $1`, [roomId]),
    roomPlacements(roomId),
    roomNodes(roomId),
  ]);
  const solvedRows = await pool.query(`SELECT DISTINCT node_id FROM session_solves WHERE session_id = $1`, [inviteRow.session_id]);
  const solved = new Set(solvedRows.rows.map((r) => r.node_id as string));
  const avail = availability(asNodeLike(nodes as unknown as Record<string, unknown>[]), solved);
  const ordered = chainOrder(asNodeLike(nodes as unknown as Record<string, unknown>[]));
  const hints = await pool.query(`SELECT text, sent_at FROM hints WHERE session_id = $1 ORDER BY id`, [inviteRow.session_id]);
  return {
    session: {
      state: full.session.state, startsAt: full.session.startsAt,
      remainingSeconds: full.session.remainingSeconds,
      hintCooldownSeconds: full.session.hintCooldownSeconds,
      durationSeconds: full.session.durationSeconds,
      serverTime: full.session.serverTime,
      outcome: full.session.outcome,
    },
    room: {
      name: roomRow.rows[0].name, widthMm: roomRow.rows[0].width_mm,
      depthMm: roomRow.rows[0].depth_mm, heightMm: roomRow.rows[0].height_mm,
      placements: placements.map((p) => placementJson(p as unknown as Record<string, unknown>)),
    },
    nodes: ordered.map((n) => ({
      id: n.id, title: n.title, kind: n.kind, prerequisites: n.prerequisites,
      placementId: n.placementId,
      needsAnswer: (n.kind === 'puzzle' || n.kind === 'exit') && !!n.answer,
      solved: solved.has(n.id),
      available: !!avail.get(n.id),
    })),
    testers: full.session.testers.map((t) => ({ displayName: t.displayName, joined: t.joined })),
    me: { displayName: inviteRow.display_name ?? '', joined: inviteRow.joined },
    hints: hints.rows.map((h) => ({ text: h.text, sentAt: new Date(h.sent_at).toISOString() })),
  };
}

router.get('/play/:token', route(async (req, res) => {
  const invite = await inviteByToken(req.params.token);
  if (!invite || invite.row.revoked) throw notFound();
  const loaded = await loadSession(invite.row.session_id);
  if (!loaded) throw notFound();
  if (loaded.row.state === 'ended' || loaded.row.state === 'cancelled') {
    res.status(410).json({ error: 'invite_expired' });
    return;
  }
  if (loaded.row.state === 'running') await settleSession(loaded.row.id);
  res.json(await playBody(invite.row));
}));

router.post('/play/:token/join', route(async (req, res) => {
  const invite = await inviteByToken(req.params.token);
  if (!invite || invite.row.revoked) throw notFound();
  const loaded = await loadSession(invite.row.session_id);
  if (!loaded) throw notFound();
  if (loaded.row.state === 'ended' || loaded.row.state === 'cancelled') {
    res.status(410).json({ error: 'invite_expired' });
    return;
  }
  const name = String(req.body?.displayName ?? '').trim();
  if (name.length < 1 || name.length > 40) throw oneField('displayName', 'must be 1 to 40 characters');
  await pool.query(`UPDATE invites SET joined = true, display_name = $2 WHERE id = $1`, [invite.row.id, name]);
  const row = (await pool.query(`SELECT * FROM invites WHERE id = $1`, [invite.row.id])).rows[0];
  res.json(await playBody(row));
}));

router.post('/play/:token/solves', route(async (req, res) => {
  const invite = await inviteByToken(req.params.token);
  if (!invite || invite.row.revoked) throw notFound();
  const loaded = await loadSession(invite.row.session_id);
  if (!loaded) throw notFound();
  if (loaded.row.state === 'ended' || loaded.row.state === 'cancelled') {
    res.status(410).json({ error: 'invite_expired' });
    return;
  }
  if (!invite.row.joined) { res.status(409).json({ error: 'not_joined' }); return; }
  if (!valkeyAvailable()) throw liveUnavailable();
  const result = await solveNode(invite.row.session_id, req.body?.nodeId, req.body?.answer, invite.row.display_name);
  if ('error' in result) {
    const { status, body } = result.error;
    res.status(status).json(body);
    return;
  }
  const row = (await pool.query(`SELECT * FROM invites WHERE id = $1`, [invite.row.id])).rows[0];
  const body = (await playBody(row)) as { nodes: unknown[]; session: unknown };
  const already = (result.body as { alreadySolved: boolean }).alreadySolved;
  res.json({ nodes: body.nodes, session: body.session, alreadySolved: already });
}));

router.post('/play/:token/position', route(async (req, res) => {
  const invite = await inviteByToken(req.params.token);
  if (!invite || invite.row.revoked) throw notFound();
  const { xMm, zMm, headingDeg } = req.body ?? {};
  if (!Number.isInteger(xMm) || !Number.isInteger(zMm) || !Number.isInteger(headingDeg)) {
    throw oneField('position', 'required');
  }
  const payload = JSON.stringify({
    event: 'tester', data: { sessionId: invite.row.session_id, displayName: invite.row.display_name, xMm, zMm, headingDeg },
  });
  await publish(sessionChannel(invite.row.session_id), payload);
  res.status(204).end();
}));

/* -------------------------------------------------------------- build pack */

async function packByToken(token: string): Promise<{ versionId: string; roomId: string } | null> {
  const r = await pool.query(
    `SELECT t.version_id, v.room_id FROM build_tokens t JOIN versions v ON v.id = t.version_id WHERE t.token = $1 AND t.revoked = false`,
    [token]
  );
  return r.rows.length ? { versionId: r.rows[0].version_id as string, roomId: r.rows[0].room_id as string } : null;
}

router.get('/pack/:token', route(async (req, res) => {
  const pack = await packByToken(req.params.token);
  if (!pack) throw notFound();
  const v = await pool.query(`SELECT * FROM versions WHERE id = $1`, [pack.versionId]);
  const scene = await pool.query(`SELECT * FROM version_scene WHERE version_id = $1`, [pack.versionId]);
  const placements = await pool.query(`SELECT * FROM version_placements WHERE version_id = $1`, [pack.versionId]);
  const nodes = await pool.query(`SELECT * FROM version_nodes WHERE version_id = $1`, [pack.versionId]);
  const snapshot = await getObject(`versions/${pack.versionId}/snapshot.json`);
  if (snapshot === null) throw storageUnavailable();
  const snap = JSON.parse(snapshot.toString('utf8'));
  const linked = new Map(placements.rows.map((p) => [p.placement_id, (p.data as { label: string }).label]));
  const titles = new Map(nodes.rows.map((n) => [n.node_id, (n.data as { title: string }).title]));
  void linked; void titles;
  res.json({
    version: {
      number: Number(v.rows[0].number), label: v.rows[0].label,
      state: v.rows[0].state, frozenAt: new Date(v.rows[0].frozen_at).toISOString(),
      supersededBy: v.rows[0].superseded_by === null ? null : Number(v.rows[0].superseded_by),
    },
    room: snap.room,
    placements: snap.placements,
    nodes: (snap.nodes as Array<{ title: string; kind: string; needs: string[]; linkedPlacement: string | null; answer: string | null }>).map((n) => ({
      title: n.title, kind: n.kind,
      needs: n.needs,
      linkedPlacement: n.linkedPlacement,
      answer: n.answer,
    })),
    props: snap.props,
    stats: snap.stats,
  });
  void linked; void titles; void scene;
}));

router.get('/pack/:token/props/:propId', route(async (req, res) => {
  const pack = await packByToken(req.params.token);
  if (!pack) throw notFound();
  // The pack serves its own copies even after the library changes.
  const snapshot = await getObject(`versions/${pack.versionId}/snapshot.json`);
  if (snapshot === null) throw storageUnavailable();
  const snap = JSON.parse(snapshot.toString('utf8')) as { props: Array<{ id: string; name: string; bytes: number; sha256: string }> };
  const entry = snap.props.find((p) => p.id === req.params.propId);
  if (!entry) throw notFound();
  // The version's own copy holds the content type from freeze time; try both extensions.
  let buf = await getObject(`versions/${pack.versionId}/props/${req.params.propId}.glb`);
  let contentType = 'model/gltf-binary';
  if (buf === null) {
    buf = await getObject(`versions/${pack.versionId}/props/${req.params.propId}.gltf`);
    contentType = 'model/gltf+json';
  }
  if (buf === null) throw notFound();
  await serveStored(buf, contentType, entry.name, req, res);
}));

router.get('/pack/:token/snapshot', route(async (req, res) => {
  const pack = await packByToken(req.params.token);
  if (!pack) throw notFound();
  const buf = await getObject(`versions/${pack.versionId}/snapshot.json`);
  if (buf === null) throw storageUnavailable();
  res.status(200).type('application/json').send(buf);
}));

router.all('/pack/:token*', (req, res) => {
  if (req.method === 'GET' || req.method === 'HEAD') { res.status(404).json({ error: 'not_found' }); return; }
  res.status(405).json({ error: 'read_only' });
});

/* ------------------------------------------- changes, undo, restore, SSE */

router.get('/rooms/:roomId/changes', route(async (req, res) => {
  const a = requireAuth(req);
  const roomId = req.params.roomId;
  await roomOf(roomId, a.user.workspaceId);
  const since = Number(req.query.since ?? 0) || 0;
  const rev = await pool.query(`SELECT revision FROM rooms WHERE id = $1`, [roomId]);
  const rows = await pool.query(
    `SELECT revision, op_id, kind, placement_id, user_id FROM room_changes WHERE room_id = $1 AND revision > $2 ORDER BY revision`,
    [roomId, since]
  );
  res.json({
    revision: rev.rows[0].revision,
    changes: rows.rows.map((r) => ({
      revision: Number(r.revision), opId: r.op_id ?? null, kind: r.kind,
      placementId: r.placement_id ?? null, userId: r.user_id,
    })),
  });
}));

router.post('/rooms/:roomId/placements/:placementId/scene-move', route(async (req, res) => {
  const a = requireAuth(req);
  const roomId = req.params.roomId;
  await roomOf(roomId, a.user.workspaceId);
  const placementId = req.params.placementId;
  const opId = req.header('Op-Id') ?? null;
  validateOpId(opId ?? undefined);
  await refuseDuringPlaytest(roomId);
  const tomb = await pool.query(`SELECT * FROM deleted_placements WHERE room_id = $1 AND placement_id = $2`, [roomId, placementId]);
  const exists = await pool.query(`SELECT 1 FROM placements WHERE id = $1 AND room_id = $2 AND deleted_at IS NULL`, [placementId, roomId]);
  if (!exists.rows.length) {
    if (tomb.rows.length) {
      const t = tomb.rows[0];
      throw new ApiError(410, 'placement_deleted', undefined, { label: t.label, deletedBy: { userId: t.deleted_by, displayName: t.deleted_by_name } });
    }
    throw notFound();
  }
  // replay: after the 404 and 410 checks
  if (opId) {
    const replay = await replayLookup(a.user.workspaceId, opId);
    if (replay) {
      const entry = (await pool.query(`SELECT * FROM change_log WHERE workspace_id = $1 AND op_id = $2`, [a.user.workspaceId, opId])).rows[0];
      if (!entry || entry.room_id !== roomId || entry.placement_id !== placementId) {
        res.status(409).json({ error: 'op_id_reused' });
        return;
      }
      res.status(replay.status).json(JSON.parse(replay.body));
      return;
    }
  }
  const dir = req.body?.direction;
  if (dir !== 'up' && dir !== 'down') throw oneField('direction', 'must be up or down');
  const room = (await pool.query(`SELECT scene_order FROM rooms WHERE id = $1`, [roomId])).rows[0];
  const order = room.scene_order as string[];
  const idx = order.indexOf(placementId);
  if (dir === 'up' && idx <= 0) throw oneField('direction', 'already first');
  if (dir === 'down' && idx >= order.length - 1) throw oneField('direction', 'already last');
  const swap = dir === 'up' ? idx - 1 : idx + 1;
  const next = [...order];
  [next[idx], next[swap]] = [next[swap], next[idx]];
  await pool.query(`UPDATE rooms SET scene_order = $2 WHERE id = $1`, [roomId, next]);
  const revision = (await pool.query(`SELECT revision FROM rooms WHERE id = $1`, [roomId])).rows[0].revision;
  const respBody = { sceneOrder: next, revision: revision + 1 };
  await recordChange(roomId, a.user.workspaceId, a.user.id, 'move', placementId, opId, pool, respBody);
  await publish(roomChannel(roomId), JSON.stringify({ event: 'room', data: { room: { sceneOrder: next } } }));
  res.json(respBody);
}));

router.post('/rooms/:roomId/undo', route(async (req, res) => {
  const a = requireAuth(req);
  const roomId = req.params.roomId;
  await roomOf(roomId, a.user.workspaceId);
  await refuseDuringPlaytest(roomId);
  const entry = await pool.query(
    `SELECT * FROM undo_entries WHERE room_id = $1 AND user_id = $2 ORDER BY id DESC LIMIT 1`,
    [roomId, a.user.id]
  );
  if (!entry.rows.length) { res.status(409).json({ error: 'nothing_to_undo' }); return; }
  const e = entry.rows[0];
  const exists = await pool.query(`SELECT 1 FROM placements WHERE id = $1 AND deleted_at IS NULL`, [e.placement_id]);
  if (!exists.rows.length) {
    const tomb = await pool.query(`SELECT * FROM deleted_placements WHERE room_id = $1 AND placement_id = $2`, [roomId, e.placement_id]);
    await pool.query(`DELETE FROM undo_entries WHERE id = $1`, [e.id]);
    const t = tomb.rows[0];
    res.status(409).json({
      error: 'undo_conflict',
      label: t?.label ?? e.label,
      deletedBy: { userId: t?.deleted_by ?? '', displayName: t?.deleted_by_name ?? '' },
    });
    return;
  }
  const holder = await lockHeld(roomId, 'placement', e.placement_id);
  if (holder && holder.userId !== a.user.id) {
    res.status(409).json({ error: 'locked', holder, expiresInSeconds: config.lockTtl });
    return;
  }
  // pg returns jsonb already parsed
  const fields = e.fields as string[];
  const prev = e.prev_values as Record<string, unknown>;
  const sets: string[] = [];
  const params: unknown[] = [e.placement_id];
  for (const f of fields) {
    params.push(prev[f]);
    sets.push(`${PLACEMENT_COLS[f]} = $${params.length}`);
  }
  sets.push(`version = version + 1`);
  await pool.query(`UPDATE placements SET ${sets.join(', ')} WHERE id = $1`, params);
  await pool.query(`DELETE FROM undo_entries WHERE id = $1`, [e.id]);
  await recordChange(roomId, a.user.workspaceId, a.user.id, 'undo', e.placement_id, req.header('Op-Id') ?? null, pool);
  const row = (await pool.query(`SELECT * FROM placements WHERE id = $1`, [e.placement_id])).rows[0];
  const revision = (await pool.query(`SELECT revision FROM rooms WHERE id = $1`, [roomId])).rows[0].revision;
  const fieldWord = (k: string) =>
    ['xMm', 'yMm', 'zMm'].includes(k) ? 'position' : k === 'rotationDeg' ? 'rotation' : k === 'label' ? 'label' : 'size';
  await publish(roomChannel(roomId), JSON.stringify({ event: 'placement', data: { placement: placementJson(row) } }));
  res.json({
    undone: { placementId: e.placement_id, label: e.label, field: fieldWord(fields[0]) },
    placement: placementJson(row),
    revision,
  });
}));

router.post('/rooms/:roomId/restore', route(async (req, res) => {
  const a = requireAuth(req);
  const roomId = req.params.roomId;
  await roomOf(roomId, a.user.workspaceId);
  if (a.user.role !== 'owner') throw forbidden();
  const versionId = req.body?.versionId;
  if (typeof versionId !== 'string' || !versionId) throw oneField('versionId', 'required');
  const v = await pool.query(`SELECT * FROM versions WHERE id = $1 AND room_id = $2`, [versionId, roomId]);
  if (!v.rows.length) throw oneField('versionId', 'unknown version');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT id FROM rooms WHERE id = $1 FOR UPDATE`, [roomId]);
    const scene = (await client.query(`SELECT * FROM version_scene WHERE version_id = $1`, [versionId])).rows[0];
    const vPlacements = (await client.query(`SELECT * FROM version_placements WHERE version_id = $1`, [versionId])).rows;
    const vNodes = (await client.query(`SELECT * FROM version_nodes WHERE version_id = $1`, [versionId])).rows;

    const roomJsonData = scene.room_json as unknown as { name: string; widthMm: number; depthMm: number; heightMm: number };
    // a prop that is no longer in the library blocks the restore
    const neededProps = vPlacements.map((p) => (p.data as { propId: string | null }).propId).filter(Boolean) as string[];
    if (neededProps.length) {
      const found = await client.query(`SELECT id FROM props WHERE id = ANY($1)`, [neededProps]);
      if (found.rows.length !== neededProps.length) { await client.query('ROLLBACK'); res.status(409).json({ error: 'prop_missing' }); return; }
    }
    await client.query(`DELETE FROM placements WHERE room_id = $1`, [roomId]);
    for (const p of vPlacements) {
      const d = p.data as Record<string, string | number | boolean | null>;
      const existing = await client.query(`SELECT version FROM placements WHERE id = $1`, [p.placement_id]);
      const version = existing.rows.length ? Number(existing.rows[0].version) + 1 : 1;
      await client.query(
        `INSERT INTO placements (id, room_id, kind, label, prop_id, entry, x_mm, y_mm, z_mm, rotation_deg, width_mm, depth_mm, height_mm, version, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, (SELECT created_at FROM rooms WHERE id = $2))`,
        [p.placement_id, roomId, d.kind, d.label, d.propId ?? null, !!d.entry, d.xMm ?? d.x_mm, d.yMm ?? d.y_mm, d.zMm ?? d.z_mm,
         d.rotationDeg ?? d.rotation_deg, d.widthMm ?? d.width_mm, d.depthMm ?? d.depth_mm, d.heightMm ?? d.height_mm, version]
      );
    }
    // remove stale tombstones for restored placements
    if (vPlacements.length) {
      const ids = vPlacements.map((p) => p.placement_id);
      await client.query(`DELETE FROM deleted_placements WHERE room_id = $1 AND placement_id = ANY($2)`, [roomId, ids]);
    }
    await client.query(`DELETE FROM trigger_nodes WHERE room_id = $1`, [roomId]);
    for (const n of vNodes) {
      const d = n.data as Record<string, unknown>;
      await client.query(
        `INSERT INTO trigger_nodes (id, room_id, title, kind, placement_id, answer, prerequisites, version, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7::text[],1,(SELECT created_at FROM rooms WHERE id = $2))`,
        [n.node_id, roomId, d.title, d.kind, d.placementId ?? null, d.answer ?? null, d.prerequisites ?? []]
      );
    }
    await client.query(
      `UPDATE rooms SET width_mm = $2, depth_mm = $3, height_mm = $4, scene_order = $5, version = version + 1 WHERE id = $1`,
      [roomId, roomJsonData.widthMm, roomJsonData.depthMm, roomJsonData.heightMm, scene.scene_order]
    );
    await client.query(`DELETE FROM undo_entries WHERE room_id = $1`, [roomId]);
    await recordChange(roomId, a.user.workspaceId, a.user.id, 'restore', null, req.header('Op-Id') ?? null, client);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    client.release();
    throw e;
  }
  client.release();
  const [roomRow, placements, nodes] = await Promise.all([
    pool.query(`SELECT r.* FROM rooms r WHERE r.id = $1`, [roomId]),
    roomPlacements(roomId),
    roomNodes(roomId),
  ]);
  const data = {
    room: roomJson(roomRow.rows[0], await roomStats(roomId)),
    placements: placements.map((p) => placementJson(p as unknown as Record<string, unknown>)),
    nodes: chainSorted(nodes as unknown as Record<string, unknown>[]).map((n) => nodeJson(n as unknown as Record<string, unknown>)),
    sceneOrder: roomRow.rows[0].scene_order as string[],
    revision: roomRow.rows[0].revision as number,
  };
  await publish(roomChannel(roomId), JSON.stringify({ event: 'restore', data }));
  res.json(data);
}));

/* ---------------------------------------------------------------- events */

/** Presence from Valkey keys; only yourself while it is down. */
async function presenceOf(roomId: string): Promise<Array<{ userId: string; displayName: string }>> {
  if (!valkeyAvailable()) return [];
  const keys = ((await guard(redis.keys(`presence:${roomId}:*`))) as string[] | null) ?? [];
  const members: Array<{ userId: string; displayName: string }> = [];
  for (const key of keys) {
    const userId = key.split(':')[2];
    const displayName = (await guard(redis.get(key))) as string | null;
    if (displayName) members.push({ userId, displayName });
  }
  return members;
}

router.get('/rooms/:roomId/events', route(async (req, res) => {
  const a = requireAuth(req);
  await roomOf(req.params.roomId, a.user.workspaceId);
  const roomId = req.params.roomId;
  if (!valkeyAvailable()) throw liveUnavailable();
  // presence: refresh every 10 seconds, expires after 30
  const presenceKey = `presence:${roomId}:${a.user.id}`;
  await guard(redis.set(presenceKey, a.user.displayName, { EX: 30 }));
  const members = await presenceOf(roomId);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ event: 'presence', data: { members } })}\n\n`);
  const refresh = setInterval(async () => {
    await guard(redis.set(presenceKey, a.user.displayName, { EX: 30 }));
    const list = await presenceOf(roomId);
    res.write(`data: ${JSON.stringify({ event: 'presence', data: { members: list } })}\n\n`);
  }, 10_000);
  const sub = await subscribeRoom(roomId, (msg) => {
    res.write(`data: ${msg}\n\n`);
  });
  const keep = setInterval(() => res.write(': ping\n\n'), 15_000);
  req.on('close', () => {
    clearInterval(keep);
    clearInterval(refresh);
    void guard(redis.del(presenceKey));
    void sub.unsubscribe();
  });
}));

router.get('/play/:token/events', route(async (req, res) => {
  const invite = await inviteByToken(req.params.token);
  if (!invite || invite.row.revoked) { res.status(404).json({ error: 'not_found' }); return; }
  const loaded = await loadSession(invite.row.session_id);
  if (!loaded) { res.status(404).json({ error: 'not_found' }); return; }
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  const sub = await subscribeSession(invite.row.session_id, (msg) => {
    res.write(`data: ${msg}\n\n`);
  });
  const keep = setInterval(() => res.write(': ping\n\n'), 15_000);
  req.on('close', () => {
    clearInterval(keep);
    void sub.unsubscribe();
  });
}));