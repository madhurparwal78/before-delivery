import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { ApiError } from '../shared/errors.ts';
import { assertSameOrigin, decodeSegment, parseCookies, serialize } from './http.ts';

interface UpgradeCtx {
  req: IncomingMessage;
  socket: Duplex;
  head: Buffer;
  params: Record<string, string>;
  query: URLSearchParams;
  cookies: Record<string, string>;
}

interface UpgradeRoute {
  names: string[];
  pattern: RegExp;
  handle: (ctx: UpgradeCtx) => Promise<void>;
}

const upgrades: UpgradeRoute[] = [];
const sockets = new WebSocketServer({ noServer: true });

export function upgradeRoute(template: string, handle: (ctx: UpgradeCtx) => Promise<void>): void {
  const names: string[] = [];
  const source = template.replace(/:([a-z_]+)/g, (_all, name: string) => {
    names.push(name);
    return '([^/]+)';
  });
  upgrades.push({ names, pattern: new RegExp(`^${source}$`), handle });
}

/** Answer a refused upgrade with the one error body and close the connection. */
function rejectUpgrade(socket: Duplex, error: ApiError): void {
  socket.write(serialize({ status: error.status, body: error.body(), headers: error.headers }));
  socket.destroy();
}

/** Complete the WebSocket handshake for a request an upgrade route accepted. */
export function acceptUpgrade(ctx: UpgradeCtx): Promise<WebSocket> {
  return new Promise((resolve) => {
    sockets.handleUpgrade(ctx.req, ctx.socket, ctx.head, (ws) => resolve(ws));
  });
}

export async function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  try {
    if (req.headers.origin !== undefined) {
      assertSameOrigin('UPGRADE', req.headers.origin, req.headers.host);
    }
    for (const candidate of upgrades) {
      const found = candidate.pattern.exec(url.pathname);
      if (!found) continue;
      const params: Record<string, string> = {};
      candidate.names.forEach((name, at) => {
        params[name] = decodeSegment(found[at + 1] ?? '');
      });
      await candidate.handle({ req, socket, head, params, query: url.searchParams, cookies: parseCookies(req.headers.cookie) });
      return;
    }
    throw new ApiError('not_found', 'Not found.');
  } catch (error) {
    rejectUpgrade(socket, error instanceof ApiError ? error : new ApiError('not_found', 'Not found.'));
  }
}
