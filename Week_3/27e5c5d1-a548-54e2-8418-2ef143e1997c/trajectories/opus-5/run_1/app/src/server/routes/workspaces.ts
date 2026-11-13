import { COPY } from '../../shared/copy';
import type {
  BoardListEntry,
  PermissionLogEntry,
  SearchResult,
  Visibility,
  WorkspaceRole,
} from '../../shared/types';
import { transaction } from '../db/pool';
import {
  db,
  loadBoard,
  loadCard,
  loadUserByEmail,
  loadWorkspace,
  loadWorkspaceBoards,
  loadWorkspaceMembers,
  loadLastColour,
  workspaceRoleOf,
  type Reader,
  type UserRow,
  type WorkspaceRow,
} from '../db/repo';
import { readEnum, readString, readText } from '../domain/body';
import { canSeeCard } from '../domain/access';
import { initialsFor, nextColour } from '../domain/cardRules';
import { loadSnapshot, roleOnBoard } from '../domain/boardService';
import { assertBoardsKeepAdminsWithout, assertWorkspaceKeepsAdmin } from '../domain/guards';
import { PRIVATE_BOARD_LABEL, PRIVATE_CARD_LABEL, writeLogEntry } from '../domain/permissionLog';
import { matchesQuery, SEARCH_RESULT_LIMIT, validateQuery } from '../domain/search';
import { shapeWorkspacePerson } from '../domain/snapshot';
import { publishBoardSignal, publishUserSignal } from '../events/live';
import type { Ctx } from '../http/context';
import { errors } from '../http/errors';
import { hashPassword, newId } from '../lib/crypto';

interface WorkspaceAccess {
  user: UserRow;
  workspace: WorkspaceRow;
  role: WorkspaceRole;
}

async function requireWorkspace(ctx: Ctx, reader: Reader = db): Promise<WorkspaceAccess> {
  const user = ctx.requireUser();
  const workspace = await loadWorkspace(reader, ctx.id('workspaceId'));
  if (workspace === null) throw errors.notFound();
  const role = await workspaceRoleOf(reader, workspace.id, user.id);
  if (role === null) throw errors.notFound();
  return { user, workspace, role };
}

function requireAdmin(access: WorkspaceAccess): void {
  if (access.role !== 'admin') throw errors.forbidden();
}

export async function readWorkspace(ctx: Ctx): Promise<void> {
  const { workspace, role } = await requireWorkspace(ctx);
  ctx.json(200, {
    id: workspace.id,
    name: workspace.name,
    parentName: workspace.parent_name,
    timeZone: workspace.time_zone,
    role,
  });
}

export async function patchWorkspace(ctx: Ctx): Promise<void> {
  const access = await requireWorkspace(ctx);
  requireAdmin(access);
  const body = ctx.body({ required: ['timeZone'] });
  const timeZone = readString(body, 'timeZone', 'Give a time zone.');
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone });
  } catch {
    throw errors.validation({ timeZone: "That isn't a known time zone." });
  }
  await db.query(`update workspaces set time_zone = $1 where id = $2`, [timeZone, access.workspace.id]);
  ctx.json(200, {
    id: access.workspace.id,
    name: access.workspace.name,
    parentName: access.workspace.parent_name,
    timeZone,
    role: access.role,
  });
}

export async function listWorkspaceMembers(ctx: Ctx): Promise<void> {
  const access = await requireWorkspace(ctx);
  const members = await loadWorkspaceMembers(db, access.workspace.id);
  ctx.json(200, { members: members.map((member) => shapeWorkspacePerson(member, access.role)) });
}

export async function addWorkspaceMember(ctx: Ctx): Promise<void> {
  const access = await requireWorkspace(ctx);
  requireAdmin(access);
  const body = ctx.body({ required: ['displayName', 'email', 'password', 'role'], optional: ['phone'] });
  const displayName = readText(body, 'displayName', {
    min: 1,
    max: 60,
    tooShort: 'Give the person a name.',
    tooLong: 'Keep the name to 60 characters or fewer.',
  });
  const email = readString(body, 'email', 'Give an email address.').trim();
  if (email.length < 3 || email.length > 200 || !email.includes('@') || /\s/u.test(email)) {
    throw errors.validation({ email: 'Give an email address.' });
  }
  const password = readString(body, 'password', COPY.passwordLength);
  const passwordLength = [...password].length;
  if (passwordLength < 12 || passwordLength > 200) throw errors.validation({ password: COPY.passwordLength });
  const role = readEnum<WorkspaceRole>(body, 'role', ['admin', 'member'], 'Choose a role.');
  const phone = 'phone' in body ? readString(body, 'phone', 'Give a phone number.') : '';
  if ([...phone].length > 30) throw errors.validation({ phone: 'Keep the phone number to 30 characters or fewer.' });

  if ((await loadUserByEmail(db, email)) !== null) throw errors.emailTaken();

  const passwordHash = await hashPassword(password);
  const member = await transaction(async (tx) => {
    const previousColour = await loadLastColour(tx, access.workspace.id);
    const colour = nextColour(previousColour);
    const userId = newId();
    const initials = initialsFor(displayName);
    await tx.query(
      `insert into users (id, display_name, email, password_hash, phone, colour, initials)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, displayName, email, passwordHash, phone, colour, initials],
    );
    await tx.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, $3)`, [
      access.workspace.id,
      userId,
      role,
    ]);
    await writeLogEntry(tx, {
      workspaceId: access.workspace.id,
      actorUserId: access.user.id,
      action: 'workspace.member_added',
      targetType: 'user',
      targetId: userId,
      targetLabel: displayName,
      boardId: null,
      before: null,
      after: role,
    });
    return { user_id: userId, role, display_name: displayName, initials, colour, email, phone, joined_seq: '0' };
  });
  ctx.json(201, { member: shapeWorkspacePerson(member, 'admin') });
}

export async function patchWorkspaceMember(ctx: Ctx): Promise<void> {
  const access = await requireWorkspace(ctx);
  requireAdmin(access);
  const targetId = ctx.id('userId');
  const body = ctx.body({ required: ['role'] });
  const role = readEnum<WorkspaceRole>(body, 'role', ['admin', 'member'], 'Choose a role.');
  const member = await transaction(async (tx) => {
    const current = await tx.queryOne<{ role: WorkspaceRole }>(
      `select role from workspace_members where workspace_id = $1 and user_id = $2 for update`,
      [access.workspace.id, targetId],
    );
    if (current === null) throw errors.notFound();
    if (current.role === role) throw errors.noChange();
    await assertWorkspaceKeepsAdmin(tx, access.workspace.id, targetId, role);
    await tx.query(`update workspace_members set role = $1 where workspace_id = $2 and user_id = $3`, [
      role,
      access.workspace.id,
      targetId,
    ]);
    const user = await tx.queryOne<UserRow>(`select * from users where id = $1`, [targetId]);
    if (user === null) throw errors.notFound();
    await writeLogEntry(tx, {
      workspaceId: access.workspace.id,
      actorUserId: access.user.id,
      action: 'workspace.role_changed',
      targetType: 'user',
      targetId,
      targetLabel: user.display_name,
      boardId: null,
      before: current.role,
      after: role,
    });
    return {
      user_id: targetId,
      role,
      display_name: user.display_name,
      initials: user.initials,
      colour: user.colour,
      email: user.email,
      phone: user.phone,
      joined_seq: '0',
    };
  });
  ctx.json(200, { member: shapeWorkspacePerson(member, 'admin') });
}

export async function removeWorkspaceMember(ctx: Ctx): Promise<void> {
  const access = await requireWorkspace(ctx);
  requireAdmin(access);
  const targetId = ctx.id('userId');
  const boardIds = await transaction(async (tx) => {
    const current = await tx.queryOne<{ role: WorkspaceRole }>(
      `select role from workspace_members where workspace_id = $1 and user_id = $2 for update`,
      [access.workspace.id, targetId],
    );
    if (current === null) throw errors.notFound();
    const user = await tx.queryOne<UserRow>(`select * from users where id = $1`, [targetId]);
    if (user === null) throw errors.notFound();
    await assertWorkspaceKeepsAdmin(tx, access.workspace.id, targetId, 'removed');
    await assertBoardsKeepAdminsWithout(tx, access.workspace.id, targetId);

    const memberships = await tx.query<{ board_id: string; state: string; name: string }>(
      `select m.board_id, m.state, b.name from board_members m join boards b on b.id = m.board_id
        where b.workspace_id = $1 and m.user_id = $2 and m.state <> 'removed'`,
      [access.workspace.id, targetId],
    );
    for (const membership of memberships) {
      await tx.query(`update board_members set state = 'removed' where board_id = $1 and user_id = $2`, [
        membership.board_id,
        targetId,
      ]);
      await writeLogEntry(tx, {
        workspaceId: access.workspace.id,
        actorUserId: access.user.id,
        action: 'board.member_removed',
        targetType: 'user',
        targetId,
        targetLabel: user.display_name,
        boardId: membership.board_id,
        before: membership.state,
        after: 'removed',
      });
    }
    await tx.query(`delete from workspace_members where workspace_id = $1 and user_id = $2`, [
      access.workspace.id,
      targetId,
    ]);
    await writeLogEntry(tx, {
      workspaceId: access.workspace.id,
      actorUserId: access.user.id,
      action: 'workspace.member_removed',
      targetType: 'user',
      targetId,
      targetLabel: user.display_name,
      boardId: null,
      before: current.role,
      after: null,
    });
    const boards = await tx.query<{ id: string }>(`select id from boards where workspace_id = $1`, [
      access.workspace.id,
    ]);
    return boards.map((board) => board.id);
  });
  for (const boardId of boardIds) {
    publishBoardSignal(boardId, { type: 'membership' });
    publishUserSignal(targetId, { type: 'access', boardId });
  }
  ctx.noContent();
}

export async function listWorkspaceBoards(ctx: Ctx): Promise<void> {
  const access = await requireWorkspace(ctx);
  const boards = await loadWorkspaceBoards(db, access.workspace.id);
  const entries: BoardListEntry[] = [];
  for (const board of boards) {
    const role = await roleOnBoard(db, board, access.user.id);
    if (role === null) continue;
    const snapshot = await loadSnapshot(db, board.id);
    if (snapshot === null) continue;
    entries.push({
      id: board.id,
      name: board.name,
      visibility: board.visibility,
      role,
      openCards: snapshot.openCards({ userId: access.user.id, role }),
    });
  }
  ctx.json(200, { boards: entries });
}

export async function createBoard(ctx: Ctx): Promise<void> {
  const access = await requireWorkspace(ctx);
  requireAdmin(access);
  const body = ctx.body({ required: ['name', 'visibility'] });
  const name = readText(body, 'name', {
    min: 1,
    max: 60,
    tooShort: COPY.boardNameRequired,
    tooLong: COPY.boardNameTooLong,
  });
  const visibility = readEnum<Visibility>(body, 'visibility', ['workspace', 'private'], 'Choose who can see it.');
  const boardId = newId();
  await transaction(async (tx) => {
    await tx.query(`insert into boards (id, workspace_id, name, visibility) values ($1, $2, $3, $4)`, [
      boardId,
      access.workspace.id,
      name,
      visibility,
    ]);
    await tx.query(`insert into board_members (board_id, user_id, state) values ($1, $2, 'admin')`, [
      boardId,
      access.user.id,
    ]);
    await writeLogEntry(tx, {
      workspaceId: access.workspace.id,
      actorUserId: access.user.id,
      action: 'board.member_added',
      targetType: 'user',
      targetId: access.user.id,
      targetLabel: access.user.display_name,
      boardId,
      before: 'none',
      after: 'admin',
    });
  });
  ctx.json(201, { board: { id: boardId, name, visibility } });
}

export async function searchWorkspace(ctx: Ctx): Promise<void> {
  const access = await requireWorkspace(ctx);
  const q = validateQuery(ctx.query('q'));
  const boards = await loadWorkspaceBoards(db, access.workspace.id);
  const results: SearchResult[] = [];
  for (const board of boards) {
    const role = await roleOnBoard(db, board, access.user.id);
    if (role === null) continue;
    const snapshot = await loadSnapshot(db, board.id);
    if (snapshot === null) continue;
    for (const list of snapshot.listPayloads({ userId: access.user.id, role })) {
      for (const card of list.cards) {
        const inTitle = matchesQuery(card.title, q);
        const inNotes = card.notes !== undefined && matchesQuery(card.notes, q);
        if (!inTitle && !inNotes) continue;
        results.push({
          cardId: card.id,
          boardId: board.id,
          boardName: board.name,
          listName: list.name,
          title: card.title,
        });
      }
    }
  }
  ctx.json(200, { results: results.slice(0, SEARCH_RESULT_LIMIT), total: results.length });
}

async function labelFor(
  entry: {
    target_type: 'user' | 'board' | 'card';
    target_id: string;
    target_label: string;
    board_id: string | null;
  },
  userId: string,
): Promise<{ label: string; boardName: string | null }> {
  let boardName: string | null = null;
  if (entry.board_id !== null) {
    const board = await loadBoard(db, entry.board_id);
    if (board !== null) {
      const role = await roleOnBoard(db, board, userId);
      boardName = role === null ? PRIVATE_BOARD_LABEL : board.name;
    }
  }
  if (entry.target_type === 'board') {
    const board = await loadBoard(db, entry.target_id);
    const role = board === null ? null : await roleOnBoard(db, board, userId);
    return { label: role === null ? PRIVATE_BOARD_LABEL : entry.target_label, boardName };
  }
  if (entry.target_type === 'card') {
    const card = await loadCard(db, entry.target_id);
    const board = card === null ? null : await loadBoard(db, card.boardId);
    const role = board === null ? null : await roleOnBoard(db, board, userId);
    const visible =
      card !== null &&
      role !== null &&
      canSeeCard(
        role,
        card.privateMembers.map((member) => member.userId),
        userId,
      );
    return { label: visible ? entry.target_label : PRIVATE_CARD_LABEL, boardName };
  }
  return { label: entry.target_label, boardName };
}

interface LogRow {
  id: string;
  at: string;
  actor_user_id: string;
  actor_name: string;
  action: string;
  target_type: 'user' | 'board' | 'card';
  target_id: string;
  target_label: string;
  board_id: string | null;
  before_value: string | string[] | null;
  after_value: string | string[] | null;
}

async function shapeEntry(row: LogRow, userId: string): Promise<PermissionLogEntry> {
  const { label, boardName } = await labelFor(row, userId);
  return {
    id: row.id,
    at: row.at,
    actor: { userId: row.actor_user_id, displayName: row.actor_name },
    action: row.action,
    target: { type: row.target_type, id: row.target_id, label },
    board: row.board_id === null ? null : { id: row.board_id, name: boardName ?? PRIVATE_BOARD_LABEL },
    before: row.before_value,
    after: row.after_value,
  };
}

const LOG_SELECT = `
select l.id, to_char(l.at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at,
       l.actor_user_id, u.display_name as actor_name, l.action, l.target_type, l.target_id, l.target_label,
       l.board_id, l.before_value, l.after_value
  from permission_log l join users u on u.id = l.actor_user_id
`;

export async function readPermissionLog(ctx: Ctx): Promise<void> {
  const access = await requireWorkspace(ctx);
  requireAdmin(access);
  const rows = await db.query<LogRow>(
    `${LOG_SELECT} where l.workspace_id = $1 order by l.at desc, l.seq desc`,
    [access.workspace.id],
  );
  const entries: PermissionLogEntry[] = [];
  for (const row of rows) entries.push(await shapeEntry(row, access.user.id));
  ctx.json(200, { entries });
}

export async function readPermissionLogEntry(ctx: Ctx): Promise<void> {
  const access = await requireWorkspace(ctx);
  requireAdmin(access);
  const row = await db.queryOne<LogRow>(`${LOG_SELECT} where l.workspace_id = $1 and l.id = $2`, [
    access.workspace.id,
    ctx.id('entryId'),
  ]);
  if (row === null) throw errors.notFound();
  ctx.json(200, { entry: await shapeEntry(row, access.user.id) });
}
