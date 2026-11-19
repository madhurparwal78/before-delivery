import { copy } from '../shared/copy.js';
import { LIMITS, type Role, findPage } from '../shared/document.js';
import { HTTP_OPERATION_KINDS, parseOperationRequest } from '../shared/operation.js';
import {
  isPlainObject,
  validateDisplayName,
  validateEmail,
  validatePassword,
  validateTitle,
} from '../shared/validate.js';
import {
  type Session,
  clearedSessionCookie,
  createSession,
  createUser,
  deleteSession,
  findUserByEmail,
  sessionCookie,
  verifyPassword,
} from './auth.js';
import { createComment, listComments, resolveComment } from './comments.js';
import { query, queryOne, transaction } from './db.js';
import {
  canEdit,
  registerObjectIds,
  requireKnownIds,
  requireMembership,
  saveOutageActive,
} from './diagrams.js';
import { newDocument } from '../shared/engine.js';
import {
  ApiError,
  badCredentials,
  conflict,
  forbiddenRole,
  invalidRequest,
  notFound,
  saveUnavailable,
  unauthenticated,
} from './errors.js';
import {
  type ExportBackground,
  type ExportFormat,
  exportFile,
  exportSummary,
  listExports,
  loadExport,
  requestExport,
  retryExport,
} from './exports.js';
import {
  applyRoleChange,
  clientsOfSession,
  clientsOfUser,
  closeClients,
} from './hub.js';
import { newId } from './ids.js';
import {
  acceptOpenInvites,
  createInvite,
  listInvites,
  listMembers,
  resendInvite,
  revokeInvite,
} from './invites.js';
import { UndoSkipped, runOperation } from './operations.js';
import { seedDiagrams, startSaveOutage } from './grading.js';
import { listVersions, loadVersion, saveVersion } from './versions.js';
import { config } from './env.js';

export interface RequestContext {
  method: string;
  url: URL;
  session: Session | null;
  body: unknown;
  params: Record<string, string>;
}

export interface ApiResponse {
  status: number;
  body?: unknown;
  cookie?: string;
  file?: { body: Buffer; contentType: string; filename: string };
}

type Handler = (context: RequestContext) => Promise<ApiResponse>;

interface Route {
  method: string;
  pattern: string[];
  handler: Handler;
}

function route(method: string, path: string, handler: Handler): Route {
  return { method, pattern: path.split('/').filter((part) => part.length > 0), handler };
}

function requireSession(context: RequestContext): Session {
  if (!context.session) throw unauthenticated();
  return context.session;
}

function requireBody(context: RequestContext): Record<string, unknown> {
  if (!isPlainObject(context.body)) throw invalidRequest({ '': 'Send a JSON object.' });
  return context.body;
}

function param(context: RequestContext, name: string): string {
  const value = context.params[name];
  if (value === undefined) throw notFound();
  return value;
}

function requireOwner(role: Role): void {
  if (role !== 'owner') throw forbiddenRole();
}

const routes: Route[] = [
  route('GET', '/api/health', async () => ({ status: 200, body: { status: 'ok' } })),

  route('POST', '/api/auth/signup', async (context) => {
    const body = requireBody(context);
    const name = validateDisplayName(body['name'], 'name');
    if (!name.ok) throw invalidRequest(name.fields);
    const email = validateEmail(body['email'], 'email');
    if (!email.ok) throw invalidRequest(email.fields);
    const password = validatePassword(body['password'], 'password');
    if (!password.ok) throw invalidRequest(password.fields);
    if (await findUserByEmail(email.value)) {
      throw new ApiError(409, 'email_taken', copy.fieldErrors.emailTaken, {
        email: copy.fieldErrors.emailTaken,
      });
    }
    const user = await createUser(email.value, name.value, password.value);
    await acceptOpenInvites(user);
    return {
      status: 201,
      body: { user: { id: user.id, email: user.email, name: user.name } },
      cookie: sessionCookie(await createSession(user.id)),
    };
  }),

  route('POST', '/api/auth/signin', async (context) => {
    const body = requireBody(context);
    const email = validateEmail(body['email'], 'email');
    if (!email.ok) throw invalidRequest(email.fields);
    const password = body['password'];
    const found = await findUserByEmail(email.value);
    if (!found || typeof password !== 'string' || !(await verifyPassword(password, found.password_hash))) {
      throw badCredentials();
    }
    const user = { id: found.id, email: found.email, name: found.name };
    await acceptOpenInvites(user);
    return {
      status: 200,
      body: { user },
      cookie: sessionCookie(await createSession(user.id)),
    };
  }),

  route('POST', '/api/auth/signout', async (context) => {
    if (context.session) {
      closeClients(clientsOfSession(context.session.id), 4401);
      await deleteSession(context.session.id);
    }
    return { status: 204, cookie: clearedSessionCookie() };
  }),

  route('GET', '/api/me', async (context) => {
    const session = requireSession(context);
    return { status: 200, body: { user: session.user } };
  }),

  route('GET', '/api/diagrams', async (context) => {
    const session = requireSession(context);
    const rows = await query<{ id: string; title: string; role: Role; updated_at: Date }>(
      `SELECT d.id, d.title, m.role, d.updated_at
         FROM diagrams d JOIN members m ON m.diagram_id = d.id
        WHERE m.user_id = $1 ORDER BY d.updated_at DESC`,
      [session.user.id],
    );
    return {
      status: 200,
      body: {
        diagrams: rows.map((r) => ({
          id: r.id,
          title: r.title,
          role: r.role,
          updatedAt: r.updated_at.toISOString(),
        })),
      },
    };
  }),

  route('POST', '/api/diagrams', async (context) => {
    const session = requireSession(context);
    const body = requireBody(context);
    const title = validateTitle(body['title'], 'title');
    if (!title.ok) throw invalidRequest(title.fields);
    const id = newId('d');
    const document = newDocument(newId, id, title.value);
    await transaction(async (client) => {
      await client.query(
        'INSERT INTO diagrams (id, title, owner_id, document, seq) VALUES ($1, $2, $3, $4, 0)',
        [id, title.value, session.user.id, JSON.stringify(document)],
      );
      await client.query('INSERT INTO members (diagram_id, user_id, role) VALUES ($1, $2, $3)', [
        id,
        session.user.id,
        'owner',
      ]);
      await registerObjectIds(client, id, [
        { id: session.user.id, kind: 'member' },
        ...document.pages.flatMap((page) => [
          { id: page.id, kind: 'page' },
          ...page.layers.map((layer) => ({ id: layer.id, kind: 'layer' })),
        ]),
      ]);
    });
    return { status: 201, body: { diagram: { id, title: title.value }, document } };
  }),

  route('GET', '/api/diagrams/:diagramId/document', async (context) => {
    const session = requireSession(context);
    const { diagram } = await requireMembership(param(context, 'diagramId'), session.user.id);
    return { status: 200, body: diagram.document };
  }),

  route('POST', '/api/diagrams/:diagramId/operations', async (context) => {
    const session = requireSession(context);
    const diagramId = param(context, 'diagramId');
    const { role } = await requireMembership(diagramId, session.user.id);
    const parsed = parseOperationRequest(context.body, HTTP_OPERATION_KINDS);
    if (!parsed.ok) {
      if (!canEdit(role)) throw forbiddenRole();
      if (await saveOutageActive(diagramId)) throw saveUnavailable();
      throw invalidRequest(parsed.fields);
    }
    try {
      return { status: 200, body: await runOperation(diagramId, session.user, parsed.value) };
    } catch (error) {
      if (error instanceof UndoSkipped) throw conflict('op_conflict', error.message);
      throw error;
    }
  }),

  route('GET', '/api/diagrams/:diagramId/members', async (context) => {
    const session = requireSession(context);
    const diagramId = param(context, 'diagramId');
    await requireMembership(diagramId, session.user.id);
    return {
      status: 200,
      body: { members: await listMembers(diagramId), invites: await listInvites(diagramId) },
    };
  }),

  route('POST', '/api/diagrams/:diagramId/invites', async (context) => {
    const session = requireSession(context);
    const diagramId = param(context, 'diagramId');
    const { role, diagram } = await requireMembership(diagramId, session.user.id);
    requireOwner(role);
    const body = requireBody(context);
    const email = validateEmail(body['email'], 'email');
    if (!email.ok) throw invalidRequest(email.fields);
    const invited = body['role'];
    if (invited !== 'editor' && invited !== 'viewer') {
      throw invalidRequest({ role: 'Choose Editor or Viewer.' });
    }
    const invite = await createInvite(diagramId, diagram.title, session.user, email.value, invited);
    return { status: 201, body: { invite } };
  }),

  route('POST', '/api/diagrams/:diagramId/invites/:inviteId/resend', async (context) => {
    const session = requireSession(context);
    const diagramId = param(context, 'diagramId');
    const inviteId = param(context, 'inviteId');
    await requireKnownIds(diagramId, [inviteId]);
    const { role, diagram } = await requireMembership(diagramId, session.user.id);
    requireOwner(role);
    return {
      status: 200,
      body: { invite: await resendInvite(diagramId, diagram.title, session.user, inviteId) },
    };
  }),

  route('DELETE', '/api/diagrams/:diagramId/invites/:inviteId', async (context) => {
    const session = requireSession(context);
    const diagramId = param(context, 'diagramId');
    const inviteId = param(context, 'inviteId');
    await requireKnownIds(diagramId, [inviteId]);
    const { role } = await requireMembership(diagramId, session.user.id);
    requireOwner(role);
    await revokeInvite(diagramId, inviteId);
    return { status: 204 };
  }),

  route('PATCH', '/api/diagrams/:diagramId/members/:userId', async (context) => {
    const session = requireSession(context);
    const diagramId = param(context, 'diagramId');
    const userId = param(context, 'userId');
    await requireKnownIds(diagramId, [userId]);
    const { role, diagram } = await requireMembership(diagramId, session.user.id);
    requireOwner(role);
    const body = requireBody(context);
    const next = body['role'];
    if (next !== 'editor' && next !== 'viewer') {
      throw invalidRequest({ role: 'Choose Editor or Viewer.' });
    }
    if (userId === diagram.owner_id) {
      throw conflict('owner_role', "The owner's role cannot change.");
    }
    const updated = await query<{ user_id: string; role: Role; email: string; name: string }>(
      `UPDATE members SET role = $3 WHERE diagram_id = $1 AND user_id = $2
       RETURNING user_id, role, (SELECT email FROM users WHERE id = $2) AS email,
                 (SELECT name FROM users WHERE id = $2) AS name`,
      [diagramId, userId, next],
    );
    const member = updated[0];
    if (!member) throw notFound();
    applyRoleChange(diagramId, userId, next);
    return {
      status: 200,
      body: {
        member: {
          userId: member.user_id,
          email: member.email,
          name: member.name,
          role: member.role,
          status: 'active',
        },
      },
    };
  }),

  route('DELETE', '/api/diagrams/:diagramId/members/:userId', async (context) => {
    const session = requireSession(context);
    const diagramId = param(context, 'diagramId');
    const userId = param(context, 'userId');
    await requireKnownIds(diagramId, [userId]);
    const { role, diagram } = await requireMembership(diagramId, session.user.id);
    requireOwner(role);
    if (userId === diagram.owner_id) {
      throw conflict('owner_role', 'The owner cannot be removed.');
    }
    await query('DELETE FROM members WHERE diagram_id = $1 AND user_id = $2', [diagramId, userId]);
    closeClients(clientsOfUser(diagramId, userId), 4404);
    return { status: 204 };
  }),

  route('GET', '/api/diagrams/:diagramId/comments', async (context) => {
    const session = requireSession(context);
    const diagramId = param(context, 'diagramId');
    await requireMembership(diagramId, session.user.id);
    return { status: 200, body: { comments: await listComments(diagramId) } };
  }),

  route('POST', '/api/diagrams/:diagramId/comments', async (context) => {
    const session = requireSession(context);
    const diagramId = param(context, 'diagramId');
    const body = requireBody(context);
    const shape = body['shape'];
    const parent = body['parent'] ?? null;
    await requireKnownIds(diagramId, [
      ...(typeof shape === 'string' ? [shape] : []),
      ...(typeof parent === 'string' ? [parent] : []),
    ]);
    await requireMembership(diagramId, session.user.id);
    if (typeof shape !== 'string') throw invalidRequest({ shape: 'Name the shape to comment on.' });
    const text = body['text'];
    if (typeof text !== 'string' || text.length < 1 || text.length > LIMITS.commentMax) {
      throw invalidRequest({ text: `Use 1 to ${LIMITS.commentMax} characters.` });
    }
    if (parent !== null && typeof parent !== 'string') {
      throw invalidRequest({ parent: 'Name the thread to reply to.' });
    }
    const comment = await createComment(diagramId, session.user, shape, text, parent);
    return { status: 201, body: { comment } };
  }),

  route('POST', '/api/diagrams/:diagramId/comments/:commentId/resolve', async (context) => {
    const session = requireSession(context);
    const diagramId = param(context, 'diagramId');
    const commentId = param(context, 'commentId');
    await requireKnownIds(diagramId, [commentId]);
    const { role } = await requireMembership(diagramId, session.user.id);
    const comment = await resolveComment(diagramId, commentId, session.user, canEdit(role));
    return { status: 200, body: { comment } };
  }),

  route('GET', '/api/diagrams/:diagramId/versions', async (context) => {
    const session = requireSession(context);
    const diagramId = param(context, 'diagramId');
    await requireMembership(diagramId, session.user.id);
    return { status: 200, body: { versions: await listVersions(diagramId) } };
  }),

  route('POST', '/api/diagrams/:diagramId/versions', async (context) => {
    const session = requireSession(context);
    const diagramId = param(context, 'diagramId');
    const { role } = await requireMembership(diagramId, session.user.id);
    if (!canEdit(role)) throw forbiddenRole();
    const body = requireBody(context);
    const name = body['name'] ?? null;
    if (name !== null && (typeof name !== 'string' || name.length > LIMITS.versionNameMax)) {
      throw invalidRequest({ name: `Use at most ${LIMITS.versionNameMax} characters.` });
    }
    const trimmed = typeof name === 'string' && name.length > 0 ? name : null;
    return { status: 201, body: { version: await saveVersion(diagramId, session.user, trimmed) } };
  }),

  route('GET', '/api/diagrams/:diagramId/versions/:versionId', async (context) => {
    const session = requireSession(context);
    const diagramId = param(context, 'diagramId');
    const versionId = param(context, 'versionId');
    await requireKnownIds(diagramId, [versionId]);
    await requireMembership(diagramId, session.user.id);
    const loaded = await loadVersion(diagramId, versionId);
    if (!loaded) throw notFound();
    return { status: 200, body: { version: loaded.version, document: loaded.document } };
  }),

  route('POST', '/api/diagrams/:diagramId/versions/:versionId/restore', async (context) => {
    const session = requireSession(context);
    const diagramId = param(context, 'diagramId');
    const versionId = param(context, 'versionId');
    await requireKnownIds(diagramId, [versionId]);
    const { role } = await requireMembership(diagramId, session.user.id);
    requireOwner(role);
    const result = await runOperation(diagramId, session.user, {
      opId: `restore-${versionId}-${newId('v')}`,
      baseSeq: 0,
      op: { kind: 'restore_version', version: versionId },
    });
    const versions = await listVersions(diagramId);
    return { status: 200, body: { version: versions[0], seq: result.seq } };
  }),

  route('GET', '/api/diagrams/:diagramId/exports', async (context) => {
    const session = requireSession(context);
    const diagramId = param(context, 'diagramId');
    await requireMembership(diagramId, session.user.id);
    return { status: 200, body: { exports: await listExports(diagramId) } };
  }),

  route('POST', '/api/diagrams/:diagramId/exports', async (context) => {
    const session = requireSession(context);
    const diagramId = param(context, 'diagramId');
    const body = requireBody(context);
    const page = body['page'];
    const { role, diagram } = await requireMembership(diagramId, session.user.id);
    if (typeof page === 'string' && !findPage(diagram.document, page)) {
      await requireKnownIds(diagramId, [page]);
    }
    if (!canEdit(role)) throw forbiddenRole();
    const format = body['format'];
    if (format !== 'png' && format !== 'svg') {
      throw invalidRequest({ format: 'Choose PNG or SVG.' });
    }
    const scale = body['scale'];
    if (scale !== 1 && scale !== 2) throw invalidRequest({ scale: 'Choose 1 or 2.' });
    if (format === 'svg' && scale !== 1) throw invalidRequest({ scale: 'SVG takes only 1.' });
    const background = body['background'];
    if (background !== 'white' && background !== 'transparent') {
      throw invalidRequest({ background: 'Choose White or Transparent.' });
    }
    if (typeof page !== 'string') throw invalidRequest({ page: 'Choose a page.' });
    const created = await requestExport(diagramId, session.user, {
      page,
      format: format as ExportFormat,
      scale,
      background: background as ExportBackground,
    });
    return { status: created.started ? 202 : 200, body: created.view };
  }),

  route('GET', '/api/exports/:exportId', async (context) => {
    const session = requireSession(context);
    const row = await loadExport(param(context, 'exportId'));
    if (!row) throw notFound();
    await requireMembership(row.diagram_id, session.user.id);
    return { status: 200, body: exportSummary(row) };
  }),

  route('GET', '/api/exports/:exportId/file', async (context) => {
    const session = requireSession(context);
    const row = await loadExport(param(context, 'exportId'));
    if (!row) throw notFound();
    await requireMembership(row.diagram_id, session.user.id);
    const file = await exportFile(row);
    return {
      status: 200,
      file: { ...file, filename: `${row.id}.${row.format}` },
    };
  }),

  route('POST', '/api/exports/:exportId/retry', async (context) => {
    const session = requireSession(context);
    const row = await loadExport(param(context, 'exportId'));
    if (!row) throw notFound();
    const { role } = await requireMembership(row.diagram_id, session.user.id);
    if (!canEdit(role)) throw forbiddenRole();
    return { status: 202, body: await retryExport(row.id) };
  }),

  route('POST', '/api/grading/seed', async (context) => {
    if (!config.gradingRoutes) throw notFound();
    return { status: 201, body: await seedDiagrams(context.body) };
  }),

  route('POST', '/api/grading/save-outage', async (context) => {
    if (!config.gradingRoutes) throw notFound();
    const body = requireBody(context);
    const diagramId = body['diagramId'];
    const ms = body['ms'];
    if (typeof diagramId !== 'string') throw invalidRequest({ diagramId: 'Name a diagram.' });
    if (typeof ms !== 'number' || !Number.isInteger(ms) || ms < 1 || ms > 60000) {
      throw invalidRequest({ ms: 'Enter a whole number from 1 to 60000.' });
    }
    const exists = await queryOne<{ id: string }>('SELECT id FROM diagrams WHERE id = $1', [diagramId]);
    if (!exists) throw notFound();
    return { status: 200, body: { until: await startSaveOutage(diagramId, ms) } };
  }),
];

export function matchRoute(
  method: string,
  pathname: string,
): { handler: Handler; params: Record<string, string> } | null {
  const parts = pathname.split('/').filter((part) => part.length > 0);
  for (const candidate of routes) {
    if (candidate.pattern.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (let i = 0; i < parts.length; i += 1) {
      const expected = candidate.pattern[i];
      const actual = parts[i];
      if (expected === undefined || actual === undefined) {
        matched = false;
        break;
      }
      if (expected.startsWith(':')) params[expected.slice(1)] = decodeURIComponent(actual);
      else if (expected !== actual) {
        matched = false;
        break;
      }
    }
    if (!matched) continue;
    if (candidate.method !== method) continue;
    return { handler: candidate.handler, params };
  }
  return null;
}

export function apiPathExists(pathname: string): boolean {
  const parts = pathname.split('/').filter((part) => part.length > 0);
  return routes.some((candidate) => {
    if (candidate.pattern.length !== parts.length) return false;
    return candidate.pattern.every((expected, i) => expected.startsWith(':') || expected === parts[i]);
  });
}
