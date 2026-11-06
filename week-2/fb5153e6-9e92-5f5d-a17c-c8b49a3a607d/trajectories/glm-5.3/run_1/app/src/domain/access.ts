import type { ModelRow } from './models.js';
import { one, query } from '../db/db.js';
import { ApiError } from '../errors.js';
import { planOf } from './plans.js';
import { planState } from './plan-service.js';
import { verifyPassword, sha256Hex } from './ids.js';
import { getOrderByReceipt } from './commerce.js';

export interface Viewer {
  kind: 'public' | 'studio' | 'contributor';
  userId?: number;
  role?: 'author' | 'editor' | 'contributor' | 'staff';
}

export interface ViewerContext {
  viewer: Viewer;
  unlockCookie?: string;
  accessToken?: string;
}

/** Studio sessions: author, editor, or the contributor who owns the model. */
export function isStudioSessionFor(model: ModelRow, viewer: Viewer): boolean {
  if (viewer.kind === 'studio' && (viewer.role === 'author' || viewer.role === 'editor')) return true;
  if (viewer.kind === 'contributor' && viewer.userId === model.owner_id) return true;
  return false;
}

export interface AccessDecision {
  allowed: boolean;
  passwordGate: boolean;
}

/** Whether a non-studio caller may see the model page and its media. */
export async function publicAccess(
  model: ModelRow,
  ctx: ViewerContext,
  sessionSecret: string,
): Promise<AccessDecision> {
  if (isStudioSessionFor(model, ctx.viewer)) return { allowed: true, passwordGate: false };
  if (model.state !== 'published' || model.read_only) return { allowed: false, passwordGate: false };
  if (model.visibility === 'public') return { allowed: true, passwordGate: false };
  if (model.visibility === 'unlisted') {
    const token = ctx.accessToken;
    if (token === undefined) return { allowed: false, passwordGate: false };
    const row = await one<{ token: string }>('SELECT token FROM share_tokens WHERE model_id = $1', [model.id]);
    if (row !== null && row.token === token) return { allowed: true, passwordGate: false };
    return { allowed: false, passwordGate: false };
  }
  if (model.visibility === 'password') {
    if (ctx.unlockCookie === undefined) return { allowed: true, passwordGate: true };
    if (unlockValid(model, ctx.unlockCookie, sessionSecret)) return { allowed: true, passwordGate: false };
    return { allowed: true, passwordGate: true };
  }
  return { allowed: false, passwordGate: false };
}

/** An unlock lasts for the browser session and ends when the password or visibility changes. */
export function unlockCookieValue(modelSlug: string, epoch: number, secret: string): string {
  return `${epoch}.${sha256Hex(Buffer.from(`${modelSlug}:${epoch}:${secret}`)).slice(0, 40)}`;
}

export function unlockValid(model: ModelRow, cookie: string, secret: string): boolean {
  const expected = unlockCookieValue(model.slug, model.password_epoch, secret);
  return cookie === expected;
}

export async function verifyModelPassword(model: ModelRow, password: string): Promise<boolean> {
  const row = await one<{ password_hash: string | null }>('SELECT password_hash FROM models WHERE id = $1', [model.id]);
  if (row?.password_hash === null || row === null) return false;
  return verifyPassword(password, row.password_hash);
}

/** Embed entitlement: checked on every request. */
export async function embedAllowed(model: ModelRow): Promise<boolean> {
  if (model.state !== 'published' || (model.visibility !== 'public' && model.visibility !== 'unlisted')) return false;
  if (model.read_only) return false;
  const state = await planState();
  const plan = planOf(state.plan);
  return plan.embeds;
}

export async function embedModelOf(token: string): Promise<ModelRow | null> {
  const row = await one<{ model_id: number }>('SELECT model_id FROM embeds WHERE token = $1', [token]);
  if (row === null) return null;
  const modelRow = await one<ModelRow>('SELECT * FROM models WHERE id = $1', [row.model_id]);
  return modelRow;
}

export interface MediaDecision {
  serve: boolean;
  status: 'ok' | 'rebuilding' | 'forbidden';
}

/**
 * Who is served which revision's files. Studio sessions get the newest revision's
 * file once that file's own stage confirmed; everyone else gets the current revision
 * unless it is outdated, which is never served again.
 */
export async function mediaAccess(
  model: ModelRow,
  ctx: ViewerContext,
  sessionSecret: string,
): Promise<MediaDecision> {
  if (isStudioSessionFor(model, ctx.viewer)) {
    return { serve: true, status: 'ok' };
  }
  const access = await publicAccess(model, ctx, sessionSecret);
  if (!access.allowed || access.passwordGate) return { serve: false, status: 'forbidden' };
  if (model.rebuilding || model.outdated) return { serve: false, status: 'rebuilding' };
  return { serve: true, status: 'ok' };
}

export interface ReceiptFileAccess {
  ok: boolean;
  reason?: 'refunded' | 'rebuilding' | 'not_found';
}

export async function receiptFileAccess(receiptToken: string, model: ModelRow): Promise<ReceiptFileAccess> {
  const order = await getOrderByReceipt(receiptToken);
  if (order === null || order.model_id !== model.id) return { ok: false, reason: 'not_found' };
  if (order.status === 'refunded') return { ok: false, reason: 'refunded' };
  if (model.rebuilding || model.outdated) return { ok: false, reason: 'rebuilding' };
  return { ok: true };
}

export function assertMediaAllowed(decision: MediaDecision): void {
  if (decision.status === 'rebuilding') throw new ApiError(409, 'derivatives_rebuilding');
  if (decision.status === 'forbidden') throw new ApiError(404, 'not_found');
}

export async function modelsVisibleToStaff(): Promise<ModelRow[]> {
  const rows = await query<ModelRow>('SELECT * FROM models ORDER BY id');
  return rows.rows;
}
