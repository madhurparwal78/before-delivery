/**
 * Request plumbing: the transport checks, the rate check, the session, and the
 * one place an error becomes a response. The published check order lives here.
 */

import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { nowMs, realNowMs } from '../clock';
import { settings } from '../config';
import { one, query } from '../db';
import {
  ApiError,
  crossOrigin,
  forbidden,
  notFound,
  operatorOnly,
  rateLimited,
  tooLargeBody,
  unauthenticated,
} from '../errors';
import { hasAnyRole, type RoleKey } from '../domain/roles';
import type { Caller } from '../services/engine';
import { loadPerson, type Person, type Workspace } from '../services/store';

export const sessionCookie = 'switchyard_session';

export interface SessionRow {
  readonly id: string;
  readonly username: string;
  readonly impersonating: string | null;
  readonly workspace: Workspace;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

export async function loadSession(request: IncomingMessage): Promise<SessionRow | null> {
  const id = parseCookies(request.headers.cookie)[sessionCookie];
  if (!id) return null;
  const row = await one<{
    id: string;
    username: string;
    impersonating: string | null;
    workspace: string;
  }>(`SELECT id, username, impersonating, workspace FROM session WHERE id = $1`, [id]);
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    impersonating: row.impersonating,
    workspace: row.workspace === 'test' ? 'test' : 'live',
  };
}

export async function createSession(username: string): Promise<string> {
  const id = randomBytes(24).toString('hex');
  await query(`INSERT INTO session (id, username, workspace, created_at) VALUES ($1, $2, 'live', now())`, [
    id,
    username,
  ]);
  return id;
}

export async function deleteSession(id: string): Promise<void> {
  await query(`DELETE FROM session WHERE id = $1`, [id]);
}

/** The person whose eyes the request sees through, and the operator behind them. */
export async function callerOf(session: SessionRow): Promise<Caller | null> {
  const actor = await loadPerson(session.username);
  if (!actor) return null;
  const subject: Person | null = session.impersonating ? await loadPerson(session.impersonating) : actor;
  if (!subject) return null;
  return {
    username: subject.username,
    roles: subject.roles,
    department: subject.department,
    timeZone: subject.timeZone,
    displayName: subject.displayName,
    actor: actor.username,
    impersonating: session.impersonating !== null,
    workspace: session.workspace,
  };
}

export interface MultipartFile {
  readonly fieldName: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly bytes: Buffer;
  readonly fields: Record<string, string>;
}

export interface RequestContext {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly method: string;
  readonly path: string;
  readonly url: URL;
  readonly session: SessionRow | null;
  readonly caller: Caller | null;
  readonly bodyText: string;
  readonly body: Record<string, unknown>;
  readonly multipart: MultipartFile | null;
}

export const jsonBodyLimit = 1_000_000;

export function multipartLimit(): number {
  return settings().ATTACHMENT_MAX_BYTES + 65_536;
}

/** Reads a body, refusing one over its limit before it is parsed. */
export async function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(request.headers['content-length'] ?? '0');
  if (Number.isFinite(declared) && declared > limit) throw tooLargeBody(limit);
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > limit) throw tooLargeBody(limit);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function splitBuffer(body: Buffer, separator: Buffer): Buffer[] {
  const out: Buffer[] = [];
  let from = 0;
  for (;;) {
    const index = body.indexOf(separator, from);
    if (index < 0) break;
    if (index > from) out.push(body.subarray(from, index));
    from = index + separator.length;
  }
  if (from < body.length) out.push(body.subarray(from));
  return out;
}

export function parseMultipart(body: Buffer, contentType: string): MultipartFile | null {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!match) return null;
  const boundary = `--${match[1] ?? match[2]}`;
  const fields: Record<string, string> = {};
  let file: Omit<MultipartFile, 'fields'> | null = null;
  for (const part of splitBuffer(body, Buffer.from(boundary))) {
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd < 0) continue;
    const headers = part.subarray(0, headerEnd).toString('utf8');
    const content = part.subarray(headerEnd + 4);
    const nameMatch = /name="([^"]*)"/i.exec(headers);
    if (!nameMatch) continue;
    const fileMatch = /filename="([^"]*)"/i.exec(headers);
    const typeMatch = /content-type:\s*([^\r\n]+)/i.exec(headers);
    const tail = content.subarray(content.length - 2).toString();
    const trimmed = tail === '\r\n' ? content.subarray(0, content.length - 2) : content;
    if (fileMatch) {
      file = {
        fieldName: nameMatch[1],
        fileName: fileMatch[1],
        contentType: (typeMatch?.[1] ?? 'application/octet-stream').trim(),
        bytes: trimmed,
      };
    } else {
      fields[nameMatch[1]] = trimmed.toString('utf8');
    }
  }
  return file ? { ...file, fields } : null;
}

/** Counts cover the 60 seconds before now on real time, not the grading clock. */
class SlidingWindow {
  private readonly hits = new Map<string, number[]>();

  check(key: string, limit: number): void {
    const at = realNowMs();
    const window = at - 60_000;
    const kept = (this.hits.get(key) ?? []).filter((t) => t > window);
    if (kept.length >= limit) {
      const seconds = Math.max(1, Math.ceil((kept[0] + 60_000 - at) / 1000));
      this.hits.set(key, kept);
      throw rateLimited(seconds);
    }
    kept.push(at);
    this.hits.set(key, kept);
  }

  clear(): void {
    this.hits.clear();
  }
}

const writeWindow = new SlidingWindow();
const loginWindow = new SlidingWindow();

export function clearRateLimits(): void {
  writeWindow.clear();
  loginWindow.clear();
}

export function checkLoginRate(username: string): void {
  loginWindow.check(`login:${username}`, settings().LOGIN_RATE_LIMIT_PER_MINUTE);
}

export function checkWriteRate(username: string): void {
  writeWindow.check(`write:${username}`, settings().WRITE_RATE_LIMIT_PER_MINUTE);
}

export function isWriteMethod(method: string): boolean {
  return method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
}

/** A state-changing request from another origin is refused before anything else. */
export function checkOrigin(request: IncomingMessage): void {
  if (!isWriteMethod(request.method ?? 'GET')) return;
  const origin = request.headers.origin;
  if (!origin) return;
  const host = request.headers.host ?? '';
  if (origin !== `http://${host}` && origin !== `https://${host}`) throw crossOrigin();
}

export function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  response.end(text);
}

export function sendError(response: ServerResponse, error: unknown): void {
  if (error instanceof ApiError) {
    sendJson(response, error.status, error.body(), error.headers ?? {});
    return;
  }
  const message = error instanceof Error ? error.message : 'Something went wrong.';
  sendJson(response, 500, { error: { code: 'internal', message } });
}

export function requireCaller(context: RequestContext): Caller {
  if (!context.caller) throw unauthenticated();
  return context.caller;
}

export function requireOperator(context: RequestContext): Caller {
  const caller = requireCaller(context);
  if (!caller.roles.includes('operator')) throw operatorOnly();
  return caller;
}

export function requireRoles(context: RequestContext, roles: readonly RoleKey[]): Caller {
  const caller = requireCaller(context);
  if (!hasAnyRole(caller.roles, roles)) throw forbidden();
  return caller;
}

/** An idempotent replay returns its stored response before any other check. */
export async function replayOf(
  key: string | undefined,
  username: string,
  endpoint: string,
  bodyHash: string,
): Promise<{ status: number; response: unknown } | null> {
  if (!key) return null;
  const row = await one<{ body_hash: string; status: number; response: unknown }>(
    `SELECT body_hash, status, response FROM idempotency_record
     WHERE key = $1 AND username = $2 AND endpoint = $3`,
    [key, username, endpoint],
  );
  if (!row) return null;
  if (row.body_hash !== bodyHash) {
    throw new ApiError(409, 'idempotency_conflict', 'This key was already used for a different request.');
  }
  return { status: row.status, response: row.response };
}

export async function storeReplay(
  key: string | undefined,
  username: string,
  endpoint: string,
  bodyHash: string,
  status: number,
  response: unknown,
): Promise<void> {
  if (!key) return;
  await query(
    `INSERT INTO idempotency_record (key, username, endpoint, body_hash, status, response, created_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, now())
     ON CONFLICT (key, username, endpoint) DO NOTHING`,
    [key, username, endpoint, bodyHash, status, JSON.stringify(response)],
  );
}

export function idempotencyKeyOf(request: IncomingMessage): string | undefined {
  const raw = request.headers['idempotency-key'];
  const key = Array.isArray(raw) ? raw[0] : raw;
  if (!key || key.length < 1 || key.length > 64) return undefined;
  return key;
}

export function notFoundError(): ApiError {
  return notFound();
}

export function nowServer(): number {
  return nowMs();
}
