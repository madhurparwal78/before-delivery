import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { JSON_BODY_LIMIT_BYTES, config } from './config';
import { connectAndMigrate, one } from './db';
import { ApiError, messages } from './errors';
import {
  checkGradingKey,
  checkOrigin,
  checkRole,
  compile,
  isJsonContentType,
  matchRoute,
  parseJsonBody,
  readBody,
  sendJson,
  sessionUser,
  type Ctx,
  type Reply,
  type Route,
  type UserRow,
  type WorkspaceRow,
} from './http';
import { authRoutes } from './routes/auth';
import { automationRoutes } from './routes/automations';
import { eventRoutes } from './routes/events';
import { gradingRoutes } from './routes/grading';
import { publicRoutes, formFields } from './routes/public';
import { runRoutes } from './routes/runs';
import { workspaceRoutes } from './routes/workspaces';
import { resumeOwnedRuns, startTicking } from './scheduler';
import { seed } from './seed';
import { shellHtml } from './shell';
import { heartbeat } from './sse';
import { findLiveByTrigger } from './triggers';
import type { Role } from '../shared/types';

const routes = compile([
  ...authRoutes,
  ...workspaceRoutes,
  ...automationRoutes,
  ...runRoutes,
  ...eventRoutes,
  ...publicRoutes,
  ...gradingRoutes,
]);

const PUBLIC_DIR = join(__dirname, '..', '..', 'public');

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

async function serveAsset(pathname: string, res: ServerResponse): Promise<boolean> {
  const relative = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  if (!relative.startsWith('/assets/')) return false;
  try {
    const file = await readFile(join(PUBLIC_DIR, relative));
    res.writeHead(200, {
      'content-type': CONTENT_TYPES[extname(relative)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
      'content-length': String(file.length),
    });
    res.end(file);
    return true;
  } catch {
    return false;
  }
}

function sendReply(res: ServerResponse, reply: Reply): void {
  if (reply.handled === true) return;
  const status = reply.status ?? 200;
  if (reply.json !== undefined) {
    sendJson(res, status, reply.json, reply.headers ?? {});
    return;
  }
  if (reply.body !== undefined) {
    const payload = Buffer.isBuffer(reply.body) ? reply.body : Buffer.from(reply.body, 'utf8');
    res.writeHead(status, {
      'content-type': reply.contentType ?? 'text/plain; charset=utf-8',
      'content-length': String(payload.length),
      ...(reply.headers ?? {}),
    });
    res.end(payload);
    return;
  }
  res.writeHead(status, reply.headers ?? {});
  res.end();
}

function sendError(res: ServerResponse, error: unknown): void {
  if (error instanceof ApiError) {
    const headers = { ...(error.extras.headers ?? {}) };
    if (error.status === 413) headers.connection = 'close';
    sendJson(res, error.status, error.body(), headers);
    return;
  }
  process.stderr.write(`unhandled: ${String(error)}\n`);
  sendJson(res, 500, { error: 'Something went wrong' });
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
  const method = (req.method ?? 'GET').toUpperCase();
  if (method === 'GET' && (await serveAsset(url.pathname, res))) return;

  const matched = matchRoute(routes, method, url.pathname);
  if (matched !== null) {
    const { route, params } = matched;
    try {
      await runRoute(route, params, req, res, url);
    } catch (error) {
      sendError(res, error);
    }
    return;
  }

  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/hooks/')) {
    sendJson(res, 404, { error: messages.notFound });
    return;
  }
  if (method !== 'GET' && method !== 'HEAD') {
    sendJson(res, 404, { error: messages.notFound });
    return;
  }
  const html = shellHtml({ form: await formBootstrap(url.pathname) });
  const payload = Buffer.from(html, 'utf8');
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': String(payload.length),
    'cache-control': 'no-store',
  });
  res.end(method === 'HEAD' ? undefined : payload);
}

async function formBootstrap(pathname: string): Promise<unknown> {
  const match = /^\/forms\/([^/]+)\/([^/]+)$/.exec(pathname);
  if (match === null) return null;
  const automation = await findLiveByTrigger(
    decodeURIComponent(match[1]),
    'form',
    decodeURIComponent(match[2]),
  );
  if (automation === null) return null;
  const name = await one<{ name: string }>('select name from automations where id = $1', [automation.id]);
  return {
    name: name === null ? '' : name.name,
    fields: formFields(automation.content),
  };
}

async function runRoute(
  route: Route,
  params: Record<string, string>,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  if (route.skipOriginCheck !== true) checkOrigin(req);
  if (route.auth === 'grading') checkGradingKey(req);
  let user: UserRow | null = null;
  if (route.auth === 'session') {
    user = await sessionUser(req);
    if (user === null) throw new ApiError(401, messages.signInRequired);
  }
  let workspace: WorkspaceRow | null = null;
  let role: Role | null = null;
  if (route.workspace !== undefined) {
    workspace = await one<WorkspaceRow>('select * from workspaces where id = $1', [params[route.workspace]]);
    const membership =
      workspace === null || user === null
        ? null
        : await one<{ role: Role }>('select role from members where workspace_id = $1 and user_id = $2', [
            workspace.id,
            user.id,
          ]);
    if (workspace === null || membership === null) throw new ApiError(404, messages.notFound);
    role = membership.role;
    if (route.minimumRole !== undefined) checkRole(role, route.minimumRole);
  }
  let raw = Buffer.alloc(0);
  let body = {};
  if (route.body === 'json' || route.body === 'raw') {
    raw = await readBody(req, route.bodyLimit ?? JSON_BODY_LIMIT_BYTES);
    if (route.body === 'raw') {
      if (!isJsonContentType(req)) throw new ApiError(415, messages.contentTypeJson);
    } else if (raw.length > 0 && !isJsonContentType(req)) {
      throw new ApiError(415, messages.contentTypeJson);
    } else {
      body = parseJsonBody(raw);
    }
  }
  const ctx: Ctx = {
    req,
    res,
    url,
    params,
    body,
    raw,
    user: user as UserRow,
    workspace: workspace as WorkspaceRow,
    role: role as Role,
    setCookie: () => undefined,
  };
  sendReply(res, await route.handler(ctx));
}

async function main(): Promise<void> {
  await connectAndMigrate();
  await seed();
  const server = createServer((req, res) => {
    void handle(req, res).catch((error: unknown) => sendError(res, error));
  });
  server.listen(config.port, '0.0.0.0', () => {
    process.stdout.write(`Pinbyte Switchyard listening on ${config.port}\n`);
  });
  setInterval(heartbeat, 15_000).unref();
  startTicking();
  await resumeOwnedRuns();
}

void main();
