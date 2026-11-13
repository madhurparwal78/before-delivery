import type { IncomingMessage } from "node:http";
import type { Role } from "../shared/roles";
import { forbidden } from "./errors";
import type { Json } from "./validate";

export interface Session {
  token: string;
  role: Role;
  teamId: number | null;
}

export interface Ctx {
  req: IncomingMessage;
  session: Session | null;
  /** Captures of the matched path pattern, as written in the URL. */
  params: string[];
  query: URLSearchParams;
  /** Parsed JSON body of a JSON route; undefined when the request carried none. */
  body: Json | undefined;
  /** Raw bytes of a sheet upload. */
  bytes: Buffer;
}

export interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  /** A stored image, sent as is. */
  image?: { bytes: Buffer; contentType: string };
}

export type Handler = (ctx: Ctx) => Promise<Reply>;

export const json = (status: number, body: unknown, headers?: Record<string, string>): Reply =>
  headers === undefined ? { status, body } : { status, body, headers };

/** Role check of the error precedence; handlers call it after the unknown-resource check. */
export function requireRole(ctx: Ctx, ...roles: Role[]): Session {
  if (ctx.session === null || !roles.includes(ctx.session.role)) throw forbidden();
  return ctx.session;
}

/** A round number from the path; only 1 to 8 name a round. */
export function roundNumber(raw: string | undefined): number | null {
  const number = Number(raw);
  return raw !== undefined && /^\d+$/.test(raw) && number >= 1 && number <= 8 ? number : null;
}
