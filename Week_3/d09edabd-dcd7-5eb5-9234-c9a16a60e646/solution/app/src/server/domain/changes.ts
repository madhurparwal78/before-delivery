import type { Queryable } from '../db.js';
import { fail } from '../errors.js';
import type { Ctx, Reply } from '../http.js';
import { json, empty } from '../http.js';
import type { RoomRow } from './rooms.js';

type ChangeKind = 'create' | 'update' | 'delete' | 'move' | 'undo' | 'restore';

const OP_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** The request's `Op-Id` header, if it sent one. */
export function opIdOf(ctx: Ctx): string | undefined {
  return ctx.header('op-id');
}

export function validOpId(opId: string | undefined): boolean {
  return opId === undefined || OP_ID.test(opId);
}

/**
 * The idempotent replay step: an Op-Id already in the workspace's change logs answers the stored response of the change that used it,
 * or 409 op_id_reused when this request is for a different room, placement or endpoint.
 */
export async function replayOf(ctx: Ctx, scope: string): Promise<Reply | undefined> {
  const opId = opIdOf(ctx);
  if (opId === undefined) return undefined;
  const found = await ctx.db.query<{ scope: string; status: number; response: unknown }>(
    `SELECT scope, status, response FROM changes WHERE workspace_id = $1 AND op_id = $2`,
    [ctx.actor.workspaceId, opId],
  );
  const stored = found.rows[0];
  if (!stored) return undefined;
  if (stored.scope !== scope) throw fail(409, 'op_id_reused');
  return stored.response === null ? empty(stored.status) : json(stored.status, stored.response);
}

/** Adds exactly 1 to the room's revision and appends the change log entry; returns the new revision. */
export async function recordChange(
  ctx: Ctx,
  room: RoomRow,
  change: { kind: ChangeKind; placementId: string | null; scope: string; status: number; response: (revision: number) => unknown },
): Promise<number> {
  const bumped = await ctx.db.query<{ revision: number }>(`UPDATE rooms SET revision = revision + 1 WHERE id = $1 RETURNING revision`, [room.id]);
  const revision = bumped.rows[0]!.revision;
  const response = change.response(revision);
  await ctx.db.query(
    `INSERT INTO changes (room_id, workspace_id, revision, op_id, scope, kind, placement_id, user_id, status, response)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [room.id, ctx.actor.workspaceId, revision, opIdOf(ctx) ?? null, change.scope, change.kind, change.placementId, ctx.actor.userId, change.status,
      response === undefined ? null : JSON.stringify(response)],
  );
  return revision;
}

export async function changesSince(db: Queryable, roomId: string, since: number) {
  const found = await db.query<{ revision: number; op_id: string | null; kind: ChangeKind; placement_id: string | null; user_id: string | null }>(
    `SELECT revision, op_id, kind, placement_id, user_id FROM changes WHERE room_id = $1 AND revision > $2 ORDER BY revision`,
    [roomId, since],
  );
  return found.rows.map((row) => ({ revision: row.revision, opId: row.op_id, kind: row.kind, placementId: row.placement_id, userId: row.user_id }));
}
