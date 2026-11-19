import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { initClock } from './clock';
import { config, JSON_BODY_LIMIT } from './config';
import { applySchema, query, waitForDatabase } from './db';
import { seedDemoData } from './demo';
import { notFound } from './errors';
import {
  checkOrigin,
  isApiError,
  parseCookies,
  readBody,
  requireJsonContentType,
  sendJson,
  type Ctx,
} from './http';
import { startHeartbeat } from './live';
import { startMailWorker } from './mail';
import { pageShell } from './shell';
import * as auth from './routes/auth';
import * as content from './routes/content';
import * as grading from './routes/grading';
import * as jobs from './routes/jobs';
import * as messaging from './routes/messaging';
import * as misc from './routes/misc';
import * as network from './routes/network';
import * as profiles from './routes/profiles';

type Result = { status: number; body: unknown };
type Route = {
  method: string;
  segments: string[];
  handler: (ctx: Ctx) => Promise<Result> | Result;
  raw?: (ctx: Ctx) => Promise<void> | void;
  upload?: boolean;
  grading?: boolean;
  open?: boolean;
};

function route(
  method: string,
  pattern: string,
  handler: (ctx: Ctx) => Promise<Result> | Result,
  options: { upload?: boolean; grading?: boolean; open?: boolean } = {},
): Route {
  return { method, segments: pattern.split('/').filter(Boolean), handler, ...options };
}

function rawRoute(
  method: string,
  pattern: string,
  raw: (ctx: Ctx) => Promise<void> | void,
  options: { open?: boolean } = {},
): Route {
  return {
    method,
    segments: pattern.split('/').filter(Boolean),
    handler: () => ({ status: 204, body: null }),
    raw,
    ...options,
  };
}

const ROUTES: Route[] = [
  rawRoute('GET', '/api/health', misc.health, { open: true }),
  rawRoute('GET', '/api/config', misc.configEndpoint, { open: true }),
  rawRoute('GET', '/api/live', misc.liveStream),

  route('POST', '/api/grading/clock', grading.setClock, { grading: true }),
  route('POST', '/api/grading/seed', grading.seed, { grading: true }),

  route('POST', '/api/auth/signup', auth.signUp, { open: true }),
  route('POST', '/api/auth/confirm', auth.confirm, { open: true }),
  route('POST', '/api/auth/signin', auth.signIn, { open: true }),
  route('POST', '/api/auth/signout', auth.signOut, { open: true }),
  route('GET', '/api/me', auth.me),

  route('GET', '/api/me/jobs', jobs.myJobs),
  route('PATCH', '/api/me/sections/:section', profiles.patchSection),
  route('PATCH', '/api/me/settings', profiles.patchSettings),
  route('PUT', '/api/me/photo', profiles.putMyPhoto),
  route('DELETE', '/api/me/photo', profiles.deleteMyPhoto),

  route('POST', '/api/uploads/photo', profiles.uploadPhoto, { upload: true }),
  route('POST', '/api/uploads/resume', profiles.uploadResume, { upload: true }),
  rawRoute('GET', '/media/photos/:photo_id', profiles.readPhoto),

  route('GET', '/api/profiles/:handle', profiles.getProfile),
  route('GET', '/api/profiles/:handle/mutual', profiles.getMutual),
  route('GET', '/api/profiles/:handle/path', profiles.getPath),

  route('GET', '/api/network', network.networkLists),
  route('POST', '/api/connections', network.createConnection),
  route('POST', '/api/connections/:member_id/withdraw', network.withdrawConnection),
  route('POST', '/api/connections/:member_id/accept', network.acceptConnection),
  route('POST', '/api/connections/:member_id/ignore', network.ignoreConnection),
  route('DELETE', '/api/connections/:member_id', network.removeConnection),
  route('POST', '/api/invitations/withdraw', network.withdrawInvitations),
  route('GET', '/api/blocks', network.listBlocks),
  route('POST', '/api/blocks', network.createBlock),
  route('DELETE', '/api/blocks/:member_id', network.removeBlock),
  route('POST', '/api/follows', network.createFollow),
  route('DELETE', '/api/follows/:target_id', network.removeFollow),
  route(
    'PUT',
    '/api/members/:member_id/skills/:skill/endorsement',
    profiles.addEndorsement,
  ),
  route(
    'DELETE',
    '/api/members/:member_id/skills/:skill/endorsement',
    profiles.removeEndorsement,
  ),

  route('GET', '/api/feed', content.getFeed),
  route('POST', '/api/posts', content.createPost),
  route('GET', '/api/posts/:id', content.getPost),
  route('PATCH', '/api/posts/:id', content.patchPost),
  route('DELETE', '/api/posts/:id', content.deletePost),
  route('PUT', '/api/posts/:id/reaction', content.putReaction),
  route('DELETE', '/api/posts/:id/reaction', content.deleteReaction),
  route('GET', '/api/posts/:id/reactions', content.getReactions),
  route('GET', '/api/posts/:id/comments', content.getComments),
  route('POST', '/api/posts/:id/comments', content.createComment),
  route('DELETE', '/api/comments/:id', content.deleteComment),
  route('POST', '/api/posts/:id/reposts', content.createRepost),
  route('DELETE', '/api/reposts/:id', content.deleteRepost),
  route('GET', '/api/hashtags/:tag', content.getHashtag),

  route('GET', '/api/conversations', messaging.listConversations),
  route('POST', '/api/conversations', messaging.createConversation),
  route('GET', '/api/conversations/:id/messages', messaging.listMessages),
  route('POST', '/api/conversations/:id/messages', messaging.createMessage),
  route('POST', '/api/conversations/:id/read', messaging.markRead),
  route('POST', '/api/conversations/:id/typing', messaging.sendTyping),

  route('GET', '/api/companies/:handle', jobs.getCompany),
  route('PATCH', '/api/companies/:handle', jobs.patchCompany),
  route('GET', '/api/companies/:handle/followers', jobs.getFollowers),
  route('POST', '/api/jobs', jobs.createJob),
  route('GET', '/api/jobs/:id', jobs.getJob),
  route('GET', '/api/jobs/:id/editor', jobs.getJobEditor),
  route('POST', '/api/jobs/:id/editor/typing', jobs.jobEditorTyping),
  route('PATCH', '/api/jobs/:id/fields/:field', jobs.patchJobField),
  route('GET', '/api/jobs/:id/funnel', jobs.getFunnel),
  route('PUT', '/api/jobs/:id/save', jobs.saveJob),
  route('DELETE', '/api/jobs/:id/save', jobs.unsaveJob),
  route('POST', '/api/jobs/:id/applications', jobs.createApplication),
  route('GET', '/api/jobs/:id/applications', jobs.getBoard),
  route('GET', '/api/applications/:id', jobs.getApplication),
  route('POST', '/api/applications/:id/transition', jobs.transitionApplication),
  rawRoute('GET', '/api/applications/:id/resume', jobs.getResume),

  route('GET', '/api/search', misc.search),
  route('GET', '/api/notifications', misc.getNotifications),
  route('POST', '/api/notifications/seen', misc.seenNotifications),
];

function matchRoute(method: string, path: string): { route: Route; params: Record<string, string> } | null {
  const segments = path.split('/').filter(Boolean);
  for (const candidate of ROUTES) {
    if (candidate.method !== method) continue;
    if (candidate.segments.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (const [index, part] of candidate.segments.entries()) {
      if (part.startsWith(':')) params[part.slice(1)] = decodeURIComponent(segments[index]);
      else if (part !== segments[index]) {
        matched = false;
        break;
      }
    }
    if (matched) return { route: candidate, params };
  }
  return null;
}

const PUBLIC_DIR = join(__dirname, '..', 'public');
const STATIC_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
};

function serveStatic(path: string, res: ServerResponse): boolean {
  const relative = normalize(path).replace(/^\/+/, '');
  if (relative.includes('..')) return false;
  const type = STATIC_TYPES[extname(relative)];
  if (!type) return false;
  const allowed =
    relative === 'app.js' || relative === 'app.css' || relative.startsWith('fonts/');
  if (!allowed) return false;
  const file = join(PUBLIC_DIR, relative);
  if (!existsSync(file) || !statSync(file).isFile()) return false;
  res.writeHead(200, {
    'content-type': type,
    'cache-control': 'public, max-age=3600',
    'x-content-type-options': 'nosniff',
  });
  createReadStream(file).pipe(res);
  return true;
}

const MEMBER_PAGES = [
  '/feed',
  '/network',
  '/notifications',
  '/messaging',
  '/settings',
  '/my-jobs',
  '/jobs',
  '/search',
  '/posts/',
  '/hashtag/',
  '/in/',
  '/company/',
];

function isMemberPage(path: string): boolean {
  return MEMBER_PAGES.some((prefix) =>
    prefix.endsWith('/') ? path.startsWith(prefix) : path === prefix || path.startsWith(`${prefix}/`),
  );
}

async function sessionMember(req: IncomingMessage): Promise<string | null> {
  const token = parseCookies(req.headers.cookie)['pw_session'];
  if (!token) return null;
  const rows = await query<{ member_id: string }>(
    'SELECT member_id FROM sessions WHERE token = $1',
    [token],
  );
  return rows[0]?.member_id ?? null;
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname;
  const method = req.method ?? 'GET';

  if (method === 'GET' && serveStatic(path, res)) return;

  const matched = matchRoute(method, path);
  const isApi = path.startsWith('/api/') || path.startsWith('/media/');

  if (!matched && isApi) {
    sendJson(res, 404, { error: 'not_found' });
    return;
  }

  if (!matched) {
    if (method !== 'GET') {
      sendJson(res, 404, { error: 'not_found' });
      return;
    }
    const lastSegment = path.split('/').pop() ?? '';
    if (lastSegment.includes('.')) {
      sendJson(res, 404, { error: 'not_found' });
      return;
    }
    const memberId = await sessionMember(req);
    if (path === '/' && memberId) {
      res.writeHead(302, { location: '/feed' });
      res.end();
      return;
    }
    if (!memberId && isMemberPage(path)) {
      res.writeHead(302, { location: '/signin' });
      res.end();
      return;
    }
    const html = pageShell();
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': String(Buffer.byteLength(html)),
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    });
    res.end(html);
    return;
  }

  const ctx: Ctx = {
    req,
    res,
    method,
    path,
    params: matched.params,
    search: url.searchParams,
    memberId: null,
    body: null,
    rawBody: Buffer.alloc(0),
  };

  try {
    checkOrigin(req);
    if (matched.route.grading) {
      if (!grading.hasGradingKey(ctx)) throw notFound();
    }
    if (!matched.route.upload) {
      ctx.rawBody = await readBody(req, JSON_BODY_LIMIT);
      requireJsonContentType(req);
    }
    if (!matched.route.open && !matched.route.grading) {
      ctx.memberId = await sessionMember(req);
    }
    if (matched.route.raw) {
      await matched.route.raw(ctx);
      return;
    }
    const result = await matched.route.handler(ctx);
    if (result.status === 204) {
      res.writeHead(204);
      res.end();
      return;
    }
    sendJson(res, result.status, result.body);
  } catch (err) {
    if (isApiError(err)) {
      sendJson(res, err.status, err.body);
      return;
    }
    process.stderr.write(`request failed: ${String(err)}\n`);
    sendJson(res, 500, { error: 'server_error' });
  }
}

async function main(): Promise<void> {
  try {
    await waitForDatabase();
  } catch {
    process.stderr.write('database unreachable after 60 seconds\n');
    process.exit(1);
  }
  await applySchema();
  await initClock();
  await seedDemoData();
  startMailWorker();
  startHeartbeat();

  const server = createServer((req, res) => {
    void handle(req, res);
  });
  server.listen(config.port, '0.0.0.0', () => {
    process.stdout.write(`Plainwork listening on ${config.port}\n`);
  });
}

void main();
