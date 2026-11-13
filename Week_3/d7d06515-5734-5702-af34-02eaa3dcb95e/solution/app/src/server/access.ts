// Who is calling, what they may do, and the single decisions behind it: link status, trial days left, the 403 order.
import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Access, ShareAccess } from '../shared/types.ts';
import { config } from './config.ts';
import { clockedNow, studioDate, studioDaysBetween } from './clock.ts';
import { isUuid, query } from './db.ts';
import { HttpError, type Context } from './http.ts';

export interface UserRow {
  id: string;
  workspace_id: string;
  name: string;
  email: string;
  time_zone: string;
  verified: boolean;
  confirmed_at: Date | null;
}

export interface ShareRow {
  id: string;
  drawing_id: string;
  token: string;
  access: ShareAccess;
  recipient_email: string;
  recipient_name: string;
  expiry_date: string | null;
  expires_at: Date | null;
  time_zone: string;
  revoked_at: Date | null;
  last_invite_at: Date | null;
  created_at: Date;
}

export interface DrawingRow {
  id: string;
  workspace_id: string;
  folder_id: string | null;
  name: string;
  name_key: string;
  sample: boolean;
  units: 'mm' | 'm';
  plot_style: 'Monochrome' | 'Color' | 'Grayscale';
  version: number;
  next_handle: number;
  next_trace_handle: number;
  export_count: number;
  created_at: Date;
  modified_at: Date;
  deleted_at: Date | null;
}

export type Caller =
  | { kind: 'user'; user: UserRow; workspaceId: string }
  | { kind: 'link'; share: ShareRow; workspaceId: string };

type LinkStatus = 'active' | 'expired' | 'revoked';
type Action = 'base' | 'owner' | 'export' | 'trace' | 'trace-own';

export interface TrialState { days_left: number; ended: boolean }

export interface DrawingAccess {
  drawing: DrawingRow;
  access: Access;
  /** `key` is the user id or the share id; `name` is the account name or the recipient name. */
  actor: { key: string; name: string };
  workspaceId: string;
  ownerUserId: string;
  ownerName: string;
  ownerConfirmedAt: Date | null;
  /** The owner's studio zone, which decides every studio-zone date of the workspace. */
  zone: string;
  /** The workspace's now when this request was authorised. */
  now: Date;
  trial: TrialState;
}

export const SESSION_COOKIE = 'corbel_session';
export const SESSION_SECONDS = 30 * 24 * 3600;

export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

export function cookieValue(req: IncomingMessage, name: string): string | null {
  for (const pair of (req.headers.cookie ?? '').split(';')) {
    const at = pair.indexOf('=');
    if (at > 0 && pair.slice(0, at).trim() === name) return pair.slice(at + 1).trim();
  }
  return null;
}

/** The share-link holder (`Authorization: Link <token>`) if the header is present, else the signed-in account. */
export async function resolveCaller(req: IncomingMessage): Promise<Caller | null> {
  const header = req.headers.authorization;
  if (header?.startsWith('Link ')) {
    const rows = await query<ShareRow & { workspace_id: string }>(
      'SELECT s.*, d.workspace_id FROM shares s JOIN drawings d ON d.id = s.drawing_id WHERE s.token = $1',
      [header.slice(5).trim()],
    );
    const row = rows[0];
    return row ? { kind: 'link', share: row, workspaceId: row.workspace_id } : null;
  }
  const session = cookieValue(req, SESSION_COOKIE);
  if (!session) return null;
  const rows = await query<UserRow>(
    `SELECT u.id, u.workspace_id, u.name, u.email, u.time_zone, u.verified, u.confirmed_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.created_at > $2`,
    [sha256(session), new Date(Date.now() - SESSION_SECONDS * 1000)],
  );
  const user = rows[0];
  return user ? { kind: 'user', user, workspaceId: user.workspace_id } : null;
}

/** Account endpoints accept the cookie only. */
export function requireUser(ctx: Context): UserRow {
  if (ctx.caller?.kind !== 'user') throw new HttpError(401, { error: 'unauthenticated' });
  return ctx.caller.user;
}

/** Either kind of caller; 401 for neither. */
export function requireCaller(ctx: Context): Caller {
  if (!ctx.caller) throw new HttpError(401, { error: 'unauthenticated' });
  return ctx.caller;
}

/** The one decision on a share link's state: revoked, expired (at or after its expiry second) or active. */
export function linkStatus(share: Pick<ShareRow, 'revoked_at' | 'expires_at'>, now: Date): LinkStatus {
  if (share.revoked_at) return 'revoked';
  if (share.expires_at && now.getTime() >= share.expires_at.getTime()) return 'expired';
  return 'active';
}

/** 410 with the link's error code unless the link is active. */
export function assertLinkActive(share: Pick<ShareRow, 'revoked_at' | 'expires_at'>, now: Date): void {
  const status = linkStatus(share, now);
  if (status !== 'active') throw new HttpError(410, { error: `link_${status}` });
}

/** The one place trial days left are computed: whole studio-zone days since the confirmation date, never below 0. */
export function trialState(confirmedAt: Date | null, zone: string, now: Date): TrialState {
  const elapsed = confirmedAt ? studioDaysBetween(studioDate(confirmedAt, zone), studioDate(now, zone)) : 0;
  const days_left = Math.min(config.trialDays, Math.max(0, config.trialDays - elapsed));
  return { days_left, ended: days_left === 0 };
}

interface DrawingContext extends DrawingRow {
  clock_base: Date | null;
  clock_set_at: Date | null;
  owner_id: string;
  owner_name: string;
  owner_confirmed_at: Date | null;
  owner_zone: string;
}

/** Resolves the drawing for the caller in the brief's precedence: 401, 404, 410. Refusals (403) are `assertMay`. */
export async function authorizeDrawing(ctx: Context, drawingId: string): Promise<DrawingAccess> {
  const caller = requireCaller(ctx);
  if (!isUuid(drawingId)) throw new HttpError(404, { error: 'not_found' });
  const rows = await query<DrawingContext>(
    `SELECT d.*, w.clock_base, w.clock_set_at,
            u.id AS owner_id, u.name AS owner_name, u.confirmed_at AS owner_confirmed_at, u.time_zone AS owner_zone
       FROM drawings d
       JOIN workspaces w ON w.id = d.workspace_id
       JOIN users u ON u.workspace_id = d.workspace_id
      WHERE d.id = $1 AND d.deleted_at IS NULL`,
    [drawingId],
  );
  const row = rows[0];
  if (!row || row.workspace_id !== caller.workspaceId) throw new HttpError(404, { error: 'not_found' });
  const { clock_base, clock_set_at, owner_id, owner_name, owner_confirmed_at, owner_zone, ...drawing } = row;
  const now = clockedNow({ clock_base, clock_set_at });
  const trial = trialState(owner_confirmed_at, owner_zone, now);
  const common = {
    drawing, workspaceId: drawing.workspace_id, ownerUserId: owner_id, ownerName: owner_name, ownerConfirmedAt: owner_confirmed_at,
    zone: owner_zone, now, trial,
  };
  if (caller.kind === 'user') {
    return { ...common, access: drawing.sample ? 'view' : 'owner', actor: { key: caller.user.id, name: caller.user.name } };
  }
  if (caller.share.drawing_id !== drawing.id) throw new HttpError(404, { error: 'not_found' });
  assertLinkActive(caller.share, now);
  return { ...common, access: caller.share.access, actor: { key: caller.share.id, name: caller.share.recipient_name } };
}

/** The refusal order of the brief: view_only, markup_only, trial_ended, forbidden. */
export function assertMay(access: Access, action: Action, drawingAccess: DrawingAccess): void {
  if (access === 'view') throw new HttpError(403, { error: 'view_only' });
  if (access === 'markup' && action !== 'trace' && action !== 'trace-own') throw new HttpError(403, { error: 'markup_only' });
  if (action === 'base' && drawingAccess.trial.ended) throw new HttpError(403, { error: 'trial_ended' });
  if (action === 'owner' && access !== 'owner') throw new HttpError(403, { error: 'forbidden' });
}
