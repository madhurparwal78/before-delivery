/* Image upload: magic-byte sniffing, re-encoding to WebP without EXIF, XMP or
   IPTC data, storage of the original and the 320/640/1080 slots, and
   confirmation by HEAD before the 201. */
import crypto from 'node:crypto';
import { PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { ApiError, validation } from '../errors.js';
import { route, type Route, type RouteHandler, type Services } from '../routes.js';
import type { Ctx } from '../context.js';
import { mediaKey } from './media.js';
import { sniff, decode, resize, encodeWebpFromRgba, type ImageKind } from '../imaging.js';

const SLOTS = [320, 640, 1080] as const;

export function registerImageRoutes(services: Services, add: (r: Route) => void): void {
  add(route('POST', '/api/images', upload(services), 'multipart'));
}

/* Extracts the single `file` part from a multipart body without a dependency. */
function parseMultipartFile(raw: Buffer, contentType: string): Buffer | null {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
  if (m === null) return null;
  const boundary = (m[1] ?? m[2]) as string;
  const delim = Buffer.from(`--${boundary}`);
  const parts: Buffer[] = [];
  let start = raw.indexOf(delim);
  while (start !== -1) {
    const next = raw.indexOf(delim, start + delim.length);
    if (next === -1) break;
    parts.push(raw.subarray(start + delim.length, next));
    start = next;
  }
  for (const part of parts) {
    let chunk = part;
    if (chunk[0] === 0x0d && chunk[1] === 0x0a) chunk = chunk.subarray(2);
    const headerEnd = chunk.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const headers = chunk.subarray(0, headerEnd).toString('utf8');
    if (!/name="file"/.test(headers)) continue;
    let body = chunk.subarray(headerEnd + 4);
    if (body.length >= 2 && body[body.length - 2] === 0x0d && body[body.length - 1] === 0x0a) body = body.subarray(0, body.length - 2);
    return Buffer.from(body);
  }
  return null;
}

function upload(services: Services): RouteHandler {
  return async (ctx) => {
    if (ctx.account === null) throw new ApiError('UNAUTHENTICATED', 'Sign in to continue');
    if (!ctx.account.emailVerified) throw new ApiError('EMAIL_UNVERIFIED', 'Verify your email to post');
    const raw = ctx.rawBody ?? Buffer.alloc(0);
    const contentType = ctx.req.headers['content-type'] ?? '';
    const file = parseMultipartFile(raw, contentType);
    if (file === null || file.length === 0) throw validation({ file: 'Use a JPEG, PNG or WebP image' });
    const maxBytes = services.cfg.limits.maxImageBytes;
    if (file.length > maxBytes) {
      throw new ApiError('VALIDATION', 'This image is too large', { fields: { file: 'This image is too large' }, status: 413 });
    }
    const kind = sniff(file);
    if (kind === null) throw validation({ file: 'Use a JPEG, PNG or WebP image' });

    // The decode step applies the EXIF orientation; nothing else survives.
    let image;
    try {
      image = await decode(file, kind as ImageKind);
    } catch {
      throw validation({ file: 'Use a JPEG, PNG or WebP image' });
    }
    if (image.width * image.height > 50_000_000) throw validation({ file: 'Images can be at most 50 megapixels' });
    if (image.width < 1 || image.height < 1) throw validation({ file: 'Use a JPEG, PNG or WebP image' });

    const sha = crypto.createHash('sha256').update(file).digest('hex');
    const variants: { slot: string; bytes: Uint8Array }[] = [];
    const original = await encodeWebpFromRgba(image, 82);
    variants.push({ slot: 'original', bytes: original });
    for (const slot of SLOTS) {
      const width = Math.min(slot, image.width);
      const resized = resize(image, width);
      const bytes = await encodeWebpFromRgba(resized, 82);
      variants.push({ slot: String(slot), bytes });
    }

    try {
      for (const v of variants) {
        await services.storage.send(
          new PutObjectCommand({ Bucket: services.cfg.s3.bucket, Key: mediaKey(sha, v.slot), Body: v.bytes, ContentType: 'image/webp' })
        );
      }
      // Confirm every object with HEAD before answering 201.
      for (const v of variants) {
        await services.storage.send(new HeadObjectCommand({ Bucket: services.cfg.s3.bucket, Key: mediaKey(sha, v.slot) }));
      }
    } catch {
      throw new ApiError('STORAGE_UNAVAILABLE', 'Image uploads are unavailable right now. Your draft is kept.');
    }

    const inserted = await services.db.query(
      `INSERT INTO images (sha256, owner_id, width, height, alt, post_id, position) VALUES ($1,$2,$3,$4,NULL,NULL,0) RETURNING id`,
      [sha, ctx.account.id, image.width, image.height]
    );
    const id = Number((inserted.rows[0] as { id: string }).id);
    // srcset lists each slot whose stored width differs from the ones before it.
    const srcsetWidths: number[] = [];
    for (const slot of SLOTS) {
      const width = Math.min(slot, image.width);
      if (!srcsetWidths.includes(width)) srcsetWidths.push(width);
    }
    return {
      status: 201,
      body: {
        id,
        alt: null,
        width: image.width,
        height: image.height,
        src: `/media/${id}/640.webp`,
        srcset: srcsetWidths.map((w) => `/media/${id}/${slotForWidth(w, image.width)}.webp ${w}w`).join(', '),
      },
    };
  };
}

function slotForWidth(width: number, originalWidth: number): string {
  for (const slot of SLOTS) {
    if (Math.min(slot, originalWidth) === width) return String(slot);
  }
  return '1080';
}
