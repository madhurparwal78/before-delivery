import { createHash, randomUUID } from 'node:crypto';
import { errors } from '../errors.js';
import type { Route } from '../http.js';
import { requireMember, requireOwner } from '../domain/session.js';
import type { Member } from '../domain/session.js';
import { FieldCollector, asRecord, text } from '../domain/validate.js';
import {
  freezeRoom,
  newLinkToken,
  packUrlOf,
  toVersion,
  versionColumns,
} from '../domain/versions.js';
import type { VersionRow } from '../domain/versions.js';
import { one, query } from '../services/db.js';
import { memberRoom, publishRoom, reply } from './support.js';

async function ownVersion(member: Member, versionId: string): Promise<VersionRow> {
  const row = await one<VersionRow>(
    `select ${versionColumns} from room_versions where id = $1`,
    [versionId],
  );
  if (!row) throw errors.notFound();
  const room = await one<{ id: string }>(
    `select id from rooms where id = $1 and workspace_id = $2`,
    [row.room_id, member.workspaceId],
  );
  if (!room) throw errors.notFound();
  return row;
}

async function storedIdempotentReply(
  member: Member,
  key: string,
  roomId: string,
  bodyHash: string,
): Promise<{ status: number; response: unknown } | null> {
  const id = randomUUID();
  const inserted = await query<{ id: string }>(
    `insert into idempotency_keys (id, workspace_id, key, room_id, body_hash)
     values ($1,$2,$3,$4,$5) on conflict (workspace_id, key) do nothing returning id`,
    [id, member.workspaceId, key, roomId, bodyHash],
  );
  if (inserted.length > 0) return null;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const existing = await one<{
      room_id: string;
      body_hash: string;
      response_status: number | null;
      response: unknown;
    }>(
      `select room_id, body_hash, response_status, response from idempotency_keys
         where workspace_id = $1 and key = $2`,
      [member.workspaceId, key],
    );
    if (!existing) return null;
    if (existing.room_id !== roomId || existing.body_hash !== bodyHash) {
      throw errors.idempotencyKeyReused();
    }
    if (existing.response_status !== null) {
      return { status: existing.response_status, response: existing.response };
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw errors.storageUnavailable();
}

export const versionRoutes: Route[] = [
  {
    method: 'POST',
    pattern: '/api/rooms/:roomId/versions',
    body: 'json',
    async handler(ctx) {
      const member = await requireMember(ctx);
      const room = await memberRoom(member, ctx.params.roomId);
      requireOwner(member);
      const body = asRecord(ctx.body);
      const rawKey = ctx.header('idempotency-key');
      const collector = new FieldCollector();
      const label = text(body, 'label', 1, 80, collector);
      if (rawKey !== undefined && (rawKey.length < 1 || rawKey.length > 64)) {
        collector.add('idempotencyKey', 'must be 1 to 64 characters');
      }
      collector.throwIfAny();
      const bodyHash = createHash('sha256')
        .update(JSON.stringify({ label }))
        .digest('hex');
      if (rawKey !== undefined) {
        const stored = await storedIdempotentReply(member, rawKey, room.id, bodyHash);
        if (stored) return reply(stored.status, stored.response);
      }
      try {
        const result = await freezeRoom(room.id, label as string);
        publishRoom(room.id, 'version', { version: result.version });
        if (result.superseded) {
          publishRoom(room.id, 'version', { version: result.superseded });
        }
        if (rawKey !== undefined) {
          await query(
            `update idempotency_keys set response_status = 201, response = $3
               where workspace_id = $1 and key = $2`,
            [member.workspaceId, rawKey, JSON.stringify({ version: result.version })],
          );
        }
        return reply(201, { version: result.version });
      } catch (error) {
        if (rawKey !== undefined) {
          await query(
            `delete from idempotency_keys where workspace_id = $1 and key = $2
               and response_status is null`,
            [member.workspaceId, rawKey],
          );
        }
        throw error;
      }
    },
  },
  {
    method: 'GET',
    pattern: '/api/rooms/:roomId/versions',
    body: 'none',
    async handler(ctx) {
      const member = await requireMember(ctx);
      const room = await memberRoom(member, ctx.params.roomId);
      const list = await query<VersionRow>(
        `select ${versionColumns} from room_versions where room_id = $1 order by number desc`,
        [room.id],
      );
      return { versions: list.map(toVersion) };
    },
  },
  {
    method: 'POST',
    pattern: '/api/versions/:versionId/link',
    body: 'json',
    async handler(ctx) {
      const member = await requireMember(ctx);
      const row = await ownVersion(member, ctx.params.versionId);
      requireOwner(member);
      const token = newLinkToken();
      await query(`update room_versions set link_token = $2 where id = $1`, [row.id, token]);
      publishRoom(row.room_id, 'version', {
        version: toVersion({ ...row, link_token: token }),
      });
      return reply(201, { packUrl: packUrlOf(token) });
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/versions/:versionId/link',
    body: 'none',
    async handler(ctx) {
      const member = await requireMember(ctx);
      const row = await ownVersion(member, ctx.params.versionId);
      requireOwner(member);
      await query(`update room_versions set link_token = null where id = $1`, [row.id]);
      publishRoom(row.room_id, 'version', {
        version: toVersion({ ...row, link_token: null }),
      });
      return undefined;
    },
  },
];
