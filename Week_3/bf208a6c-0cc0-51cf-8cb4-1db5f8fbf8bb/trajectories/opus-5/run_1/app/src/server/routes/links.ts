import { boardDto, linkAccess, loadBoardByToken } from '../boards';
import { callerOf, grantUnlock, requireSignedIn } from '../context';
import { pool } from '../db';
import { notFound } from '../errors';
import type { Ctx, Router } from '../http';
import { verifyPassword } from '../session';
import { joinBoard } from './members';
import { listingFor, streamEvents } from './boards';

const readLink = async (ctx: Ctx): Promise<void> => {
  const { board, role } = await linkAccess(pool, callerOf(ctx), ctx.params.token, 'share');
  ctx.sendJson(200, {
    board: await boardDto(pool, board, role),
    posts: await listingFor(board, role, ctx.userId),
  });
};

const unlockLink = async (ctx: Ctx): Promise<void> => {
  const body = await ctx.json<{ password?: string }>();
  const board = await loadBoardByToken(pool, ctx.params.token);
  if (board === null || board.link_access === 'off' || board.privacy !== 'password' || board.password_hash === null) {
    throw notFound();
  }
  if (!verifyPassword(body.password ?? '', board.password_hash)) throw notFound();
  grantUnlock(ctx, board);
  ctx.sendEmpty(204);
};

const linkEvents = async (ctx: Ctx): Promise<void> => {
  const { board, role } = await linkAccess(pool, callerOf(ctx), ctx.params.token, 'share');
  await streamEvents(ctx, board, role, { kind: 'link', token: ctx.params.token });
};

const joinLink = async (ctx: Ctx): Promise<void> => {
  const { board } = await linkAccess(pool, callerOf(ctx), ctx.params.token, 'share');
  const userId = requireSignedIn(ctx);
  const role = await joinBoard(board.id, userId, board.link_access === 'contribute' ? 'contributor' : 'viewer');
  ctx.sendJson(200, { board_id: board.id, role });
};

export const registerLinkRoutes = (router: Router): void => {
  router.add('GET', '/api/links/:token', readLink);
  router.add('POST', '/api/links/:token/unlock', unlockLink);
  router.add('GET', '/api/links/:token/events', linkEvents);
  router.add('POST', '/api/links/:token/join', joinLink);
};
