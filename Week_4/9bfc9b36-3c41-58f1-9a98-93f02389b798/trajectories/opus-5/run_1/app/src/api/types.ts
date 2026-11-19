import type { IncomingHttpHeaders, ServerResponse } from 'node:http';
import { FIELD_COPY } from '../shared/copy';
import { invalid } from '../http/errors';

export type Role = 'sailmaker' | 'loft-hand' | 'yacht-owner';

/** The caller, always read from the stored account, never from token claims. */
export interface Caller {
  readonly id: string;
  readonly email: string;
  readonly display_name: string;
  readonly role: Role;
}

export interface Reply {
  readonly status: number;
  readonly json?: unknown;
  readonly body?: Buffer;
  readonly contentType?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface Ctx {
  readonly method: string;
  readonly path: string;
  readonly query: URLSearchParams;
  readonly params: Readonly<Record<string, string>>;
  readonly headers: IncomingHttpHeaders;
  readonly rawBody: Buffer;
  readonly caller: Caller | null;
  readonly response: ServerResponse;
  readonly now: Date;
  readonly setCookie: (value: string | null) => void;
}

export type Handler = (ctx: Ctx) => Promise<Reply>;

export function signedIn(ctx: Ctx): Caller {
  return ctx.caller as Caller;
}

/** The parsed JSON body of a write, or an empty object when the body is empty. */
export function jsonBody(ctx: Ctx): Record<string, unknown> {
  if (ctx.rawBody.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(ctx.rawBody.toString('utf8'));
  } catch {
    throw invalid({ body: FIELD_COPY.required });
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw invalid({ body: FIELD_COPY.required });
  }
  return parsed as Record<string, unknown>;
}

export function reply(status: number, json: unknown, headers?: Readonly<Record<string, string>>): Reply {
  return headers ? { status, json, headers } : { status, json };
}

export function bytes(
  status: number,
  body: Buffer,
  contentType: string,
  headers?: Readonly<Record<string, string>>,
): Reply {
  return headers ? { status, body, contentType, headers } : { status, body, contentType };
}
