import type { Db } from './db.js';
import { ApiError, notFound, passwordRequired, forbidden, signInRequired } from './errors.js';
import type { BoardRow, PostRow } from './types.js';
import type { Role } from '../shared/types.js';
import { verifySignedToken } from './sessions.js';
import { decodePassCookie, type PassUnlock } from './cookies.js';

export type AccessResult =
  | { kind: 'open'; board: BoardRow; role: Role | null }
  | { kind: 'password'; board: BoardRow }
  | { kind: 'missing' };

export interface Ctx {
  userId: string | null;
  passUnlocks: PassUnlock[];
}

export async function boardRow(db: Db, boardId: string): Promise<BoardRow | null> {
  const res = await db.query('SELECT * FROM boards WHERE id = $1 AND NOT deleted', [boardId]);
  return (res.rows[0] as BoardRow | undefined) ?? null;
}

export async function membershipRole(db: Db, boardId: string, userId: string | null): Promise<Role | null> {
  if (!userId) return null;
  const res = await db.query('SELECT role FROM memberships WHERE board_id = $1 AND user_id = $2', [boardId, userId]);
  const row = res.rows[0] as { role: Role } | undefined;
  if (!row) return null;
  if (row.role === 'owner') return 'owner';
  return row.role;
}

export function passUnlocksFromCookie(cookie: string | undefined): PassUnlock[] {
  const raw = verifySignedToken(cookie);
  return decodePassCookie(raw ?? undefined);
}

export async function accessToBoard(db: Db, boardId: string, ctx: Ctx): Promise<AccessResult> {
  const board = await boardRow(db, boardId);
  if (!board) return { kind: 'missing' };
  const role = await membershipRole(db, boardId, ctx.userId);
  if (role) return { kind: 'open', board, role };
  if (board.privacy === 'public') return { kind: 'open', board, role: null };
  if (board.privacy === 'password') {
    const unlocked = ctx.passUnlocks.some((u) => u.boardId === boardId && u.generation === board.pass_gen);
    if (unlocked) return { kind: 'open', board, role: null };
    return { kind: 'password', board };
  }
  return { kind: 'missing' };
}

export async function openBoardOr404(db: Db, boardId: string, ctx: Ctx): Promise<{ board: BoardRow; role: Role | null }> {
  const result = await accessToBoard(db, boardId, ctx);
  if (result.kind === 'missing') throw notFound();
  if (result.kind === 'password') throw passwordRequired();
  return { board: result.board, role: result.role };
}

export async function openBoardOrNotFound(db: Db, boardId: string, ctx: Ctx): Promise<{ board: BoardRow; role: Role | null } | 'password' | 'missing'> {
  const result = await accessToBoard(db, boardId, ctx);
  if (result.kind === 'missing') return 'missing';
  if (result.kind === 'password') return 'password';
  return { board: result.board, role: result.role };
}

export function roleAtLeast(role: Role | null, floor: Role): boolean {
  if (!role) return false;
  const order: Role[] = ['viewer', 'contributor', 'moderator', 'owner'];
  return order.indexOf(role) >= order.indexOf(floor);
}

export function canMovePost(role: Role | null, userId: string | null, post: PostRow): boolean {
  if (!role) return false;
  if (role === 'owner' || role === 'moderator') return true;
  return role === 'contributor' && post.author_id === userId;
}

export async function requireRole(db: Db, boardId: string, ctx: Ctx, floor: Role): Promise<{ board: BoardRow; role: Role }> {
  const opened = await openBoardOr404(db, boardId, ctx);
  if (!opened.role) throw forbidden();
  if (!roleAtLeast(opened.role, floor)) throw forbidden();
  return { board: opened.board, role: opened.role };
}

export async function requireSignedIn(ctx: Ctx): Promise<string> {
  if (!ctx.userId) throw signInRequired();
  return ctx.userId;
}

export async function postVisibleToCaller(db: Db, postId: string, ctx: Ctx): Promise<{ post: PostRow; board: BoardRow; role: Role | null } | 'missing' | 'password'> {
  const res = await db.query('SELECT * FROM posts WHERE id = $1', [postId]);
  const post = res.rows[0] as PostRow | undefined;
  if (!post) return 'missing';
  const access = await accessToBoard(db, post.board_id, ctx);
  if (access.kind === 'missing') return 'missing';
  if (access.kind === 'password') return 'password';
  const { board, role } = access;
  if (post.state === 'rejected') return 'missing';
  if (post.state === 'awaiting_approval') {
    const isModerator = roleAtLeast(role, 'moderator');
    const isAuthor = role !== null && post.author_id === ctx.userId;
    if (!isModerator && !isAuthor) return 'missing';
  }
  return { post, board, role };
}
