import { SEARCH_MAX, SEARCH_MIN, SEARCH_RESULT_LIMIT } from '../shared/search.ts';
import { isWriter, type CardStatus, type Colour, type Role, type Visibility, type WorkspaceInfo } from '../shared/types.ts';
import { boardRole, otherAdmins, type MembershipState } from './access.ts';
import { PRIVATE_USERS_SQL, byName, canSee, openCardCount, privateUsersOf, type Viewer } from './cards-data.ts';
import { database, isUniqueViolation, lockBoard, lockWorkspace, only, transaction, type Db, type Row } from './db.ts';
import { conflict, forbidden, notFound, validation } from './errors.ts';
import type { Handler } from './http-types.ts';
import { hashPassword } from './passwords.ts';
import { initialsOf, nextColour, personFrom, shapePerson, type PersonRecord, type Reveal } from './people.ts';
import { readLog, recordAccessChange } from './permission-log.ts';
import { accessChanged } from './hub.ts';
import { Input, codePoints, isId, oneOf, text, timeZoneName } from './validate.ts';

export function workspaceFrom(row: Row): WorkspaceInfo {
  return {
    id: row['id'] as string,
    name: row['name'] as string,
    parentName: row['parent_name'] as string,
    timeZone: row['time_zone'] as string,
    role: row['role'] as WorkspaceInfo['role'],
  };
}

/** The workspace, seen by a current member; anyone else gets the plain not-found. */
async function workspaceFor(db: Db, userId: string, workspaceId: string): Promise<WorkspaceInfo> {
  if (!isId(workspaceId)) throw notFound();
  const { rows } = await db.query<Row>(
    `SELECT w.id, w.name, w.parent_name, w.time_zone, wm.role FROM workspaces w
       JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = $2 WHERE w.id = $1`,
    [workspaceId, userId],
  );
  const row = rows[0];
  if (!row) throw notFound();
  return workspaceFrom(row);
}

function requireWorkspaceAdmin(workspace: WorkspaceInfo): void {
  if (workspace.role !== 'admin') throw forbidden();
}

export const getWorkspace: Handler = async ({ actor, params }) => ({
  status: 200,
  body: await workspaceFor(database(), actor.userId, params[0]),
});

export const patchWorkspace: Handler = async ({ actor, params, body }) => {
  const workspace = await workspaceFor(database(), actor.userId, params[0]);
  requireWorkspaceAdmin(workspace);
  const input = new Input(body, { timeZone: timeZoneName('Use an IANA time zone name.') }, ['timeZone']);
  const { timeZone } = input.check();
  await database().query('UPDATE workspaces SET time_zone = $1 WHERE id = $2', [timeZone, workspace.id]);
  return { status: 200, body: { ...workspace, timeZone } };
};

async function workspacePeople(db: Db, workspaceId: string): Promise<PersonRecord[]> {
  const { rows } = await db.query<Row>(
    `SELECT u.id, u.display_name, u.initials, u.colour, u.email, u.phone, wm.role
       FROM workspace_members wm JOIN users u ON u.id = wm.user_id WHERE wm.workspace_id = $1`,
    [workspaceId],
  );
  return rows.map(personFrom).sort((a, b) => byName(a.displayName, b.displayName));
}

/** Workspace admins see the whole record of every person, everyone else the name, initials and colour. */
const workspaceReveal = (workspace: WorkspaceInfo): Reveal => (workspace.role === 'admin' ? 'admin' : 'basic');

export const listPeople: Handler = async ({ actor, params }) => {
  const workspace = await workspaceFor(database(), actor.userId, params[0]);
  const people = await workspacePeople(database(), workspace.id);
  return { status: 200, body: { members: people.map((p) => shapePerson(p, workspaceReveal(workspace))) } };
};

const EMAIL_MESSAGE = 'Enter a valid email address.';
const email = {
  parse: (value: unknown) =>
    typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
      ? { ok: true as const, value }
      : { ok: false as const, message: EMAIL_MESSAGE },
};
const phone = {
  parse: (value: unknown) =>
    typeof value === 'string' && codePoints(value) <= 30
      ? { ok: true as const, value }
      : { ok: false as const, message: 'Keep the phone number to 30 characters or fewer.' },
};
const workspaceRoleField = oneOf(['admin', 'member'] as const, 'Choose Admin or Member.');
const PASSWORD_MESSAGE = 'Use 12 to 200 characters.';

export const addPerson: Handler = async ({ actor, params, body }) => {
  const workspaceId = params[0];
  const input = new Input(
    body,
    {
      displayName: text({ max: 60, empty: 'Give the person a name.', long: 'Keep the name to 60 characters or fewer.' }),
      email,
      phone,
      password: text({ min: 12, max: 200, trim: false, empty: PASSWORD_MESSAGE, long: PASSWORD_MESSAGE }),
      role: workspaceRoleField,
    },
    ['displayName', 'email', 'password', 'role'],
  );
  const created = await transaction(async (client) => {
    const workspace = await workspaceFor(client, actor.userId, workspaceId);
    requireWorkspaceAdmin(workspace);
    await lockWorkspace(client, workspace.id);
    const wanted = input.peek('email');
    if (wanted !== undefined) {
      const taken = await client.query('SELECT 1 FROM users WHERE lower(email) = lower($1)', [wanted]);
      if (taken.rowCount) throw conflict('email_taken');
    }
    const values = input.check();
    const last = await client.query<Row>('SELECT last_colour FROM workspaces WHERE id = $1', [workspace.id]);
    const colour = nextColour(only(last.rows)['last_colour'] as Colour);
    const displayName = values.displayName;
    const inserted = await client
      .query<Row>(
        `INSERT INTO users (email, display_name, phone, password_hash, colour, initials) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [values.email, displayName, values.phone ?? null, await hashPassword(values.password), colour, initialsOf(displayName)],
      )
      .catch((error: unknown) => {
        throw isUniqueViolation(error) ? conflict('email_taken') : error;
      });
    const userId = only(inserted.rows)['id'] as string;
    await client.query('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,$3)', [workspace.id, userId, values.role]);
    await client.query('UPDATE workspaces SET last_colour = $1 WHERE id = $2', [colour, workspace.id]);
    await recordAccessChange(client, {
      workspaceId: workspace.id,
      actorId: actor.userId,
      action: 'workspace.member_added',
      target: { type: 'user', id: userId, label: displayName },
      boardId: null,
      before: null,
      after: values.role,
    });
    return shapePerson(
      { userId, displayName, initials: initialsOf(displayName), colour, role: values.role, email: values.email, phone: values.phone ?? null },
      'admin',
    );
  });
  return { status: 201, body: { member: created } };
};

async function targetPerson(db: Db, workspaceId: string, userId: string): Promise<PersonRecord> {
  if (!isId(userId)) throw notFound();
  const person = (await workspacePeople(db, workspaceId)).find((candidate) => candidate.userId === userId);
  if (!person) throw notFound();
  return person;
}

export const changePersonRole: Handler = async ({ actor, params, body }) => {
  const input = new Input(body, { role: workspaceRoleField }, ['role']);
  const member = await transaction(async (client) => {
    const workspace = await workspaceFor(client, actor.userId, params[0]);
    await lockWorkspace(client, workspace.id);
    const target = await targetPerson(client, workspace.id, params[1]);
    requireWorkspaceAdmin(workspace);
    const wanted = input.peek('role');
    if (wanted === target.role) throw conflict('no_change');
    if (wanted === 'member' && target.role === 'admin' && (await otherAdmins(client, { workspaceId: workspace.id }, target.userId)) === 0) {
      throw conflict('last_admin');
    }
    const { role } = input.check();
    await client.query('UPDATE workspace_members SET role = $1 WHERE workspace_id = $2 AND user_id = $3', [role, workspace.id, target.userId]);
    await recordAccessChange(client, {
      workspaceId: workspace.id,
      actorId: actor.userId,
      action: 'workspace.role_changed',
      target: { type: 'user', id: target.userId, label: target.displayName },
      boardId: null,
      before: target.role,
      after: role,
    });
    return shapePerson({ ...target, role }, 'admin');
  });
  return { status: 200, body: { member } };
};

export const removePerson: Handler = async ({ actor, params }) => {
  const targetId = await transaction(async (client) => {
    const workspace = await workspaceFor(client, actor.userId, params[0]);
    await lockWorkspace(client, workspace.id);
    const target = await targetPerson(client, workspace.id, params[1]);
    requireWorkspaceAdmin(workspace);
    const held = await client.query<Row>(
      `SELECT b.id, b.name, bm.role FROM board_members bm JOIN boards b ON b.id = bm.board_id
        WHERE b.workspace_id = $1 AND bm.user_id = $2 AND bm.role <> 'removed' ORDER BY b.id`,
      [workspace.id, target.userId],
    );
    if (target.role === 'admin' && (await otherAdmins(client, { workspaceId: workspace.id }, target.userId)) === 0) throw conflict('last_admin');
    for (const board of held.rows) {
      await lockBoard(client, board['id'] as string);
      if (board['role'] !== 'admin') continue;
      if ((await otherAdmins(client, { boardId: board['id'] as string }, target.userId)) === 0) throw conflict('last_admin');
    }
    for (const board of held.rows) {
      await client.query(`UPDATE board_members SET role = 'removed' WHERE board_id = $1 AND user_id = $2`, [board['id'], target.userId]);
      await recordAccessChange(client, {
        workspaceId: workspace.id,
        actorId: actor.userId,
        action: 'board.member_removed',
        target: { type: 'user', id: target.userId, label: target.displayName },
        boardId: board['id'] as string,
        before: board['role'],
        after: 'removed',
      });
    }
    await client.query('DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [workspace.id, target.userId]);
    await recordAccessChange(client, {
      workspaceId: workspace.id,
      actorId: actor.userId,
      action: 'workspace.member_removed',
      target: { type: 'user', id: target.userId, label: target.displayName },
      boardId: null,
      before: target.role,
      after: null,
    });
    return target.userId;
  });
  void accessChanged({ userId: targetId });
  return { status: 204 };
};

interface VisibleBoard {
  id: string;
  name: string;
  visibility: Visibility;
  role: Role;
}

/** Every board of the workspace the person can see, by name. */
async function visibleBoards(db: Db, userId: string, workspaceId: string): Promise<VisibleBoard[]> {
  const { rows } = await db.query<Row>(
    `SELECT b.id, b.name, b.visibility, COALESCE(bm.role, 'none') AS state
       FROM boards b LEFT JOIN board_members bm ON bm.board_id = b.id AND bm.user_id = $2 WHERE b.workspace_id = $1`,
    [workspaceId, userId],
  );
  return rows
    .flatMap((row) => {
      const visibility = row['visibility'] as Visibility;
      const role = boardRole(visibility, row['state'] as MembershipState);
      return role ? [{ id: row['id'] as string, name: row['name'] as string, visibility, role }] : [];
    })
    .sort((a, b) => byName(a.name, b.name));
}

export const listBoards: Handler = async ({ actor, params }) => {
  const workspace = await workspaceFor(database(), actor.userId, params[0]);
  const boards = await visibleBoards(database(), actor.userId, workspace.id);
  const cards = await database().query<Row>(
    `SELECT c.board_id, c.status, ${PRIVATE_USERS_SQL}
       FROM cards c JOIN boards b ON b.id = c.board_id WHERE b.workspace_id = $1 AND c.status <> 'archived'`,
    [workspace.id],
  );
  const cardsByBoard = new Map<string, { status: CardStatus; privateMembers: { userId: string }[] }[]>();
  for (const row of cards.rows) {
    const list = cardsByBoard.get(row['board_id'] as string) ?? [];
    list.push({ status: row['status'] as CardStatus, privateMembers: privateUsersOf(row) });
    cardsByBoard.set(row['board_id'] as string, list);
  }
  return {
    status: 200,
    body: {
      boards: boards.map((board) => ({
        id: board.id,
        name: board.name,
        visibility: board.visibility,
        role: board.role,
        openCards: openCardCount(cardsByBoard.get(board.id) ?? [], { userId: actor.userId, role: board.role }),
      })),
    },
  };
};

const boardName = text({ max: 60, empty: 'Give the board a name.', long: 'Keep the name to 60 characters or fewer.' });
const visibilityField = oneOf(['workspace', 'private'] as const, 'Choose who can see this board.');
export { boardName, visibilityField };

export const createBoard: Handler = async ({ actor, params, body }) => {
  const input = new Input(body, { name: boardName, visibility: visibilityField }, ['name', 'visibility']);
  const board = await transaction(async (client) => {
    const workspace = await workspaceFor(client, actor.userId, params[0]);
    requireWorkspaceAdmin(workspace);
    const { name, visibility } = input.check();
    const inserted = await client.query<Row>(
      'INSERT INTO boards (workspace_id, name, visibility) VALUES ($1,$2,$3) RETURNING id',
      [workspace.id, name, visibility],
    );
    const id = only(inserted.rows)['id'] as string;
    await client.query(`INSERT INTO board_members (board_id, user_id, role) VALUES ($1,$2,'admin')`, [id, actor.userId]);
    await recordAccessChange(client, {
      workspaceId: workspace.id,
      actorId: actor.userId,
      action: 'board.member_added',
      target: { type: 'user', id: actor.userId, label: actor.displayName },
      boardId: id,
      before: 'none',
      after: 'admin',
    });
    return { id, name: name, visibility: visibility };
  });
  return { status: 201, body: { board } };
};

const queryText = {
  parse: (value: unknown) => {
    const length = typeof value === 'string' ? codePoints(value) : 0;
    return typeof value === 'string' && length >= SEARCH_MIN && length <= SEARCH_MAX
      ? { ok: true as const, value }
      : { ok: false as const, message: `Search for ${SEARCH_MIN} to ${SEARCH_MAX} characters.` };
  },
};

export const search: Handler = async ({ actor, params, url }) => {
  const workspace = await workspaceFor(database(), actor.userId, params[0]);
  const parsed = queryText.parse(url.searchParams.get('q'));
  if (!parsed.ok) throw validation({ q: parsed.message });
  const needle = parsed.value.toLowerCase();
  const boards = new Map((await visibleBoards(database(), actor.userId, workspace.id)).map((board) => [board.id, board]));
  const { rows } = await database().query<Row>(
    `SELECT c.id, c.board_id, c.title, c.notes, c.rank, l.name AS list_name, l.position AS list_position,
            ${PRIVATE_USERS_SQL}
       FROM cards c JOIN lists l ON l.id = c.list_id JOIN boards b ON b.id = c.board_id
      WHERE b.workspace_id = $1 AND c.status <> 'archived'`,
    [workspace.id],
  );
  const matches = rows
    .flatMap((row) => {
      const board = boards.get(row['board_id'] as string);
      if (!board) return [];
      const viewer: Viewer = { userId: actor.userId, role: board.role };
      if (!canSee({ privateMembers: privateUsersOf(row) }, viewer)) return [];
      const inTitle = (row['title'] as string).toLowerCase().includes(needle);
      const inNotes = isWriter(board.role) && (row['notes'] as string).toLowerCase().includes(needle);
      return inTitle || inNotes ? [{ row, board }] : [];
    })
    .sort(
      (a, b) =>
        byName(a.board.name, b.board.name) ||
        (a.row['list_position'] as number) - (b.row['list_position'] as number) ||
        (a.row['rank'] as number) - (b.row['rank'] as number),
    );
  return {
    status: 200,
    body: {
      results: matches.slice(0, SEARCH_RESULT_LIMIT).map(({ row, board }) => ({
        cardId: row['id'],
        boardId: board.id,
        boardName: board.name,
        listName: row['list_name'],
        title: row['title'],
      })),
      total: matches.length,
    },
  };
};

export const listPermissionLog: Handler = async ({ actor, params }) => {
  const workspace = await workspaceFor(database(), actor.userId, params[0]);
  requireWorkspaceAdmin(workspace);
  return { status: 200, body: { entries: await logFor(workspace, actor.userId) } };
};

export const getPermissionLogEntry: Handler = async ({ actor, params }) => {
  const workspace = await workspaceFor(database(), actor.userId, params[0]);
  requireWorkspaceAdmin(workspace);
  const entryId = params[1];
  const entries = isId(entryId) ? await logFor(workspace, actor.userId, entryId) : [];
  if (!entries[0]) throw notFound();
  return { status: 200, body: { entry: entries[0] } };
};

async function logFor(workspace: WorkspaceInfo, userId: string, entryId?: string) {
  const boards = new Map((await visibleBoards(database(), userId, workspace.id)).map((board) => [board.id, board]));
  const cards = await database().query<Row>(
    `SELECT c.id, c.board_id, ${PRIVATE_USERS_SQL}
       FROM cards c WHERE c.id IN (SELECT target_id::uuid FROM permission_log WHERE workspace_id = $1 AND target_type = 'card')`,
    [workspace.id],
  );
  const visibleCards = new Set(
    cards.rows.flatMap((row) => {
      const board = boards.get(row['board_id'] as string);
      return board && canSee({ privateMembers: privateUsersOf(row) }, { userId, role: board.role }) ? [row['id'] as string] : [];
    }),
  );
  return readLog(database(), workspace.id, (id) => boards.has(id), (id) => visibleCards.has(id), entryId);
}
