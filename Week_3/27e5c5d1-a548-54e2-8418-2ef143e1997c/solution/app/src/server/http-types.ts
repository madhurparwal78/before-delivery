import type { IncomingHttpHeaders, ServerResponse } from 'node:http';
import type { Actor } from './auth.ts';

export interface Upload {
  filename: string;
  contentType: string;
  bytes: Buffer;
}

/** What every handler gets; sign-in is the only one that runs without a signed-in person. */
export interface PublicContext {
  /** The path captures: the first and, on routes that have one, the second id (empty otherwise). */
  params: [string, string];
  url: URL;
  /** Parsed JSON body, or INVALID_JSON; undefined for routes without a body. */
  body: unknown;
  upload: Upload | null;
  headers: IncomingHttpHeaders;
  response: ServerResponse;
}

export interface RouteContext extends PublicContext {
  actor: Actor;
}

export interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string | string[]>;
  raw?: Buffer;
}

/** A handler that wrote the whole response itself (the event stream). */
export const HANDLED = Symbol('handled');

export type Handler = (context: RouteContext) => Promise<Reply | typeof HANDLED>;
export type PublicHandler = (context: PublicContext) => Promise<Reply>;

type Methods<H> = Partial<Record<'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', H>>;

export interface Route {
  pattern: RegExp;
  upload?: boolean;
  methods: Methods<Handler>;
  /** Methods open to anonymous callers (sign-in). */
  open?: Methods<PublicHandler>;
}
