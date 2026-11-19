/* Media serving: the stored WebP variants, visible only when the image belongs
   to a visible post (or is unattached and its uploader asks, or its post is
   removed and the caller is the author or a moderator). */
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { ApiError } from '../errors.js';
import type { Ctx } from '../context.js';
import type { Services } from '../routes.js';

export function mediaKey(sha256: string, slot: string): string {
  return `images/${sha256}/${slot}.webp`;
}

export async function serveMedia(services: Services, ctx: Ctx, imageId: number, slot: string): Promise<void> {
  const rows = await services.db.query(
    `SELECT i.sha256, i.owner_id, i.post_id, p.state AS post_state, p.author_id AS post_author, p.community_id AS community_id
     FROM images i LEFT JOIN posts p ON p.id = i.post_id WHERE i.id = $1`,
    [imageId]
  );
  if (rows.rows.length === 0) throw new ApiError('NOT_FOUND', 'Not found');
  const img = rows.rows[0] as { sha256: string; owner_id: string | null; post_id: string | null; post_state: string | null; post_author: string | null; community_id: string | null };
  if (img.post_id === null) {
    if (ctx.account === null || img.owner_id === null || Number(img.owner_id) !== ctx.account.id) {
      throw new ApiError('NOT_FOUND', 'Not found');
    }
  } else if (img.post_state === 'removed') {
    const isAuthor = ctx.account !== null && img.post_author !== null && Number(img.post_author) === ctx.account.id;
    const isMod = ctx.account !== null && img.community_id !== null && (await isModerator(services, Number(img.community_id), ctx.account.id));
    if (!isAuthor && !isMod) throw new ApiError('NOT_FOUND', 'Not found');
  } else if (img.post_state !== 'published') {
    throw new ApiError('NOT_FOUND', 'Not found');
  }
  try {
    const data = await services.storage.send(new GetObjectCommand({ Bucket: services.cfg.s3.bucket, Key: mediaKey(img.sha256, slot) }));
    const bytes = await data.Body?.transformToByteArray();
    if (bytes === undefined) throw new ApiError('NOT_FOUND', 'Not found');
    ctx.res.writeHead(200, { 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=31536000', 'X-Content-Type-Options': 'nosniff' });
    ctx.res.end(Buffer.from(bytes));
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError('STORAGE_UNAVAILABLE', 'Image uploads are unavailable right now');
  }
}

async function isModerator(services: Services, communityId: number, accountId: number): Promise<boolean> {
  const rows = await services.db.query(`SELECT 1 FROM moderators WHERE community_id = $1 AND account_id = $2`, [communityId, accountId]);
  return rows.rows.length > 0;
}
