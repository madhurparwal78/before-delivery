import type { PoolClient } from 'pg';
import { errors } from '../errors.js';
import type { Ctx } from '../http.js';
import type { Member } from '../domain/session.js';
import { liveUp, publish, readLock, roomChannel } from '../services/live.js';
import { one, query, rowOne } from '../services/db.js';
import { roomColumns } from '../repo/rooms.js';
import type { ChangeKind } from '../../shared/types.js';
import type { RoomRow } from '../repo/rooms.js';

export class Reply {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {}
}

export function reply(status: number, body: unknown): Reply {
  return new Reply(status, body);
}

export async function memberRoom(member: Member, roomId: string): Promise<RoomRow> {
  const room = await one<RoomRow>(
    `select ${roomColumns} from rooms where id = $1 and workspace_id = $2`,
    [roomId, member.workspaceId],
  );
  if (!room) throw errors.notFound();
  return room;
}

export async function assertNoRunningPlaytest(
  client: PoolClient,
  roomId: string,
): Promise<void> {
  const running = await rowOne<{ id: string }>(
    client,
    `select id from playtests where room_id = $1 and state = 'running' limit 1`,
    [roomId],
  );
  if (running) throw errors.playtestRunning();
}

/** A record another member holds refuses the edit; a record nobody holds is open. */
export async function assertNotHeldByOther(
  roomId: string,
  targetType: 'placement' | 'node',
  targetId: string,
  member: Member,
): Promise<void> {
  if (!liveUp()) return;
  const state = await readLock(roomId, targetType, targetId).catch(() => null);
  if (state && state.holder.userId !== member.id) {
    throw errors.locked(state.holder, state.expiresInSeconds);
  }
}

export function publishRoom(roomId: string, event: string, data: unknown): void {
  publish(roomChannel(roomId), { event, data });
}

export interface StoredChange {
  status: number;
  response: unknown;
}

/**
 * The idempotent replay step: a change id already in the workspace's change log
 * returns its stored response, and the same id used elsewhere is refused.
 */
export async function replayOf(
  member: Member,
  roomId: string,
  kind: ChangeKind,
  placementId: string | null,
  rawOpId: string | undefined,
): Promise<StoredChange | null> {
  if (rawOpId === undefined) return null;
  const existing = await one<{
    room_id: string;
    kind: ChangeKind;
    placement_id: string | null;
    response_status: number;
    response: unknown;
  }>(
    `select room_id, kind, placement_id, response_status, response from room_changes
       where workspace_id = $1 and op_id = $2`,
    [member.workspaceId, rawOpId],
  );
  if (!existing) return null;
  if (
    existing.room_id !== roomId ||
    existing.kind !== kind ||
    existing.placement_id !== placementId
  ) {
    throw errors.opIdReused();
  }
  return { status: existing.response_status, response: existing.response };
}

export function opIdHeader(ctx: Ctx): string | undefined {
  return ctx.header('op-id');
}

export async function deletedPlacement(
  client: PoolClient,
  roomId: string,
  placementId: string,
): Promise<{ label: string; deletedBy: { userId: string; displayName: string } } | null> {
  const row = await rowOne<{
    label: string;
    deleted_at: Date | null;
    deleted_by: string | null;
  }>(
    client,
    `select label, deleted_at, deleted_by from placements where id = $1 and room_id = $2`,
    [placementId, roomId],
  );
  if (!row || row.deleted_at === null) return null;
  const who = row.deleted_by
    ? await rowOne<{ id: string; display_name: string }>(
        client,
        `select id, display_name from users where id = $1`,
        [row.deleted_by],
      )
    : null;
  return {
    label: row.label,
    deletedBy: {
      userId: who ? who.id : '',
      displayName: who ? who.display_name : '',
    },
  };
}

export async function propsInUse(propId: string): Promise<boolean> {
  const used = await query<{ id: string }>(
    `select id from placements where prop_id = $1 and deleted_at is null limit 1`,
    [propId],
  );
  return used.length > 0;
}
