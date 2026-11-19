import type { IncomingMessage, ServerResponse } from 'node:http';

/** Tiny typed request/response pair used by route handlers. */
export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  path: string;
  query: URLSearchParams;
  params: Record<string, string>;
  cookies: Record<string, string>;
  /** The authenticated user, if any. */
  user: { id: string; username: string } | null;
  /** The guest identity, if any. */
  guest: { token: string; username: string; role: string; mapId: string } | null;
  /** The request body (already size-checked). */
  body: unknown;
  rawBody: Buffer | null;
  origin: string | null;
}
