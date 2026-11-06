import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError } from './errors.ts';

export type PersonRole = 'owner' | 'kiln_tech' | 'member';
export type RouteRole = 'anyone' | 'signed_in' | 'staff' | 'owner' | 'member';

export interface StudioRow {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly time_zone: string;
  readonly pickup_window_days: number;
  readonly storage_fee_cents: number;
}

export interface Actor {
  readonly sessionId: string;
  readonly personId: string;
  readonly role: PersonRole;
  readonly membership: 'member' | 'drop_off' | null;
  readonly name: string;
  readonly handle: string;
  readonly email: string;
  readonly studio: StudioRow;
}

export interface UploadedFile {
  readonly field: string;
  readonly bytes: Buffer;
  readonly truncated: boolean;
}

export interface RawResponse {
  readonly buffer: Buffer;
  readonly contentType: string;
  readonly headers?: Record<string, string>;
}

export interface RouteResult {
  readonly status: number;
  readonly body?: unknown;
  readonly raw?: RawResponse;
  readonly setSession?: string;
  readonly clearSession?: boolean;
  readonly streamed?: boolean;
}

export class Ctx {
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly method: string;
  readonly path: string;
  readonly query: URLSearchParams;
  readonly host: string;
  params: Record<string, string> = {};
  json: Record<string, unknown> = {};
  rawBody: Buffer = Buffer.alloc(0);
  upload: UploadedFile | null = null;
  actor: Actor | null = null;
  store: Record<string, unknown> = {};

  constructor(req: IncomingMessage, res: ServerResponse, path: string, query: URLSearchParams) {
    this.req = req;
    this.res = res;
    this.method = req.method ?? 'GET';
    this.path = path;
    this.query = query;
    this.host = req.headers.host ?? 'localhost';
  }

  get actorOrFail(): Actor {
    if (!this.actor) throw new ApiError('unauthenticated');
    return this.actor;
  }

  param(name: string): string {
    return this.params[name] ?? '';
  }

  header(name: string): string {
    const value = this.req.headers[name];
    if (Array.isArray(value)) return value[0] ?? '';
    return value ?? '';
  }
}

export interface Route {
  readonly method: string;
  readonly pattern: string;
  readonly role: RouteRole;
  readonly bodyMode?: 'json' | 'multipart';
  readonly idempotent?: boolean;
  readonly resolve?: (ctx: Ctx) => Promise<void>;
  readonly handle: (ctx: Ctx) => Promise<RouteResult>;
}
