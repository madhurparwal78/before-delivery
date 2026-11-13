import type { Role } from '../shared/types';
import { boardAccess, loadBoardRow, roleOf, isUnlocked, type BoardRow, type Caller } from './boards';
import type { Db } from './db';
import { notFound, passwordRequired, signInRequired } from './errors';
import type { Ctx } from './http';
import { canSeePost, loadPostRow, type PostRow } from './posts';
import { UNLOCK_COOKIE, makeUnlockValue } from './session';

export const callerOf = (ctx: Ctx): Caller => ({ userId: ctx.userId, unlocks: ctx.unlocks });

export const requireSignedIn = (ctx: Ctx): string => {
  if (ctx.userId === null) throw signInRequired();
  return ctx.userId;
};

export const accessBoard = (db: Db, ctx: Ctx, boardId: string): Promise<{ board: BoardRow; role: Role | null }> =>
  boardAccess(db, callerOf(ctx), boardId);

export interface PostAccess {
  post: PostRow;
  board: BoardRow;
  role: Role | null;
}

/** Rule 2 for the post itself comes before the board's password gate. */
export const accessPost = async (db: Db, ctx: Ctx, postId: string): Promise<PostAccess> => {
  const post = await loadPostRow(db, postId, ctx.userId);
  if (post === null) throw notFound();
  const board = await loadBoardRow(db, post.board_id);
  if (board === null) throw notFound();
  const role = await roleOf(db, board, ctx.userId);
  if (!canSeePost(post, role, ctx.userId)) throw notFound();
  if (role === null) {
    if (board.privacy === 'private') throw notFound();
    if (board.privacy === 'password' && !isUnlocked(board, callerOf(ctx))) throw passwordRequired();
  }
  return { post, board, role };
};

export const grantUnlock = (ctx: Ctx, board: BoardRow): void => {
  const unlocks = { ...ctx.unlocks, [board.id]: board.unlock_generation };
  ctx.setCookie(UNLOCK_COOKIE, makeUnlockValue(unlocks), null);
};
