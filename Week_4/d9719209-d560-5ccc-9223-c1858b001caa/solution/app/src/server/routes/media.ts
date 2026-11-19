import { createHash } from 'node:crypto';
import { pool, one } from '../db.js';
import { config } from '../config.js';
import { now } from '../clock.js';
import { AppError, notFound, validation } from '../errors.js';
import { created, route, type Ctx, type Reply } from '../http.js';
import { optionalUser, requireUser, requireVerified } from '../guards.js';
import { MAX_PIXELS, SLOTS, processImage, sniffImage } from '../images.js';
import { getObject, objectExists, putObject } from '../storage.js';
import { imageView } from '../views.js';
import { parseId } from '../validate.js';

const IMAGE_TYPE = 'Use a JPEG, PNG or WebP image';
const objectKey = (sha256: string, slot: string): string => `images/${sha256}/${slot}.webp`;

async function upload(ctx: Ctx): Promise<Reply> {
  const user = requireUser(ctx);
  requireVerified(user);
  const file = ctx.file;
  if (!file) throw validation({ file: IMAGE_TYPE });
  if (file.size > config.limits.maxImageBytes) {
    throw new AppError('VALIDATION', 'This image is too large', { status: 413, fields: { file: 'This image is too large' } });
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  const sniffed = sniffImage(bytes);
  if (!sniffed) throw validation({ file: IMAGE_TYPE });
  if (sniffed.width * sniffed.height > MAX_PIXELS) throw validation({ file: 'Images can be at most 50 megapixels' });
  const processed = await processImage(bytes, sniffed).catch(() => { throw validation({ file: IMAGE_TYPE }); });
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const objects: [string, Buffer][] = [
    [objectKey(sha256, 'original'), processed.original],
    ...SLOTS.map((slot): [string, Buffer] => [objectKey(sha256, String(slot)), processed.slots[slot]]),
  ];
  await Promise.all(objects.map(([key, body]) => putObject(key, body, 'image/webp')));
  const confirmed = await Promise.all(objects.map(([key]) => objectExists(key)));
  if (confirmed.includes(false)) throw new AppError('STORAGE_UNAVAILABLE', 'Image storage is unavailable right now');
  const row = await one<{ id: string }>(pool,
    'INSERT INTO images (uploader_id, sha256, width, height, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [user.id, sha256, processed.width, processed.height, now()]);
  return created(imageView({ id: (row as { id: string }).id, alt: null, width: processed.width, height: processed.height }));
}

async function media(ctx: Ctx): Promise<Reply> {
  const viewer = optionalUser(ctx);
  const id = parseId(ctx.params.id as string);
  const slot = /^(320|640|1080)\.webp$/.exec(ctx.params.file as string)?.[1];
  if (id === null || !slot) throw notFound('No such image');
  const row = await one<{ sha256: string; visible: boolean }>(pool,
    `SELECT i.sha256,
       (i.uploader_id = $2::bigint
        OR p.state = 'published'
        OR (p.state = 'removed' AND (p.author_id = $2::bigint
             OR EXISTS (SELECT 1 FROM moderators m WHERE m.community_id = p.community_id AND m.user_id = $2::bigint)))) AS visible
     FROM images i LEFT JOIN posts p ON p.id = i.post_id WHERE i.id = $1`,
    [id, viewer?.id ?? null]);
  if (!row?.visible) throw notFound('No such image');
  const data = await getObject(objectKey(row.sha256, slot));
  if (!data) throw notFound('No such image');
  return { status: 200, raw: data, type: 'image/webp', headers: { 'Cache-Control': 'private, max-age=86400' } };
}

export function registerMediaRoutes(): void {
  route('POST', '/api/images', upload, { body: 'multipart' });
  route('GET', '/media/:id/:file', media);
}
