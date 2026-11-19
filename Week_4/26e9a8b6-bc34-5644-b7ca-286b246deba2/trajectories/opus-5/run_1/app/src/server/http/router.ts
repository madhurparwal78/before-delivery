import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError, bodyTooLarge, methodNotAllowed, tooDeep, unsupportedMediaType } from './errors.js';
import { jsonDepth } from '../../shared/glb.js';

export const JSON_BODY_LIMIT = 1_000_000;
export const JSON_MAX_DEPTH = 32;

export type BodyKind = 'json' | 'bytes' | 'none';

export interface Exchange {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  method: string;
  params: Readonly<Record<string, string>>;
  /** Raw request bytes, read once by the router for the route's body kind. */
  raw: Buffer;
  json: <T>() => T;
  isEmbed: boolean;
}

export interface Route {
  method: string;
  /** Pattern segments, `:name` capturing one segment. */
  path: string;
  body: BodyKind;
  handle: (exchange: Exchange) => Promise<void> | void;
}

interface CompiledRoute extends Route {
  segments: string[];
}

function compile(route: Route): CompiledRoute {
  return { ...route, segments: route.path.split('/').filter((s) => s.length > 0) };
}

function matchSegments(
  pattern: readonly string[],
  actual: readonly string[],
): Record<string, string> | null {
  if (pattern.length !== actual.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i += 1) {
    const expected = pattern[i] ?? '';
    const given = actual[i] ?? '';
    if (expected.startsWith(':')) {
      if (given.length === 0) return null;
      params[expected.slice(1)] = decodeURIComponent(given);
    } else if (expected !== given) return null;
  }
  return params;
}

/** Reads the whole request, draining an over-long body so the reply still lands. */
async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  let overLimit = false;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.byteLength;
    if (size > limit) {
      overLimit = true;
      chunks.length = 0;
      continue;
    }
    chunks.push(buffer);
  }
  if (overLimit) throw bodyTooLarge(JSON_BODY_LIMIT);
  return Buffer.concat(chunks);
}

function mimeOf(header: string | undefined): string {
  return (header ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

const UPLOAD_MIMES = new Set(['model/gltf-binary', 'application/octet-stream']);

export class Router {
  private readonly routes: CompiledRoute[] = [];

  add(route: Route): void {
    this.routes.push(compile(route));
  }

  addAll(routes: readonly Route[]): void {
    for (const route of routes) this.add(route);
  }

  /** Resolves a request to its route, applying the route checks in order. */
  resolve(method: string, pathname: string): { route: CompiledRoute; params: Record<string, string> } {
    const actual = pathname.split('/').filter((s) => s.length > 0);
    const allow = new Set<string>();
    let pathMatched = false;
    for (const route of this.routes) {
      const params = matchSegments(route.segments, actual);
      if (params === null) continue;
      pathMatched = true;
      allow.add(route.method);
      if (route.method === method) return { route, params };
      if (route.method === 'GET' && method === 'HEAD') return { route, params };
    }
    if (!pathMatched) throw new ApiError(404, { error: 'not_found' });
    allow.add('HEAD');
    allow.add('OPTIONS');
    throw methodNotAllowed([...allow].sort());
  }

  async run(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    modelMaxBytes: number,
  ): Promise<void> {
    const method = req.method ?? 'GET';
    const { route, params } = this.resolve(method, url.pathname);
    const mime = mimeOf(req.headers['content-type']);

    let raw: Buffer = Buffer.alloc(0);
    if (route.body === 'json') {
      if (mime.length > 0 && mime !== 'application/json') throw unsupportedMediaType();
      raw = await readBody(req, JSON_BODY_LIMIT);
    } else if (route.body === 'bytes') {
      if (!UPLOAD_MIMES.has(mime)) throw unsupportedMediaType();
      raw = await readBody(req, modelMaxBytes + 1_048_576);
    } else {
      req.resume();
    }

    const exchange: Exchange = {
      req,
      res,
      url,
      method,
      params,
      raw,
      isEmbed: url.pathname === '/embed' || url.pathname.startsWith('/embed/'),
      json: <T>(): T => {
        if (raw.byteLength === 0) return {} as T;
        const text = raw.toString('utf8');
        if (jsonDepth(text) > JSON_MAX_DEPTH) throw tooDeep();
        try {
          return JSON.parse(text) as T;
        } catch {
          throw new ApiError(422, { error: 'invalid', field: 'body' });
        }
      },
    };
    await route.handle(exchange);
  }
}
