// View links: a random token opens one published version without an account until it expires or is turned off.
import { randomBytes, randomUUID } from 'node:crypto';
import * as copy from '../shared/copy.ts';
import { ApiError } from '../shared/errors.ts';
import { MINIMUM_ROLE } from '../shared/rules.ts';
import { accessTo } from './access.ts';
import { requireUser } from './auth.ts';
import { clock } from './clock.ts';
import { config } from './config.ts';
import { db } from './db.ts';
import { hub } from './live.ts';
import { registerStartStep } from './registry.ts';
import { route, socketRoute } from './router.ts';
import { scheduler } from './scheduler.ts';
import { versionDocument } from './versions.ts';

const TOKEN_BYTES = 24;

interface LinkRow { id: string; version_id: string; expires_at: Date; revoked: boolean }
type LinkState = 'active' | 'expired' | 'revoked';

const stateOf = (link: Pick<LinkRow, 'expires_at' | 'revoked'>): LinkState => {
  if (link.revoked) return 'revoked';
  return link.expires_at.getTime() <= clock.now() ? 'expired' : 'active';
};

const announce = (linkId: string, state: LinkState): void => hub.sendToLink(linkId, { type: 'link', data: { link_id: linkId, state } });

function watchExpiry(link: Pick<LinkRow, 'id' | 'expires_at'>): void {
  scheduler.schedule(link.expires_at.getTime(), async () => {
    const [current] = await db.query<Pick<LinkRow, 'revoked'>>('SELECT revoked FROM links WHERE id = $1', [link.id]);
    if (!current.revoked) announce(link.id, 'expired');
  });
}

registerStartStep(async () => {
  for (const row of await db.query<LinkRow>('SELECT id, version_id, expires_at, revoked FROM links WHERE NOT revoked')) {
    if (stateOf(row) === 'active') watchExpiry(row);
  }
});

/** A new link to the version; returns its id and the `/v/<token>` address. */
export async function createLink(versionId: string, createdBy: string): Promise<{ id: string; url: string; expires_at: string }> {
  const id = randomUUID();
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  const expiresAt = new Date(clock.now() + config.linkTtlMs);
  await db.query('INSERT INTO links (id, token, version_id, created_by, expires_at) VALUES ($1, $2, $3, $4, $5)', [id, token, versionId, createdBy, expiresAt]);
  watchExpiry({ id, expires_at: expiresAt });
  return { id, url: `/v/${token}`, expires_at: expiresAt.toISOString() };
}

/** The link behind a token, whatever its state; `not_found` for an unknown token. */
async function findLink(token: string): Promise<LinkRow> {
  const [link] = await db.query<LinkRow>('SELECT id, version_id, expires_at, revoked FROM links WHERE token = $1', [token]);
  if (!link) throw new ApiError('not_found', copy.NOT_FOUND);
  return link;
}

/** The link behind a token while it works: `link_revoked` and `link_expired` once it does not, `not_found` for an unknown token. */
async function openLink(token: string): Promise<LinkRow> {
  const link = await findLink(token);
  const state = stateOf(link);
  if (state === 'revoked') throw new ApiError('link_revoked', copy.LINK_ENDED.link_revoked);
  if (state === 'expired') throw new ApiError('link_expired', copy.LINK_ENDED.link_expired);
  return link;
}

route('POST', '/api/versions/:id/links', async (ctx) => {
  await accessTo(ctx, 'version', ctx.params.id, MINIMUM_ROLE.createLink);
  return ctx.reply(201, await createLink(ctx.params.id, requireUser(ctx).username));
});

route('DELETE', '/api/links/:id', async (ctx) => {
  await accessTo(ctx, 'link', ctx.params.id, MINIMUM_ROLE.turnOffLink);
  await db.query('UPDATE links SET revoked = true WHERE id = $1', [ctx.params.id]);
  announce(ctx.params.id, 'revoked');
  return ctx.reply(204);
});

route('GET', '/api/links/:token', async (ctx) => ctx.reply(200, await versionDocument((await openLink(ctx.params.token)).version_id)), { access: 'public' });

// A page whose link ended between loading the version and opening its socket still has to be told, so an ended link is attached too.
socketRoute('/api/links/:token/live', async (ctx) => {
  const link = await findLink(ctx.params.token);
  return {
    attach: (socket) => {
      hub.attachLink(link.id, socket);
      const state = stateOf(link);
      if (state !== 'active') announce(link.id, state);
    },
  };
}, { access: 'public' });
