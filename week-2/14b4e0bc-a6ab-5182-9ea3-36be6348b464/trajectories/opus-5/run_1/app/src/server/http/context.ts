import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Role } from '../../shared/domain.ts';
import { type Actor, SESSION_COOKIE, actorForToken, hashToken, parseCookies } from '../auth.ts';
import { pool } from '../db.ts';
import { type Capability, allows } from '../domain/roles.ts';
import {
  type JsonObject,
  type MultipartBody,
  JSON_BODY_LIMIT,
  MULTIPART_BODY_LIMIT,
  parseJsonBody,
  parseMultipart,
  readBody,
} from './body.ts';
import { errors } from './errors.ts';

export interface Reply {
  status: number;
  json?: unknown;
  headers?: Record<string, string>;
  body?: Buffer;
  cookie?: string;
}

export class Ctx {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly method: string;
  readonly url: URL;
  readonly params: Record<string, string>;
  readonly rawBody: Buffer;
  private resolvedActor: Actor | null | undefined;

  constructor(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    params: Record<string, string>,
    rawBody: Buffer,
  ) {
    this.request = request;
    this.response = response;
    this.method = (request.method ?? 'GET').toUpperCase();
    this.url = url;
    this.params = params;
    this.rawBody = rawBody;
  }

  header(name: string): string | undefined {
    const value = this.request.headers[name];
    return Array.isArray(value) ? value[0] : value;
  }

  queryParam(name: string): string | null {
    return this.url.searchParams.get(name);
  }

  json(): JsonObject {
    return parseJsonBody(this.rawBody);
  }

  multipart(): MultipartBody {
    return parseMultipart(this.rawBody, this.header('content-type') ?? '');
  }

  sessionToken(): string | null {
    return parseCookies(this.header('cookie')).get(SESSION_COOKIE) ?? null;
  }

  async actor(): Promise<Actor | null> {
    if (this.resolvedActor === undefined) {
      const token = this.sessionToken();
      this.resolvedActor = token === null ? null : await actorForToken(pool, hashToken(token));
    }
    return this.resolvedActor;
  }

  async requireActor(): Promise<Actor> {
    const actor = await this.actor();
    if (actor === null) throw errors.unauthenticated();
    return actor;
  }

  async requireCapability(capability: Capability): Promise<Actor> {
    const actor = await this.requireActor();
    if (!allows(actor.role, capability)) throw errors.forbidden();
    return actor;
  }

  async requireRoles(roles: readonly Role[]): Promise<Actor> {
    const actor = await this.requireActor();
    if (!roles.includes(actor.role)) throw errors.forbidden();
    return actor;
  }
}

export async function readRequestBody(request: IncomingMessage): Promise<Buffer> {
  const method = (request.method ?? 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD') return Buffer.alloc(0);
  const contentType = request.headers['content-type'] ?? '';
  const limit = contentType.includes('multipart/form-data') ? MULTIPART_BODY_LIMIT : JSON_BODY_LIMIT;
  return readBody(request, limit);
}
