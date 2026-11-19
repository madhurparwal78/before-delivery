import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError, errors } from './errors.js';

export interface RequestCtx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  user: { id: string; email: string; display_name: string } | null;
  setId: () => void;
}

export type Handler = (ctx: RequestCtx) => Promise<void> | void;

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: Handler;
}

const JSON_LIMIT = 1_000_000;

export class Router {
  private routes: Route[] = [];

  add (method: string, path: string, handler: Handler): this {
    const paramNames: string[] = [];
    const source = path.split('/').map((segment) => {
      if (segment.startsWith(':')) {
        paramNames.push(segment.slice(1));
        return '([^/]+)';
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('/');
    this.routes.push({ method, pattern: new RegExp(`^${source}$`), paramNames, handler });
    return this;
  }

  async dispatch (req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://local');
    for (const route of this.routes) {
      if (route.method !== req.method) continue;
      const match = route.pattern.exec(url.pathname);
      if (match === null) continue;
      const params: Record<string, string> = {};
      route.paramNames.forEach((name, index) => { params[name] = decodeURIComponent(match[index + 1]); });
      try {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          checkSameOrigin(req);
          checkContentType(req);
        }
        await route.handler({ req, res, url, params, user: null, setId: () => {} });
        return;
      } catch (error) {
        if (error instanceof ApiError) {
          sendJsonError(res, error);
          return;
        }
        console.error('Unhandled error', error);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        }
        res.end(JSON.stringify({ error: { code: 'internal', message: 'Something went wrong' } }));
        return;
      }
    }
    sendJsonError(res, errors.notFound());
  }
}

function checkSameOrigin (req: IncomingMessage): void {
  const origin = req.headers.origin;
  if (origin === undefined) return;
  const host = req.headers.host ?? '';
  try {
    if (new URL(origin).host !== host) {
      throw errors.forbiddenOrigin();
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw errors.forbiddenOrigin();
  }
}

function checkContentType (req: IncomingMessage): void {
  const contentType = req.headers['content-type'] ?? '';
  const base = contentType.split(';')[0].trim().toLowerCase();
  if (base === '' || base === 'application/json') return;
  // Multipart endpoints check their own content type before parsing.
  if (base === 'multipart/form-data') return;
  throw errors.unsupportedMediaType(contentType);
}

export function sendJsonError (res: ServerResponse, error: ApiError): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(error.status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: { code: error.code, message: error.message, ...(error.fields !== undefined ? { fields: error.fields } : {}), ...(error.extra ?? {}) } }));
}

export { JSON_LIMIT };
