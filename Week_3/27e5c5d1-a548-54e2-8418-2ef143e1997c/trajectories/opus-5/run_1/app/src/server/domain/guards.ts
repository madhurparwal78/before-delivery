import type { Tx } from '../db/pool';
import { errors } from '../http/errors';
import type { BoardRole, WorkspaceRole } from '../../shared/types';

/** The one place that keeps every board and the workspace with an admin. */
export async function assertBoardKeepsAdmin(
  tx: Tx,
  boardId: string,
  userId: string,
  nextState: BoardRole | 'removed',
): Promise<void> {
  if (nextState === 'admin') return;
  const row = await tx.queryOne<{ count: string }>(
    `select count(*)::text as count from board_members
      where board_id = $1 and state = 'admin' and user_id <> $2`,
    [boardId, userId],
  );
  if (row !== null && row.count === '0') throw errors.lastAdmin();
}

export async function assertWorkspaceKeepsAdmin(
  tx: Tx,
  workspaceId: string,
  userId: string,
  nextRole: WorkspaceRole | 'removed',
): Promise<void> {
  if (nextRole === 'admin') return;
  const row = await tx.queryOne<{ count: string }>(
    `select count(*)::text as count from workspace_members
      where workspace_id = $1 and role = 'admin' and user_id <> $2`,
    [workspaceId, userId],
  );
  if (row !== null && row.count === '0') throw errors.lastAdmin();
}

/** Removing a workspace person also leaves every board they administer without an admin. */
export async function assertBoardsKeepAdminsWithout(tx: Tx, workspaceId: string, userId: string): Promise<void> {
  const boards = await tx.query<{ board_id: string }>(
    `select m.board_id from board_members m join boards b on b.id = m.board_id
      where b.workspace_id = $1 and m.user_id = $2 and m.state = 'admin'`,
    [workspaceId, userId],
  );
  for (const board of boards) {
    await assertBoardKeepsAdmin(tx, board.board_id, userId, 'removed');
  }
}
