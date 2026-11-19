import type { IncomingMessage, ServerResponse } from 'node:http';
import { AppError, bodyText, sendError, sendJson } from '../errors.js';
import type { User } from '../types.js';
import { currentUser } from './auth.js';

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  method: string;
  user: User | null;
  body<T>(): T;
}

export type Handler = (ctx: Ctx) => Promise<void>;

export class Router {
  private routes: { method: string; pattern: RegExp; keys: string[]; handler: Handler }[] = [];

  add(method: string, path: string, handler: Handler): void {
    const keys: string[] = [];
    const source = path.replace(/:([A-Za-z]+)/g, (_, key) => {
      keys.push(key);
      return '([^/]+)';
    });
    this.routes.push({ method, pattern: new RegExp(`^${source}$`), keys, handler });
  }

  async dispatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const method = req.method === 'HEAD' ? 'GET' : req.method ?? 'GET';
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const match = route.pattern.exec(url.pathname);
      if (!match) continue;
      const user = await currentUser(req).catch(() => null);
      const ctx: Ctx = {
        req,
        res,
        url,
        method,
        user,
        body: <T,>(): T => JSON.parse(bodyText(req) || 'null') as T
      };
      for (let i = 0; i < route.keys.length; i++) {
        (url as unknown as Record<string, string>)[`param_${route.keys[i]}`] = match[i + 1];
      }
      try {
        await route.handler(ctx);
      } catch (err) {
        if (err instanceof AppError) {
          sendError(res, err);
          return;
        }
        console.error('[api] unhandled', err);
        if (!res.headersSent) {
          sendJson(res, 500, { error: { code: 'internal_error', message: 'Something went wrong.' } });
        }
      }
      return;
    }
    sendError(res, AppError.notFound());
  }
}

export function pathParam(ctx: Ctx, key: string): string {
  return (ctx.url as unknown as Record<string, string>)[`param_${key}`] ?? '';
}

export function idem(ctx: Ctx): string {
  const key = ctx.req.headers['idempotency-key'];
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(key)) {
    throw AppError.validation({ 'Idempotency-Key': 'Send an idempotency key of 1 to 128 letters, digits, - or _.' });
  }
  return key;
}
