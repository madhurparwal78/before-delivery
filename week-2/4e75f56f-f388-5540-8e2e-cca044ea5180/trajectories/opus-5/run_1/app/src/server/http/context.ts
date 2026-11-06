import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Account, Role } from '../db/accounts.js';
import { malformedJson, unsupportedMediaType, validation, type ApiError } from './errors.js';
import { boundaryOf, parseMultipart, type MultipartBody } from './multipart.js';

export const JSON_BODY_LIMIT = 65_536;
export const MULTIPART_BODY_LIMIT = 10_100_000;
export const FILE_LIMIT = 10_000_000;

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export interface JsonResponse {
  readonly status: number;
  readonly body: unknown;
  readonly cookies?: readonly string[];
}

export type Access = 'anonymous' | readonly Role[];

export interface Route {
  readonly method: string;
  readonly pattern: string;
  readonly access: Access;
  readonly idempotent?: boolean;
  readonly handler: (ctx: Ctx) => Promise<JsonResponse>;
}

export class Ctx {
  readonly params: Record<string, string>;
  readonly query: URLSearchParams;
  readonly rawBody: Buffer;
  readonly account: Account | null;
  readonly endpointKey: string;
  readonly idempotencyHeader: string | null;
  readonly sessionToken: string | null;
  private idempotencyConflicting = false;
  private readonly contentType: string;

  constructor(input: {
    req: IncomingMessage;
    params: Record<string, string>;
    query: URLSearchParams;
    rawBody: Buffer;
    account: Account | null;
    endpointKey: string;
    sessionToken: string | null;
  }) {
    this.params = input.params;
    this.query = input.query;
    this.rawBody = input.rawBody;
    this.account = input.account;
    this.endpointKey = input.endpointKey;
    this.sessionToken = input.sessionToken;
    this.contentType = (input.req.headers['content-type'] ?? '').toString();
    const header = input.req.headers['idempotency-key'];
    this.idempotencyHeader = typeof header === 'string' ? header : null;
  }

  param(name: string): string {
    const value = this.params[name];
    if (value === undefined) throw new Error(`route parameter ${name} is not declared`);
    return value;
  }

  signedIn(): Account {
    if (this.account === null) throw new Error('route access should have required a session');
    return this.account;
  }

  bodyHash(): string {
    return createHash('sha256').update(this.rawBody).digest('hex');
  }

  json(): Record<string, unknown> {
    if (this.rawBody.byteLength === 0) return {};
    const base = this.contentType.split(';')[0]?.trim().toLowerCase() ?? '';
    if (base !== '' && base !== 'application/json') throw unsupportedMediaType();
    let parsed: unknown;
    try {
      parsed = JSON.parse(this.rawBody.toString('utf8'));
    } catch {
      throw malformedJson();
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw malformedJson();
    }
    return parsed as Record<string, unknown>;
  }

  multipart(): MultipartBody {
    const base = this.contentType.split(';')[0]?.trim().toLowerCase() ?? '';
    if (base !== 'multipart/form-data') throw unsupportedMediaType();
    const boundary = boundaryOf(this.contentType);
    if (boundary === null) throw malformedJson();
    const parsed = parseMultipart(this.rawBody, boundary);
    if (parsed === null) throw malformedJson();
    return parsed;
  }

  markIdempotencyConflict(): void {
    this.idempotencyConflicting = true;
  }

  /** Rule 8: the same key used before for a different endpoint or body. */
  idempotencyConflict(): boolean {
    return this.idempotencyConflicting;
  }

  /** Rule 9: the key's own shape. */
  idempotencyKey(): string {
    const key = this.idempotencyHeader;
    if (key === null || !IDEMPOTENCY_KEY_PATTERN.test(key)) {
      throw validation({
        idempotency_key: 'Send an Idempotency-Key of 8 to 128 letters, digits, hyphens or underscores.',
      });
    }
    return key;
  }
}

export type { ApiError };
