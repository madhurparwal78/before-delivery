import { asId, require, roleIn, spriteAccess } from './access';
import { instant, now } from './clock';
import { config } from './config';
import { one, pool, rows } from './db';
import { invalid, notFound, conflict } from './errors';
import { endViewers, joinViewer } from './hub';
import { created, decodePart, newToken, route } from './http';
import { enqueueMail } from './mailer';
import { loadFrames, loadSpriteRow } from './model';
import { tagInfos } from './infos';
import { compositeRows } from './sprites';
import { objectBody } from './validate';
import { DEFAULT_LOCALE, formatDate, type Locale } from '../shared/format';

interface LinkRow {
  id: number;
  sprite_id: number;
  label: string;
  token: string;
  expires_at: number | null;
  revoked: boolean;
}

/** The one place a link's state is decided: ended by revocation or by the server clock. */
export const linkState = (link: Pick<LinkRow, 'expires_at' | 'revoked'>): 'active' | 'ended' =>
  link.revoked || (link.expires_at !== null && link.expires_at <= now()) ? 'ended' : 'active';

const originOf = (host: string | undefined): string => config.publicUrl || `http://${host}`;

const linkJson = (link: LinkRow, origin: string, withLabel = true) => ({
  id: link.id,
  ...(withLabel ? { sprite: link.sprite_id } : {}),
  label: link.label,
  token: link.token,
  url: `${origin}/s/${link.token}`,
  state: linkState(link),
  expires_at: link.expires_at === null ? null : instant(link.expires_at),
});

const columns = 'id, sprite_id, label, token, expires_at, revoked';

route('GET', '/api/projects/:id/links', async (ctx) => {
  const projectId = asId(ctx.params.id);
  await roleIn(pool, ctx.need().id, projectId);
  const found = await rows<LinkRow>(pool, `SELECT l.id, l.sprite_id, l.label, l.token, l.expires_at, l.revoked FROM share_links l JOIN sprites s ON s.id = l.sprite_id WHERE s.project_id = $1 ORDER BY l.id`, [projectId]);
  return { links: found.map((l) => linkJson(l, originOf(ctx.req.headers.host))) };
});

route('POST', '/api/sprites/:id/links', async (ctx) => {
  const user = ctx.need();
  const { sprite, role } = await spriteAccess(user.id, asId(ctx.params.id));
  require(role, 'owner');
  const body = objectBody(ctx.body);
  const label = typeof body.label === 'string' ? body.label.trim() : '';
  const errors: Record<string, string> = {};
  if (label === '' || label.length > 80) errors.label = 'Name the link in up to 80 characters';
  let ends: number | null = null;
  if (body.expires_at !== null) {
    ends = typeof body.expires_at === 'string' ? Date.parse(body.expires_at) : Number.NaN;
    if (Number.isNaN(ends) || ends <= now()) errors.expires_at = 'Choose a time after now';
  }
  if (Object.keys(errors).length > 0) throw invalid(errors);
  const link = await one<LinkRow>(pool, `INSERT INTO share_links (sprite_id, label, token, expires_at, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING ${columns}`, [sprite.id, label, newToken(18), ends, user.id]);
  return created(linkJson(link as LinkRow, originOf(ctx.req.headers.host), false));
});

async function ownedLink(ctx: { need: () => { id: number }; params: Record<string, string> }): Promise<LinkRow> {
  const link = await one<LinkRow & { project_id: number }>(pool, `SELECT l.id, l.sprite_id, l.label, l.token, l.expires_at, l.revoked, s.project_id FROM share_links l JOIN sprites s ON s.id = l.sprite_id WHERE l.id = $1`, [asId(ctx.params.id)]);
  if (!link) throw notFound();
  require(await roleIn(pool, ctx.need().id, link.project_id), 'owner');
  if (linkState(link) === 'ended') throw conflict('link_ended');
  return link;
}

route('DELETE', '/api/links/:id', async (ctx) => {
  const link = await ownedLink(ctx);
  await pool.query('UPDATE share_links SET revoked = true, notified = true WHERE id = $1', [link.id]);
  endViewers(link.id);
  return { state: 'revoked' };
});

route('POST', '/api/links/:id/regenerate', async (ctx) => {
  const link = await ownedLink(ctx);
  const fresh = await one<LinkRow>(pool, `UPDATE share_links SET token = $2 WHERE id = $1 RETURNING ${columns}`, [link.id, newToken(18)]);
  endViewers(link.id);
  const json = linkJson(fresh as LinkRow, originOf(ctx.req.headers.host), false);
  return { id: json.id, token: json.token, url: json.url, state: json.state, expires_at: json.expires_at };
});

async function activeLink(token: string | undefined): Promise<LinkRow> {
  const link = await one<LinkRow>(pool, `SELECT ${columns} FROM share_links WHERE token = $1`, [token]);
  if (!link || linkState(link) === 'ended') throw notFound();
  return link;
}

/** Status for the document of /s/<token>: an ended or unknown link answers 404. */
export async function sharePageStatus(path: string): Promise<number> {
  const match = /^\/s\/([^/]+)\/?$/.exec(path);
  if (!match) return 200;
  const token = decodePart(match[1] ?? '');
  if (token === null) return 404;
  const link = await one<LinkRow>(pool, `SELECT ${columns} FROM share_links WHERE token = $1`, [token]);
  return link && linkState(link) === 'active' ? 200 : 404;
}

route('GET', '/api/share/:token', async (ctx) => {
  const link = await activeLink(ctx.params.token);
  const sprite = await loadSpriteRow(pool, link.sprite_id);
  if (!sprite) throw notFound();
  const [frames, tags] = await Promise.all([loadFrames(pool, sprite.id), tagInfos(pool, sprite.id)]);
  return {
    sprite: {
      name: sprite.name,
      width: sprite.width,
      height: sprite.height,
      seq: sprite.seq,
      frames: frames.map((f, i) => ({ number: i + 1, duration_ms: f.duration_ms })),
      tags: tags.map(({ name, from, to, direction, repeat }) => ({ name, from, to, direction, repeat })),
    },
    state: 'active',
  };
});

route('GET', '/api/share/:token/frames/:n/pixels', async (ctx) => {
  const link = await activeLink(ctx.params.token);
  const composite = await compositeRows(link.sprite_id, asId(ctx.params.n));
  if (!composite) throw notFound();
  return composite;
});

route('GET', '/api/share/:token/events', async (ctx) => {
  const link = await activeLink(ctx.params.token);
  joinViewer(ctx.res, link.sprite_id, link.id);
});

/** Ends links whose time has come: tells open viewers and mails the owner once. */
export async function sweepLinks(): Promise<void> {
  const ended = await rows<LinkRow & { project_id: number; sprite: string }>(
    pool,
    `UPDATE share_links l SET notified = true FROM sprites s
     WHERE s.id = l.sprite_id AND NOT l.notified AND NOT l.revoked AND l.expires_at IS NOT NULL AND l.expires_at <= $1
     RETURNING l.id, l.sprite_id, l.label, l.token, l.expires_at, l.revoked, s.project_id, s.name AS sprite`,
    [now()],
  );
  for (const link of ended) {
    endViewers(link.id);
    const owner = await one<Locale & { email: string }>(pool, 'SELECT u.email, u.number_format, u.time_zone FROM projects p JOIN users u ON u.id = p.owner_id WHERE p.id = $1', [link.project_id]);
    if (!owner) continue;
    await enqueueMail(pool, {
      to: owner.email,
      subject: `Read-only link ended: ${link.sprite}`,
      body: `Link: ${link.label}\nEnded: ${formatDate(link.expires_at ?? 0, owner ?? DEFAULT_LOCALE)}`,
    });
  }
}

