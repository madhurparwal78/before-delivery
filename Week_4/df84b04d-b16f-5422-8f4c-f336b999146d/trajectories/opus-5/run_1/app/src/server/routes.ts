import { displayText } from '../shared/types.js';
import {
  closeSession,
  confirmSignUp,
  openSession,
  setHideCompleted,
  signIn,
  signUp
} from './accounts.js';
import { buildExport, type ExportFormat } from './export.js';
import { invalid } from './errors.js';
import {
  clearedCookie,
  sendEmpty,
  sendJson,
  sessionCookie,
  type RequestContext
} from './http.js';
import {
  createBullet,
  deleteBullet,
  mirrorBullet,
  moveBullet,
  patchBullet,
  redo,
  undo,
  type MoveRequest
} from './mutations.js';
import { loadView, readBullet, readOutline, searchOutline, suggest } from './outline.js';
import { acceptedShares, scopeForBullet, type Viewer } from './scope.js';
import {
  acceptInvitation,
  createShare,
  listShares,
  readInvitation,
  retryShare,
  revokeShare
} from './shares.js';
import { runSetup } from './setup.js';

export interface Route {
  method: string;
  pattern: string[];
  auth: boolean;
  handler: (context: RequestContext, viewer: Viewer) => Promise<void>;
}

function text(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === 'string' ? value : '';
}

function optionalId(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw invalid({ [key]: 'Send a bullet id or null.' });
  return value;
}

function rootParam(context: RequestContext): string | null {
  const value = context.url.searchParams.get('root');
  return value === null || value === '' ? null : value;
}

function viewerBody(viewer: Viewer): Record<string, unknown> {
  return {
    id: viewer.userId,
    email: viewer.email,
    name: viewer.name,
    hideCompleted: viewer.hideCompleted
  };
}

async function meBody(viewer: Viewer): Promise<Record<string, unknown>> {
  const shares = await acceptedShares(viewer.email);
  const shared = [];
  for (const share of shares) {
    const { tree } = await scopeForBullet(viewer, share.bulletId);
    const row = tree.row(share.bulletId);
    if (row === undefined) continue;
    const original = tree.original(row);
    shared.push({
      bulletId: share.bulletId,
      text: displayText({ text: original?.text ?? '', placeholder: original === undefined }),
      owner: { name: share.ownerName }
    });
  }
  return { user: viewerBody(viewer), shared };
}

function moveRequest(body: Record<string, unknown>): MoveRequest {
  const op = body['op'];
  if (op !== undefined) {
    if (op === 'indent' || op === 'outdent' || op === 'up' || op === 'down') return { op };
    throw invalid({ op: 'Send indent, outdent, up or down.' });
  }
  const index = body['index'];
  if (typeof index !== 'number') throw invalid({ index: 'Send a position among the children.' });
  return { parentId: optionalId(body, 'parentId'), index };
}

export const routes: Route[] = [
  {
    method: 'POST',
    pattern: ['api', 'signup'],
    auth: false,
    handler: async (context) => {
      const body = context.body();
      await signUp({
        name: text(body, 'name'),
        email: text(body, 'email'),
        password: text(body, 'password')
      });
      sendJson(context.response, 202, { status: 'code_sent' });
    }
  },
  {
    method: 'POST',
    pattern: ['api', 'signup', 'confirm'],
    auth: false,
    handler: async (context) => {
      const body = context.body();
      const user = await confirmSignUp(text(body, 'email'), text(body, 'code'));
      const session = await openSession(user.id);
      sendJson(context.response, 200, { user }, { 'set-cookie': sessionCookie(session) });
    }
  },
  {
    method: 'POST',
    pattern: ['api', 'session'],
    auth: false,
    handler: async (context) => {
      const body = context.body();
      const user = await signIn(text(body, 'email'), text(body, 'password'));
      const session = await openSession(user.id);
      sendJson(context.response, 200, { user }, { 'set-cookie': sessionCookie(session) });
    }
  },
  {
    method: 'DELETE',
    pattern: ['api', 'session'],
    auth: false,
    handler: async (context) => {
      const session = context.cookies['twig_session'];
      if (session !== undefined) await closeSession(session);
      sendEmpty(context.response, 204, { 'set-cookie': clearedCookie() });
    }
  },
  {
    method: 'GET',
    pattern: ['api', 'me'],
    auth: true,
    handler: async (context, viewer) => {
      sendJson(context.response, 200, await meBody(viewer));
    }
  },
  {
    method: 'PATCH',
    pattern: ['api', 'me'],
    auth: true,
    handler: async (context, viewer) => {
      const value = context.body()['hideCompleted'];
      if (typeof value !== 'boolean') {
        throw invalid({ hideCompleted: 'Send true or false.' });
      }
      await setHideCompleted(viewer.userId, value);
      sendJson(context.response, 200, await meBody({ ...viewer, hideCompleted: value }));
    }
  },
  {
    method: 'GET',
    pattern: ['api', 'outline'],
    auth: true,
    handler: async (context, viewer) => {
      sendJson(context.response, 200, await readOutline(viewer, rootParam(context)));
    }
  },
  {
    method: 'GET',
    pattern: ['api', 'bullets', ':id'],
    auth: true,
    handler: async (context, viewer) => {
      const bullet = await readBullet(viewer, context.params['id']!);
      sendJson(context.response, 200, { bullet });
    }
  },
  {
    method: 'POST',
    pattern: ['api', 'bullets'],
    auth: true,
    handler: async (context, viewer) => {
      const body = context.body();
      const split = body['splitFrom'];
      let splitFrom: { id: string; text: string; revision: number } | null = null;
      if (split !== undefined && split !== null) {
        const record = split as Record<string, unknown>;
        if (typeof record['id'] !== 'string' || typeof record['revision'] !== 'number') {
          throw invalid({ splitFrom: 'Send the bullet and the revision the split came from.' });
        }
        splitFrom = {
          id: record['id'],
          text: typeof record['text'] === 'string' ? record['text'] : '',
          revision: record['revision']
        };
      }
      const parentId = optionalId(body, 'parentId');
      const scope =
        parentId === null
          ? { viewer, ownerId: viewer.userId, shareRootId: null }
          : (await scopeForBullet(viewer, parentId)).scope;
      const created = await createBullet(scope, {
        parentId,
        afterId: optionalId(body, 'afterId'),
        text: text(body, 'text'),
        splitFrom
      });
      const bullet = await readBullet(viewer, created.id);
      sendJson(context.response, 201, { bullet, seq: created.seq });
    }
  },
  {
    method: 'PATCH',
    pattern: ['api', 'bullets', ':id'],
    auth: true,
    handler: async (context, viewer) => {
      const bulletId = context.params['id']!;
      const { scope } = await scopeForBullet(viewer, bulletId);
      const body = context.body();
      const input: {
        text?: string;
        revision?: number;
        completed?: boolean;
        collapsed?: boolean;
      } = {};
      if (body['text'] !== undefined) {
        if (typeof body['text'] !== 'string') throw invalid({ text: 'Send the bullet text.' });
        input.text = body['text'];
      }
      if (body['revision'] !== undefined) {
        if (typeof body['revision'] !== 'number') {
          throw invalid({ revision: 'Send the revision you last saw.' });
        }
        input.revision = body['revision'];
      }
      for (const key of ['completed', 'collapsed'] as const) {
        if (body[key] !== undefined) {
          if (typeof body[key] !== 'boolean') throw invalid({ [key]: 'Send true or false.' });
          input[key] = body[key] as boolean;
        }
      }
      const { seq } = await patchBullet(scope, bulletId, input);
      const bullet = await readBullet(viewer, bulletId);
      sendJson(context.response, 200, { bullet, seq });
    }
  },
  {
    method: 'DELETE',
    pattern: ['api', 'bullets', ':id'],
    auth: true,
    handler: async (context, viewer) => {
      const bulletId = context.params['id']!;
      const { scope } = await scopeForBullet(viewer, bulletId);
      const outcome = await deleteBullet(scope, bulletId);
      sendJson(context.response, 200, outcome);
    }
  },
  {
    method: 'POST',
    pattern: ['api', 'bullets', ':id', 'move'],
    auth: true,
    handler: async (context, viewer) => {
      const bulletId = context.params['id']!;
      const { scope } = await scopeForBullet(viewer, bulletId);
      const { seq } = await moveBullet(scope, bulletId, moveRequest(context.body()));
      const bullet = await readBullet(viewer, bulletId);
      sendJson(context.response, 200, { bullet, seq });
    }
  },
  {
    method: 'POST',
    pattern: ['api', 'bullets', ':id', 'mirror'],
    auth: true,
    handler: async (context, viewer) => {
      const bulletId = context.params['id']!;
      const { scope } = await scopeForBullet(viewer, bulletId);
      const body = context.body();
      let destination: { parentId: string | null; index: number } | null = null;
      if (body['index'] !== undefined) {
        if (typeof body['index'] !== 'number') {
          throw invalid({ index: 'Send a position among the children.' });
        }
        destination = { parentId: optionalId(body, 'parentId'), index: body['index'] };
      }
      const created = await mirrorBullet(scope, bulletId, destination);
      const bullet = await readBullet(viewer, created.id);
      sendJson(context.response, 201, { bullet, seq: created.seq });
    }
  },
  {
    method: 'POST',
    pattern: ['api', 'undo'],
    auth: true,
    handler: async (context, viewer) => {
      const root = rootParam(context);
      const scope =
        root === null
          ? { viewer, ownerId: viewer.userId, shareRootId: null }
          : (await scopeForBullet(viewer, root)).scope;
      sendJson(context.response, 200, await undo(scope));
    }
  },
  {
    method: 'POST',
    pattern: ['api', 'redo'],
    auth: true,
    handler: async (context, viewer) => {
      const root = rootParam(context);
      const scope =
        root === null
          ? { viewer, ownerId: viewer.userId, shareRootId: null }
          : (await scopeForBullet(viewer, root)).scope;
      sendJson(context.response, 200, await redo(scope));
    }
  },
  {
    method: 'GET',
    pattern: ['api', 'search'],
    auth: true,
    handler: async (context, viewer) => {
      const q = context.url.searchParams.get('q') ?? '';
      sendJson(context.response, 200, await searchOutline(viewer, q, rootParam(context)));
    }
  },
  {
    method: 'GET',
    pattern: ['api', 'suggest'],
    auth: true,
    handler: async (context, viewer) => {
      const kind = context.url.searchParams.get('kind');
      if (kind !== 'tag' && kind !== 'mention') throw invalid({ kind: 'Send tag or mention.' });
      const prefix = context.url.searchParams.get('prefix') ?? '';
      const suggestions = await suggest(viewer, kind, prefix, rootParam(context));
      sendJson(context.response, 200, { suggestions });
    }
  },
  {
    method: 'GET',
    pattern: ['api', 'export'],
    auth: true,
    handler: async (context, viewer) => {
      const format = context.url.searchParams.get('format');
      if (format !== 'text' && format !== 'markdown' && format !== 'opml') {
        throw invalid({ format: 'Send text, markdown or opml.' });
      }
      const view = await loadView(viewer, rootParam(context));
      const file = buildExport(view, format as ExportFormat);
      const payload = Buffer.from(file.body, 'utf8');
      context.response.writeHead(200, {
        'content-type': file.contentType,
        'content-length': String(payload.length),
        'content-disposition': `attachment; filename="${file.filename}"`,
        'cache-control': 'no-store'
      });
      context.response.end(payload);
    }
  },
  {
    method: 'GET',
    pattern: ['api', 'bullets', ':id', 'shares'],
    auth: true,
    handler: async (context, viewer) => {
      const shares = await listShares(viewer, context.params['id']!);
      sendJson(context.response, 200, { shares });
    }
  },
  {
    method: 'POST',
    pattern: ['api', 'bullets', ':id', 'shares'],
    auth: true,
    handler: async (context, viewer) => {
      const bulletId = context.params['id']!;
      await scopeForBullet(viewer, bulletId);
      const share = await createShare(viewer, bulletId, context.body()['email']);
      sendJson(context.response, 201, { share });
    }
  },
  {
    method: 'POST',
    pattern: ['api', 'shares', ':id', 'retry'],
    auth: true,
    handler: async (context, viewer) => {
      const share = await retryShare(viewer, context.params['id']!);
      sendJson(context.response, 200, { share });
    }
  },
  {
    method: 'DELETE',
    pattern: ['api', 'shares', ':id'],
    auth: true,
    handler: async (context, viewer) => {
      const share = await revokeShare(viewer, context.params['id']!);
      sendJson(context.response, 200, { share });
    }
  },
  {
    method: 'GET',
    pattern: ['api', 'invitations', ':token'],
    auth: false,
    handler: async (context) => {
      sendJson(context.response, 200, await readInvitation(context.params['token']!));
    }
  },
  {
    method: 'POST',
    pattern: ['api', 'invitations', ':token', 'accept'],
    auth: true,
    handler: async (context, viewer) => {
      const bulletId = await acceptInvitation(viewer, context.params['token']!);
      sendJson(context.response, 200, { bulletId });
    }
  },
  {
    method: 'POST',
    pattern: ['api', 'grading', 'setup'],
    auth: false,
    handler: async (context) => {
      sendJson(context.response, 201, await runSetup(context.body()));
    }
  }
];

export function matchRoute(
  method: string,
  segments: string[]
): { route: Route; params: Record<string, string> } | null {
  for (const route of routes) {
    if (route.method !== method) continue;
    if (route.pattern.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (const [index, part] of route.pattern.entries()) {
      const actual = segments[index]!;
      if (part.startsWith(':')) {
        params[part.slice(1)] = actual;
        continue;
      }
      if (part !== actual) {
        matched = false;
        break;
      }
    }
    if (matched) return { route, params };
  }
  return null;
}
