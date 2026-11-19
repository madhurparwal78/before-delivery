import { bytesToColourRows } from '../../shared/composite.js';
import { openProject, openSprite, requireOwner, requirePerson, roleIn } from '../access.js';
import { instant, now } from '../clock.js';
import { config } from '../config.js';
import { one, query, transact } from '../db.js';
import { conflict, forbidden, notFound, READ_ONLY_LINK, unprocessable } from '../errors.js';
import type { Ctx, Route } from '../http.js';
import { closeShareStreams, openStream, closeStream, publishShare } from '../live.js';
import { token } from '../secrets.js';
import { compositeBytes, framesOf } from '../sprite.js';
import { idParam } from '../validate.js';
import { first } from '../db.js';

interface LinkRow {
  id: number;
  sprite_id: number;
  label: string;
  token: string;
  state: string;
  expires_at: Date | null;
}

function publicBase(ctx: Ctx): string {
  if (config.publicUrl !== '') return config.publicUrl.replace(/\/$/, '');
  return `http://${String(ctx.req.headers.host ?? '')}`;
}

function linkUrl(ctx: Ctx, linkToken: string): string {
  return `${publicBase(ctx)}/s/${linkToken}`;
}

async function liveLink(linkToken: string): Promise<LinkRow | null> {
  const link = await one<LinkRow>(
    'SELECT id, sprite_id, label, token, state, expires_at FROM share_links WHERE token = $1',
    [linkToken],
  );
  if (link === null || link.state !== 'active') return null;
  if (link.expires_at !== null && (await now()).getTime() >= link.expires_at.getTime()) return null;
  return link;
}

export const linkRoutes: Route[] = [
  {
    method: 'GET',
    pattern: '/api/projects/:id/links',
    handler: async (ctx) => {
      const access = await openProject(ctx, idParam(ctx, 'id'));
      const list = await query<LinkRow>(
        `SELECT l.id, l.sprite_id, l.label, l.token, l.state, l.expires_at
           FROM share_links l JOIN sprites s ON s.id = l.sprite_id
          WHERE s.project_id = $1 ORDER BY l.id`,
        [access.project.id],
      );
      const at = await now();
      return {
        status: 200,
        body: {
          links: list.map((link) => ({
            id: link.id,
            sprite: link.sprite_id,
            label: link.label,
            token: link.token,
            url: linkUrl(ctx, link.token),
            state:
              link.state === 'active' &&
              (link.expires_at === null || at.getTime() < link.expires_at.getTime())
                ? 'active'
                : 'ended',
            expires_at: link.expires_at === null ? null : instant(link.expires_at),
          })),
        },
      };
    },
  },
  {
    method: 'POST',
    pattern: '/api/sprites/:id/links',
    handler: async (ctx) => {
      const { sprite, access } = await openSprite(ctx, idParam(ctx, 'id'));
      requireOwner(access);
      const label = String(ctx.body.label ?? '').trim();
      if (label === '') throw unprocessable({ label: 'Name this link' });
      const at = await now();
      let expiresAt: Date | null = null;
      if (ctx.body.expires_at !== undefined && ctx.body.expires_at !== null) {
        const parsed = new Date(String(ctx.body.expires_at));
        if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= at.getTime()) {
          throw unprocessable({ expires_at: 'Choose a time after now' });
        }
        expiresAt = parsed;
      }
      const linkToken = token(16);
      const made = await one<{ id: number }>(
        `INSERT INTO share_links (sprite_id, label, token, state, expires_at, created_at)
         VALUES ($1, $2, $3, 'active', $4, $5) RETURNING id`,
        [sprite.id, label, linkToken, expiresAt, at],
      );
      return {
        status: 201,
        body: {
          id: (made as { id: number }).id,
          token: linkToken,
          url: linkUrl(ctx, linkToken),
          label,
          state: 'active',
          expires_at: expiresAt === null ? null : instant(expiresAt),
        },
      };
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/links/:id',
    handler: async (ctx) => {
      const { link } = await openLink(ctx, idParam(ctx, 'id'));
      await query("UPDATE share_links SET state = 'ended' WHERE id = $1", [link.id]);
      publishShare(link.token, { type: 'ended' });
      closeShareStreams(link.token);
      return { status: 200, body: { state: 'revoked' } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/links/:id/regenerate',
    handler: async (ctx) => {
      const { link } = await openLink(ctx, idParam(ctx, 'id'));
      const next = token(16);
      await query('UPDATE share_links SET token = $2 WHERE id = $1', [link.id, next]);
      publishShare(link.token, { type: 'ended' });
      closeShareStreams(link.token);
      return {
        status: 200,
        body: {
          id: link.id,
          token: next,
          url: linkUrl(ctx, next),
          state: 'active',
          expires_at: link.expires_at === null ? null : instant(link.expires_at),
        },
      };
    },
  },
  {
    method: 'GET',
    pattern: '/api/share/:token',
    handler: async (ctx) => {
      const link = await liveLink(ctx.params.token);
      if (link === null) throw notFound();
      return transact(async (client) => {
        const sprite = await first<{
          id: number;
          project_id: number;
          palette_id: number;
          name: string;
          width: number;
          height: number;
          seq: number;
        }>(
          client,
          'SELECT id, project_id, palette_id, name, width, height, seq FROM sprites WHERE id = $1',
          [link.sprite_id],
        );
        if (sprite === null) throw notFound();
        const frames = await framesOf(client, sprite.id);
        const tags = await client.query<{
          name: string;
          from_frame: number;
          to_frame: number;
          direction: string;
          repeat: number;
        }>('SELECT name, from_frame, to_frame, direction, repeat FROM tags WHERE sprite_id = $1 ORDER BY id', [
          sprite.id,
        ]);
        return {
          status: 200,
          body: {
            sprite: {
              name: sprite.name,
              width: sprite.width,
              height: sprite.height,
              seq: sprite.seq,
              frames: frames.map((frame) => ({
                number: frame.number,
                duration_ms: frame.duration_ms,
              })),
              tags: tags.rows.map((tag) => ({
                name: tag.name,
                from: tag.from_frame,
                to: tag.to_frame,
                direction: tag.direction,
                repeat: tag.repeat,
              })),
            },
            state: 'active',
          },
        };
      });
    },
  },
  {
    method: 'GET',
    pattern: '/api/share/:token/frames/:n/pixels',
    handler: async (ctx) => {
      const link = await liveLink(ctx.params.token);
      if (link === null) throw notFound();
      return transact(async (client) => {
        const sprite = await first<{
          id: number;
          project_id: number;
          palette_id: number;
          name: string;
          width: number;
          height: number;
          seq: number;
        }>(
          client,
          'SELECT id, project_id, palette_id, name, width, height, seq FROM sprites WHERE id = $1',
          [link.sprite_id],
        );
        if (sprite === null) throw notFound();
        const frame = await first<{ id: number }>(
          client,
          'SELECT id FROM frames WHERE sprite_id = $1 AND number = $2',
          [sprite.id, idParam(ctx, 'n')],
        );
        if (frame === null) throw notFound();
        const bytes = await compositeBytes(client, sprite, frame.id);
        return {
          status: 200,
          body: {
            width: sprite.width,
            height: sprite.height,
            seq: sprite.seq,
            rows: bytesToColourRows(bytes, sprite.width, sprite.height),
          },
        };
      });
    },
  },
  {
    method: 'GET',
    pattern: '/api/share/:token/events',
    raw: true,
    handler: async (ctx) => {
      const link = await liveLink(ctx.params.token);
      if (link === null) throw notFound();
      const client = openStream(ctx.res, { shareToken: link.token, spriteId: link.sprite_id });
      ctx.req.on('close', () => closeStream(client));
    },
  },
];

async function openLink(ctx: Ctx, linkId: number): Promise<{ link: LinkRow }> {
  const person = requirePerson(ctx);
  const link = await one<LinkRow & { project_id: number }>(
    `SELECT l.id, l.sprite_id, l.label, l.token, l.state, l.expires_at, s.project_id
       FROM share_links l JOIN sprites s ON s.id = l.sprite_id WHERE l.id = $1`,
    [linkId],
  );
  if (link === null) throw notFound();
  const role = await roleIn(link.project_id, person.id);
  if (role === null) throw notFound();
  if (role !== 'owner') throw forbidden('Only the project owner can do this');
  const at = await now();
  const ended =
    link.state !== 'active' ||
    (link.expires_at !== null && at.getTime() >= link.expires_at.getTime());
  if (ended) throw conflict({ error: 'link_ended' });
  return { link };
}

/** No other method ever succeeds on a share path. */
export const shareGuard: Route[] = ['POST', 'PUT', 'PATCH', 'DELETE'].flatMap((method) =>
  ['/api/share/:token', '/api/share/:token/frames/:n/pixels', '/api/share/:token/events'].map(
    (pattern) => ({
      method,
      pattern,
      handler: async (): Promise<never> => {
        throw forbidden(READ_ONLY_LINK);
      },
    }),
  ),
);
