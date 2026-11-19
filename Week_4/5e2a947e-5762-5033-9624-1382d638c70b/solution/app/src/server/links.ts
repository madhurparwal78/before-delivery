import { ApiError } from '../shared/errors.ts';
import type { LinkState, Role, ShareLinkInfo } from '../shared/model.ts';
import { LINK_TRANSITIONS, canTransition } from '../shared/rules.ts';
import { serverNow, toIso } from './clock.ts';
import { database, query, type Db } from './db.ts';
import type { Effects } from './groups.ts';
import { dropPerson, transient } from './hub.ts';
import { randomId } from './ids.ts';
import { onTick } from './tick.ts';

export type GrantableRole = Exclude<Role, 'owner'>;

interface NewShareLink {
  mapId: string;
  role: GrantableRole;
  expiresAt: number | null;
}

export interface LinkRow {
  id: string;
  map_id: string;
  code: string;
  role: GrantableRole;
  expires_at: Date | null;
  state: LinkState;
  map_title: string;
}

const CODE_LENGTH = 22;

const SELECT_LINK = 'SELECT l.id, l.map_id, l.code, l.role, l.expires_at, l.state, m.title AS map_title FROM share_links l JOIN maps m ON m.id = l.map_id';

/** A link's state against the server clock, so an expired link reads expired before the tick records it. */
function stateOf(link: Pick<LinkRow, 'state' | 'expires_at'>): LinkState {
  return link.state === 'active' && link.expires_at !== null && link.expires_at.getTime() <= serverNow() ? 'expired' : link.state;
}

export function describeLink(link: LinkRow): ShareLinkInfo {
  return {
    id: link.id,
    code: link.code,
    role: link.role,
    expires_at: link.expires_at === null ? null : toIso(link.expires_at.getTime()),
    state: stateOf(link),
    url: `/s/${link.code}`,
  };
}

export async function createShareLink(db: Db, args: NewShareLink): Promise<ShareLinkInfo> {
  const code = randomId(CODE_LENGTH);
  const info: ShareLinkInfo = {
    id: randomId(),
    code,
    role: args.role,
    expires_at: args.expiresAt === null ? null : toIso(args.expiresAt),
    state: 'active',
    url: `/s/${code}`,
  };
  await query(db, 'INSERT INTO share_links (id, map_id, code, role, expires_at, state, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)', [
    info.id,
    args.mapId,
    info.code,
    info.role,
    info.expires_at,
    info.state,
    toIso(serverNow()),
  ]);
  return info;
}

export async function linksOf(db: Db, mapId: string): Promise<LinkRow[]> {
  return query<LinkRow>(db, `${SELECT_LINK} WHERE l.map_id = $1 ORDER BY l.created_at, l.id`, [mapId]);
}

/** One of a map's links; `lock` holds the row until the transaction ends. */
export async function findLink(db: Db, mapId: string, linkId: string, lock = false): Promise<LinkRow> {
  const rows = await query<LinkRow>(db, `${SELECT_LINK} WHERE l.map_id = $1 AND l.id = $2${lock ? ' FOR UPDATE OF l' : ''}`, [mapId, linkId]);
  const link = rows[0];
  if (!link) throw new ApiError('not_found', 'That link no longer exists.');
  return link;
}

export async function findLinkByCode(db: Db, code: string): Promise<LinkRow> {
  // A NUL byte is not storable text, so no link can carry it.
  const rows = code.includes('\0') ? [] : await query<LinkRow>(db, `${SELECT_LINK} WHERE l.code = $1`, [code]);
  const link = rows[0];
  if (!link) throw new ApiError('not_found', "We couldn't find that page.");
  return link;
}

/** A dead link answers 404 with the code that says how it died. */
export function assertLive(link: LinkRow): void {
  const state = stateOf(link);
  if (state === 'expired') throw new ApiError('link_expired', 'This link has expired.');
  if (state === 'revoked') throw new ApiError('link_revoked', "This link was turned off by the map's owner.");
}

/** Turning a link off or regenerating it is legal only while it is active. */
export function assertCanRevoke(link: LinkRow): void {
  if (!canTransition(LINK_TRANSITIONS, stateOf(link), 'revoked')) {
    throw new ApiError('invalid_transition', 'That link has already ended.');
  }
}

const guestIdsOf = async (db: Db, linkId: string): Promise<string[]> =>
  (await query<{ id: string }>(db, 'SELECT id FROM guest_sessions WHERE link_id = $1', [linkId])).map((row) => `guest:${row.id}`);

/** Tell every open screen that came in through a link that it ended, then close those sockets. */
function endGuestScreens(mapId: string, personIds: string[], state: 'expired' | 'revoked'): void {
  for (const personId of personIds) {
    transient(mapId, { type: 'link_expired', state }, personId);
    dropPerson(mapId, personId);
  }
}

/** Turn a link off; once the transaction commits, its guests lose their screens. */
export async function revokeLink(db: Db, link: LinkRow, fx: Effects): Promise<void> {
  await query(db, "UPDATE share_links SET state = 'revoked' WHERE id = $1", [link.id]);
  const guests = await guestIdsOf(db, link.id);
  fx.add(() => endGuestScreens(link.map_id, guests, 'revoked'));
}

/** Flip active links whose instant has come, and end the screens opened through them. */
async function expireLinks(): Promise<void> {
  const ended = await query<{ id: string; map_id: string }>(
    database(),
    "UPDATE share_links SET state = 'expired' WHERE state = 'active' AND expires_at <= $1 RETURNING id, map_id",
    [toIso(serverNow())],
  );
  for (const link of ended) endGuestScreens(link.map_id, await guestIdsOf(database(), link.id), 'expired');
}

onTick(expireLinks);
