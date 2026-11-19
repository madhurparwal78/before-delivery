import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { buildContext } from './context';
import { serveClient } from './client';
import { error, sendJson } from './respond';
import { matchRoute } from './routes';
import { streamEvents } from './routes/events';

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const built = await buildContext(req, res);
  if (!built.ok) {
    sendJson(res, built.response, built.cookies);
    return;
  }
  const context = built.context;
  const pathname = context.url.pathname;
  if (pathname !== '/api' && !pathname.startsWith('/api/')) {
    serveClient(context);
    return;
  }
  if (pathname === '/api/events' && context.method === 'GET') {
    streamEvents(context);
    return;
  }
  const matched = matchRoute(context.method, pathname);
  if (!matched) {
    sendJson(res, error(404, 'not_found'), context.cookies);
    return;
  }
  context.params = matched.params;
  if (matched.route.ownerOnly && !context.ownerSignedIn) {
    sendJson(res, error(401, 'unauthorized'), context.cookies);
    return;
  }
  sendJson(res, await matched.route.handle(context), context.cookies);
}

export function createServer(): Server {
  return createHttpServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) sendJson(res, error(500, 'server_error'));
      else res.end();
    });
  });
}
