import type { IncomingMessage, ServerResponse } from "node:http";

export class Refusal extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const unauthorized = (): Refusal => new Refusal(401, "Sign in first.");
export const notFound = (): Refusal => new Refusal(404, "Not found.");
export const conflict = (message: string): Refusal => new Refusal(409, message);
export const invalid = (message: string): Refusal => new Refusal(422, message);
export const slowDown = (): Refusal => new Refusal(429, "Slow down a little.");

const JSON_LIMIT = 64_000;
export const SETUP_LIMIT = 1_000_000;
export const MULTIPART_LIMIT = 51_000_000;

export interface Reply {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export const reply = (status: number, body: unknown, headers?: Record<string, string>): Reply => ({
  status,
  body,
  ...(headers ? { headers } : {}),
});

export interface Context {
  req: IncomingMessage;
  url: URL;
  params: Record<string, string>;
  raw: Buffer;
  contentType: string;
  cookie(name: string): string | undefined;
  json(): Record<string, unknown>;
}

type Handler<P> = (ctx: Context, person: P) => Promise<Reply> | Reply;

interface Route<P> {
  method: string;
  parts: string[];
  anonymous: boolean;
  bodyLimit: number;
  handler: Handler<P | null>;
}

export class Router<P> {
  private readonly routes: Route<P>[] = [];

  add(method: string, path: string, handler: Handler<P>, options: { anonymous?: boolean; bodyLimit?: number } = {}): void {
    this.routes.push({
      method,
      parts: path.split("/").filter(Boolean),
      anonymous: options.anonymous ?? false,
      bodyLimit: options.bodyLimit ?? JSON_LIMIT,
      handler: handler as Handler<P | null>,
    });
  }

  find(method: string, pathname: string): { route: Route<P>; params: Record<string, string> } | null {
    const segments = pathname.split("/").filter(Boolean);
    for (const route of this.routes) {
      if (route.method !== method || route.parts.length !== segments.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      route.parts.forEach((part, index) => {
        const segment = segments[index] ?? "";
        if (part.startsWith(":")) params[part.slice(1)] = decodeSegment(segment);
        else if (part !== segment) matched = false;
      });
      if (matched && !Object.values(params).some((value) => value.includes("\u0000"))) return { route, params };
    }
    return null;
  }
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Length in user-perceived characters: an emoji, including a joined family emoji, counts as 1. */
export const textLength = (value: string): number => [...graphemes.segment(value)].length;

/** The origin the caller used, for absolute links in mail. */
export const originOf = (ctx: Context): string => `http://${ctx.req.headers.host ?? "localhost"}`;

export function parseCookies(header: string | undefined): Map<string, string> {
  const jar = new Map<string, string>();
  for (const piece of (header ?? "").split(";")) {
    const at = piece.indexOf("=");
    if (at > 0) jar.set(piece.slice(0, at).trim(), piece.slice(at + 1).trim());
  }
  return jar;
}

export function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

export const CROSS_ORIGIN_TEXT = "Cross-origin requests are refused.";
export const TOO_LARGE_TEXT = "That request is too large.";

/** Reads the whole body, keeping at most `limit` bytes; `tooLarge` says whether more arrived. */
export function readBody(req: IncomingMessage, limit: number): Promise<{ raw: Buffer; tooLarge: boolean }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        tooLarge = true;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve({ raw: tooLarge ? Buffer.alloc(0) : Buffer.concat(chunks), tooLarge }));
    req.on("error", reject);
  });
}

export function parseJsonObject(raw: Buffer): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(raw.toString("utf8"));
  } catch {
    throw invalid("Send a JSON body.");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalid("Send a JSON body.");
  return value as Record<string, unknown>;
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": payload.length,
    "cache-control": "no-store",
    ...headers,
  });
  res.end(payload);
}

export function sendBytes(res: ServerResponse, status: number, type: string, bytes: Buffer, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": type, "content-length": bytes.length, ...headers });
  res.end(bytes);
}

export const errorBody = (message: string): { error: string } => ({ error: message });

/** The strings a handler reads from a JSON body, each checked by the caller. */
export function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function whole(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}
