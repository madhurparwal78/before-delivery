import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { handleApi } from './api.js';
import { config } from './config.js';
import { applySchema } from './db.js';
import { handleUpgrade, startPresenceLoop } from './live.js';
import { layoutObject } from './layouts.js';
import {
  editorPage,
  libraryPage,
  notAvailablePage,
  signInPage,
  signUpPage,
  viewPage,
} from './pages.js';
import {
  addCollaborator,
  designerBySession,
  layoutByLink,
  layoutById,
  listLibrary,
  roleFor,
} from './store.js';
import {
  readBody,
  readCookie,
  redirect,
  sendHtml,
  sendJson,
  SESSION_COOKIE,
  type RequestContext,
} from './http.js';
import { valkeyAnswers } from './valkey.js';

const clientDirectory = join(__dirname, '..', 'client');

const ASSETS: Record<string, { file: string; type: string }> = {
  '/assets/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
  '/assets/styles.css': { file: 'styles.css', type: 'text/css; charset=utf-8' },
};

function safeNext(value: string | null): string | null {
  if (!value) return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  return value;
}

async function servePage(context: RequestContext, response: ServerResponse): Promise<void> {
  const { path, segments, session } = context;

  if (path === '/signup') {
    sendHtml(response, 200, signUpPage(safeNext(context.url.searchParams.get('next'))));
    return;
  }
  if (path === '/signin') {
    sendHtml(response, 200, signInPage(safeNext(context.url.searchParams.get('next'))));
    return;
  }

  if (path === '/') {
    if (!session) {
      redirect(response, `/signin?next=${encodeURIComponent('/')}`);
      return;
    }
    const entries = await listLibrary(session.id);
    sendHtml(
      response,
      200,
      libraryPage(entries.map((entry) => ({ id: entry.id, name: entry.name, columns: entry.state.columns }))),
    );
    return;
  }

  if (segments[0] === 'layouts' && segments.length === 2) {
    if (!session) {
      redirect(response, `/signin?next=${encodeURIComponent(path)}`);
      return;
    }
    const layout = await layoutById(segments[1] as string);
    const role = layout ? await roleFor(layout, session.id) : null;
    if (!layout || !role) {
      sendHtml(response, 200, notAvailablePage(true));
      return;
    }
    sendHtml(response, 200, editorPage(layoutObject(layout, role, await valkeyAnswers()), session.username));
    return;
  }

  if (segments[0] === 'join' && segments.length === 2) {
    if (!session) {
      redirect(response, `/signin?next=${encodeURIComponent(path)}`);
      return;
    }
    const layout = await layoutByLink(segments[1] as string, 'join');
    if (!layout) {
      sendHtml(response, 200, notAvailablePage(true));
      return;
    }
    if (layout.owner_id !== session.id) await addCollaborator(layout.id, session.id);
    redirect(response, `/layouts/${layout.id}`);
    return;
  }

  if (segments[0] === 'view' && segments.length === 2) {
    const token = segments[1] as string;
    const layout = await layoutByLink(token, 'view');
    if (!layout) {
      sendHtml(response, 200, notAvailablePage(Boolean(session)));
      return;
    }
    sendHtml(response, 200, viewPage(layoutObject(layout, 'viewer', await valkeyAnswers()), token));
    return;
  }

  sendHtml(response, 404, notAvailablePage(Boolean(session)));
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const path = url.pathname;
  const method = request.method ?? 'GET';

  const asset = ASSETS[path];
  if (asset && method === 'GET') {
    try {
      const body = await readFile(join(clientDirectory, asset.file));
      response.writeHead(200, {
        'content-type': asset.type,
        'content-length': String(body.length),
        'cache-control': 'no-store',
      });
      response.end(body);
    } catch {
      sendJson(response, 404, { error: 'not_found' });
    }
    return;
  }

  const read = await readBody(request);
  if (!read.ok) {
    sendJson(response, 413, { error: 'too_large' });
    return;
  }

  const token = readCookie(request, SESSION_COOKIE);
  const session = token ? await designerBySession(token) : null;
  const context: RequestContext = {
    method,
    url,
    path,
    segments: path.split('/').filter((part) => part.length > 0),
    body: read.body,
    bodyInvalid: read.invalid,
    session,
    sessionToken: token,
    headers: request.headers,
  };

  if (path.startsWith('/api/')) {
    const reply = await handleApi(context);
    sendJson(response, reply.status, reply.body, reply.cookie);
    return;
  }

  await servePage(context, response);
}

const server = createServer((request, response) => {
  handle(request, response).catch(() => {
    if (!response.headersSent) sendJson(response, 500, { error: 'server_error' });
    else response.end();
  });
});

server.on('upgrade', (request, socket, head) => {
  handleUpgrade(request, socket, head).catch(() => socket.destroy());
});

server.listen(config.port, '0.0.0.0');
startPresenceLoop();
void applySchema();
