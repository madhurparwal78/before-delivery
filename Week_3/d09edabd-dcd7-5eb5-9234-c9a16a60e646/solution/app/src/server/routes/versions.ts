import { createHash, randomUUID } from 'node:crypto';
import { fail, notFound, storageUnavailable, validation } from '../errors.js';
import { hub, roomChannel } from '../events.js';
import { empty, json, route, type Ctx, type Reply } from '../http.js';
import { store } from '../s3.js';
import { UUID } from '../validate.js';
import { downloadReply, extensionOf } from '../domain/props.js';
import { assertEditable, findRoom, listNodes, listPlacements, reloadRoom, type RoomRow } from '../domain/rooms.js';
import { recordChange } from '../domain/changes.js';
import { copyKey, findByToken, findVersion, freezeRoom, newPackToken, packOf, snapshotKey, toVersion, type Frozen, type VersionRow } from '../domain/versions.js';
import type { Version } from '../../shared/types.js';

const READ_ONLY = ['POST', 'PUT', 'PATCH', 'DELETE'];

const publishVersions = (roomId: string, versions: Version[]) => async (): Promise<void> => {
  for (const version of versions) await hub.publish(roomChannel(roomId), 'version', { version });
};

async function loadVersionById(ctx: Ctx) {
  return findVersion(ctx.db, ctx.actor.workspaceId, ctx.params.versionId!, true);
}

/** The owner's freeze: version records, snapshot object, prop copies and link, all or nothing. */
async function freeze(ctx: Ctx, room: RoomRow, label: string, key: string | undefined): Promise<Reply> {
  const last = await ctx.db.query<{ n: number }>(`SELECT coalesce(max(number), 0) AS n FROM versions WHERE room_id = $1`, [room.id]);
  const number = last.rows[0]!.n + 1;
  const id = randomUUID();
  const frozenAt = new Date();
  const frozen = await freezeRoom(ctx.db, room, number, label, frozenAt);
  const store_ = async (key: string, body: Buffer, contentType: string): Promise<void> => {
    await store.put(key, body, contentType);
    ctx.rollbacks.push(() => store.remove(key));
  };
  await store_(snapshotKey(id), Buffer.from(JSON.stringify(frozen.snapshot)), 'application/json');
  for (const prop of frozen.props) {
    const file = await store.get(`props/${prop.id}.${extensionOf(prop.contentType)}`);
    if (!file) throw storageUnavailable();
    await store_(copyKey(id, prop), file.body, prop.contentType);
  }
  const inserted = await ctx.db.query<VersionRow>(
    `INSERT INTO versions (id, room_id, number, label, state, frozen_at, stats, content, pack_token) VALUES ($1,$2,$3,$4,'frozen',$5,$6,$7,$8) RETURNING *`,
    [id, room.id, number, label, frozenAt, JSON.stringify(frozen.snapshot.stats), JSON.stringify(frozen), newPackToken()],
  );
  const superseded = await ctx.db.query<VersionRow>(
    `UPDATE versions SET state = 'superseded', superseded_by = $3 WHERE room_id = $1 AND state = 'frozen' AND id <> $2 RETURNING *`,
    [room.id, id, number],
  );
  const version = toVersion(inserted.rows[0]!);
  const reply = { version };
  if (key) {
    await ctx.db.query(`INSERT INTO idempotency_keys (workspace_id, key, fingerprint, status, response) VALUES ($1,$2,$3,201,$4)`, [
      ctx.actor.workspaceId, key, fingerprint(room.id, ctx), JSON.stringify(reply),
    ]);
  }
  ctx.after.push(publishVersions(room.id, [version, ...superseded.rows.map(toVersion)]));
  return json(201, reply);
}

const fingerprint = (roomId: string, ctx: Ctx): string => createHash('sha256').update(`${roomId}\n${JSON.stringify(ctx.body)}`).digest('hex');

/** Puts the room back as a version froze it: one change, one revision. */
async function restore(ctx: Ctx, room: RoomRow, version: VersionRow): Promise<Reply> {
  const frozen: Frozen = version.content;
  const current = await ctx.db.query<{ id: string; deleted_at: Date | null; label: string; version: number }>(`SELECT id, deleted_at, label, version FROM placements WHERE room_id = $1`, [room.id]);
  const existing = new Map(current.rows.map((p) => [p.id, p]));
  const keep = new Set(frozen.placements.map((p) => p.id));
  for (const p of frozen.placements) {
    const f = [p.kind, p.label, p.propId, p.entry, p.xMm, p.yMm, p.zMm, p.rotationDeg, p.widthMm, p.depthMm, p.heightMm];
    if (existing.has(p.id)) {
      await ctx.db.query(
        `UPDATE placements SET kind=$2, label=$3, prop_id=$4, entry=$5, x_mm=$6, y_mm=$7, z_mm=$8, rotation_deg=$9, width_mm=$10, depth_mm=$11, height_mm=$12,
         version = version + 1, deleted_at = NULL, deleted_by = NULL WHERE id = $1`,
        [p.id, ...f],
      );
    } else {
      await ctx.db.query(
        `INSERT INTO placements (id, room_id, kind, label, prop_id, entry, x_mm, y_mm, z_mm, rotation_deg, width_mm, depth_mm, height_mm, version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [p.id, room.id, ...f, p.version + 1],
      );
    }
  }
  const added = current.rows.filter((p) => !p.deleted_at && !keep.has(p.id)).map((p) => p.id);
  if (added.length) await ctx.db.query(`UPDATE placements SET deleted_at = clock_timestamp(), deleted_by = $2 WHERE id = ANY($1::uuid[])`, [added, ctx.actor.userId]);
  const nodeIds = frozen.nodes.map((n) => n.id);
  await ctx.db.query(`DELETE FROM nodes WHERE room_id = $1 AND NOT (id = ANY($2::uuid[]))`, [room.id, nodeIds]);
  const heldNodes = new Set((await ctx.db.query<{ id: string }>(`SELECT id FROM nodes WHERE room_id = $1`, [room.id])).rows.map((n) => n.id));
  for (const n of frozen.nodes) {
    const f = [n.title, n.kind, n.placementId, n.answer, n.prerequisites];
    if (heldNodes.has(n.id)) {
      await ctx.db.query(`UPDATE nodes SET title=$2, kind=$3, placement_id=$4, answer=$5, prerequisites=$6, version = version + 1 WHERE id = $1`, [n.id, ...f]);
    } else {
      await ctx.db.query(`INSERT INTO nodes (id, room_id, seq, title, kind, placement_id, answer, prerequisites, version) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [n.id, room.id, n.seq, ...f, n.version + 1]);
    }
  }
  await ctx.db.query(
    `UPDATE rooms SET width_mm = $2, depth_mm = $3, height_mm = $4, scene_order = $5, version = version + 1 WHERE id = $1`,
    [room.id, frozen.room.widthMm, frozen.room.depthMm, frozen.room.heightMm, JSON.stringify(frozen.sceneOrder)],
  );
  await ctx.db.query(`DELETE FROM undo_entries WHERE room_id = $1`, [room.id]);
  const body = (revision: number) => ({ revision });
  const revision = await recordChange(ctx, room, { kind: 'restore', placementId: null, scope: `restore:${room.id}`, status: 200, response: body });
  const restored = {
    room: await reloadRoom(ctx.db, room.id),
    placements: await listPlacements(ctx.db, room.id),
    nodes: await listNodes(ctx.db, room.id),
    sceneOrder: frozen.sceneOrder,
    revision,
  };
  ctx.after.push(() => hub.publish(roomChannel(room.id), 'restore', restored));
  return json(200, restored);
}

export function versionRoutes(): void {
  route('POST', '/api/rooms/:roomId/versions', {
    auth: 'member',
    transaction: true,
    load: (ctx) => findRoom(ctx.db, ctx.actor.workspaceId, ctx.params.roomId!, true),
    role: (ctx) => ctx.actor.role === 'owner',
    replay: async (ctx, room) => {
      const key = ctx.header('idempotency-key');
      if (!key) return undefined;
      await ctx.db.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`${ctx.actor.workspaceId}:${key}`]);
      const found = await ctx.db.query<{ fingerprint: string; status: number; response: unknown }>(
        `SELECT fingerprint, status, response FROM idempotency_keys WHERE workspace_id = $1 AND key = $2`,
        [ctx.actor.workspaceId, key],
      );
      const stored = found.rows[0];
      if (!stored) return undefined;
      if (stored.fingerprint !== fingerprint(room.id, ctx)) throw fail(409, 'idempotency_key_reused');
      return json(stored.status, stored.response);
    },
    validate: (ctx) => {
      const input = ctx.input();
      const label = input.text('label', 1, 80, { trim: true });
      const key = ctx.header('idempotency-key');
      if (key !== undefined && (key.length < 1 || key.length > 64)) input.fields.add('idempotencyKey', 'must be 1 to 64 characters');
      input.fields.check();
      return { label: label!, key };
    },
    needs: ['storage'],
    run: (ctx, room, input) => freeze(ctx, room, input.label, input.key),
  });

  route('GET', '/api/rooms/:roomId/versions', {
    auth: 'member',
    load: (ctx) => findRoom(ctx.db, ctx.actor.workspaceId, ctx.params.roomId!),
    run: async (ctx, room) => {
      const found = await ctx.db.query<VersionRow>(`SELECT * FROM versions WHERE room_id = $1 ORDER BY number DESC`, [room.id]);
      return json(200, { versions: found.rows.map(toVersion) });
    },
  });

  route('POST', '/api/versions/:versionId/link', {
    auth: 'member',
    transaction: true,
    load: loadVersionById,
    role: (ctx) => ctx.actor.role === 'owner',
    run: async (ctx, version) => {
      const updated = await ctx.db.query<VersionRow>(`UPDATE versions SET pack_token = $2 WHERE id = $1 RETURNING *`, [version.id, newPackToken()]);
      const view = toVersion(updated.rows[0]!);
      ctx.after.push(publishVersions(version.room_id, [view]));
      return json(201, { packUrl: view.packUrl });
    },
  });

  route('DELETE', '/api/versions/:versionId/link', {
    auth: 'member',
    transaction: true,
    load: loadVersionById,
    role: (ctx) => ctx.actor.role === 'owner',
    run: async (ctx, version) => {
      const updated = await ctx.db.query<VersionRow>(`UPDATE versions SET pack_token = NULL WHERE id = $1 RETURNING *`, [version.id]);
      ctx.after.push(publishVersions(version.room_id, [toVersion(updated.rows[0]!)]));
      return empty(204);
    },
  });

  route('POST', '/api/rooms/:roomId/restore', {
    auth: 'member',
    transaction: true,
    load: (ctx) => findRoom(ctx.db, ctx.actor.workspaceId, ctx.params.roomId!, true),
    role: (ctx) => ctx.actor.role === 'owner',
    conflict: async (ctx, room) => {
      await assertEditable(ctx.db, room.id);
      const wanted = (ctx.body as { versionId?: unknown } | undefined)?.versionId;
      if (typeof wanted !== 'string' || !UUID.test(wanted)) return;
      const found = await ctx.db.query<VersionRow>(`SELECT * FROM versions WHERE id = $1 AND room_id = $2`, [wanted, room.id]);
      const ids = [...new Set(found.rows[0]?.content.placements.flatMap((p) => (p.propId ? [p.propId] : [])) ?? [])];
      if (ids.length === 0) return;
      const present = await ctx.db.query(`SELECT id FROM props WHERE id = ANY($1::uuid[])`, [ids]);
      if (present.rows.length < ids.length) throw fail(409, 'prop_missing');
    },
    validate: async (ctx, room) => {
      const input = ctx.input();
      const wanted = input.text('versionId', 1, 100);
      input.fields.check();
      const found = UUID.test(wanted!) ? await ctx.db.query<VersionRow>(`SELECT * FROM versions WHERE id = $1 AND room_id = $2`, [wanted, room.id]) : null;
      if (!found?.rows[0]) throw validation({ versionId: 'unknown version' });
      return found.rows[0];
    },
    run: (ctx, room, version) => restore(ctx, room, version),
  });

  for (const method of READ_ONLY) {
    for (const path of ['/api/pack/:token', '/api/pack/:token/snapshot', '/api/pack/:token/props/:propId']) {
      route(method, path, {
        auth: 'none',
        load: (ctx) => findByToken(ctx.db, ctx.params.token!),
        run: async () => {
          throw fail(405, 'read_only');
        },
      });
    }
  }

  route('GET', '/api/pack/:token', {
    auth: 'none',
    load: (ctx) => findByToken(ctx.db, ctx.params.token!),
    run: async (_ctx, version) => json(200, packOf(version)),
  });

  route('GET', '/api/pack/:token/snapshot', {
    auth: 'none',
    load: (ctx) => findByToken(ctx.db, ctx.params.token!),
    needs: ['storage'],
    run: async (_ctx, version) => {
      const object = await store.get(snapshotKey(version.id));
      if (!object) throw notFound();
      return { status: 200, bytes: object.body, headers: { 'content-type': 'application/json' } };
    },
  });

  route('GET', '/api/pack/:token/props/:propId', {
    auth: 'none',
    load: async (ctx) => {
      const version = await findByToken(ctx.db, ctx.params.token!);
      const prop = version.content.props.find((p) => p.id === ctx.params.propId);
      if (!prop) throw notFound();
      return { version, prop };
    },
    needs: ['storage'],
    run: async (ctx, { version, prop }) => {
      const file = await store.get(copyKey(version.id, prop));
      if (!file) throw notFound();
      return downloadReply(file, { name: prop.name, content_type: prop.contentType, sha256: prop.sha256 }, ctx.header('if-none-match'));
    },
  });
}

