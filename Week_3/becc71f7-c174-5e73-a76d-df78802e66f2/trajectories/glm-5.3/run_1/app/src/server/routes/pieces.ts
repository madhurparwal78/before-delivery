// Pieces (DP-08 to DP-11, DP-13, DP-28, DP-49, DP-52).

import crypto from 'node:crypto';
import type { Route, RouteContext } from '../http.js';
import { sendJson, parseJsonBody, asObject, str, num } from '../http.js';
import { ApiError } from '../errors.js';
import { CATEGORIES, SIZES, CONDITIONS } from '../../shared/vocab.js';
import { brusselsDateOf, daysBetween, brusselsMidnight, cutToSecond, addDays } from '../../shared/time.js';
import { tagCodeDigits, isValidTagCode, tagCodeFromSequence } from '../../shared/tagcode.js';
import { pieceJson } from '../views.js';
import { findPieceById, ladderInForceOn, photosOf } from '../rows.js';
import type { PieceRow } from '../rows.js';
import { sniffFormat, decodePhoto, encodeClean, targetSize, resample, contentTypeOf } from '../images.js';

export const pieceRoutes: Route[] = [
  {
    method: 'GET', pattern: '/api/pieces', bodyLimit: 0, auth: 'desk',
    handle: async (ctx) => {
      const status = ctx.url.searchParams.get('status');
      const q = ctx.url.searchParams.get('q')?.toLowerCase().trim() ?? '';
      const now = new Date();
      const values: unknown[] = [];
      const where: string[] = [];
      if (status) { where.push('status = $1'); values.push(status); }
      const { rows } = await ctx.services.pool.query<PieceRow>(
        `SELECT * FROM pieces ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY intake_date DESC, tag_digits`,
        values
      );
      const needleDigits = tagCodeDigits(q);
      const filtered = rows.filter((p) => {
        if (!q) return true;
        const inText = p.description.toLowerCase().includes(q) || p.brand.toLowerCase().includes(q);
        const byTag = needleDigits.length === 8 && p.tag_digits === needleDigits;
        return inText || byTag;
      });
      sendJson(ctx.res, 200, { pieces: await Promise.all(filtered.map((p) => pieceJson(ctx.services.pool, p, now))) });
    },
  },
  {
    method: 'GET', pattern: '/api/pieces/lookup', bodyLimit: 0, auth: 'desk',
    handle: async (ctx) => {
      const tag = ctx.url.searchParams.get('tag') ?? '';
      const digits = tagCodeDigits(tag);
      if (!/^\d{8}$/.test(digits) || !isValidTagCode(digits)) {
        throw new ApiError(422, 'validation_failed', 'This tag code\u2019s check digit doesn\u2019t match.', { tag: 'This tag code\u2019s check digit doesn\u2019t match.' });
      }
      const { rows } = await ctx.services.pool.query<PieceRow>('SELECT * FROM pieces WHERE tag_digits = $1', [digits]);
      if (rows.length === 0) throw new ApiError(404, 'not_found', 'Not found.');
      sendJson(ctx.res, 200, { piece: await pieceJson(ctx.services.pool, rows[0]!, new Date()) });
    },
  },
  {
    method: 'POST', pattern: '/api/pieces', bodyLimit: 65536, auth: 'desk',
    handle: async (ctx) => {
      requireJson(ctx);
      const body = asObject(parseJsonBody(ctx));
      const fields: Record<string, string> = {};

      const consignorId = str(body.consignorId);
      const category = str(body.category);
      const brand = str(body.brand);
      const description = str(body.description);
      const size = str(body.size);
      const condition = str(body.condition);
      const askingPriceCents = num(body.askingPriceCents);
      const intakeDate = str(body.intakeDate);

      // Body ids are judged before field validation (ladder step 10).
      let consignor: { id: string; status: string } | null = null;
      if (consignorId) {
        const { rows } = await ctx.services.pool.query<{ id: string; status: string }>(
          'SELECT id, status FROM consignors WHERE id = $1', [consignorId]
        );
        consignor = rows[0] ?? null;
        if (!consignor || consignor.status === 'erased') throw new ApiError(404, 'not_found', 'Not found.');
      } else {
        fields.consignorId = 'Choose a consignor.';
      }

      if (!category || !CATEGORIES.some((c) => c.value === category)) fields.category = 'Choose a category.';
      if (!brand || brand.trim().length === 0 || brand.length > 60) fields.brand = 'Enter a brand of 1 to 60 characters.';
      if (!description || description.trim().length === 0 || description.length > 120) fields.description = 'Enter a description of 1 to 120 characters.';
      if (!size || !SIZES.some((s) => s.value === size)) fields.size = 'Choose a size.';
      if (!condition || !CONDITIONS.some((c) => c.value === condition)) fields.condition = 'Choose a condition.';
      if (askingPriceCents === undefined || !Number.isInteger(askingPriceCents) || askingPriceCents < 100 || askingPriceCents > 1000000) {
        fields.askingPriceCents = 'Enter a price from \u20AC1.00 to \u20AC10,000.00.';
      }
      const today = brusselsDateOf(new Date());
      if (!intakeDate || !/^\d{4}-\d{2}-\d{2}$/.test(intakeDate) || daysBetween(today, intakeDate) > 730 || daysBetween(today, intakeDate) < 0) {
        fields.intakeDate = 'Choose today or a date up to 730 days back.';
      }
      if (Object.keys(fields).length > 0) throw new ApiError(422, 'validation_failed', 'There\u2019s a problem.', fields);

      const ladder = await ladderInForceOn(ctx.services.pool, intakeDate!);

      const id = crypto.randomUUID();
      const tag = await nextTagDigits(ctx);
      await ctx.services.pool.query(
        `INSERT INTO pieces (id, tag_digits, consignor_id, category, brand, description, size, condition,
          asking_price_cents, intake_date, ladder_id, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'on_rail', $12)`,
        [id, tag, consignor!.id, category!, brand!.trim(), description!.trim(), size!, condition!,
         askingPriceCents!, intakeDate!, ladder!.id, new Date()]
      );
      await ctx.services.pool.query(
        'INSERT INTO price_history (piece_id, asking_price_cents, effective_from) VALUES ($1, $2, $3)',
        [id, askingPriceCents!, brusselsMidnight(intakeDate!)]
      );
      const piece = await findPieceById(ctx.services.pool, id);
      sendJson(ctx.res, 201, { piece: await pieceJson(ctx.services.pool, piece!, new Date()) });
    },
  },
  {
    method: 'GET', pattern: '/api/pieces/:id', bodyLimit: 0, auth: 'desk',
    handle: async (ctx) => {
      const piece = await findPieceById(ctx.services.pool, ctx.params.id!);
      if (!piece) throw new ApiError(404, 'not_found', 'Not found.');
      sendJson(ctx.res, 200, { piece: await pieceJson(ctx.services.pool, piece, new Date()) });
    },
  },
  {
    method: 'PATCH', pattern: '/api/pieces/:id', bodyLimit: 65536, auth: 'owner',
    handle: async (ctx) => {
      const piece = await findPieceById(ctx.services.pool, ctx.params.id!);
      if (!piece) throw new ApiError(404, 'not_found', 'Not found.');
      if (piece.status === 'sold' || piece.status === 'archived') {
        throw new ApiError(409, 'not_for_sale', 'This piece is not on the rail.');
      }
      const ifMatch = ctx.req.headers['if-match'];
      if (ifMatch && ifMatch.replace(/"/g, '') !== String(piece.version)) {
        throw new ApiError(412, 'stale_edit', 'This piece changed since you opened it. Check the price and save again.');
      }
      requireJson(ctx);
      const body = asObject(parseJsonBody(ctx));
      const askingPriceCents = num(body.askingPriceCents);
      if (askingPriceCents === undefined || !Number.isInteger(askingPriceCents) || askingPriceCents < 100 || askingPriceCents > 1000000) {
        throw new ApiError(422, 'validation_failed', 'There\u2019s a problem.', { askingPriceCents: 'Enter a price from \u20AC1.00 to \u20AC10,000.00.' });
      }
      const now = cutToSecond(new Date());
      await ctx.services.pool.query('UPDATE pieces SET asking_price_cents = $1, version = version + 1 WHERE id = $2',
        [askingPriceCents, piece.id]);
      await ctx.services.pool.query(
        'INSERT INTO price_history (piece_id, asking_price_cents, effective_from) VALUES ($1, $2, $3)',
        [piece.id, askingPriceCents, now]
      );
      const updated = await findPieceById(ctx.services.pool, piece.id);
      sendJson(ctx.res, 200, { piece: await pieceJson(ctx.services.pool, updated!, new Date()) });
    },
  },
  {
    // Photos: the body limit is 6,000,000 bytes with the file itself at most 5,000,000 (DP-10).
    method: 'POST', pattern: '/api/pieces/:id/photos', bodyLimit: 6000000, auth: 'desk',
    handle: async (ctx) => {
      const piece = await findPieceById(ctx.services.pool, ctx.params.id!);
      if (!piece) throw new ApiError(404, 'not_found', 'Not found.');
      const existing = await photosOf(ctx.services.pool, piece.id);
      if (existing.length >= 6) {
        throw new ApiError(409, 'photo_limit', 'A piece can have at most 6 photos.');
      }
      const contentType = (ctx.req.headers['content-type'] ?? '').toLowerCase();
      if (!contentType.startsWith('multipart/form-data')) {
        throw new ApiError(415, 'unsupported_media_type', 'Send the photo as multipart/form-data.');
      }
      const file = readMultipartFile(ctx.body!, ctx.req.headers['content-type'] ?? '', 'photo');
      if (!file) throw new ApiError(422, 'validation_failed', 'There\u2019s a problem.', { photo: 'Choose a photo.' });
      if (file.bytes.length > 5000000) {
        throw new ApiError(413, 'payload_too_large', 'This photo is over 5,000,000 bytes.');
      }
      const format = sniffFormat(file.bytes);
      if (!format) {
        throw new ApiError(422, 'validation_failed', 'There\u2019s a problem.', { photo: 'Use a JPEG, PNG or WebP photo.' });
      }
      let decoded;
      try {
        decoded = await decodePhoto(file.bytes, format);
      } catch {
        throw new ApiError(422, 'validation_failed', 'There\u2019s a problem.', { photo: 'Use a JPEG, PNG or WebP photo.' });
      }
      const clean = encodeClean(resample(decoded, targetSize(decoded.width, decoded.height)));

      const id = crypto.randomUUID();
      const originalKey = `pieces/${piece.id}/photos/${id}/original`;
      const publicKey = `pieces/${piece.id}/photos/${id}/public`;
      const bytes = await clean;
      // While MinIO is unreachable a photo is refused with nothing stored (DP-11).
      try {
        await ctx.services.storage.put(originalKey, file.bytes, contentTypeOf(format));
        await ctx.services.storage.put(publicKey, bytes, contentTypeOf(format));
      } catch {
        throw new ApiError(503, 'storage_unavailable', 'Photos can\u2019t be saved right now. Nothing was stored \u2014 try again in a moment.');
      }
      const position = existing.length;
      await ctx.services.pool.query(
        `INSERT INTO photos (id, piece_id, content_type, width, height, position, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, piece.id, contentTypeOf(format), bytesWidth(decoded), bytesHeight(decoded), position, new Date()]
      );
      const photo = (await photosOf(ctx.services.pool, piece.id)).find((p) => p.id === id)!;
      sendJson(ctx.res, 201, {
        photo: {
          id: photo.id, pieceId: photo.piece_id, contentType: photo.content_type,
          width: photo.width, height: photo.height, publicUrl: `/api/photos/${photo.id}`,
          createdAt: new Date(photo.created_at).toISOString().replace(/\.\d{3}Z$/, 'Z'),
        },
      });
    },
  },
  {
    method: 'POST', pattern: '/api/pieces/:id/archive', bodyLimit: 0, auth: 'owner',
    handle: async (ctx) => {
      const piece = await findPieceById(ctx.services.pool, ctx.params.id!);
      if (!piece) throw new ApiError(404, 'not_found', 'Not found.');
      if (piece.status === 'on_hold' || piece.status === 'sold' || piece.status === 'archived') {
        throw new ApiError(409, 'cannot_archive', 'This piece can\u2019t be archived.');
      }
      await ctx.services.pool.query("UPDATE pieces SET status = 'archived', archived_at = $1 WHERE id = $2", [new Date(), piece.id]);
      const updated = await findPieceById(ctx.services.pool, piece.id);
      sendJson(ctx.res, 200, { piece: await pieceJson(ctx.services.pool, updated!, new Date()) });
    },
  },
  {
    method: 'POST', pattern: '/api/pieces/:id/restore', bodyLimit: 0, auth: 'owner',
    handle: async (ctx) => {
      const piece = await findPieceById(ctx.services.pool, ctx.params.id!);
      if (!piece) throw new ApiError(404, 'not_found', 'Not found.');
      if (piece.status !== 'archived') throw new ApiError(409, 'not_archived', 'This piece is not archived.');
      const { rows } = await ctx.services.pool.query<{ status: string }>('SELECT status FROM consignors WHERE id = $1', [piece.consignor_id]);
      if (rows[0]?.status === 'erased') throw new ApiError(409, 'consignor_erased', 'This consignor is erased.');
      // Bring it back exactly as it was: the same tag code, photos, choice and
      // station history; its state is whatever its dates give now.
      await ctx.services.pool.query(
        "UPDATE pieces SET status = 'on_rail', archived_at = NULL WHERE id = $1", [piece.id]
      );
      await refreshState(ctx, piece.id);
      const updated = await findPieceById(ctx.services.pool, piece.id);
      sendJson(ctx.res, 200, { piece: await pieceJson(ctx.services.pool, updated!, new Date()) });
    },
  },
  {
    method: 'POST', pattern: '/api/pieces/:id/collected', bodyLimit: 0, auth: 'desk',
    handle: async (ctx) => {
      const piece = await findPieceById(ctx.services.pool, ctx.params.id!);
      if (!piece) throw new ApiError(404, 'not_found', 'Not found.');
      if (piece.status !== 'returns_shelf') {
        throw new ApiError(409, 'not_on_returns_shelf', 'This piece is not on the Returns shelf.');
      }
      await ctx.services.pool.query("UPDATE pieces SET status = 'returned', collected_at = $1 WHERE id = $2", [new Date(), piece.id]);
      const updated = await findPieceById(ctx.services.pool, piece.id);
      sendJson(ctx.res, 200, { piece: await pieceJson(ctx.services.pool, updated!, new Date()) });
    },
  },
  {
    method: 'GET', pattern: '/api/photos/:id', bodyLimit: 0, auth: 'public',
    handle: async (ctx) => {
      const photo = await photoById(ctx, ctx.params.id!);
      servePhoto(ctx, photo, 'public');
    },
  },
  {
    method: 'GET', pattern: '/api/photos/:id/original', bodyLimit: 0, auth: 'owner',
    handle: async (ctx) => {
      const photo = await photoById(ctx, ctx.params.id!);
      servePhoto(ctx, photo, 'original');
    },
  },
];

function bytesWidth(d: { width: number }): number { return d.width; }
function bytesHeight(d: { height: number }): number { return d.height; }

async function photoById(ctx: RouteContext, id: string): Promise<{ id: string; piece_id: string; content_type: string }> {
  const { rows } = await ctx.services.pool.query('SELECT id, piece_id, content_type FROM photos WHERE id = $1', [id]);
  if (rows.length === 0) throw new ApiError(404, 'not_found', 'Not found.');
  return rows[0]!;
}

async function servePhoto(ctx: RouteContext, photo: { id: string; piece_id: string; content_type: string }, variant: 'public' | 'original'): Promise<void> {
  const key = `pieces/${photo.piece_id}/photos/${photo.id}/${variant}`;
  let bytes: Uint8Array;
  try {
    bytes = await ctx.services.storage.get(key);
  } catch {
    throw new ApiError(503, 'storage_unavailable', 'Photos can\u2019t be loaded right now.');
  }
  ctx.res.writeHead(200, { 'Content-Type': photo.content_type, 'Content-Length': String(bytes.length), 'Cache-Control': 'public, max-age=60' });
  ctx.res.end(Buffer.from(bytes));
}

/** The next tag code's storage key: the next seven-digit number after the
 * highest one given so far, with its Luhn check digit (DP-09). */
async function nextTagDigits(ctx: RouteContext): Promise<string> {
  const { rows } = await ctx.services.pool.query<{ max: string | null }>(
    "SELECT MAX(tag_digits) AS max FROM pieces WHERE tag_digits ~ '^[0-9]{8}$'"
  );
  const highest = rows[0]?.max ? Number(rows[0].max.slice(0, 7)) : 999999;
  return tagCodeFromSequence(Math.max(highest, 999999) + 1).replace(/\D/g, '');
}

function requireJson(ctx: RouteContext): void {
  const type = ctx.req.headers['content-type'] ?? '';
  if (!type.toLowerCase().startsWith('application/json')) {
    throw new ApiError(415, 'unsupported_media_type', 'Send JSON with a content type of application/json.');
  }
}

/** Read one file part out of a multipart/form-data body. */
export function readMultipartFile(body: Buffer, contentTypeHeader: string, name: string): { bytes: Uint8Array; filename: string; contentType: string } | null {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentTypeHeader);
  const boundary = match?.[1] ?? match?.[2];
  if (!boundary) return null;
  const delimiter = Buffer.from(`--${boundary}`);
  let start = body.indexOf(delimiter);
  while (start >= 0) {
    const next = body.indexOf(delimiter, start + delimiter.length);
    if (next < 0) break;
    const headStart = start + delimiter.length;
    const headEnd = body.indexOf(Buffer.from('\r\n\r\n'), headStart);
    if (headEnd < 0 || headEnd > next) { start = next; continue; }
    const headers = body.subarray(headStart, headEnd).toString('utf8');
    const dataStart = headEnd + 4;
    const dataEnd = Math.max(dataStart, next - 2);
    const nameMatch = /name="([^"]*)"/i.exec(headers);
    const fileMatch = /filename="([^"]*)"/i.exec(headers);
    const typeMatch = /content-type:\s*([^\r\n]+)/i.exec(headers);
    if ((nameMatch?.[1] ?? '') === name) {
      return {
        bytes: body.subarray(dataStart, dataEnd),
        filename: fileMatch?.[1] ?? '',
        contentType: typeMatch?.[1]?.trim() ?? '',
      };
    }
    start = next;
  }
  return null;
}

/** Period-end transitions (DP-50), applied on read so a refresh never misses one. */
async function refreshState(ctx: RouteContext, pieceId: string): Promise<void> {
  const piece = await findPieceById(ctx.services.pool, pieceId);
  if (!piece) return;
  const now = new Date();
  const { rows } = await ctx.services.pool.query<{ period_end_day: number }>(
    'SELECT period_end_day FROM ladders WHERE id = $1', [piece.ladder_id]
  );
  const periodEnd = rows[0]?.period_end_day ?? 90;
  const endsAt = brusselsMidnight(addDays(piece.intake_date, periodEnd));
  const shelfDeadline = brusselsMidnight(addDays(piece.intake_date, periodEnd + 14));
  if (now.getTime() >= endsAt.getTime() && (piece.status === 'on_rail' || piece.status === 'on_hold')) {
    const to = piece.choice === 'return' ? 'returns_shelf' : 'donation_box';
    await ctx.services.pool.query('UPDATE pieces SET status = $1 WHERE id = $2', [to, piece.id]);
    return;
  }
  if (now.getTime() >= shelfDeadline.getTime() && piece.status === 'returns_shelf') {
    await ctx.services.pool.query("UPDATE pieces SET status = 'donation_box' WHERE id = $1", [piece.id]);
  }
}

