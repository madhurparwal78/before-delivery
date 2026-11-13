import type { BoardRole } from '../../shared/types';
import {
  boardMemberState,
  loadBoard,
  loadBoardCards,
  loadLists,
  loadWorkspace,
  workspaceRoleOf,
  type BoardRow,
  type Reader,
} from '../db/repo';
import { effectiveBoardRole } from './access';
import { BoardSnapshot } from './snapshot';

export async function roleOnBoard(reader: Reader, board: BoardRow, userId: string): Promise<BoardRole | null> {
  const workspaceRole = await workspaceRoleOf(reader, board.workspace_id, userId);
  const state = await boardMemberState(reader, board.id, userId);
  return effectiveBoardRole(workspaceRole, board.visibility, state);
}

export async function loadSnapshot(reader: Reader, boardId: string, now = new Date()): Promise<BoardSnapshot | null> {
  const board = await loadBoard(reader, boardId);
  if (board === null) return null;
  const workspace = await loadWorkspace(reader, board.workspace_id);
  if (workspace === null) return null;
  const [lists, cards] = await Promise.all([loadLists(reader, boardId), loadBoardCards(reader, boardId)]);
  return new BoardSnapshot(board, lists, cards, workspace.time_zone, workspace.parent_name, now);
}
