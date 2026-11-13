import { COPY } from '../../shared/copy';
import type { BoardRole, Visibility } from '../../shared/types';
import { transaction } from '../db/pool';
import {
  db,
  loadBoard,
  loadBoardMembers,
  loadList,
  loadWorkspace,
  loadWorkspaceMembers,
  type BoardRow,
  type Reader,
  type UserRow,
} from '../db/repo';
import { canEditCards } from '../domain/access';
import { readEnum, readId, readText } from '../domain/body';
import { loadSnapshot, roleOnBoard } from '../domain/boardService';
import { assertBoardKeepsAdmin } from '../domain/guards';
import { writeLogEntry } from '../domain/permissionLog';
import { shapeBoardMember, type Viewer } from '../domain/snapshot';
import { openStream, publishBoardSignal, publishUserSignal } from '../events/live';
import type { Ctx } from '../http/context';
import { errors } from '../http/errors';
import { newId } from '../lib/crypto';

export interface BoardAccess {
  user: UserRow;
  board: BoardRow;
  role: BoardRole;
  viewer: Viewer;
}

export async function requireBoard(ctx: Ctx, boardId: string, reader: Reader = db): Promise<BoardAccess> {
  const user = ctx.requireUser();
  const board = await loadBoard(reader, boardId);
  if (board === null) throw errors.notFound();
  const role = await roleOnBoard(reader, board, user.id);
  if (role === null) throw errors.notFound();
  return { user, board, role, viewer: { userId: user.id, role } };
}

function requireBoardAdmin(access: BoardAccess): void {
  if (access.role !== 'admin') throw errors.forbidden();
}

export async function readBoard(ctx: Ctx): Promise<void> {
  const access = await requireBoard(ctx, ctx.id('boardId'));
  const snapshot = await loadSnapshot(db, access.board.id);
  if (snapshot === null) throw errors.notFound();
  ctx.json(200, {
    board: {
      id: access.board.id,
      name: access.board.name,
      visibility: access.board.visibility,
      workspaceId: access.board.workspace_id,
      parentName: snapshot.parentName,
    },
    role: access.role,
    lists: snapshot.listPayloads(access.viewer),
  });
}

export async function patchBoard(ctx: Ctx): Promise<void> {
  const access = await requireBoard(ctx, ctx.id('boardId'));
  requireBoardAdmin(access);
  const body = ctx.body({ optional: ['name', 'visibility'], requireOneOptional: true });
  const name =
    'name' in body
      ? readText(body, 'name', {
          min: 1,
          max: 60,
          tooShort: COPY.boardNameRequired,
          tooLong: COPY.boardNameTooLong,
        })
      : access.board.name;
  const visibility =
    'visibility' in body
      ? readEnum<Visibility>(body, 'visibility', ['workspace', 'private'], 'Choose who can see it.')
      : access.board.visibility;
  if (name === access.board.name && visibility === access.board.visibility) throw errors.noChange();

  await transaction(async (tx) => {
    await tx.query(`update boards set name = $1, visibility = $2 where id = $3`, [name, visibility, access.board.id]);
    if (visibility !== access.board.visibility) {
      await writeLogEntry(tx, {
        workspaceId: access.board.workspace_id,
        actorUserId: access.user.id,
        action: 'board.visibility_changed',
        targetType: 'board',
        targetId: access.board.id,
        targetLabel: name,
        boardId: access.board.id,
        before: access.board.visibility,
        after: visibility,
      });
    }
  });
  publishBoardSignal(access.board.id, { type: 'board.updated' });
  ctx.json(200, { board: { id: access.board.id, name, visibility } });
}

export async function listBoardMembers(ctx: Ctx): Promise<void> {
  const access = await requireBoard(ctx, ctx.id('boardId'));
  const members = await loadBoardMembers(db, access.board.id);
  ctx.json(200, { members: members.map((member) => shapeBoardMember(member, access.role)) });
}

export async function listCandidates(ctx: Ctx): Promise<void> {
  const access = await requireBoard(ctx, ctx.id('boardId'));
  requireBoardAdmin(access);
  const people = await loadWorkspaceMembers(db, access.board.workspace_id);
  const members = await loadBoardMembers(db, access.board.id);
  const held = new Set(members.map((member) => member.user_id));
  ctx.json(200, {
    people: people
      .filter((person) => !held.has(person.user_id))
      .map((person) => ({ userId: person.user_id, displayName: person.display_name })),
  });
}

export async function addBoardMember(ctx: Ctx): Promise<void> {
  const access = await requireBoard(ctx, ctx.id('boardId'));
  requireBoardAdmin(access);
  const body = ctx.body({ required: ['userId', 'role'] });
  const userId = readId(body, 'userId');
  const role = readEnum<BoardRole>(body, 'role', ['observer', 'member', 'admin'], 'Choose a role.');
  const member = await transaction(async (tx) => {
    const person = await tx.queryOne<UserRow & { ws_role: string }>(
      `select u.*, m.role as ws_role from users u
         join workspace_members m on m.user_id = u.id and m.workspace_id = $1
        where u.id = $2`,
      [access.board.workspace_id, userId],
    );
    if (person === null) throw errors.notFound();
    const current = await tx.queryOne<{ state: string }>(
      `select state from board_members where board_id = $1 and user_id = $2 for update`,
      [access.board.id, userId],
    );
    const before = current === null ? 'none' : current.state;
    if (before === 'observer' || before === 'member' || before === 'admin') throw errors.alreadyMember();
    if (current === null) {
      await tx.query(`insert into board_members (board_id, user_id, state) values ($1, $2, $3)`, [
        access.board.id,
        userId,
        role,
      ]);
    } else {
      await tx.query(`update board_members set state = $1 where board_id = $2 and user_id = $3`, [
        role,
        access.board.id,
        userId,
      ]);
    }
    await writeLogEntry(tx, {
      workspaceId: access.board.workspace_id,
      actorUserId: access.user.id,
      action: 'board.member_added',
      targetType: 'user',
      targetId: userId,
      targetLabel: person.display_name,
      boardId: access.board.id,
      before,
      after: role,
    });
    return {
      user_id: userId,
      state: role,
      display_name: person.display_name,
      initials: person.initials,
      colour: person.colour,
      email: person.email,
      phone: person.phone,
    };
  });
  publishBoardSignal(access.board.id, { type: 'membership' });
  publishUserSignal(userId, { type: 'access', boardId: access.board.id });
  ctx.json(201, { member: shapeBoardMember(member, access.role) });
}

export async function patchBoardMember(ctx: Ctx): Promise<void> {
  const access = await requireBoard(ctx, ctx.id('boardId'));
  requireBoardAdmin(access);
  const userId = ctx.id('userId');
  const body = ctx.body({ required: ['role'] });
  const role = readEnum<BoardRole>(body, 'role', ['observer', 'member', 'admin'], 'Choose a role.');
  const member = await transaction(async (tx) => {
    const person = await tx.queryOne<UserRow>(
      `select u.* from users u join workspace_members m on m.user_id = u.id and m.workspace_id = $1 where u.id = $2`,
      [access.board.workspace_id, userId],
    );
    if (person === null) throw errors.notFound();
    const current = await tx.queryOne<{ state: BoardRole | 'removed' }>(
      `select state from board_members where board_id = $1 and user_id = $2 for update`,
      [access.board.id, userId],
    );
    if (current === null || current.state === 'removed') throw errors.notFound();
    if (current.state === role) throw errors.noChange();
    await assertBoardKeepsAdmin(tx, access.board.id, userId, role);
    await tx.query(`update board_members set state = $1 where board_id = $2 and user_id = $3`, [
      role,
      access.board.id,
      userId,
    ]);
    await writeLogEntry(tx, {
      workspaceId: access.board.workspace_id,
      actorUserId: access.user.id,
      action: 'board.role_changed',
      targetType: 'user',
      targetId: userId,
      targetLabel: person.display_name,
      boardId: access.board.id,
      before: current.state,
      after: role,
    });
    return {
      user_id: userId,
      state: role,
      display_name: person.display_name,
      initials: person.initials,
      colour: person.colour,
      email: person.email,
      phone: person.phone,
    };
  });
  publishBoardSignal(access.board.id, { type: 'membership' });
  publishUserSignal(userId, { type: 'access', boardId: access.board.id });
  ctx.json(200, { member: shapeBoardMember(member, access.role) });
}

export async function removeBoardMember(ctx: Ctx): Promise<void> {
  const access = await requireBoard(ctx, ctx.id('boardId'));
  requireBoardAdmin(access);
  const userId = ctx.id('userId');
  await transaction(async (tx) => {
    const person = await tx.queryOne<UserRow>(
      `select u.* from users u join workspace_members m on m.user_id = u.id and m.workspace_id = $1 where u.id = $2`,
      [access.board.workspace_id, userId],
    );
    if (person === null) throw errors.notFound();
    const current = await tx.queryOne<{ state: BoardRole | 'removed' }>(
      `select state from board_members where board_id = $1 and user_id = $2 for update`,
      [access.board.id, userId],
    );
    const before = current === null ? 'none' : current.state;
    if (before === 'removed') throw errors.noChange();
    await assertBoardKeepsAdmin(tx, access.board.id, userId, 'removed');
    if (current === null) {
      await tx.query(`insert into board_members (board_id, user_id, state) values ($1, $2, 'removed')`, [
        access.board.id,
        userId,
      ]);
    } else {
      await tx.query(`update board_members set state = 'removed' where board_id = $1 and user_id = $2`, [
        access.board.id,
        userId,
      ]);
    }
    await writeLogEntry(tx, {
      workspaceId: access.board.workspace_id,
      actorUserId: access.user.id,
      action: 'board.member_removed',
      targetType: 'user',
      targetId: userId,
      targetLabel: person.display_name,
      boardId: access.board.id,
      before,
      after: 'removed',
    });
  });
  publishBoardSignal(access.board.id, { type: 'membership' });
  publishUserSignal(userId, { type: 'access', boardId: access.board.id });
  ctx.noContent();
}

export async function createList(ctx: Ctx): Promise<void> {
  const access = await requireBoard(ctx, ctx.id('boardId'));
  requireBoardAdmin(access);
  const body = ctx.body({ required: ['name'] });
  const name = readText(body, 'name', {
    min: 1,
    max: 40,
    tooShort: COPY.listNameRequired,
    tooLong: COPY.listNameTooLong,
  });
  const listId = newId();
  await transaction(async (tx) => {
    const last = await tx.queryOne<{ position: number }>(
      `select coalesce(max(position), 0) as position from lists where board_id = $1`,
      [access.board.id],
    );
    await tx.query(`insert into lists (id, board_id, name, position) values ($1, $2, $3, $4)`, [
      listId,
      access.board.id,
      name,
      (last?.position ?? 0) + 1,
    ]);
  });
  publishBoardSignal(access.board.id, { type: 'list.created', listId });
  ctx.json(201, { list: { id: listId, name, count: 0, cards: [] } });
}

export async function patchList(ctx: Ctx): Promise<void> {
  const listId = ctx.id('listId');
  const list = await loadList(db, listId);
  if (list === null) throw errors.notFound();
  const access = await requireBoard(ctx, list.board_id);
  requireBoardAdmin(access);
  const body = ctx.body({ required: ['name'] });
  const name = readText(body, 'name', {
    min: 1,
    max: 40,
    tooShort: COPY.listNameRequired,
    tooLong: COPY.listNameTooLong,
  });
  await db.query(`update lists set name = $1 where id = $2`, [name, listId]);
  publishBoardSignal(access.board.id, { type: 'list.updated', listId });
  ctx.json(200, { list: { id: listId, name } });
}

export async function listArchived(ctx: Ctx): Promise<void> {
  const access = await requireBoard(ctx, ctx.id('boardId'));
  if (!canEditCards(access.role)) throw errors.forbidden();
  const snapshot = await loadSnapshot(db, access.board.id);
  if (snapshot === null) throw errors.notFound();
  const order = await db.query<{ id: string }>(
    `select id from cards where board_id = $1 and status = 'archived' order by archived_at desc, id`,
    [access.board.id],
  );
  const cards = order
    .map((row) => snapshot.cardById(row.id))
    .filter((card): card is NonNullable<typeof card> => card !== undefined)
    .filter((card) => snapshot.canSee(card, access.viewer))
    .map((card) => snapshot.cardPayload(card, access.viewer));
  ctx.json(200, { cards });
}

export async function boardEvents(ctx: Ctx): Promise<void> {
  const access = await requireBoard(ctx, ctx.id('boardId'));
  const session = ctx.requireSession();
  const workspace = await loadWorkspace(db, access.board.workspace_id);
  if (workspace === null) throw errors.notFound();
  ctx.res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  ctx.res.write(': open\n\n');
  await openStream(ctx.res, access.board.id, access.viewer, session.tokenHash);
}
