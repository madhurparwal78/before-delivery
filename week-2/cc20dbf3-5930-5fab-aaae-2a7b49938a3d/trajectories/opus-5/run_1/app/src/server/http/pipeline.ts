import type { IncomingMessage, ServerResponse } from 'node:http';
import { FIELD_COPY } from '../../shared/errors.js';
import { JSON_BODY_LIMIT, PHOTO_BODY_LIMIT } from '../config.js';
import type { Database } from '../db/pool.js';
import { verifyPayload } from '../core/signing.js';
import { BillingUnavailable } from '../services/billing.js';
import { PhotoStorageUnavailable } from '../services/objectStore.js';
import { ApiError, fail, failBillingLending, failValidation } from './apiError.js';
import { AssetServer } from './assets.js';
import {
  isStateChange,
  originMatches,
  readCookie,
  type Caller,
  type HandlerResult,
  type SessionContext,
} from './context.js';
import { claimKey, releaseKey, requestHash, storeSuccess } from './idempotency.js';
import { parseMultipart, type MultipartFile } from './multipart.js';
import { matchRoute, type Route, type SessionRoute } from './routes.js';

export const SESSION_COOKIE = 'shedline_session';

interface BodyRead {
  readonly bytes: Buffer;
  readonly tooLarge: boolean;
}

/**
 * Reads at most `limit` bytes. A larger body is never buffered in full; the rest is
 * drained so the answer can still be written on the same connection.
 */
function readBody(request: IncomingMessage, limit: number): Promise<BodyRead> {
  const declared = Number(request.headers['content-length'] ?? '0');
  if (Number.isFinite(declared) && declared > limit) {
    request.resume();
    return Promise.resolve({ bytes: Buffer.alloc(0), tooLarge: true });
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    request.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > limit) {
        if (settled) return;
        settled = true;
        chunks.length = 0;
        resolve({ bytes: Buffer.alloc(0), tooLarge: true });
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (settled) return;
      settled = true;
      resolve({ bytes: Buffer.concat(chunks), tooLarge: false });
    });
    request.on('error', (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

function hasContentType(request: IncomingMessage, expected: string): boolean {
  const header = request.headers['content-type'];
  if (header === undefined) return false;
  return header.split(';')[0]?.trim().toLowerCase() === expected;
}

export interface PipelineDependencies {
  readonly pool: Database;
  readonly secret: Buffer;
  readonly routes: readonly Route[];
  readonly assets: AssetServer;
}

export class Pipeline {
  private readonly dependencies: PipelineDependencies;

  constructor(dependencies: PipelineDependencies) {
    this.dependencies = dependencies;
  }

  async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const method = request.method ?? 'GET';
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

    if (isStateChange(method) && !originMatches(request)) {
      this.writeError(response, fail('cross_origin'));
      return;
    }

    if (!url.pathname.startsWith('/api/')) {
      await this.serveAsset(url.pathname, response);
      return;
    }

    const match = matchRoute(this.dependencies.routes, method, url.pathname);
    if (match === null) {
      this.writeError(response, fail('not_found'));
      return;
    }

    try {
      const result =
        match.route.auth === 'anyone'
          ? await this.runPublic(match.route, request, url, match.params)
          : await this.runSession(match.route, request, url, match.params);
      this.writeResult(response, result);
    } catch (error) {
      this.writeError(response, toApiError(error));
    }
  }

  private async runPublic(
    route: Extract<Route, { auth: 'anyone' }>,
    request: IncomingMessage,
    url: URL,
    params: Record<string, string>,
  ): Promise<HandlerResult> {
    let json: Record<string, unknown> = {};
    if (route.body === 'json') {
      if (!hasContentType(request, 'application/json')) throw fail('unsupported_media_type');
      const body = await readBody(request, JSON_BODY_LIMIT);
      if (body.tooLarge) throw fail('body_too_large');
      json = parseJson(body.bytes);
    }
    return route.handle({
      method: route.method,
      path: url.pathname,
      params,
      query: url.searchParams,
      now: new Date(),
      json,
    });
  }

  private async runSession(
    route: SessionRoute,
    request: IncomingMessage,
    url: URL,
    params: Record<string, string>,
  ): Promise<HandlerResult> {
    const caller = await this.loadCaller(request);
    if (caller === null) throw fail('unauthenticated');
    const now = new Date();

    const bodyLimit = route.body === 'multipart' ? PHOTO_BODY_LIMIT : JSON_BODY_LIMIT;
    const body = route.body === 'none' ? { bytes: Buffer.alloc(0), tooLarge: false } : await readBody(request, bodyLimit);

    const headerKey = request.headers['idempotency-key'];
    const rawKey = typeof headerKey === 'string' ? headerKey : null;
    const usableKey = rawKey !== null && rawKey.length >= 1 && rawKey.length <= 100 ? rawKey : null;

    let claimed = false;
    if (route.keyed && usableKey !== null) {
      const hash = requestHash(route.method, url.pathname, body.bytes);
      const stored = await claimKey(this.dependencies.pool, caller.id, usableKey, hash);
      if (stored !== null) {
        return { kind: 'json', status: stored.status, value: JSON.parse(stored.body) as unknown };
      }
      claimed = true;
    }

    try {
      const resolveContext = {
        method: route.method,
        path: url.pathname,
        params,
        query: url.searchParams,
        now,
        caller,
      };
      const resolved = route.resolve === null ? undefined : await route.resolve(resolveContext);

      if (route.roles !== null && !route.roles.includes(caller.role)) throw fail('forbidden');

      let json: Record<string, unknown> = {};
      let files: MultipartFile[] = [];
      if (route.body === 'json') {
        if (!hasContentType(request, 'application/json')) throw fail('unsupported_media_type');
        if (body.tooLarge) throw fail('body_too_large');
        json = parseJson(body.bytes);
      } else if (route.body === 'multipart') {
        if (!hasContentType(request, 'multipart/form-data')) throw fail('unsupported_media_type');
        if (body.tooLarge) throw fail('body_too_large');
        files = parseMultipart(request.headers['content-type'] ?? '', body.bytes);
      }

      if (route.keyed && usableKey === null) {
        throw failValidation({ idempotency_key: FIELD_COPY.idempotency_key });
      }

      const context: SessionContext = {
        ...resolveContext,
        json,
        files,
        rawBody: body.bytes,
        idempotencyKey: usableKey,
      };
      const result = await route.handle(context, resolved);
      if (claimed && usableKey !== null && result.kind === 'json') {
        await storeSuccess(
          this.dependencies.pool,
          caller.id,
          usableKey,
          result.status,
          JSON.stringify(result.value),
        );
      }
      return result;
    } catch (error) {
      if (claimed && usableKey !== null) {
        await releaseKey(this.dependencies.pool, caller.id, usableKey);
      }
      throw error;
    }
  }

  private async loadCaller(request: IncomingMessage): Promise<Caller | null> {
    const token = readCookie(request, SESSION_COOKIE);
    if (token === null) return null;
    const sessionId = verifyPayload(this.dependencies.secret, token);
    if (sessionId === null) return null;
    const result = await this.dependencies.pool.query<{
      id: string;
      name: string;
      role: string;
      email: string;
    }>(
      `select person.id, person.name, person.role, person.email
       from web_session join person on person.id = web_session.person_id
       where web_session.id = $1`,
      [sessionId],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    return {
      id: row.id,
      name: row.name,
      role: row.role as Caller['role'],
      email: row.email,
      sessionId,
    };
  }

  private async serveAsset(pathname: string, response: ServerResponse): Promise<void> {
    const asset = await this.dependencies.assets.resolve(pathname);
    if (asset === null) {
      this.writeError(response, fail('not_found'));
      return;
    }
    response.writeHead(200, {
      'content-type': asset.contentType,
      'x-content-type-options': 'nosniff',
      'cache-control': asset.immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    response.end(asset.bytes);
  }

  private writeResult(response: ServerResponse, result: HandlerResult): void {
    const headers: Record<string, string> = { 'x-content-type-options': 'nosniff' };
    if (result.kind !== 'bytes' && result.cookie !== undefined) headers['set-cookie'] = result.cookie;
    if (result.kind === 'json') {
      headers['content-type'] = 'application/json; charset=utf-8';
      response.writeHead(result.status, headers);
      response.end(JSON.stringify(result.value));
      return;
    }
    if (result.kind === 'bytes') {
      response.writeHead(result.status, { ...headers, ...result.headers });
      response.end(result.bytes);
      return;
    }
    response.writeHead(result.status, headers);
    response.end();
  }

  private writeError(response: ServerResponse, error: ApiError): void {
    response.writeHead(error.status, {
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
    });
    response.end(JSON.stringify(error.body()));
  }
}

/** Service outages and unexpected failures still answer in the published shape. */
function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof PhotoStorageUnavailable) return fail('photo_storage_unavailable');
  if (error instanceof BillingUnavailable) return failBillingLending();
  process.stderr.write(`request failed: ${error instanceof Error ? error.stack : String(error)}\n`);
  return fail('not_found');
}

function parseJson(bytes: Buffer): Record<string, unknown> {
  if (bytes.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw failValidation({ body: FIELD_COPY.required });
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw failValidation({ body: FIELD_COPY.required });
  }
  return parsed as Record<string, unknown>;
}
