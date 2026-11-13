import { SETTINGS_COPY } from '../../shared/copy';
import type { BoardSummary, GroupMode, Layout, LinkAccess, Privacy, Role, SortMode } from '../../shared/types';
import { boardTitleError, boardPasswordError, clean, sectionsError } from '../../shared/validate';
import { boardDto, createBoard, loadBoardRow, loadSections, newLinkToken, type BoardRow } from '../boards';
import { accessBoard, callerOf, grantUnlock, requireSignedIn } from '../context';
import { inTransaction, pool } from '../db';
import { forbidden, invalid, notFound } from '../errors';
import { addSubscriber, filterVisible, flushBoard, latestEventId, readEventsSince, recordEvent } from '../events';
import type { Ctx, Router } from '../http';
import { permissions } from '../../shared/permissions';
import { displayedListing, loadBoardPostRows } from '../posts';
import { removeObjects } from '../services';
import { hashPassword, verifyPassword } from '../session';
import { boardPrefix } from '../storage';
import { buildCsv, csvFileName } from '../csv';

const LAYOUTS: Layout[] = ['columns', 'rows'];
const SORTS: SortMode[] = ['by_hand', 'newest', 'oldest', 'most_liked'];
const GROUPS: GroupMode[] = ['section', 'author'];
const PRIVACIES: Privacy[] = ['private', 'password', 'public'];
const LINK_ACCESS: LinkAccess[] = ['off', 'view', 'contribute'];

const pickEnum = <T extends string>(field: string, value: unknown, allowed: T[]): T => {
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw invalid({ [field]: 'Not a known value.' });
  return value as T;
};

const listBoards = async (ctx: Ctx): Promise<void> => {
  const userId = requireSignedIn(ctx);
  const result = await pool.query<BoardSummary>(
    `select b.id, b.title,
       case when b.owner_id = $1 then 'owner' else m.role end as role,
       (select count(*) from posts p where p.board_id = b.id and p.state = 'published')::int as count,
       case when b.owner_id = $1 or m.role = 'moderator'
         then (select count(*) from posts p where p.board_id = b.id and p.state = 'awaiting_approval')::int
         else 0 end as held
     from boards b left join memberships m on m.board_id = b.id and m.user_id = $1
     where b.owner_id = $1 or m.user_id is not null
     order by b.seq desc`,
    [userId],
  );
  ctx.sendJson(200, { boards: result.rows });
};

const makeBoard = async (ctx: Ctx): Promise<void> => {
  const userId = requireSignedIn(ctx);
  const body = await ctx.json<{ title?: string; sections?: unknown }>();
  const title = clean(body.title ?? '');
  const sections = Array.isArray(body.sections)
    ? body.sections.map((section) => clean(String(section))).filter((section) => section !== '')
    : [];
  const errors: Record<string, string> = {};
  const titleError = boardTitleError(title);
  if (titleError !== null) errors.title = titleError;
  const sectionError = sectionsError(sections);
  if (sectionError !== null) errors.sections = sectionError;
  if (Object.keys(errors).length > 0) throw invalid(errors);

  const board = await inTransaction((client) => createBoard(client, userId, title, sections));
  ctx.sendJson(201, await boardDto(pool, board, 'owner'));
};

const patchBoard = async (ctx: Ctx): Promise<void> => {
  const { board, role } = await accessBoard(pool, ctx, ctx.params.id);
  requireSignedIn(ctx);
  if (!permissions.manageBoard(role)) throw forbidden();
  const body = await ctx.json<Record<string, unknown>>();

  const updates: Partial<Record<string, string | boolean | number | null>> = {};
  if ('title' in body) {
    const title = clean(String(body.title));
    const titleError = boardTitleError(title);
    if (titleError !== null) throw invalid({ title: titleError });
    updates.title = title;
  }
  if ('layout' in body) updates.layout = pickEnum('layout', body.layout, LAYOUTS);
  if ('sort' in body) updates.sort = pickEnum('sort', body.sort, SORTS);
  if ('group' in body) updates.grouping = pickEnum('group', body.group, GROUPS);
  if ('approval' in body) updates.approval = body.approval === true;
  if ('password' in body && body.password !== null && body.password !== '') {
    const password = String(body.password);
    const passwordError = boardPasswordError(password);
    if (passwordError !== null) throw invalid({ password: passwordError });
    updates.password_hash = hashPassword(password);
    updates.unlock_generation = board.unlock_generation + 1;
  }
  if ('privacy' in body) {
    const privacy = pickEnum('privacy', body.privacy, PRIVACIES);
    if (privacy === 'password' && board.password_hash === null && updates.password_hash === undefined) {
      throw invalid({ password: SETTINGS_COPY.boardPassword });
    }
    updates.privacy = privacy;
  }
  if ('link_access' in body) {
    const linkAccessValue = pickEnum('link_access', body.link_access, LINK_ACCESS);
    updates.link_access = linkAccessValue;
    if (linkAccessValue !== 'off' && board.link_token === null) updates.link_token = newLinkToken();
  }

  const keys = Object.keys(updates);
  let updated = board;
  if (keys.length > 0) {
    const assignments = keys.map((key, index) => `${key} = $${index + 2}`).join(', ');
    const result = await pool.query<BoardRow>(
      `update boards set ${assignments} where id = $1
       returning id, owner_id, title, layout, sort, grouping, privacy, password_hash, approval,
         link_access, link_token, unlock_generation`,
      [board.id, ...keys.map((key) => updates[key] ?? null)],
    );
    updated = result.rows[0];
    await recordEvent(pool, board.id, { kind: 'board_updated' });
    await flushBoard(board.id);
  }
  ctx.sendJson(200, await boardDto(pool, updated, 'owner'));
};

const rotateLink = async (ctx: Ctx): Promise<void> => {
  const { board, role } = await accessBoard(pool, ctx, ctx.params.id);
  requireSignedIn(ctx);
  if (!permissions.manageBoard(role)) throw forbidden();
  const result = await pool.query<BoardRow>(
    `update boards set link_token = $2 where id = $1
     returning id, owner_id, title, layout, sort, grouping, privacy, password_hash, approval,
       link_access, link_token, unlock_generation`,
    [board.id, newLinkToken()],
  );
  await recordEvent(pool, board.id, { kind: 'board_updated' });
  await flushBoard(board.id);
  const dto = await boardDto(pool, result.rows[0], 'owner');
  ctx.sendJson(200, { share_path: dto.share_path, embed_path: dto.embed_path });
};

const deleteBoard = async (ctx: Ctx): Promise<void> => {
  const { board, role } = await accessBoard(pool, ctx, ctx.params.id);
  requireSignedIn(ctx);
  if (!permissions.manageBoard(role)) throw forbidden();
  await pool.query('delete from boards where id = $1', [board.id]);
  await flushBoard(board.id);
  await removeObjects(boardPrefix(board.id));
  ctx.sendEmpty(204);
};

const unlockBoard = async (ctx: Ctx): Promise<void> => {
  const body = await ctx.json<{ password?: string }>();
  const board = await loadBoardRow(pool, ctx.params.id);
  if (board === null || board.privacy !== 'password' || board.password_hash === null) throw notFound();
  if (!verifyPassword(body.password ?? '', board.password_hash)) throw notFound();
  grantUnlock(ctx, board);
  ctx.sendEmpty(204);
};

export const listingFor = async (
  board: BoardRow,
  role: Role | null,
  userId: string | null,
): Promise<ReturnType<typeof displayedListing>> => {
  const sections = await loadSections(pool, board.id);
  const rows = await loadBoardPostRows(pool, board.id, userId);
  return displayedListing(board, sections, rows, role, userId);
};

const boardPosts = async (ctx: Ctx): Promise<void> => {
  const { board, role } = await accessBoard(pool, ctx, ctx.params.id);
  ctx.sendJson(200, await listingFor(board, role, ctx.userId));
};

export const streamEvents = async (
  ctx: Ctx,
  board: BoardRow,
  role: Role | null,
  source: { kind: 'board' } | { kind: 'link'; token: string },
): Promise<void> => {
  const headerValue = ctx.req.headers['last-event-id'];
  const since = Number(Array.isArray(headerValue) ? headerValue[0] : (headerValue ?? '0'));
  const lastEventId = Number.isFinite(since) && since > 0 ? since : 0;
  ctx.res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  ctx.res.write(': stream open\n\n');
  const rows = await readEventsSince(pool, board.id, lastEventId);
  for (const event of filterVisible(rows, role, ctx.userId)) {
    ctx.res.write(`id: ${event.id}\ndata: ${JSON.stringify(event.data)}\n\n`);
  }
  const highest = rows.length > 0 ? rows[rows.length - 1].id : await latestEventId(pool, board.id);
  addSubscriber({
    boardId: board.id,
    caller: callerOf(ctx),
    source,
    res: ctx.res,
    lastSent: Math.max(lastEventId, highest),
  });
};

const boardEvents = async (ctx: Ctx): Promise<void> => {
  const { board, role } = await accessBoard(pool, ctx, ctx.params.id);
  await streamEvents(ctx, board, role, { kind: 'board' });
};

const exportCsv = async (ctx: Ctx): Promise<void> => {
  const { board, role } = await accessBoard(pool, ctx, ctx.params.id);
  requireSignedIn(ctx);
  if (!permissions.export(role)) throw forbidden();
  const listing = await listingFor(board, role, ctx.userId);
  ctx.send(
    200,
    {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${csvFileName(board.title)}.csv"`,
    },
    Buffer.from(buildCsv(listing), 'utf8'),
  );
};

export const registerBoardRoutes = (router: Router): void => {
  router.add('GET', '/api/boards', listBoards);
  router.add('POST', '/api/boards', makeBoard);
  router.add('GET', '/api/boards/:id', async (ctx) => {
    const { board, role } = await accessBoard(pool, ctx, ctx.params.id);
    ctx.sendJson(200, await boardDto(pool, board, role));
  });
  router.add('PATCH', '/api/boards/:id', patchBoard);
  router.add('POST', '/api/boards/:id/rotate-link', rotateLink);
  router.add('DELETE', '/api/boards/:id', deleteBoard);
  router.add('POST', '/api/boards/:id/unlock', unlockBoard);
  router.add('GET', '/api/boards/:id/posts', boardPosts);
  router.add('GET', '/api/boards/:id/events', boardEvents);
  router.add('GET', '/api/boards/:id/export.csv', exportCsv);
};
