import type { Queryable } from '../db.js';
import { forbidden, notFound } from '../errors.js';
import type { BoardRole, Visibility } from '../../shared/types.js';

export interface BoardRecord {
  id: number;
  owner_id: number;
  name: string;
  name_lower: string;
  visibility: Visibility;
  cover_pin_id: number | null;
  seq: number;
  created_at: Date;
  last_saved_at: Date | null;
  owner_name: string;
  owner_handle: string;
  member_role: 'editor' | 'viewer' | null;
}

const BOARD_SELECT = `
  select b.id, b.owner_id, b.name, b.name_lower, b.visibility, b.cover_pin_id, b.seq,
         b.created_at, b.last_saved_at,
         u.name as owner_name, u.handle as owner_handle,
         m.role as member_role
    from boards b
    join users u on u.id = b.owner_id
    left join board_members m on m.board_id = b.id and m.user_id = $2
   where b.id = $1 and b.deleted_at is null`;

export async function findBoard(
  db: Queryable,
  boardId: number,
  viewerId: number | null,
): Promise<BoardRecord | null> {
  const result = await db.query<BoardRecord>(BOARD_SELECT, [boardId, viewerId]);
  return result.rows[0] ?? null;
}

/** The one role rule. */
export function roleOf(board: BoardRecord, viewerId: number | null): BoardRole | null {
  if (viewerId !== null && board.owner_id === viewerId) return 'owner';
  return board.member_role;
}

/** The one board visibility rule. */
export function boardVisible(board: BoardRecord, viewerId: number | null): boolean {
  return board.visibility === 'public' || roleOf(board, viewerId) !== null;
}

export function canEditBoard(board: BoardRecord, viewerId: number | null): boolean {
  const role = roleOf(board, viewerId);
  return role === 'owner' || role === 'editor';
}

export function canManageBoard(board: BoardRecord, viewerId: number | null): boolean {
  return roleOf(board, viewerId) === 'owner';
}

export async function requireVisibleBoard(
  db: Queryable,
  boardId: number,
  viewerId: number,
): Promise<BoardRecord> {
  const board = await findBoard(db, boardId, viewerId);
  if (!board || !boardVisible(board, viewerId)) throw notFound();
  return board;
}

export async function requireEditableBoard(
  db: Queryable,
  boardId: number,
  viewerId: number,
): Promise<BoardRecord> {
  const board = await requireVisibleBoard(db, boardId, viewerId);
  if (!canEditBoard(board, viewerId)) throw forbidden();
  return board;
}

export async function requireOwnedBoard(
  db: Queryable,
  boardId: number,
  viewerId: number,
): Promise<BoardRecord> {
  const board = await requireVisibleBoard(db, boardId, viewerId);
  if (!canManageBoard(board, viewerId)) throw forbidden();
  return board;
}

/**
 * The SQL fragment that keeps a pin query to pins the viewer may see:
 * live pins on public boards, plus live pins on boards they own or belong to.
 */
export const VISIBLE_PIN_SQL = `
  p.state = 'live' and bd.deleted_at is null and (
    bd.visibility = 'public'
    or bd.owner_id = $VIEWER$
    or exists (select 1 from board_members mm where mm.board_id = bd.id and mm.user_id = $VIEWER$)
  )`;

export function visiblePinClause(viewerParam: string): string {
  return VISIBLE_PIN_SQL.replaceAll('$VIEWER$', viewerParam);
}
