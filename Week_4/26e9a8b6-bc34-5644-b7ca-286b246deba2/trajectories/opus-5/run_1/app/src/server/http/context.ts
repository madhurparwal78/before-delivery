import { config } from '../config.js';
import { userForSession } from '../domain/accounts.js';
import {
  isOwner,
  loadGuide,
  mayEdit,
  maySee,
  type GuideRow,
} from '../domain/guides.js';
import {
  forbidden,
  notFound,
  notSignedIn,
  unconfirmed,
  withdrawn,
} from './errors.js';
import { readCookie, SESSION_COOKIE } from './respond.js';
import type { Exchange } from './router.js';
import type { SessionUser } from '../../shared/types.js';

export async function viewerOf(exchange: Exchange): Promise<SessionUser | null> {
  return await userForSession(readCookie(exchange.req.headers.cookie, SESSION_COOKIE));
}

export function sessionIdOf(exchange: Exchange): string | null {
  return readCookie(exchange.req.headers.cookie, SESSION_COOKIE);
}

export function requireSignedIn(user: SessionUser | null): SessionUser {
  if (user === null) throw notSignedIn();
  return user;
}

export function requireConfirmed(user: SessionUser | null): SessionUser {
  const signedIn = requireSignedIn(user);
  if (!signedIn.confirmed) throw unconfirmed();
  return signedIn;
}

export interface GuideAccess {
  guide: GuideRow;
  viewer: SessionUser | null;
  editor: boolean;
  owner: boolean;
}

export type GuideNeed = 'see' | 'session' | 'edit' | 'own';

/**
 * Resolves a guide by id or slug applying the published precedence: 404 for a
 * guide the caller may not see, then 401, then 410 for a withdrawn guide, then
 * 403 for one the caller may not change.
 */
export async function guideAccess(
  idOrSlug: string,
  viewer: SessionUser | null,
  need: GuideNeed,
  options: { allowWithdrawn?: boolean } = {},
): Promise<GuideAccess> {
  const guide = await loadGuide(idOrSlug);
  if (guide === null) throw notFound();
  if (!(await maySee(guide, viewer))) throw notFound();

  const editor = await mayEdit(guide, viewer);
  const owner = isOwner(guide, viewer);

  if (need !== 'see' && viewer === null) throw notSignedIn();
  if (guide.state === 'withdrawn' && !editor && options.allowWithdrawn !== true) throw withdrawn();
  if (need === 'edit' && !editor) throw forbidden();
  if (need === 'own' && !owner) throw forbidden();
  return { guide, viewer, editor, owner };
}

export function pageLimit(url: URL): number {
  const raw = url.searchParams.get('limit');
  if (raw === null) return config.limits.page_size_default;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return config.limits.page_size_default;
  return Math.min(Math.floor(parsed), config.limits.page_size_max);
}

export function cursorOf(url: URL): string | null {
  return url.searchParams.get('cursor');
}
