import type { IncomingMessage, ServerResponse } from 'node:http';
import { config, JSON_BODY_LIMIT } from '../config.js';
import { db } from '../db.js';
import type { PrincipalRecord, Viewer } from '../domain/records.js';
import { errors } from '../errors.js';
import { repo } from '../repo.js';
import type { Role } from '../../shared/types.js';

export interface MultipartFile {
  fileName: string;
  contentType: string;
  bytes: Buffer;
}

export interface Multipart {
  file: MultipartFile | null;
  fields: Record<string, string>;
  truncated: boolean;
}

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  method: string;
  params: Record<string, string>;
  now: Date;
  principal: PrincipalRecord | null;
  viewer: Viewer | null;
  rawBody: Buffer;
  bodyTooLarge: boolean;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

export async function principalFromRequest(req: IncomingMessage): Promise<PrincipalRecord | null> {
  const cookies = parseCookies(req.headers.cookie);
  const sessionId = cookies[config.sessionCookieName];
  if (!sessionId) return null;
  const result = await db.query<{ principal_id: string }>('select principal_id from sessions where id = $1', [
    sessionId,
  ]);
  const row = result.rows[0];
  if (!row) return null;
  return repo.principal(row.principal_id);
}

export const MULTIPART_HARD_LIMIT = 64 * 1024 * 1024;

export async function readBody(req: IncomingMessage, limit: number): Promise<{ body: Buffer; tooLarge: boolean }> {
  const chunks: Buffer[] = [];
  let size = 0;
  let tooLarge = false;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > limit) {
      tooLarge = true;
      break;
    }
    chunks.push(buffer);
  }
  if (tooLarge) req.destroy();
  return { body: Buffer.concat(chunks), tooLarge };
}

export function bodyLimitFor(req: IncomingMessage): number {
  const contentType = req.headers['content-type'] ?? '';
  return contentType.startsWith('multipart/form-data') ? MULTIPART_HARD_LIMIT : JSON_BODY_LIMIT;
}

export function jsonBody<T>(ctx: Ctx): T {
  if (ctx.bodyTooLarge) throw errors.tooLarge();
  if (ctx.rawBody.length === 0) return {} as T;
  try {
    return JSON.parse(ctx.rawBody.toString('utf8')) as T;
  } catch {
    throw errors.invalidBody();
  }
}

export function parseMultipart(ctx: Ctx): Multipart {
  const contentType = ctx.req.headers['content-type'] ?? '';
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2];
  if (!boundary) return { file: null, fields: {}, truncated: ctx.bodyTooLarge };

  const delimiter = Buffer.from(`--${boundary}`);
  const parts: Buffer[] = [];
  let start = ctx.rawBody.indexOf(delimiter);
  while (start !== -1) {
    const next = ctx.rawBody.indexOf(delimiter, start + delimiter.length);
    if (next === -1) break;
    parts.push(ctx.rawBody.subarray(start + delimiter.length, next));
    start = next;
  }

  const result: Multipart = { file: null, fields: {}, truncated: ctx.bodyTooLarge };
  for (const part of parts) {
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const headerText = part.subarray(0, headerEnd).toString('utf8');
    let content = part.subarray(headerEnd + 4);
    if (content.subarray(content.length - 2).toString('latin1') === '\r\n') {
      content = content.subarray(0, content.length - 2);
    }
    const nameMatch = /name="([^"]*)"/i.exec(headerText);
    const fileNameMatch = /filename="([^"]*)"/i.exec(headerText);
    const partContentType = /content-type:\s*([^\r\n]+)/i.exec(headerText)?.[1]?.trim() ?? 'application/octet-stream';
    const name = nameMatch?.[1];
    if (!name) continue;
    if (fileNameMatch) {
      if (name === 'file') {
        result.file = { fileName: fileNameMatch[1] ?? 'upload', contentType: partContentType, bytes: content };
      }
    } else {
      result.fields[name] = content.toString('utf8');
    }
  }
  return result;
}

export function requireSignedIn(ctx: Ctx): PrincipalRecord {
  if (!ctx.principal) throw errors.unauthenticated();
  return ctx.principal;
}

export function requireViewer(ctx: Ctx): Viewer {
  if (!ctx.viewer) throw errors.unauthenticated();
  return ctx.viewer;
}

export function hasRole(principal: PrincipalRecord, roles: Role[]): boolean {
  return roles.includes(principal.role);
}
