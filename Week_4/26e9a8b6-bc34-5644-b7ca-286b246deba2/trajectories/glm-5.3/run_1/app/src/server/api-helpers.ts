// Shared helpers for the API route handlers.

import type { IncomingMessage } from 'node:http';
import type { ApiContext } from './api';
import type { App } from './app';
import { errors } from './errors';
import type { PoolClient } from 'pg';
import type { AccountRow, GuideAccess, GuideRow } from './store-types';

export const BODY_LIMIT = 1000000;
const MAX_JSON_DEPTH = 32;

export async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let length = 0;
  return new Promise((resolve, reject) => {
    request.on('data', (chunk: Buffer) => {
      length += chunk.length;
      if (length > BODY_LIMIT) {
        reject(errors.bodyTooLarge(BODY_LIMIT));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

export interface Body {
  [key: string]: unknown;
}

export async function readJsonBody(context: ApiContext): Promise<Body> {
  const contentType = String(context.request.headers['content-type'] ?? '');
  if (!contentType.includes('application/json')) throw errors.unsupportedMediaType();
  const raw = await readBody(context.request);
  if (raw.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    throw errors.invalid('body');
  }
  if (depthOf(parsed) > MAX_JSON_DEPTH) throw errors.tooDeep();
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw errors.invalid('body');
  return parsed as Body;
}

function depthOf(value: unknown, current = 1): number {
  if (current > MAX_JSON_DEPTH) return current;
  if (value !== null && typeof value === 'object') {
    let max = current;
    if (Array.isArray(value)) {
      for (const item of value) max = Math.max(max, depthOf(item, current + 1));
    } else {
      for (const key of Object.keys(value)) max = Math.max(max, depthOf((value as Record<string, unknown>)[key], current + 1));
    }
    return max;
  }
  return current;
}

export function sendJson(context: ApiContext, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const allHeaders = { 'content-type': 'application/json', ...headers };
  if (context.method === 'HEAD') {
    context.response.writeHead(status, allHeaders);
    context.response.end();
    return;
  }
  context.response.writeHead(status, allHeaders);
  context.response.end(typeof body === 'string' ? body : JSON.stringify(body));
}

export function parseCookies(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

export async function sessionAccount(context: ApiContext): Promise<AccountRow | null> {
  const cookies = parseCookies(String(context.request.headers.cookie ?? ''));
  const token = cookies['pw_session'];
  if (!token) return null;
  return context.app.store.sessionAccount(token);
}

export function setSessionCookie(context: ApiContext, token: string): void {
  context.response.setHeader('set-cookie', `pw_session=${token}; Path=/; HttpOnly; SameSite=Lax`);
}

export function clearSessionCookie(context: ApiContext): void {
  context.response.setHeader('set-cookie', 'pw_session=; Path=/; HttpOnly; Max-Age=0');
}

export async function requireSession(context: ApiContext): Promise<AccountRow> {
  const account = await sessionAccount(context);
  if (!account) throw errors.notSignedIn();
  return account;
}

export async function requireConfirmed(context: ApiContext): Promise<AccountRow> {
  const account = await requireSession(context);
  if (!account.confirmed) throw errors.unconfirmed();
  return account;
}

export async function editableGuideOf(context: ApiContext, idOrSlug: string): Promise<GuideAccess | null> {
  const store = context.app.store;
  const guide = (await store.guideById(idOrSlug)) ?? (await store.guideBySlug(idOrSlug));
  if (!guide) return null;
  const account = await sessionAccount(context);
  if (!account) {
    if (!canSee(null, guide, false)) return null;
    throw errors.notSignedIn();
  }
  const isCoauthor = await store.isCoauthor(guide.id, account.id);
  if (!canSee(account, guide, isCoauthor)) return null;
  return { guide, isOwner: account.id === guide.owner_id, isCoauthor, viewer: account };
}

export async function visibleGuideOf(context: ApiContext, idOrSlug: string): Promise<GuideAccess | null> {
  const store = context.app.store;
  const guide = (await store.guideById(idOrSlug)) ?? (await store.guideBySlug(idOrSlug));
  if (!guide) return null;
  const account = await sessionAccount(context);
  const isCoauthor = account ? await store.isCoauthor(guide.id, account.id) : false;
  if (!canSee(account, guide, isCoauthor)) return null;
  return {
    guide,
    isOwner: account?.id === guide.owner_id,
    isCoauthor,
    viewer: account,
  };
}

import { canSee } from './domain';

export function codePoints(value: string): number {
  return [...value].length;
}

export function pageParams(context: ApiContext): { cursor: string | null; limit: number } {
  const cursor = context.url.searchParams.get('cursor');
  const raw = Number.parseInt(context.url.searchParams.get('limit') ?? '', 10);
  const limit = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 100) : 24;
  return { cursor, limit };
}

export function clientAddress(context: ApiContext): string {
  return String(context.request.socket.remoteAddress ?? 'unknown');
}

export function withTx(app: App, fn: (client: PoolClient) => Promise<void>): Promise<void> {
  return app.db.tx(fn);
}

export function userJson(account: AccountRow): Record<string, unknown> {
  return { id: account.id, name: account.name, email: account.email, confirmed: account.confirmed };
}
