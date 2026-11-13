import type { App } from './app.js';
import type { RequestContext } from './http.js';
import { sendJson } from './http.js';
import { notFound, passwordRequired, signInRequired } from './errors.js';
import { boardRow, membershipRole } from './access.js';
import { toBoardDTO, boardPostsListing } from './listings.js';
import type { BoardRow } from './types.js';

export interface LinkAccessResult {
  board: BoardRow;
  kind: 'view' | 'contribute';
}

export async function linkBoard(app: App, token: string): Promise<LinkAccessResult | 'missing'> {
  const board = await boardRow(app.db, await tokenBoardId(app, token));
  if (!board) return 'missing';
  if (!board.link_token || board.link_token !== token) return 'missing';
  if (board.privacy === 'private') return 'missing';
  if (board.link_access === 'off') return 'missing';
  return { board, kind: board.link_access === 'contribute' ? 'contribute' : 'view' };
}

async function tokenBoardId(app: App, token: string): Promise<string> {
  const res = await app.db.query('SELECT id FROM boards WHERE link_token = $1 AND NOT deleted', [token]);
  const row = res.rows[0] as { id: string } | undefined;
  return row?.id ?? '';
}

export async function handleGetLink(app: App, ctx: RequestContext): Promise<void> {
  const link = await linkBoard(app, ctx.params.token);
  if (link === 'missing') throw notFound();
  const { board } = link;
  const role = await membershipRole(app.db, board.id, ctx.userId);
  if (!role && board.privacy === 'password') {
    const unlocked = app.passUnlocks(ctx).some((u) => u.boardId === board.id && u.generation === board.pass_gen);
    if (!unlocked) throw passwordRequired();
  }
  const listing = await boardPostsListing(app.db, board, ctx.userId, role);
  sendJson(ctx.res, 200, { board: await toBoardDTO(app.db, board, role, role === 'owner'), posts: listing });
}

export async function handleLinkUnlock(app: App, ctx: RequestContext): Promise<void> {
  const link = await linkBoard(app, ctx.params.token);
  if (link === 'missing') throw notFound();
  const { board } = link;
  const body = ctx.jsonBody as Record<string, unknown>;
  const password = String(body.password ?? '');
  if (board.privacy !== 'password' || !board.pass_hash) throw notFound();
  const bcrypt = (await import('bcryptjs')).default;
  const ok = await bcrypt.compare(password, board.pass_hash);
  if (!ok) throw notFound();
  app.addPassUnlock(ctx, board.id, board.pass_gen);
  ctx.res.writeHead(204);
  ctx.res.end();
}

export async function handleLinkJoin(app: App, ctx: RequestContext): Promise<void> {
  if (!ctx.userId) throw signInRequired();
  const link = await linkBoard(app, ctx.params.token);
  if (link === 'missing') throw notFound();
  const { board, kind } = link;
  const role = await membershipRole(app.db, board.id, ctx.userId);
  if (!role && board.privacy === 'password') {
    const unlocked = app.passUnlocks(ctx).some((u) => u.boardId === board.id && u.generation === board.pass_gen);
    if (!unlocked) throw passwordRequired();
  }
  if (kind === 'view') {
    if (!role) {
      await app.db.query('INSERT INTO memberships (board_id, user_id, role) VALUES ($1, $2, $3)', [
        board.id,
        ctx.userId,
        'viewer',
      ]);
      await app.events.publish(board.id, { type: 'board_update' });
      sendJson(ctx.res, 200, { board_id: board.id, role: 'viewer' });
      return;
    }
    sendJson(ctx.res, 200, { board_id: board.id, role });
    return;
  }
  if (!role) {
    await app.db.query('INSERT INTO memberships (board_id, user_id, role) VALUES ($1, $2, $3)', [
      board.id,
      ctx.userId,
      'contributor',
    ]);
    await app.events.publish(board.id, { type: 'board_update' });
    sendJson(ctx.res, 200, { board_id: board.id, role: 'contributor' });
    return;
  }
  if (role === 'viewer') {
    await app.db.query('UPDATE memberships SET role = $1 WHERE board_id = $2 AND user_id = $3', [
      'contributor',
      board.id,
      ctx.userId,
    ]);
    await app.events.publish(board.id, { type: 'board_update' });
    sendJson(ctx.res, 200, { board_id: board.id, role: 'contributor' });
    return;
  }
  sendJson(ctx.res, 200, { board_id: board.id, role });
}
