import { ROLES } from '../shared/types.ts';
import { boardAccess, otherAdmins, requireAdmin, requireWrite, type MembershipState } from './access.ts';
import { boardWrite } from './board-tx.ts';
import { byName, canSee, loadArchived, loadSnapshot, shapeAll, shapeCard, todayIn } from './cards-data.ts';
import { database, type Db, type Row, only } from './db.ts';
import { conflict, notFound } from './errors.ts';
import { HANDLED, type Handler } from './http-types.ts';
import { personFrom, revealFor, shapePerson, type PersonRecord } from './people.ts';
import { recordAccessChange } from './permission-log.ts';
import { openStream } from './hub.ts';
import { Input, isId, oneOf, text } from './validate.ts';
import { boardName, visibilityField } from './workspaces.ts';

async function readableBoard(userId: string, boardId: string) {
  if (!isId(boardId)) throw notFound();
  const access = await boardAccess(database(), userId, boardId);
  if (!access) throw notFound();
  return access;
}

export const getBoard: Handler = async ({ actor, params }) => {
  const { board, role } = await readableBoard(actor.userId, params[0]);
  const snapshot = await loadSnapshot(database(), board.id);
  return {
    status: 200,
    body: {
      board: { id: board.id, name: board.name, visibility: board.visibility, workspaceId: board.workspaceId, parentName: board.parentName },
      role,
      lists: shapeAll(snapshot, { userId: actor.userId, role }, todayIn(board.timeZone)),
    },
  };
};

export const patchBoard: Handler = async ({ actor, params, body }) => {
  const input = new Input(body, { name: boardName, visibility: visibilityField }, [], { atLeastOne: true });
  const board = await boardWrite(actor, params[0], async (tx) => {
    requireAdmin(tx.access.role);
    const current = tx.access.board;
    const name = input.peek('name');
    const visibility = input.peek('visibility');
    const nameSame = name === undefined || name === current.name;
    const visibilitySame = visibility === undefined || visibility === current.visibility;
    if ((name !== undefined || visibility !== undefined) && nameSame && visibilitySame) throw conflict('no_change');
    input.check();
    const next = { name: name ?? current.name, visibility: visibility ?? current.visibility };
    await tx.client.query('UPDATE boards SET name = $1, visibility = $2 WHERE id = $3', [next.name, next.visibility, current.id]);
    if (next.visibility !== current.visibility) {
      await recordAccessChange(tx.client, {
        workspaceId: current.workspaceId,
        actorId: actor.userId,
        action: 'board.visibility_changed',
        target: { type: 'board', id: current.id, label: next.name },
        boardId: current.id,
        before: current.visibility,
        after: next.visibility,
      });
      tx.accessSignals.push({ boardId: current.id });
    }
    const summary = { id: current.id, name: next.name, visibility: next.visibility };
    tx.intents.push({ type: 'board-event', event: { type: 'board.updated', data: { board: summary } } });
    return summary;
  });
  return { status: 200, body: { board } };
};

async function boardMembers(db: Db, boardId: string): Promise<PersonRecord[]> {
  const { rows } = await db.query<Row>(
    `SELECT u.id, u.display_name, u.initials, u.colour, u.phone, u.email, bm.role
       FROM board_members bm JOIN users u ON u.id = bm.user_id WHERE bm.board_id = $1 AND bm.role <> 'removed'`,
    [boardId],
  );
  return rows.map(personFrom).sort((a, b) => byName(a.displayName, b.displayName));
}

export const listBoardMembers: Handler = async ({ actor, params }) => {
  const { board, role } = await readableBoard(actor.userId, params[0]);
  const members = await boardMembers(database(), board.id);
  return { status: 200, body: { members: members.map((member) => shapePerson(member, revealFor(role))) } };
};

export const listCandidates: Handler = async ({ actor, params }) => {
  const { board, role } = await readableBoard(actor.userId, params[0]);
  requireAdmin(role);
  const { rows } = await database().query<Row>(
    `SELECT u.id, u.display_name FROM workspace_members wm JOIN users u ON u.id = wm.user_id
      WHERE wm.workspace_id = $1
        AND NOT EXISTS (SELECT 1 FROM board_members bm WHERE bm.board_id = $2 AND bm.user_id = u.id AND bm.role <> 'removed')`,
    [board.workspaceId, board.id],
  );
  const people = rows.map((row) => ({ userId: row['id'] as string, displayName: row['display_name'] as string }));
  return { status: 200, body: { people: people.sort((a, b) => byName(a.displayName, b.displayName)) } };
};

const memberRole = oneOf(ROLES, 'Choose Admin, Member or Observer.');

async function membershipState(db: Db, boardId: string, userId: string): Promise<MembershipState> {
  const { rows } = await db.query<Row>('SELECT role FROM board_members WHERE board_id = $1 AND user_id = $2', [boardId, userId]);
  return (rows[0]?.['role'] as MembershipState | undefined) ?? 'none';
}

async function inWorkspace(db: Db, workspaceId: string, userId: unknown): Promise<boolean> {
  if (!isId(userId)) return false;
  const { rowCount } = await db.query('SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [workspaceId, userId]);
  return (rowCount ?? 0) > 0;
}

async function memberFor(db: Db, boardId: string, userId: string): Promise<PersonRecord> {
  const member = (await boardMembers(db, boardId)).find((candidate) => candidate.userId === userId);
  if (!member) throw notFound();
  return member;
}

export const addBoardMember: Handler = async ({ actor, params, body }) => {
  const input = new Input(body, { userId: { parse: (v) => (typeof v === 'string' ? { ok: true as const, value: v } : { ok: false as const, message: 'Choose a person.' }) }, role: memberRole }, ['userId', 'role']);
  const member = await boardWrite(actor, params[0], async (tx) => {
    const { board } = tx.access;
    const wanted = input.peek('userId');
    if (wanted !== undefined && !(await inWorkspace(tx.client, board.workspaceId, wanted))) throw notFound();
    requireAdmin(tx.access.role);
    const state = wanted === undefined ? 'none' : await membershipState(tx.client, board.id, wanted);
    if (state === 'observer' || state === 'member' || state === 'admin') throw conflict('already_member');
    const { userId, role } = input.check();
    await tx.client.query(
      `INSERT INTO board_members (board_id, user_id, role) VALUES ($1,$2,$3)
         ON CONFLICT (board_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [board.id, userId, role],
    );
    const added = await memberFor(tx.client, board.id, userId);
    await recordAccessChange(tx.client, {
      workspaceId: board.workspaceId,
      actorId: actor.userId,
      action: 'board.member_added',
      target: { type: 'user', id: added.userId, label: added.displayName },
      boardId: board.id,
      before: state,
      after: role,
    });
    tx.accessSignals.push({ boardId: board.id, userId: added.userId });
    return shapePerson(added, revealFor(tx.access.role));
  });
  return { status: 201, body: { member } };
};

export const changeBoardMember: Handler = async ({ actor, params, body }) => {
  const input = new Input(body, { role: memberRole }, ['role']);
  const member = await boardWrite(actor, params[0], async (tx) => {
    const { board } = tx.access;
    if (!(await inWorkspace(tx.client, board.workspaceId, params[1]))) throw notFound();
    requireAdmin(tx.access.role);
    const targetId = params[1];
    const state = await membershipState(tx.client, board.id, targetId);
    if (state === 'none' || state === 'removed') throw notFound();
    const wanted = input.peek('role');
    if (wanted === state) throw conflict('no_change');
    if (state === 'admin' && wanted !== undefined && (await otherAdmins(tx.client, { boardId: board.id }, targetId)) === 0) throw conflict('last_admin');
    const { role } = input.check();
    await tx.client.query('UPDATE board_members SET role = $1 WHERE board_id = $2 AND user_id = $3', [role, board.id, targetId]);
    const changed = await memberFor(tx.client, board.id, targetId);
    await recordAccessChange(tx.client, {
      workspaceId: board.workspaceId,
      actorId: actor.userId,
      action: 'board.role_changed',
      target: { type: 'user', id: targetId, label: changed.displayName },
      boardId: board.id,
      before: state,
      after: role,
    });
    tx.accessSignals.push({ boardId: board.id, userId: targetId });
    return shapePerson(changed, revealFor(tx.access.role));
  });
  return { status: 200, body: { member } };
};

export const removeBoardMember: Handler = async ({ actor, params }) => {
  await boardWrite(actor, params[0], async (tx) => {
    const { board } = tx.access;
    if (!(await inWorkspace(tx.client, board.workspaceId, params[1]))) throw notFound();
    requireAdmin(tx.access.role);
    const targetId = params[1];
    const state = await membershipState(tx.client, board.id, targetId);
    if (state === 'removed') throw conflict('no_change');
    if (state === 'admin' && (await otherAdmins(tx.client, { boardId: board.id }, targetId)) === 0) throw conflict('last_admin');
    await tx.client.query(
      `INSERT INTO board_members (board_id, user_id, role) VALUES ($1,$2,'removed')
         ON CONFLICT (board_id, user_id) DO UPDATE SET role = 'removed'`,
      [board.id, targetId],
    );
    const label = await tx.client.query<Row>('SELECT display_name FROM users WHERE id = $1', [targetId]);
    await recordAccessChange(tx.client, {
      workspaceId: board.workspaceId,
      actorId: actor.userId,
      action: 'board.member_removed',
      target: { type: 'user', id: targetId, label: only(label.rows)['display_name'] as string },
      boardId: board.id,
      before: state,
      after: 'removed',
    });
    tx.accessSignals.push({ boardId: board.id, userId: targetId });
  });
  return { status: 204 };
};

const listName = text({ max: 40, empty: 'Give the list a name.', long: 'Keep the name to 40 characters or fewer.' });

export const createList: Handler = async ({ actor, params, body }) => {
  const input = new Input(body, { name: listName }, ['name']);
  const list = await boardWrite(actor, params[0], async (tx) => {
    requireAdmin(tx.access.role);
    const { name } = input.check();
    const { rows } = await tx.client.query<Row>(
      `INSERT INTO lists (board_id, name, position)
         SELECT $1, $2, COALESCE(max(position), 0) + 1 FROM lists WHERE board_id = $1 RETURNING id`,
      [tx.access.board.id, name],
    );
    const created = { id: only(rows)['id'] as string, name: name };
    tx.intents.push({ type: 'board-event', event: { type: 'list.created', data: { list: created } } });
    return created;
  });
  return { status: 201, body: { list: { ...list, count: 0, cards: [] } } };
};

export const renameList: Handler = async ({ actor, params, body }) => {
  const input = new Input(body, { name: listName }, ['name']);
  const listId = params[0];
  if (!isId(listId)) throw notFound();
  const owner = await database().query<Row>('SELECT board_id FROM lists WHERE id = $1', [listId]);
  if (!owner.rows[0]) throw notFound();
  const list = await boardWrite(actor, owner.rows[0]['board_id'] as string, async (tx) => {
    const found = await tx.client.query('SELECT 1 FROM lists WHERE id = $1 AND board_id = $2', [listId, tx.access.board.id]);
    if (!found.rowCount) throw notFound();
    requireAdmin(tx.access.role);
    const { name } = input.check();
    await tx.client.query('UPDATE lists SET name = $1 WHERE id = $2', [name, listId]);
    const renamed = { id: listId, name: name };
    tx.intents.push({ type: 'board-event', event: { type: 'list.updated', data: { list: renamed } } });
    return renamed;
  });
  return { status: 200, body: { list } };
};

export const listArchived: Handler = async ({ actor, params }) => {
  const { board, role } = await readableBoard(actor.userId, params[0]);
  requireWrite(role);
  const viewer = { userId: actor.userId, role };
  const today = todayIn(board.timeZone);
  const cards = (await loadArchived(database(), board.id)).filter((card) => canSee(card, viewer));
  return { status: 200, body: { cards: cards.map((card) => shapeCard(card, viewer, null, today)) } };
};

export const openEvents: Handler = async ({ actor, params, response }) => {
  const { board, role } = await readableBoard(actor.userId, params[0]);
  openStream(response, { userId: actor.userId, boardId: board.id, tokenHash: actor.tokenHash, role });
  return HANDLED;
};

