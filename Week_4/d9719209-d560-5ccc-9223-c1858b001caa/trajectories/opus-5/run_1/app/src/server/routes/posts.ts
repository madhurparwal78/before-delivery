import { config } from '../../core/config.js';
import { db, many, one, transaction, type Queryable } from '../../core/db.js';
import { ApiError, errors } from '../../core/errors.js';
import { hotRankSql } from '../../core/schema.js';
import { sha256Hex } from '../../core/crypto.js';
import {
  feedPage,
  imageProjection,
  isArchived,
  lockState,
  loadPostRow,
  postProjection,
  projectPost,
  projectPosts,
  type ImageRow,
  type PostRow,
} from '../../domain/posts.js';
import { emitPostState } from '../../domain/events.js';
import { renderMarkdown } from '../../domain/markdown.js';
import { withIdempotency } from '../../domain/idempotency.js';
import { castVote, checkVoteRate, parseVoteValue } from '../../domain/votes.js';
import { parseSort, postBodyFieldError, titleFieldError } from '../../domain/validation.js';
import { copy } from '../../shared/copy.js';
import { isApprovedPoster } from '../../domain/communities.js';
import { moderates } from '../../domain/viewer.js';
import { processImage, UnsupportedImage } from '../../services/images.js';
import { confirmVariants, readVariant, storeVariants, type Slot } from '../../services/image-store.js';
import { StorageUnreachable } from '../../services/s3.js';
import { parseSingleFile } from '../multipart.js';
import { checkPostingRate, communityOr404, idempotencyKey } from '../guards.js';
import { requireMember, route, sendJson, type Ctx, type Route } from '../http.js';

async function postOr404(ctx: Ctx, postId: string, source: Queryable = db): Promise<PostRow> {
  const row = await loadPostRow(source, postId, ctx.viewer.member ? ctx.viewer.member.id : null);
  if (!row) throw errors.notFound('Post not found');
  return row;
}

/** Votes and new comments share the same state conflicts. */
export function assertVotable(row: PostRow): void {
  if (row.state === 'deleted') throw errors.conflict('That post was deleted');
  if (row.state === 'removed') throw new ApiError('REMOVED', 'That post was removed by moderators');
  if (isArchived(row)) throw new ApiError('ARCHIVED', copy.fixed.archived);
}

export async function emitStateFor(row: PostRow): Promise<void> {
  const locks = lockState(row);
  await emitPostState({
    postId: String(row.id),
    communityName: row.community_name,
    state: row.state,
    publicReason: row.removal_reason,
    locked: locks.locked,
    lockedUntil: locks.lockedUntil,
    pinned: row.pinned_at !== null,
    version: Number(row.version),
  });
}

interface ImageAttachment {
  id: string;
  alt: string | null;
}

function parseAttachments(raw: unknown): ImageAttachment[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > 10) {
    throw errors.validation('A post carries at most 10 images', { images: 'A post carries at most 10 images' });
  }
  return raw.map((entry) => {
    const value = entry as Record<string, unknown>;
    const id = typeof value.id === 'string' ? value.id : '';
    const alt = typeof value.alt === 'string' && value.alt.trim() !== '' ? value.alt.trim() : null;
    if (!/^\d+$/.test(id)) throw errors.validation('Those images are not ready', { images: copy.post.imagesNotReady });
    if (alt !== null && alt.length > 300) {
      throw errors.validation('Alt text is at most 300 characters', { alt: 'Alt text is at most 300 characters' });
    }
    return { id, alt };
  });
}

interface CreatedPost {
  status: number;
  body: unknown;
  created: string;
}

export const postRoutes: Route[] = [
  route(
    'GET',
    '/api/feed',
    async (ctx) => {
      const sort = parseSort(ctx.url.searchParams.get('sort'), ['hot', 'new', 'top'] as const, 'hot');
      const page = await feedPage({
        sort,
        cursor: ctx.url.searchParams.get('cursor'),
        viewerId: ctx.viewer.member ? ctx.viewer.member.id : null,
        scope: { kind: 'home', memberId: ctx.viewer.member ? ctx.viewer.member.id : null },
      });
      sendJson(ctx, 200, { items: await projectPosts(page.rows, ctx.viewer), nextCursor: page.nextCursor });
    },
    'none',
  ),

  route('POST', '/api/communities/:name/posts', async (ctx) => {
    const member = requireMember(ctx);
    const key = idempotencyKey(ctx);

    const create = async (tx: Queryable): Promise<CreatedPost> => {
      const community = await communityOr404(ctx.params.name);
      if (!member.emailVerified) throw new ApiError('EMAIL_UNVERIFIED', copy.post.unverified);
      const isModerator = moderates(ctx.viewer, String(community.id));
      if (
        community.type === 'restricted' &&
        !isModerator &&
        !(await isApprovedPoster(String(community.id), member.id))
      ) {
        throw new ApiError('NOT_APPROVED', copy.fixed.restrictedComposer);
      }
      await checkPostingRate(member);

      const title = typeof ctx.body.title === 'string' ? ctx.body.title.trim() : '';
      const bodyMd = typeof ctx.body.bodyMd === 'string' ? ctx.body.bodyMd : '';
      const spoiler = ctx.body.spoiler === true;
      const attachments = parseAttachments(ctx.body.images);

      const images: ImageRow[] = [];
      if (attachments.length > 0) {
        const rows = await many<ImageRow>(
          tx,
          `select id, post_id, sha256, alt, width, height, w320, w640, w1080 from images
           where id = any($1::bigint[]) and uploader_id = $2 and post_id is null`,
          [attachments.map((attachment) => attachment.id), member.id],
        );
        if (rows.length !== attachments.length) throw new ApiError('IMAGES_NOT_READY', copy.post.imagesNotReady);
        for (const attachment of attachments) {
          const row = rows.find((candidate) => String(candidate.id) === attachment.id);
          if (!row) throw new ApiError('IMAGES_NOT_READY', copy.post.imagesNotReady);
          const confirmed = await confirmVariants(row.sha256).catch((error: unknown) => {
            if (error instanceof StorageUnreachable) throw errors.storageUnavailable();
            throw error;
          });
          if (!confirmed) throw new ApiError('IMAGES_NOT_READY', copy.post.imagesNotReady);
          images.push({ ...row, alt: attachment.alt });
        }
      }

      if (key === null) {
        throw errors.validation(copy.validation.idempotencyRequired, {
          idempotencyKey: copy.validation.idempotencyRequired,
        });
      }

      const fields: Record<string, string> = {};
      const titleError = titleFieldError(title);
      const bodyError = postBodyFieldError(bodyMd);
      if (titleError) fields.title = titleError;
      if (bodyError) fields.bodyMd = bodyError;
      if (Object.keys(fields).length > 0) throw errors.validation('Check the highlighted fields', fields);

      const inserted = await one<{ id: string }>(
        tx,
        `insert into posts (community_id, author_id, title, body_md, body_html, spoiler, hot_rank)
         values ($1, $2, $3, $4, $5, $6, 0) returning id`,
        [community.id, member.id, title, bodyMd, renderMarkdown(bodyMd), spoiler],
      );
      const postId = String(inserted?.id);
      await tx.query(`update posts set hot_rank = ${hotRankSql('score')} where id = $1`, [postId]);

      for (const [index, image] of images.entries()) {
        await tx.query('update images set post_id = $2, position = $3, alt = $4 where id = $1', [
          image.id,
          postId,
          index,
          image.alt,
        ]);
      }

      const row = await postOr404(ctx, postId, tx);
      return { status: 201, body: postProjection({ row, images }, ctx.viewer), created: postId };
    };

    if (key === null) {
      await transaction(create);
      return;
    }
    const outcome = await withIdempotency(member.id, 'create-post', key, ctx.body, create);
    sendJson(ctx, outcome.status, outcome.body);
  }),

  route(
    'GET',
    '/api/posts/:id',
    async (ctx) => {
      const row = await postOr404(ctx, ctx.params.id);
      sendJson(ctx, 200, await projectPost(row, ctx.viewer));
    },
    'none',
  ),

  route('PATCH', '/api/posts/:id', async (ctx) => {
    const member = requireMember(ctx);
    const row = await postOr404(ctx, ctx.params.id);
    if (String(row.author_id) !== member.id) throw errors.forbidden('Only the author can edit this post');
    if (row.state === 'deleted') throw errors.conflict('That post was deleted');
    if (row.state === 'removed') throw new ApiError('REMOVED', 'That post was removed by moderators');
    if (isArchived(row)) throw new ApiError('ARCHIVED', copy.fixed.archived);

    const fields: Record<string, string> = {};
    if (ctx.body.title !== undefined) fields.title = copy.post.titleNote;
    const bodyMd = typeof ctx.body.bodyMd === 'string' ? ctx.body.bodyMd : '';
    const bodyError = postBodyFieldError(bodyMd);
    if (bodyError) fields.bodyMd = bodyError;
    if (Object.keys(fields).length > 0) throw errors.validation(fields.title ?? copy.post.bodyInvalid, fields);

    await db.query('update posts set body_md = $2, body_html = $3, edited_at = now() where id = $1', [
      row.id,
      bodyMd,
      renderMarkdown(bodyMd),
    ]);
    sendJson(ctx, 200, await projectPost(await postOr404(ctx, ctx.params.id), ctx.viewer));
  }),

  route('DELETE', '/api/posts/:id', async (ctx) => {
    const member = requireMember(ctx);
    const row = await postOr404(ctx, ctx.params.id);
    if (String(row.author_id) !== member.id) throw errors.forbidden('Only the author can delete this post');
    if (row.state === 'deleted') throw errors.conflict('That post was already deleted');
    await db.query(`update posts set state = 'deleted', pinned_at = null, version = version + 1 where id = $1`, [
      row.id,
    ]);
    const updated = await postOr404(ctx, ctx.params.id);
    await emitStateFor(updated);
    sendJson(ctx, 200, await projectPost(updated, ctx.viewer));
  }),

  route('PUT', '/api/posts/:id/vote', async (ctx) => {
    const member = requireMember(ctx);
    const row = await postOr404(ctx, ctx.params.id);
    if (!member.emailVerified) throw new ApiError('EMAIL_UNVERIFIED', copy.vote.unverified);
    await checkVoteRate(member);
    assertVotable(row);
    const value = parseVoteValue(ctx.body.value);
    sendJson(
      ctx,
      200,
      await castVote(
        member,
        { targetType: 'post', targetId: String(row.id), postId: String(row.id), communityName: row.community_name },
        value,
      ),
    );
  }),

  route('POST', '/api/markdown/preview', async (ctx) => {
    const bodyMd = typeof ctx.body.bodyMd === 'string' ? ctx.body.bodyMd : '';
    const error = postBodyFieldError(bodyMd);
    if (error) throw errors.validation(error, { bodyMd: error });
    sendJson(ctx, 200, { html: renderMarkdown(bodyMd) });
  }),

  route(
    'POST',
    '/api/images',
    async (ctx) => {
      const member = requireMember(ctx);
      if (!member.emailVerified) throw new ApiError('EMAIL_UNVERIFIED', copy.post.unverified);
      const file = parseSingleFile(ctx.rawBody, String(ctx.req.headers['content-type'] ?? ''));
      if (!file) throw errors.validation(copy.image.type, { file: copy.image.type });
      if (file.length > config.limits.maxImageBytes) {
        throw errors.validation(copy.image.size, { file: copy.image.size }, 413);
      }

      const processed = await processImage(file).catch((error: unknown) => {
        if (error instanceof UnsupportedImage) {
          const message = error.reason === 'pixels' ? copy.image.pixels : copy.image.type;
          throw errors.validation(message, { file: message });
        }
        throw error;
      });

      const sha256 = sha256Hex(file);
      const confirmed = await storeVariants(sha256, processed.variants).catch((error: unknown) => {
        if (error instanceof StorageUnreachable) throw errors.storageUnavailable();
        throw error;
      });
      if (!confirmed) throw errors.storageUnavailable();

      const widths = new Map(processed.variants.map((variant) => [variant.slot, variant.width]));
      const row = await one<ImageRow>(
        db,
        `insert into images (uploader_id, sha256, width, height, w320, w640, w1080)
         values ($1, $2, $3, $4, $5, $6, $7)
         returning id, post_id, sha256, alt, width, height, w320, w640, w1080`,
        [
          member.id,
          sha256,
          processed.width,
          processed.height,
          widths.get('320'),
          widths.get('640'),
          widths.get('1080'),
        ],
      );
      sendJson(ctx, 201, imageProjection(row as ImageRow));
    },
    'multipart',
  ),

  route(
    'GET',
    '/media/:imageId/:file',
    async (ctx) => {
      const match = /^(320|640|1080)\.webp$/.exec(ctx.params.file);
      if (!match) throw errors.notFound('Not found');
      const slot = match[1] as Slot;
      const row = await one<{
        sha256: string;
        uploader_id: string;
        post_id: string | null;
        state: string | null;
        community_id: string | null;
        author_id: string | null;
      }>(
        db,
        `select i.sha256, i.uploader_id, i.post_id, p.state, p.community_id, p.author_id
         from images i left join posts p on p.id = i.post_id where i.id = $1`,
        [/^\d+$/.test(ctx.params.imageId) ? ctx.params.imageId : '0'],
      );
      if (!row) throw errors.notFound('Not found');

      const viewerId = ctx.viewer.member ? ctx.viewer.member.id : null;
      if (row.post_id === null) {
        if (viewerId === null || String(row.uploader_id) !== viewerId) throw errors.notFound('Not found');
      } else if (row.state === 'deleted') {
        throw errors.notFound('Not found');
      } else if (row.state === 'removed') {
        const privileged =
          viewerId !== null &&
          (String(row.author_id) === viewerId || moderates(ctx.viewer, String(row.community_id)));
        if (!privileged) throw errors.notFound('Not found');
      }

      const bytes = await readVariant(row.sha256, slot).catch((error: unknown) => {
        if (error instanceof StorageUnreachable) throw errors.storageUnavailable();
        throw error;
      });
      if (!bytes) throw errors.notFound('Not found');
      ctx.res.writeHead(200, {
        'Content-Type': 'image/webp',
        'Content-Length': bytes.length,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      });
      ctx.res.end(bytes);
    },
    'none',
  ),
];
