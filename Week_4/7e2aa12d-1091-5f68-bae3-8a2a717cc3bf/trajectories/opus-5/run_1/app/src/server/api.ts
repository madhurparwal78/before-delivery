import { checkLayoutName, checkPassword, checkUsername, checkVersionName } from '../shared/accounts.js';
import { parseChange } from '../shared/changes.js';
import { versionDifferences } from '../shared/diff.js';
import {
  BODY_MESSAGE,
  TEMPLATE_MESSAGE,
  UNKNOWN_CHANGE_MESSAGE,
  USERNAME_TAKEN_MESSAGE,
  WRONG_CREDENTIALS_MESSAGE,
} from '../shared/messages.js';
import { isTemplateKey, templateState } from '../shared/templates.js';
import type { Role } from '../shared/types.js';
import { postgresReady } from './db.js';
import { applyLayoutChange, layoutObject } from './layouts.js';
import { handleGradingSetup } from './grading.js';
import { publishChange } from './live.js';
import {
  addCollaborator,
  checkCredentials,
  createDesigner,
  createLayout,
  endSession,
  layoutByLink,
  layoutById,
  listLibrary,
  listVersions,
  removeCollaborator,
  replaceLink,
  revokeViewLink,
  roleFor,
  saveVersion,
  shareInfo,
  startSession,
  versionByNumber,
  type LayoutRecord,
} from './store.js';
import { clearedCookie, sessionCookie, type RequestContext } from './http.js';
import { valkeyAnswers } from './valkey.js';

export interface ApiReply {
  status: number;
  body?: unknown;
  cookie?: string;
}

const notFound: ApiReply = { status: 404, body: { error: 'not_found' } };
const signInRequired: ApiReply = { status: 401, body: { error: 'sign_in_required' } };
const invalidBody: ApiReply = { status: 422, body: { error: 'invalid', message: BODY_MESSAGE } };

function invalid(message: string): ApiReply {
  return { status: 422, body: { error: 'invalid', message } };
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

async function openLayout(
  id: string,
  designerId: string,
): Promise<{ layout: LayoutRecord; role: Role } | null> {
  const layout = await layoutById(id);
  if (!layout) return null;
  const role = await roleFor(layout, designerId);
  if (!role) return null;
  return { layout, role };
}

async function accounts(context: RequestContext): Promise<ApiReply | null> {
  const { method, path, body } = context;

  if (method === 'POST' && path === '/api/signup') {
    if (context.bodyInvalid) return invalidBody;
    const username = readString(body['username']);
    const usernameProblem = checkUsername(body['username']);
    if (usernameProblem) return invalid(usernameProblem);
    const passwordProblem = checkPassword(body['password']);
    if (passwordProblem) return invalid(passwordProblem);
    const designer = await createDesigner(username, readString(body['password']));
    if (!designer) {
      return { status: 409, body: { error: 'taken', message: USERNAME_TAKEN_MESSAGE } };
    }
    const token = await startSession(designer.id);
    return { status: 201, body: { username: designer.username }, cookie: sessionCookie(token) };
  }

  if (method === 'POST' && path === '/api/session') {
    if (context.bodyInvalid) return invalidBody;
    const designer = await checkCredentials(readString(body['username']), readString(body['password']));
    if (!designer) {
      return { status: 401, body: { error: 'wrong_credentials', message: WRONG_CREDENTIALS_MESSAGE } };
    }
    const token = await startSession(designer.id);
    return { status: 200, body: { username: designer.username }, cookie: sessionCookie(token) };
  }

  if (method === 'DELETE' && path === '/api/session') {
    if (context.sessionToken) await endSession(context.sessionToken);
    return { status: 204, cookie: clearedCookie() };
  }

  if (method === 'GET' && path === '/api/me') {
    if (!context.session) return signInRequired;
    return { status: 200, body: { username: context.session.username } };
  }

  return null;
}

async function library(context: RequestContext): Promise<ApiReply | null> {
  const { method, path, body, session } = context;

  if (path === '/api/layouts' && method === 'GET') {
    if (!session) return signInRequired;
    const entries = await listLibrary(session.id);
    return {
      status: 200,
      body: {
        layouts: entries.map((entry) => ({
          id: entry.id,
          name: entry.name,
          role: entry.role,
          columns: entry.state.columns,
        })),
      },
    };
  }

  if (path === '/api/layouts' && method === 'POST') {
    if (!session) return signInRequired;
    if (context.bodyInvalid) return invalidBody;
    const nameProblem = checkLayoutName(body['name']);
    if (nameProblem) return invalid(nameProblem);
    const template = body['template'] ?? 'blank';
    if (!isTemplateKey(template)) return invalid(TEMPLATE_MESSAGE);
    const record = await createLayout(session.id, readString(body['name']).trim(), templateState(template));
    return { status: 201, body: layoutObject(record, 'owner', await valkeyAnswers()) };
  }

  return null;
}

async function layoutRoutes(context: RequestContext): Promise<ApiReply | null> {
  const { method, segments, session, body } = context;
  if (segments[0] !== 'api' || segments[1] !== 'layouts' || segments.length < 3) return null;
  if (!session) return signInRequired;
  const layoutId = segments[2] as string;
  const rest = segments.slice(3);

  const opened = await openLayout(layoutId, session.id);
  if (!opened) return notFound;
  const { layout, role } = opened;

  if (rest.length === 0 && method === 'GET') {
    return { status: 200, body: layoutObject(layout, role, await valkeyAnswers()) };
  }

  if (rest.length === 1 && rest[0] === 'changes' && method === 'POST') {
    if (context.bodyInvalid) return invalidBody;
    const baseRevision = body['base_revision'];
    if (!Number.isInteger(baseRevision)) return invalidBody;
    const parsed = parseChange(body['change']);
    if (!parsed.ok) {
      return parsed.reason === 'unknown-kind' ? invalid(UNKNOWN_CHANGE_MESSAGE) : invalidBody;
    }
    const result = await applyLayoutChange(layout.id, session.id, baseRevision as number, parsed.change);
    const live = await valkeyAnswers();
    if (result.kind === 'invalid') return invalid(result.message);
    if (result.kind === 'conflict') {
      return {
        status: 409,
        body: {
          error: 'conflict',
          message: `${result.username} changed ${result.target} first. Your change was not applied.`,
          revision: result.revision,
          layout: layoutObject({ ...layout, state: result.state }, role, live),
        },
      };
    }
    if (result.kind === 'unchanged') {
      return { status: 200, body: { revision: result.revision, unchanged: true } };
    }
    await publishChange(layout.id, {
      revision: result.revision,
      author: session.username,
      change: result.change,
      state: result.state,
    });
    return {
      status: 200,
      body: {
        revision: result.revision,
        layout: layoutObject(
          { ...layout, revision: result.revision, state: result.state },
          role,
          live,
        ),
      },
    };
  }

  if (rest[0] === 'versions') {
    if (rest.length === 1 && method === 'GET') {
      const versions = await listVersions(layout.id);
      return {
        status: 200,
        body: { versions: versions.map((version) => ({ number: version.number, name: version.name })) },
      };
    }
    if (rest.length === 1 && method === 'POST') {
      if (context.bodyInvalid) return invalidBody;
      const nameProblem = checkVersionName(body['name']);
      if (nameProblem) return invalid(nameProblem);
      const saved = await saveVersion(layout.id, readString(body['name']));
      return { status: 201, body: saved };
    }
    if (rest.length === 2 && method === 'GET') {
      const number = Number(rest[1]);
      if (!Number.isInteger(number)) return notFound;
      const version = await versionByNumber(layout.id, number);
      if (!version) return notFound;
      return {
        status: 200,
        body: {
          number: version.number,
          name: version.name,
          layout: layoutObject(
            { ...layout, revision: version.revision, state: version.state },
            role,
            await valkeyAnswers(),
          ),
        },
      };
    }
  }

  if (rest.length === 1 && rest[0] === 'compare' && method === 'GET') {
    const from = Number(context.url.searchParams.get('from'));
    const to = Number(context.url.searchParams.get('to'));
    if (!Number.isInteger(from) || !Number.isInteger(to)) return notFound;
    const [left, right] = await Promise.all([
      versionByNumber(layout.id, from),
      versionByNumber(layout.id, to),
    ]);
    if (!left || !right) return notFound;
    return { status: 200, body: { differences: versionDifferences(left.state, right.state) } };
  }

  if (role !== 'owner') return notFound;

  if (rest.length === 1 && rest[0] === 'share' && method === 'GET') {
    return { status: 200, body: await shareInfo(layout.id) };
  }

  if (rest.length === 1 && rest[0] === 'view-link') {
    if (method === 'POST') {
      const token = await replaceLink(layout.id, 'view');
      return { status: 201, body: { view_path: `/view/${token}` } };
    }
    if (method === 'DELETE') {
      const revoked = await revokeViewLink(layout.id);
      if (!revoked) return { status: 409, body: { error: 'no_view_link' } };
      return { status: 204 };
    }
  }

  if (rest.length === 1 && rest[0] === 'join-link' && method === 'POST') {
    const token = await replaceLink(layout.id, 'join');
    return { status: 201, body: { join_path: `/join/${token}` } };
  }

  if (rest.length === 2 && rest[0] === 'collaborators' && method === 'DELETE') {
    const removed = await removeCollaborator(layout.id, decodeURIComponent(rest[1] as string));
    return removed ? { status: 204 } : notFound;
  }

  return notFound;
}

async function sharing(context: RequestContext): Promise<ApiReply | null> {
  const { method, segments, session } = context;

  if (segments[0] === 'api' && segments[1] === 'join' && segments.length === 3 && method === 'POST') {
    if (!session) return signInRequired;
    const layout = await layoutByLink(segments[2] as string, 'join');
    if (!layout) return notFound;
    if (layout.owner_id !== session.id) await addCollaborator(layout.id, session.id);
    return { status: 200, body: { layout_id: layout.id } };
  }

  if (segments[0] === 'api' && segments[1] === 'view' && segments.length === 3 && method === 'GET') {
    const layout = await layoutByLink(segments[2] as string, 'view');
    if (!layout) return notFound;
    return { status: 200, body: layoutObject(layout, 'viewer', await valkeyAnswers()) };
  }

  return null;
}

export async function handleApi(context: RequestContext): Promise<ApiReply> {
  const { method, path } = context;

  if (path === '/api/health' && method === 'GET') {
    if (!postgresReady()) return { status: 503, body: { status: 'starting' } };
    const live = await valkeyAnswers();
    return { status: 200, body: { status: live ? 'ok' : 'unavailable' } };
  }

  if (path === '/api/grading/setup' && method === 'POST') {
    return handleGradingSetup(context);
  }

  const handlers = [accounts, library, layoutRoutes, sharing];
  for (const handler of handlers) {
    const reply = await handler(context);
    if (reply) return reply;
  }

  return notFound;
}
