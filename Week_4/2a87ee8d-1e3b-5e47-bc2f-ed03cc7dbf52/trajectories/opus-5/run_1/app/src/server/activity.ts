import { AppError, FIELD_MESSAGES } from './errors.js';
import { newId } from './ids.js';
import { isoTimestamp } from './domain/schedule.js';
import type { Queryable } from './db/pool.js';

export const ACTIVITY_ACTIONS = [
  'workshop.created',
  'workshop.transitioned',
  'join_link.rotated',
  'join_link.turned_off',
  'invites.sent',
  'frame.trashed',
  'frame.restored',
  'frame.purged',
  'version.restored',
  'note.facilitator_only_changed',
  'plan.changed',
  'plan.change_scheduled',
  'payment.retried',
  'sponsor.invoiced',
  'recap.completed',
] as const;

export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

export type ActivityActor = 'facilitator' | 'system';

export interface ActivityDraft {
  readonly facilitatorId: string;
  readonly actor: ActivityActor;
  readonly action: ActivityAction;
  readonly workshopId: string | null;
}

/** Appends one entry. Entries are never changed or removed. */
export async function recordActivity(executor: Queryable, draft: ActivityDraft): Promise<void> {
  await executor.query(
    `INSERT INTO activity_entries (id, facilitator_id, actor, action, workshop_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [newId('ac'), draft.facilitatorId, draft.actor, draft.action, draft.workshopId],
  );
}

export interface ActivityEntry {
  readonly id: string;
  readonly seq: number;
  readonly at: string;
  readonly actor: ActivityActor;
  readonly action: ActivityAction;
  readonly workshopId: string | null;
}

export interface ActivityPage {
  readonly entries: readonly ActivityEntry[];
  readonly nextCursor: string | null;
}

/** The cursor is opaque, carrying the `seq` the next page continues below. */
function encodeCursor(seq: number): string {
  return Buffer.from(`seq:${seq}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): number {
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  const match = /^seq:(\d+)$/.exec(decoded);
  if (!match) throw new AppError('validation', { fields: { cursor: FIELD_MESSAGES.cursor } });
  return Number.parseInt(match[1] as string, 10);
}

/**
 * Lists the caller's own workspace, newest first. Passing `nextCursor` returns the entries
 * strictly older than the previous page's last entry, so new entries never shift a page.
 */
export async function readActivity(
  executor: Queryable,
  facilitatorId: string,
  cursor: string | null,
  limit: number,
): Promise<ActivityPage> {
  const before = cursor === null ? null : decodeCursor(cursor);
  const result = await executor.query<{
    id: string;
    seq: number;
    at: Date;
    actor: ActivityActor;
    action: ActivityAction;
    workshop_id: string | null;
  }>(
    `SELECT id, seq, at, actor, action, workshop_id
       FROM activity_entries
      WHERE facilitator_id = $1 AND ($2::bigint IS NULL OR seq < $2::bigint)
      ORDER BY seq DESC
      LIMIT $3`,
    [facilitatorId, before, limit + 1],
  );
  const rows = result.rows.slice(0, limit);
  const hasMore = result.rows.length > limit;
  const lastSeq = rows[rows.length - 1]?.seq;
  return {
    entries: rows.map((row) => ({
      id: row.id,
      seq: Number(row.seq),
      at: isoTimestamp(row.at.getTime()),
      actor: row.actor,
      action: row.action,
      workshopId: row.workshop_id,
    })),
    nextCursor: hasMore && lastSeq !== undefined ? encodeCursor(Number(lastSeq)) : null,
  };
}
