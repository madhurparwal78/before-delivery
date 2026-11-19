import type { IncomingHttpHeaders, ServerResponse } from "node:http";

export interface Request {
  query: URLSearchParams;
  /** A path parameter of the matched route (`:id`); every name in the pattern is present. */
  param(name: string): string;
  headers: IncomingHttpHeaders;
  ip: string;
  /** The raw body, already held to the route's size limit. */
  body: Buffer;
  /** A state-changing request whose `Origin` is not the APP_PUBLIC_URL origin; refused 403 once the 401 and 404 checks pass. */
  crossOrigin: boolean;
  /** The body as a JSON object: 415 for another content type, 422 for text that is not a JSON object. */
  jsonObject(): Record<string, unknown>;
  cookie(name: string): string | undefined;
}

export interface Reply {
  status: number;
  body?: unknown;
  /** A body that is already bytes (downloads), sent as-is. */
  bytes?: Buffer;
  headers?: Record<string, string | string[]>;
  /** Takes over the response for a long-lived stream. */
  stream?: (res: ServerResponse) => void;
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface Route {
  method: Method;
  pattern: string;
  /** Largest accepted body in bytes; defaults to the JSON limit. */
  bodyLimit?: number;
  /** Routes that answer without Postgres (health, config). */
  withoutDatabase?: boolean;
  /** Routes that answer without a signed-in session (sign-up, sign-in, joining, grading); they refuse a cross-origin write first. */
  withoutSession?: boolean;
  handler: (req: Request) => Promise<Reply> | Reply;
}
