import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { config } from '../config.ts';
import { ApiError, forbidden, tooLarge, validation } from './errors.ts';

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Readonly<Record<string, string>>;
  cookies: Readonly<Record<string, string>>;
  body: () => Promise<Record<string, unknown>>;
  rawBody: () => Promise<Buffer>;
}

export type Handler = (ctx: Ctx) => Promise<void>;

interface Route {
  method: string;
  segments: readonly string[];
  handler: Handler;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const parseCookies = (header: string | undefined): Record<string, string> => {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    if (name !== '') out[name] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
};

export const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': payload.byteLength,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(payload);
};

export const sendBytes = (
  res: ServerResponse,
  status: number,
  contentType: string,
  bytes: Buffer,
  headers: Record<string, string> = {},
): void => {
  res.writeHead(status, {
    'content-type': contentType,
    'content-length': bytes.byteLength,
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  res.end(bytes);
};

export const sendEmpty = (res: ServerResponse, status: number): void => {
  res.writeHead(status, { 'cache-control': 'no-store' });
  res.end();
};

export const redirect = (res: ServerResponse, location: string): void => {
  res.writeHead(302, { location, 'cache-control': 'no-store' });
  res.end();
};

const MULTIPART_MARGIN = 1000000;

const readRaw = async (
  req: IncomingMessage,
  limit: number,
  reportLimit: number,
): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.byteLength;
    if (size > limit) throw tooLarge(reportLimit);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
};

export interface BodyLimits {
  json: number;
  upload: number;
}

export class HttpApp {
  private readonly routes: Route[] = [];
  private readonly limits: BodyLimits;
  private fallback: Handler | null = null;

  constructor(limits: BodyLimits) {
    this.limits = limits;
  }

  on(method: string, pattern: string, handler: Handler): this {
    this.routes.push({
      method,
      segments: pattern.split('/').filter((segment) => segment !== ''),
      handler,
    });
    return this;
  }

  otherwise(handler: Handler): this {
    this.fallback = handler;
    return this;
  }

  private match(method: string, pathname: string): { route: Route; params: Record<string, string> } | null {
    const parts = pathname.split('/').filter((segment) => segment !== '');
    for (const route of this.routes) {
      if (route.method !== method) continue;
      if (route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (let index = 0; index < route.segments.length; index += 1) {
        const expected = route.segments[index] ?? '';
        const actual = parts[index] ?? '';
        if (expected.startsWith(':')) {
          params[expected.slice(1)] = decodeURIComponent(actual);
          continue;
        }
        if (expected !== actual) {
          matched = false;
          break;
        }
      }
      if (matched) return { route, params };
    }
    return null;
  }

  listen(port: number): void {
    const server = createServer((req, res) => {
      void this.handle(req, res);
    });
    server.keepAliveTimeout = 65000;
    server.headersTimeout = 70000;
    server.listen(port, '0.0.0.0');
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method ?? 'GET';
    const url = new URL(req.url ?? '/', config.appPublicUrl);
    const multipart = (req.headers['content-type'] ?? '').includes('multipart/form-data');
    const reportLimit = multipart ? this.limits.upload : this.limits.json;
    // A multipart body carries boundaries around the file part, so the raw cap
    // leaves room for them while the reported limit stays the file-part limit.
    const bodyLimit = multipart ? this.limits.upload + MULTIPART_MARGIN : this.limits.json;
    let cached: Buffer | null = null;
    const rawBody = async (): Promise<Buffer> => {
      if (cached === null) cached = await readRaw(req, bodyLimit, reportLimit);
      return cached;
    };
    const ctx: Ctx = {
      req,
      res,
      url,
      params: {},
      cookies: parseCookies(req.headers.cookie),
      rawBody,
      body: async (): Promise<Record<string, unknown>> => {
        const raw = await rawBody();
        if (raw.byteLength === 0) return {};
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw.toString('utf8'));
        } catch {
          throw validation({});
        }
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw validation({});
        }
        return { ...parsed };
      },
    };

    try {
      const declared = Number.parseInt(String(req.headers['content-length'] ?? '0'), 10);
      if (Number.isFinite(declared) && declared > bodyLimit) throw tooLarge(reportLimit);
      if (!SAFE_METHODS.has(method)) {
        const origin = req.headers.origin;
        if (typeof origin === 'string' && origin !== '' && origin !== 'null') {
          const allowed = new Set([new URL(config.appPublicUrl).origin]);
          const host = req.headers.host;
          if (typeof host === 'string') {
            allowed.add(`http://${host}`);
            allowed.add(`https://${host}`);
          }
          if (!allowed.has(origin)) throw forbidden();
        }
      }
      const found = this.match(method === 'HEAD' ? 'GET' : method, url.pathname);
      if (found) {
        await found.route.handler({ ...ctx, params: found.params });
        return;
      }
      if (this.fallback) {
        await this.fallback(ctx);
        return;
      }
      sendJson(res, 404, { error: 'not_found' });
    } catch (error) {
      if (!(error instanceof ApiError)) {
        process.stderr.write(`${method} ${url.pathname} failed: ${String(error)}\n`);
      }
      if (res.headersSent) {
        res.end();
        return;
      }
      if (error instanceof ApiError) {
        sendJson(res, error.status, error.body);
        return;
      }
      sendJson(res, 500, { error: 'internal' });
    }
  }
}
