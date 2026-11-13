import type { App } from './app.js';
import type { RequestContext } from './http.js';
import { sendJson } from './http.js';
import {
  ApiError,
  notFound,
  passwordRequired,
  validation,
  forbidden,
  signInRequired,
  mailUnavailable,
} from './errors.js';
import { limits } from './rules.js';
import { trim, countCodePoints, randomId, randomToken, isoPlusSeconds } from './util.js';
import { openBoardOr404, accessToBoard, roleAtLeast } from './access.js';
import { toBoardDTO, boardPostsListing } from './listings.js';
import type { BoardRow } from './types.js';
import type { Role, Privacy, LinkAccess, Sort } from '../shared/types.js';
import bcrypt from 'bcryptjs';

const SORT_VALUES: Sort[] = ['by_hand', 'newest', 'oldest', 'most_liked'];
const PRIVACY_VALUES: Privacy[] = ['private', 'password', 'public'];
const LINK_ACCESS_VALUES: LinkAccess[] = ['off', 'view', 'contribute'];

export function isSort(v: unknown): v is Sort {
  return SORT_VALUES.includes(v as Sort);
}

export function isPrivacy(v: unknown): v is Privacy {
  return PRIVACY_VALUES.includes(v as Privacy);
}

export function isLinkAccess(v: unknown): v is LinkAccess {
  return LINK_ACCESS_VALUES.includes(v as LinkAccess);
}

export async function requireOwner(app: App, ctx: RequestContext, boardId: string): Promise<BoardRow> {
  const { board, role } = await openBoardOr404(app.db, boardId, { userId: ctx.userId, passUnlocks: app.passUnlocks(ctx) });
  if (role !== 'owner') throw forbidden();
  return board;
}

export async function handleListBoards(app: App, ctx: RequestContext): Promise<void> {
  if (!ctx.userId) throw signInRequired();
  const res = await app.db.query(
    `SELECT b.id, b.title, m.role,
            (SELECT count(*) FROM posts p WHERE p.board_id = b.id AND p.state = 'published') AS count,
            CASE WHEN m.role IN ('owner','moderator')
                 THEN (SELECT count(*) FROM posts p WHERE p.board_id = b.id AND p.state = 'awaiting_approval')
                 ELSE 0 END AS held,
            b.created_at
       FROM boards b JOIN memberships m ON m.board_id = b.id
      WHERE m.user_id = $1 AND NOT b.deleted
      ORDER BY b.created_at DESC`,
    [ctx.userId],
  );
  sendJson(ctx.res, 200, {
    boards: res.rows.map((r) => {
      const row = r as { id: string; title: string; role: Role; count: string; held: string };
      return { id: row.id, title: row.title, role: row.role, count: Number(row.count), held: Number(row.held) };
    }),
  });
}

export async function handleCreateBoard(app: App, ctx: RequestContext): Promise<void> {
  if (!ctx.userId) throw signInRequired();
  const body = ctx.jsonBody as Record<string, unknown>;
  const title = trim(String(body.title ?? ''));
  const rawSections = Array.isArray(body.sections) ? (body.sections as unknown[]).map((s) => trim(String(s))) : [];
  const errors: Record<string, string> = {};
  if (countCodePoints(title) < 1) errors.title = 'Give your board a title.';
  else if (countCodePoints(title) > limits.boardTitleMax) errors.title = 'Board titles can be at most 80 characters.';
  if (rawSections.length < limits.sectionsMin || rawSections.length > limits.sectionsMax) {
    errors.sections = 'Add between 1 and 12 sections.';
  } else if (rawSections.some((s) => countCodePoints(s) < 1 || countCodePoints(s) > limits.sectionTitleMax)) {
    errors.sections = 'Section titles can be at most 40 characters.';
  }
  if (Object.keys(errors).length > 0) throw validation(errors);

  const boardId = randomId('brd');
  const client = await app.db.connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO boards (id, title, owner_id) VALUES ($1, $2, $3)', [boardId, title, ctx.userId]);
    await client.query('INSERT INTO memberships (board_id, user_id, role) VALUES ($1, $2, $3)', [boardId, ctx.userId, 'owner']);
    let pos = 1;
    for (const sectionTitle of rawSections) {
      await client.query('INSERT INTO sections (id, board_id, title, position) VALUES ($1, $2, $3, $4)', [
        randomId('sec'),
        boardId,
        sectionTitle,
        pos,
      ]);
      pos += 1;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  const board = await app.db.query('SELECT * FROM boards WHERE id = $1', [boardId]);
  const boardRow = board.rows[0] as BoardRow;
  sendJson(ctx.res, 201, await toBoardDTO(app.db, boardRow, 'owner', true));
}

export async function handleGetBoard(app: App, ctx: RequestContext): Promise<void> {
  const { board, role } = await openBoardOr404(app.db, ctx.params.id, {
    userId: ctx.userId,
    passUnlocks: app.passUnlocks(ctx),
  });
  sendJson(ctx.res, 200, await toBoardDTO(app.db, board, role, role === 'owner'));
}

export async function handlePatchBoard(app: App, ctx: RequestContext): Promise<void> {
  const board = await requireOwner(app, ctx, ctx.params.id);
  const body = ctx.jsonBody as Record<string, unknown>;
  const updates: string[] = [];
  const params: unknown[] = [];
  const errors: Record<string, string> = {};

  if (body.title !== undefined) {
    const title = trim(String(body.title));
    if (countCodePoints(title) < 1 || countCodePoints(title) > limits.boardTitleMax) {
      errors.title = 'Board titles can be at most 80 characters.';
    } else {
      params.push(title);
      updates.push(`title = $${params.length}`);
    }
  }
  if (body.layout !== undefined) {
    if (body.layout !== 'columns' && body.layout !== 'rows') errors.layout = 'Layout must be columns or rows.';
    else {
      params.push(body.layout);
      updates.push(`layout = $${params.length}`);
    }
  }
  if (body.sort !== undefined) {
    if (!isSort(body.sort)) errors.sort = 'Unknown sort.';
    else {
      params.push(body.sort);
      updates.push(`sort = $${params.length}`);
    }
  }
  if (body.group !== undefined) {
    if (body.group !== 'section' && body.group !== 'author') errors.group = 'Group must be section or author.';
    else {
      params.push(body.group);
      updates.push(`"group" = $${params.length}`);
    }
  }
  if (body.privacy !== undefined) {
    if (!isPrivacy(body.privacy)) errors.privacy = 'Unknown privacy.';
    else {
      const privacy = body.privacy;
      if (privacy === 'password') {
        const newPassword = body.password !== undefined ? String(body.password) : null;
        if (newPassword !== null) {
          if (newPassword.length < limits.boardPasswordMin || newPassword.length > limits.boardPasswordMax) {
            errors.password = 'Passwords are 8 to 64 characters.';
          } else {
            const hash = await bcrypt.hash(newPassword, 10);
            params.push(hash);
            updates.push(`pass_hash = $${params.length}`);
            updates.push(privacyGenBump());
            params.push(privacy);
            updates.push(`privacy = $${params.length}`);
          }
        } else {
          const existing = await app.db.query('SELECT pass_hash FROM boards WHERE id = $1', [board.id]);
          const hasHash = (existing.rows[0] as { pass_hash: string | null }).pass_hash !== null;
          if (!hasHash) errors.password = 'Passwords are 8 to 64 characters.';
          else {
            params.push(privacy);
            updates.push(`privacy = $${params.length}`);
          }
        }
      } else {
        params.push(privacy);
        updates.push(`privacy = $${params.length}`);
      }
    }
  }
  if (body.password !== undefined && body.privacy === undefined) {
    const newPassword = String(body.password);
    if (newPassword.length < limits.boardPasswordMin || newPassword.length > limits.boardPasswordMax) {
      errors.password = 'Passwords are 8 to 64 characters.';
    } else {
      const hash = await bcrypt.hash(newPassword, 10);
      params.push(hash);
      updates.push(`pass_hash = $${params.length}`);
      updates.push(privacyGenBump());
    }
  }
  if (body.approval !== undefined) {
    params.push(Boolean(body.approval));
    updates.push(`approval = $${params.length}`);
  }
  if (body.link_access !== undefined) {
    if (!isLinkAccess(body.link_access)) errors.link_access = 'Unknown link access.';
    else {
      params.push(body.link_access);
      updates.push(`link_access = $${params.length}`);
      if (body.link_access !== 'off' && !board.link_token) {
        const token = randomToken(24);
        params.push(token);
        updates.push(`link_token = $${params.length}`);
      }
    }
  }
  if (Object.keys(errors).length > 0) throw validation(errors);

  const oldPassHash = board.pass_hash;
  if (updates.length > 0) {
    params.push(board.id);
    await app.db.query(`UPDATE boards SET ${updates.join(', ')} WHERE id = $${params.length}`, params);
  }
  const fresh = await app.db.query('SELECT * FROM boards WHERE id = $1', [board.id]);
  const freshBoard = fresh.rows[0] as BoardRow;
  if (oldPassHash !== freshBoard.pass_hash) {
    await app.events.closeBoard(board.id, 'password_required');
    await app.events.publish(board.id, { type: 'board_update' });
  } else {
    await app.events.publish(board.id, { type: 'board_update' });
  }
  sendJson(ctx.res, 200, await toBoardDTO(app.db, freshBoard, 'owner', true));
}

function privacyGenBump(): string {
  return 'pass_gen = pass_gen + 1';
}

export async function handleRotateLink(app: App, ctx: RequestContext): Promise<void> {
  const board = await requireOwner(app, ctx, ctx.params.id);
  const token = randomToken(24);
  await app.db.query('UPDATE boards SET link_token = $1 WHERE id = $2', [token, board.id]);
  await app.events.closeBoard(board.id, 'not_found');
  sendJson(ctx.res, 200, { share_path: `/s/${token}`, embed_path: `/embed/${token}` });
}

export async function handleDeleteBoard(app: App, ctx: RequestContext): Promise<void> {
  const board = await requireOwner(app, ctx, ctx.params.id);
  await app.db.query('UPDATE boards SET deleted = true WHERE id = $1', [board.id]);
  await app.events.closeBoard(board.id, 'not_found');
  const ok = await app.services.storage.deletePrefix(app.services.storage.boardPrefix(board.id));
  if (!ok) {
    await app.db.query("INSERT INTO storage_retries (prefix, kind) VALUES ($1, 'board')", [
      app.services.storage.boardPrefix(board.id),
    ]);
  }
  ctx.res.writeHead(204);
  ctx.res.end();
}

export async function handleUnlock(app: App, ctx: RequestContext): Promise<void> {
  const body = ctx.jsonBody as Record<string, unknown>;
  const password = String(body.password ?? '');
  const access = await accessToBoard(app.db, ctx.params.id, { userId: ctx.userId, passUnlocks: [] });
  if (access.kind !== 'password') throw notFound();
  const board = access.board;
  if (board.privacy !== 'password' || !board.pass_hash) throw notFound();
  const ok = await bcrypt.compare(password, board.pass_hash);
  if (!ok) throw notFound();
  app.addPassUnlock(ctx, board.id, board.pass_gen);
  ctx.res.writeHead(204);
  ctx.res.end();
}

export async function handleBoardPosts(app: App, ctx: RequestContext): Promise<void> {
  const { board, role } = await openBoardOr404(app.db, ctx.params.id, {
    userId: ctx.userId,
    passUnlocks: app.passUnlocks(ctx),
  });
  const listing = await boardPostsListing(app.db, board, ctx.userId, role);
  sendJson(ctx.res, 200, listing);
}
