import { db, transaction } from '../db/pool';
import { assertNoContactDetails, AUTHOR_LABEL, excerpt, postedMonth } from '../domain/anonymity';
import { COPY, textBetween } from '../domain/validate';
import { ApiError } from '../errors';
import type { Context } from '../http/context';
import { sendJson } from '../http/respond';
import { HANDLED, type Router } from '../http/router';
import { uuid } from '../ids';
import { publish } from '../services/live';

const REVIEW_PATH = /\/companies\/([a-z0-9-]+)\/reviews\/([0-9a-fA-F-]{36})/;

export type ChannelQuote =
  { review_id: string; company_slug: string; title: string; excerpt: string } | { removed: true } | null;

export interface ChannelPostBody {
  id: string;
  channel_slug: string;
  body: string;
  posted_month: string;
  author_label: string;
  quote: ChannelQuote;
}

async function quoteFor(body: string): Promise<ChannelQuote> {
  const match = REVIEW_PATH.exec(body);
  if (!match) return null;
  const row = await db.one<{ id: string; title: string; pros: string; slug: string }>(
    `SELECT p.id, p.title, p.pros, c.slug
       FROM posts p JOIN companies c ON c.id = p.company_id
      WHERE p.id = $1 AND p.kind = 'review' AND p.state = 'approved' AND p.deleted_at IS NULL`,
    [match[2]],
  );
  if (!row) return { removed: true };
  return { review_id: row.id, company_slug: row.slug, title: row.title, excerpt: excerpt(row.pros) };
}

async function projectChannelPost(
  row: { id: string; body: string; created_at: Date },
  channelSlug: string,
): Promise<ChannelPostBody> {
  return {
    id: row.id,
    channel_slug: channelSlug,
    body: row.body,
    posted_month: postedMonth(row.created_at),
    author_label: AUTHOR_LABEL,
    quote: await quoteFor(row.body),
  };
}

async function requireChannel(slug: string): Promise<{ id: string; slug: string; name: string }> {
  const channel = await db.one<{ id: string; slug: string; name: string }>(
    'SELECT id, slug, name FROM channels WHERE slug = $1',
    [slug],
  );
  if (!channel) throw new ApiError('not_found');
  return channel;
}

export function registerChannelRoutes(router: Router): void {
  router.get('/api/channels', async (ctx: Context) => {
    ctx.requireRole('member');
    const rows = await db.query<{ slug: string; name: string }>('SELECT slug, name FROM channels ORDER BY name');
    return { channels: rows };
  });

  router.get('/api/channels/:slug/posts', async (ctx: Context) => {
    ctx.requireRole('member');
    const channel = await requireChannel(ctx.param('slug'));
    const rows = await db.query<{ id: string; body: string; created_at: Date }>(
      'SELECT id, body, created_at FROM channel_posts WHERE channel_id = $1 ORDER BY created_at, id',
      [channel.id],
    );
    return { posts: await Promise.all(rows.map((row) => projectChannelPost(row, channel.slug))) };
  });

  router.post('/api/channels/:slug/posts', async (ctx: Context) => {
    const member = ctx.requireRole('member');
    const channel = await requireChannel(ctx.param('slug'));
    const body = ctx.json();
    const text = textBetween(body['body'], 1, 2000);
    if (text === null) throw new ApiError('validation_failed', { fields: { body: COPY.channel_body } });
    assertNoContactDetails([['body', text]]);

    const now = await ctx.now();
    const id = uuid();
    const post = await projectChannelPost({ id, body: text, created_at: now }, channel.slug);
    await transaction(async (tx) => {
      await tx.query(
        'INSERT INTO channel_posts (id, channel_id, author_id, body, created_at) VALUES ($1, $2, $3, $4, $5)',
        [id, channel.id, member.id, text, now],
      );
      await publish(tx, now, 'channel.post', { channel_slug: channel.slug, post }, { roles: ['member'] });
    });
    sendJson(ctx.res, 201, post);
    return HANDLED;
  });
}
