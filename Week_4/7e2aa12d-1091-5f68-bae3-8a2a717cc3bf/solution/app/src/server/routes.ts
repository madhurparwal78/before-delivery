import type { IncomingMessage } from 'node:http';
import { compareStates } from './domain/diff.js';
import { TEMPLATE_MESSAGE } from '../shared/messages.js';
import { checkPassword, checkUsername, layoutName, versionName } from '../shared/rules.js';
import type { LayoutState, ShareInfo } from '../shared/types.js';
import { clearedCookie, cookieToken, endSession, hashPassword, newToken, passwordMatches, sessionCookie, startSession, type User } from './auth.js';
import { submitChange } from './changes.js';
import { config, limits } from './config.js';
import { databaseReady, inTransaction, pool } from './db.js';
import { integer, invalid, list, nameField, record, refuse, text } from './domain/input.js';
import { prepareChange } from './domain/prepare.js';
import { Refusal } from './domain/refusal.js';
import { readLayoutState } from './domain/state-input.js';
import { isTemplateName } from '../shared/templates.js';
import { template } from './domain/templates.js';
import { conflictAnswer, jsonOf, noViewLink, notFound, taken, wrongCredentials } from './http.js';
import { disconnect } from './live.js';
import {
  accessFor,
  addCollaborator,
  collaboratorsOf,
  contentOf,
  insertLayout,
  insertVersion,
  layoutByJoinToken,
  layoutByViewToken,
  libraryOf,
  objectOf,
  objectWith,
  type Access,
} from './store.js';
import { publish, valkeyLive } from './valkey.js';

interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

interface Request {
  request: IncomingMessage;
  params: string[];
  query: URLSearchParams;
  body: Buffer;
}

interface Context extends Request {
  user: User;
}

type Handler = (context: Context) => Promise<Reply>;
type OpenHandler = (request: Request) => Promise<Reply>;

interface Placement {
  method: string;
  pattern: RegExp;
  /** The route answers while Postgres is still starting. */
  beforeDatabase?: true;
  /** The route looks absent unless the grading key is sent. */
  gradingOnly?: true;
}

type Route = (Placement & { handler: OpenHandler; open: true }) | (Placement & { handler: Handler; open?: false });

const ok = (body: unknown, status = 200): Reply => ({ status, body });
const noContent: Reply = { status: 204 };

async function ownedAccess(context: Context): Promise<Access> {
  const access = await accessFor(context.user, context.params[0]);
  if (!access) throw notFound();
  return access;
}

async function ownerAccess(context: Context): Promise<Access> {
  const access = await ownedAccess(context);
  if (access.role !== 'owner') throw notFound();
  return access;
}

// --- accounts ---

function credentials(body: Buffer): { username: string; password: string } {
  const source = record(jsonOf(body));
  return { username: text(source, 'username'), password: text(source, 'password') };
}

const signUp: OpenHandler = async ({ body }) => {
  const { username, password } = credentials(body);
  refuse(checkUsername(username) ?? checkPassword(password));
  const hash = await hashPassword(password);
  const { rows } = await pool.query<{ id: number }>('INSERT INTO users (username, password_hash) VALUES ($1, $2) ON CONFLICT (username) DO NOTHING RETURNING id', [username, hash]);
  if (!rows[0]) throw taken();
  return { status: 201, body: { username }, headers: { 'Set-Cookie': sessionCookie(await startSession(rows[0].id)) } };
};

const signIn: OpenHandler = async ({ body }) => {
  const { username, password } = credentials(body);
  const { rows } = await pool.query<{ id: number; password_hash: string }>('SELECT id, password_hash FROM users WHERE username = $1', [username]);
  const stored = rows[0]?.password_hash ?? (await hashPassword(password));
  if (!rows[0] || !(await passwordMatches(password, stored))) throw wrongCredentials();
  return { status: 200, body: { username }, headers: { 'Set-Cookie': sessionCookie(await startSession(rows[0].id)) } };
};

const signOut: OpenHandler = async ({ request }) => {
  const token = cookieToken(request);
  if (token) await endSession(token);
  return { status: 204, headers: { 'Set-Cookie': clearedCookie } };
};

// --- library and layouts ---

const createLayout: Handler = async ({ body, user }) => {
  const source = record(jsonOf(body));
  const name = nameField(source, 'name', layoutName);
  const choice = source.template ?? 'blank';
  if (typeof choice !== 'string') throw invalid();
  if (!isTemplateName(choice)) throw new Refusal(TEMPLATE_MESSAGE);
  const layout = await insertLayout(pool, user.id, name, template(choice));
  return ok(await objectOf(layout, 'owner'), 201);
};

const readLayout: Handler = async (context) => {
  const access = await ownedAccess(context);
  return ok(await objectOf(access.layout, access.role));
};

const postChange: Handler = async (context) => {
  const access = await ownedAccess(context);
  const source = record(jsonOf(context.body));
  const base = integer(source, 'base_revision');
  if (base < 1) throw invalid();
  const prepared = prepareChange(source.change, limits);
  const editor = context.request.headers['x-editor-id'];
  const outcome = await submitChange(access.layout.id, context.user.username, base, prepared);
  if (outcome.kind === 'unchanged') return ok({ revision: outcome.revision, unchanged: true });
  const layout = await objectWith(access.layout, access.role, outcome.content);
  if (outcome.kind === 'conflict') throw conflictAnswer(layout, outcome.message);
  void publish(access.layout.id, {
    type: 'change',
    editor: typeof editor === 'string' ? editor.slice(0, 64) : null,
    author: outcome.author,
    revision: outcome.content.revision,
    announcement: outcome.announcement,
    restored: outcome.restored,
    layout: outcome.content,
  });
  return ok({ revision: layout.revision, layout, announcement: outcome.announcement });
};

// --- versions ---

const saveVersion: Handler = async (context) => {
  const access = await ownedAccess(context);
  const name = nameField(record(jsonOf(context.body)), 'name', versionName);
  const number = await inTransaction(async (client) => {
    const { rows } = await client.query<{ revision: number; state: LayoutState }>('SELECT revision, state FROM layouts WHERE id = $1 FOR UPDATE', [access.layout.id]);
    return insertVersion(client, access.layout.id, name, rows[0].revision, rows[0].state);
  });
  return ok({ number, name }, 201);
};

const listVersions: Handler = async (context) => {
  const access = await ownedAccess(context);
  const { rows } = await pool.query<{ number: number; name: string }>('SELECT number, name FROM versions WHERE layout_id = $1 ORDER BY number', [access.layout.id]);
  return ok({ versions: rows });
};

async function versionOf(layoutId: string, raw: string): Promise<{ number: number; name: string; revision: number; state: LayoutState }> {
  const { rows } = await pool.query<{ number: number; name: string; revision: number; state: LayoutState }>(
    'SELECT number, name, revision, state FROM versions WHERE layout_id = $1 AND number = $2',
    [layoutId, /^\d{1,9}$/.test(raw) ? Number(raw) : -1],
  );
  if (!rows[0]) throw notFound();
  return rows[0];
}

const getVersion: Handler = async (context) => {
  const access = await ownedAccess(context);
  const version = await versionOf(access.layout.id, context.params[1]);
  return ok({ number: version.number, name: version.name, layout: await objectWith(access.layout, access.role, contentOf(version.revision, version.state)) });
};

const compareVersions: Handler = async (context) => {
  const access = await ownedAccess(context);
  const from = await versionOf(access.layout.id, context.query.get('from') ?? '');
  const to = await versionOf(access.layout.id, context.query.get('to') ?? '');
  return ok({ differences: compareStates(from.state, to.state) });
};

// --- sharing ---

const sharePath = (kind: 'view' | 'join', token: string): string => `/${kind}/${token}`;

const getShare: Handler = async (context) => {
  const { layout } = await ownerAccess(context);
  const share: ShareInfo = {
    view_path: layout.viewToken && sharePath('view', layout.viewToken),
    join_path: sharePath('join', layout.joinToken),
    collaborators: await collaboratorsOf(layout.id),
  };
  return ok(share);
};

const createViewLink: Handler = async (context) => {
  const { layout } = await ownerAccess(context);
  const token = newToken();
  await pool.query('UPDATE layouts SET view_token = $2 WHERE id = $1', [layout.id, token]);
  if (layout.viewToken) disconnect(layout.id, null);
  return ok({ view_path: sharePath('view', token) }, 201);
};

const revokeViewLink: Handler = async (context) => {
  const { layout } = await ownerAccess(context);
  const { rowCount } = await pool.query('UPDATE layouts SET view_token = NULL WHERE id = $1 AND view_token IS NOT NULL', [layout.id]);
  if (!rowCount) throw noViewLink();
  disconnect(layout.id, null);
  return noContent;
};

const regenerateJoinLink: Handler = async (context) => {
  const { layout } = await ownerAccess(context);
  const token = newToken();
  await pool.query('UPDATE layouts SET join_token = $2 WHERE id = $1', [layout.id, token]);
  return ok({ join_path: sharePath('join', token) }, 201);
};

const removeCollaborator: Handler = async (context) => {
  const { layout } = await ownerAccess(context);
  const username = context.params[1];
  const { rowCount } = await pool.query(
    "DELETE FROM memberships m USING users u WHERE m.user_id = u.id AND m.layout_id = $1 AND u.username = $2 AND m.role = 'collaborator'",
    [layout.id, username],
  );
  if (!rowCount) throw notFound();
  disconnect(layout.id, username);
  return noContent;
};

const joinLayout: Handler = async ({ params, user }) => {
  const layout = await layoutByJoinToken(params[0]);
  if (!layout) throw notFound();
  await addCollaborator(pool, layout.id, user.id);
  return ok({ layout_id: layout.id });
};

const readView: OpenHandler = async ({ params }) => {
  const layout = await layoutByViewToken(params[0]);
  if (!layout) throw notFound();
  return ok(await objectOf(layout, 'viewer'));
};

// --- health and grading ---

const health: OpenHandler = async () => {
  if (!databaseReady()) return ok({ status: 'starting' }, 503);
  return ok({ status: (await valkeyLive()) ? 'ok' : 'unavailable' });
};

interface SetupLayout {
  ref: string;
  owner: string;
  name: string;
  state: LayoutState;
  versions: { name: string; state: LayoutState }[];
  collaborators: string[];
  viewLink: boolean;
}

function readSetup(raw: unknown): { users: { username: string; password: string }[]; layouts: SetupLayout[] } {
  const source = record(raw);
  const users = list(source, 'users').map((entry) => {
    const item = record(entry);
    const user = { username: text(item, 'username'), password: text(item, 'password') };
    refuse(checkUsername(user.username) ?? checkPassword(user.password));
    return user;
  });
  const layouts = list(source, 'layouts').map((entry): SetupLayout => {
    const item = record(entry);
    return {
      ref: text(item, 'ref'),
      owner: text(item, 'owner'),
      name: nameField(item, 'name', layoutName),
      state: readLayoutState(item, limits),
      versions: (item.versions === undefined ? [] : list(item, 'versions')).map((version) => {
        const saved = record(version);
        return { name: nameField(saved, 'name', versionName), state: readLayoutState(saved, limits) };
      }),
      collaborators: (item.collaborators === undefined ? [] : list(item, 'collaborators')).map((name) => {
        if (typeof name !== 'string') throw invalid();
        return name;
      }),
      viewLink: item.view_link === true,
    };
  });
  return { users, layouts };
}

const gradingSetup: OpenHandler = async ({ body }) => {
  const { users, layouts } = readSetup(jsonOf(body));
  const hashes = await Promise.all(users.map((user) => hashPassword(user.password)));
  return inTransaction(async (client) => {
    const ids = new Map<string, number>();
    const sessions: Record<string, string> = {};
    for (const [index, user] of users.entries()) {
      const { rows } = await client.query<{ id: number; password_hash: string }>('SELECT id, password_hash FROM users WHERE username = $1', [user.username]);
      if (rows[0]) {
        if (!(await passwordMatches(user.password, rows[0].password_hash))) throw taken();
        ids.set(user.username, rows[0].id);
      } else {
        const created = await client.query<{ id: number }>('INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id', [user.username, hashes[index]]);
        ids.set(user.username, created.rows[0].id);
      }
    }
    for (const [username, id] of ids) sessions[username] = await startSession(id, client);
    const idOf = async (username: string): Promise<number> => {
      const known = ids.get(username);
      if (known !== undefined) return known;
      const { rows } = await client.query<{ id: number }>('SELECT id FROM users WHERE username = $1', [username]);
      if (!rows[0]) throw invalid();
      return rows[0].id;
    };
    const created: Record<string, { id: string; revision: number; view_path: string | null; join_path: string }> = {};
    for (const spec of layouts) {
      const layout = await insertLayout(client, await idOf(spec.owner), spec.name, spec.state);
      for (const version of spec.versions) await insertVersion(client, layout.id, version.name, 1, version.state);
      for (const collaborator of spec.collaborators) await addCollaborator(client, layout.id, await idOf(collaborator));
      const viewToken = spec.viewLink ? newToken() : null;
      if (viewToken) await client.query('UPDATE layouts SET view_token = $2 WHERE id = $1', [layout.id, viewToken]);
      created[spec.ref] = { id: layout.id, revision: 1, view_path: viewToken && sharePath('view', viewToken), join_path: sharePath('join', layout.joinToken) };
    }
    return ok({ sessions, layouts: created }, 201);
  });
};

export const gradingKeyMatches = (request: IncomingMessage): boolean => {
  const sent = request.headers['x-grading-key'];
  return config.gradingKey !== undefined && sent === config.gradingKey;
};

export const routes: Route[] = [
  { method: 'GET', pattern: /^\/api\/health$/, handler: health, open: true, beforeDatabase: true },
  { method: 'POST', pattern: /^\/api\/signup$/, handler: signUp, open: true },
  { method: 'POST', pattern: /^\/api\/session$/, handler: signIn, open: true },
  { method: 'DELETE', pattern: /^\/api\/session$/, handler: signOut, open: true },
  { method: 'GET', pattern: /^\/api\/me$/, handler: async ({ user }) => ok({ username: user.username }) },
  { method: 'GET', pattern: /^\/api\/layouts$/, handler: async ({ user }) => ok({ layouts: await libraryOf(user) }) },
  { method: 'POST', pattern: /^\/api\/layouts$/, handler: createLayout },
  { method: 'GET', pattern: /^\/api\/layouts\/([^/]+)$/, handler: readLayout },
  { method: 'POST', pattern: /^\/api\/layouts\/([^/]+)\/changes$/, handler: postChange },
  { method: 'POST', pattern: /^\/api\/layouts\/([^/]+)\/versions$/, handler: saveVersion },
  { method: 'GET', pattern: /^\/api\/layouts\/([^/]+)\/versions$/, handler: listVersions },
  { method: 'GET', pattern: /^\/api\/layouts\/([^/]+)\/versions\/([^/]+)$/, handler: getVersion },
  { method: 'GET', pattern: /^\/api\/layouts\/([^/]+)\/compare$/, handler: compareVersions },
  { method: 'GET', pattern: /^\/api\/layouts\/([^/]+)\/share$/, handler: getShare },
  { method: 'POST', pattern: /^\/api\/layouts\/([^/]+)\/view-link$/, handler: createViewLink },
  { method: 'DELETE', pattern: /^\/api\/layouts\/([^/]+)\/view-link$/, handler: revokeViewLink },
  { method: 'POST', pattern: /^\/api\/layouts\/([^/]+)\/join-link$/, handler: regenerateJoinLink },
  { method: 'DELETE', pattern: /^\/api\/layouts\/([^/]+)\/collaborators\/([^/]+)$/, handler: removeCollaborator },
  { method: 'POST', pattern: /^\/api\/join\/([^/]+)$/, handler: joinLayout },
  { method: 'GET', pattern: /^\/api\/view\/([^/]+)$/, handler: readView, open: true },
  { method: 'POST', pattern: /^\/api\/grading\/setup$/, handler: gradingSetup, open: true, gradingOnly: true },
];
