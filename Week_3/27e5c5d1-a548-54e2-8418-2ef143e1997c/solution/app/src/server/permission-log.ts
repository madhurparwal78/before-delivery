import type pg from 'pg';
import type { LogEntry } from '../shared/types.ts';
import type { Db, Row } from './db.ts';

type LogAction =
  | 'workspace.member_added'
  | 'workspace.role_changed'
  | 'workspace.member_removed'
  | 'board.member_added'
  | 'board.role_changed'
  | 'board.member_removed'
  | 'board.visibility_changed'
  | 'card.private_members_changed';

interface LogInput {
  workspaceId: string;
  actorId: string;
  action: LogAction;
  target: { type: 'user' | 'board' | 'card'; id: string; label: string };
  boardId: string | null;
  before: unknown;
  after: unknown;
}

/** The only writer of the permission log; callers pass the transaction of the change itself. */
export async function recordAccessChange(client: pg.PoolClient, entry: LogInput): Promise<void> {
  await client.query(
    `INSERT INTO permission_log (workspace_id, actor_id, action, target_type, target_id, target_label, board_id, before, after)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)`,
    [
      entry.workspaceId,
      entry.actorId,
      entry.action,
      entry.target.type,
      entry.target.id,
      entry.target.label,
      entry.boardId,
      entry.before === null ? null : JSON.stringify(entry.before),
      entry.after === null ? null : JSON.stringify(entry.after),
    ],
  );
}

const ENTRY_COLUMNS = `l.id, l.at, l.action, l.target_type, l.target_id, l.target_label, l.before, l.after,
  l.actor_id, a.display_name AS actor_name, l.board_id, b.name AS board_name`;

/**
 * Entries for a workspace admin. Labels are decided for this reader now: a card or board the reader cannot
 * currently see is named `Private card` or `Private board`.
 */
export async function readLog(
  db: Db,
  workspaceId: string,
  canSeeBoard: (boardId: string) => boolean,
  canSeeCard: (cardId: string) => boolean,
  entryId?: string,
): Promise<LogEntry[]> {
  const { rows } = await db.query<Row>(
    `SELECT ${ENTRY_COLUMNS} FROM permission_log l JOIN users a ON a.id = l.actor_id LEFT JOIN boards b ON b.id = l.board_id
      WHERE l.workspace_id = $1 ${entryId ? 'AND l.id = $2' : ''} ORDER BY l.seq DESC`,
    entryId ? [workspaceId, entryId] : [workspaceId],
  );
  return rows.map((row) => {
    const boardId = row['board_id'] as string | null;
    const type = row['target_type'] as 'user' | 'board' | 'card';
    const targetId = row['target_id'] as string;
    const hiddenBoard = boardId !== null && !canSeeBoard(boardId);
    const label =
      type === 'card' && !canSeeCard(targetId)
        ? 'Private card'
        : type === 'board' && !canSeeBoard(targetId)
          ? 'Private board'
          : (row['target_label'] as string);
    return {
      id: row['id'] as string,
      at: (row['at'] as Date).toISOString(),
      actor: { userId: row['actor_id'] as string, displayName: row['actor_name'] as string },
      action: row['action'] as string,
      target: { type, id: targetId, label },
      board: boardId ? { id: boardId, name: hiddenBoard ? 'Private board' : (row['board_name'] as string) } : null,
      before: row['before'] ?? null,
      after: row['after'] ?? null,
    };
  });
}
