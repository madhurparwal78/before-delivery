import type { Tx } from '../db/pool';
import { newId } from '../lib/crypto';

export type LogAction =
  | 'workspace.member_added'
  | 'workspace.role_changed'
  | 'workspace.member_removed'
  | 'board.member_added'
  | 'board.role_changed'
  | 'board.member_removed'
  | 'board.visibility_changed'
  | 'card.private_members_changed';

export interface LogWrite {
  workspaceId: string;
  actorUserId: string;
  action: LogAction;
  targetType: 'user' | 'board' | 'card';
  targetId: string;
  targetLabel: string;
  boardId: string | null;
  before: string | string[] | null;
  after: string | string[] | null;
}

/**
 * Writes one permission-log entry in the caller's transaction.
 * Nothing in the app updates or deletes an entry.
 */
export async function writeLogEntry(tx: Tx, entry: LogWrite): Promise<void> {
  await tx.query(
    `insert into permission_log
       (id, workspace_id, actor_user_id, action, target_type, target_id, target_label, board_id, before_value, after_value)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      newId(),
      entry.workspaceId,
      entry.actorUserId,
      entry.action,
      entry.targetType,
      entry.targetId,
      entry.targetLabel,
      entry.boardId,
      JSON.stringify(entry.before),
      JSON.stringify(entry.after),
    ],
  );
}

export const PRIVATE_CARD_LABEL = 'Private card';
export const PRIVATE_BOARD_LABEL = 'Private board';
