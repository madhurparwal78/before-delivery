import { type IncomingMessage, type ServerResponse } from "node:http";
import { MAX_JSON_BYTES, MAX_UPLOAD_REQUEST_BYTES, SESSION_COOKIE } from "./config.js";
import { ApiError, errors } from "./errors.js";
import { type UserRow } from "./domain/accounts.js";

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  url: URL;
  params: Record<string, string>;
  sessionId: string | null;
  user: UserRow | null;
  wantsJson: boolean;
}

export function cookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  const found: Record<string, string> = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) found[name] = decodeURIComponent(value);
  }
  return found;
}

export function setSessionCookie(res: ServerResponse, sessionId: string): void {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`,
  );
}

export function clearSessionCookie(res: ServerResponse): void {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload).toString(),
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end(payload);
}

export function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(html).toString(),
    "X-Content-Type-Options": "nosniff",
  });
  res.end(html);
}

export function redirect(res: ServerResponse, location: string): void {
  res.writeHead(303, { Location: location });
  res.end();
}

async function readBody(req: IncomingMessage, limit: number, tooLarge: ApiError): Promise<Buffer> {
  const declared = req.headers["content-length"];
  if (declared !== undefined && Number(declared) > limit) throw tooLarge;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const part = chunk as Buffer;
    size += part.length;
    if (size > limit) throw tooLarge;
    chunks.push(part);
  }
  return Buffer.concat(chunks);
}

export function assertSameOrigin(ctx: Ctx): void {
  if (ctx.method === "GET" || ctx.method === "HEAD") return;
  const origin = ctx.req.headers.origin;
  if (!origin || origin === "null") return;
  const host = ctx.req.headers.host ?? "";
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw errors.crossOrigin();
  }
  if (originHost !== host) throw errors.crossOrigin();
}

export async function readJson(ctx: Ctx): Promise<Record<string, unknown>> {
  const contentType = (ctx.req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  const body = await readBody(ctx.req, MAX_JSON_BYTES, errors.payloadTooLarge());
  if (body.length === 0) {
    if (contentType && contentType !== "application/json") throw errors.unsupportedMediaType();
    return {};
  }
  if (contentType !== "application/json") throw errors.unsupportedMediaType();
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {
    throw errors.validation({ body: "Send a JSON object." });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw errors.validation({ body: "Send a JSON object." });
  }
  return parsed as Record<string, unknown>;
}

export interface UploadedPart {
  fileName: string;
  bytes: Buffer;
}

export async function readUpload(ctx: Ctx): Promise<UploadedPart> {
  const header = ctx.req.headers["content-type"] ?? "";
  const type = header.split(";")[0]?.trim().toLowerCase() ?? "";
  if (type !== "multipart/form-data") {
    await readBody(ctx.req, MAX_UPLOAD_REQUEST_BYTES, errors.fileTooLarge()).catch(() => Buffer.alloc(0));
    throw errors.unsupportedMediaType();
  }
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(header);
  const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2];
  if (!boundary) throw errors.unsupportedMediaType();
  const body = await readBody(ctx.req, MAX_UPLOAD_REQUEST_BYTES, errors.fileTooLarge());
  const delimiter = Buffer.from(`--${boundary}`);
  let cursor = body.indexOf(delimiter);
  while (cursor !== -1) {
    const partStart = cursor + delimiter.length;
    if (body.subarray(partStart, partStart + 2).toString() === "--") break;
    const headerEnd = body.indexOf("\r\n\r\n", partStart);
    if (headerEnd === -1) break;
    const rawHeaders = body.subarray(partStart, headerEnd).toString("utf8");
    const next = body.indexOf(delimiter, headerEnd);
    const contentEnd = next === -1 ? body.length : next - 2;
    const content = body.subarray(headerEnd + 4, contentEnd);
    const disposition = /content-disposition:[^\r\n]*/i.exec(rawHeaders)?.[0] ?? "";
    const fieldName = /name="([^"]*)"/i.exec(disposition)?.[1] ?? "";
    const fileName = /filename="([^"]*)"/i.exec(disposition)?.[1] ?? "";
    if (fieldName === "file") {
      return { fileName, bytes: content };
    }
    cursor = next;
  }
  throw errors.validation({ file: "Attach a file." });
}

export function clientWantsJson(req: IncomingMessage): boolean {
  const accept = req.headers.accept ?? "";
  return accept.includes("application/json") && !accept.includes("text/html");
}
