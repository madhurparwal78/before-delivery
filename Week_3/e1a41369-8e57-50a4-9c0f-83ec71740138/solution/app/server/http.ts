import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { HttpError, Refusal } from "./errors.js";
import { one, pool } from "./db.js";
import type { UserRow } from "./records.js";

const JSON_LIMIT = 64_000;
export const SESSION_COOKIE = "deed_session";

export interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  raw?: Buffer;
  contentType?: string;
  /** The handler already wrote the response (a live stream). */
  streamed?: true;
}

export const reply = (status: number, body?: unknown): Reply => ({ status, body });

interface RawBody {
  bytes: Buffer;
  oversize: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string): boolean => UUID.test(value);

export function readBody(req: IncomingMessage, limit: number): Promise<RawBody> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
    });
    req.on("end", () => resolve({ bytes: Buffer.concat(chunks), oversize: size > limit }));
    req.on("error", reject);
  });
}

export function sessionToken(req: IncomingMessage): string | undefined {
  for (const pair of (req.headers.cookie ?? "").split(";")) {
    const [name, ...rest] = pair.trim().split("=");
    if (name === SESSION_COOKIE) return rest.join("=");
  }
  return undefined;
}

export const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");
export const newToken = (): string => randomBytes(32).toString("base64url");

export async function userOfRequest(req: IncomingMessage): Promise<UserRow | undefined> {
  const token = sessionToken(req);
  if (!token) return undefined;
  return one<UserRow>(
    pool,
    "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1",
    [hashToken(token)],
  );
}

export class Context {
  private account: UserRow | undefined;

  constructor(
    readonly req: IncomingMessage,
    readonly res: ServerResponse,
    readonly url: URL,
    readonly params: Record<string, string>,
    private readonly body: RawBody,
  ) {}

  get method(): string {
    return this.req.method ?? "GET";
  }

  header(name: string): string | undefined {
    const value = this.req.headers[name];
    return Array.isArray(value) ? value[0] : value;
  }

  /** Error order step 1: no session, no answer. */
  async user(): Promise<UserRow> {
    this.account ??= await userOfRequest(this.req);
    if (!this.account) throw Refusal.unauthenticated();
    return this.account;
  }

  /** Error order steps 6 and 7 for a JSON body: too large, then wrong type; the caller validates (step 8). */
  json<T>(parse: (value: unknown) => T): T {
    if (this.body.oversize) throw Refusal.bodyTooLarge();
    if (!(this.header("content-type") ?? "").toLowerCase().startsWith("application/json")) throw Refusal.unsupportedMediaType();
    return parse(parseJson(this.body.bytes));
  }

  /** The body as sent, for the idempotency fingerprint: JSON when it is JSON, else nothing. */
  fingerprintBody(): unknown {
    return parseJson(this.body.bytes) ?? null;
  }

  multipartFile(limit: number): { filename: string; bytes: Buffer } {
    const type = this.header("content-type") ?? "";
    const boundary = /^multipart\/form-data;.*boundary=(?:"([^"]+)"|([^;]+))/i.exec(type);
    if (!boundary) throw Refusal.unsupportedMediaType();
    if (this.body.oversize) throw Refusal.fileTooLarge();
    const file = findFilePart(this.body.bytes, `--${boundary[1] ?? boundary[2]}`);
    if (!file) throw Refusal.unsupportedFileType();
    if (file.bytes.length > limit) throw Refusal.fileTooLarge();
    return file;
  }
}

function parseJson(bytes: Buffer): unknown {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    return undefined;
  }
}

function findFilePart(body: Buffer, delimiter: string): { filename: string; bytes: Buffer } | undefined {
  const marker = Buffer.from(delimiter);
  let start = body.indexOf(marker);
  while (start !== -1) {
    const headerStart = start + marker.length + 2;
    const headerEnd = body.indexOf("\r\n\r\n", headerStart);
    if (headerEnd === -1) return undefined;
    const headers = body.subarray(headerStart, headerEnd).toString("utf8");
    const end = body.indexOf(`\r\n${delimiter}`, headerEnd + 4);
    const name = /\bname="([^"]*)"/.exec(headers)?.[1];
    const filename = /\bfilename="([^"]*)"/.exec(headers)?.[1];
    if (name === "file" && filename !== undefined) {
      const content = body.subarray(headerEnd + 4, end === -1 ? body.length : end);
      return { filename, bytes: Buffer.from(content) };
    }
    start = end === -1 ? -1 : end + 2;
  }
  return undefined;
}

type Handler = (context: Context) => Promise<Reply>;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  limit: number;
  handler: Handler;
}

const routes: Route[] = [];

export function route(method: string, path: string, handler: Handler, limit = JSON_LIMIT): void {
  const keys: string[] = [];
  const source = path.replace(/:(\w+)/g, (_match, key: string) => {
    keys.push(key);
    return "([^/]+)";
  });
  routes.push({ method, pattern: new RegExp(`^${source}$`), keys, limit, handler });
}

export function findRoute(method: string, pathname: string): { route: Route; params: Record<string, string> } | undefined {
  for (const candidate of routes) {
    if (candidate.method !== method) continue;
    const match = candidate.pattern.exec(pathname);
    if (match) return { route: candidate, params: Object.fromEntries(candidate.keys.map((key, index) => [key, decodeURIComponent(match[index + 1]!)])) };
  }
  return undefined;
}

export function send(res: ServerResponse, result: Reply): void {
  if (result.streamed) return;
  const headers: Record<string, string> = { "Cache-Control": "no-store", ...result.headers };
  if (result.raw) {
    res.writeHead(result.status, { ...headers, "Content-Type": result.contentType ?? "application/octet-stream", "Content-Length": String(result.raw.length) });
    res.end(result.raw);
    return;
  }
  if (result.body === undefined) {
    res.writeHead(result.status, headers);
    res.end();
    return;
  }
  const payload = Buffer.from(JSON.stringify(result.body));
  res.writeHead(result.status, { ...headers, "Content-Type": "application/json; charset=utf-8", "Content-Length": String(payload.length) });
  res.end(payload);
}

const CONNECTION_FAILURES = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "57P01", "57P03"]);

function databaseWentAway(error: unknown): boolean {
  const { code, message } = error as { code?: string; message?: string };
  return (code !== undefined && CONNECTION_FAILURES.has(code)) || /Connection terminated|timeout exceeded when trying to connect/.test(message ?? "");
}

export function sendError(res: ServerResponse, error: unknown): void {
  if (error instanceof HttpError) {
    send(res, { status: error.status, body: error.body });
    return;
  }
  if (databaseWentAway(error)) {
    sendError(res, Refusal.databaseUnavailable());
    return;
  }
  console.error(error);
  send(res, { status: 500, body: { error: "internal_error" } });
}
