import { randomUUID } from 'node:crypto';
import { jsonResponse, type RequestContext } from '../http/context.js';
import {
  conflict,
  forbidden,
  gone,
  notFound,
  payloadTooLarge,
  staleEdit,
  storageUnavailable,
  unauthenticated,
  validationFailed,
} from '../http/errors.js';
import { route, type CompiledRoute } from '../http/router.js';
import { FieldProblems, readInteger, readTrimmed } from '../http/validate.js';
import { parseMultipart } from '../http/multipart.js';
import { instantParam, type Queryable } from '../db.js';
import {
  ladderInForceOn,
  loadAllPieces,
  loadPieceById,
  loadPieceByTagCode,
  nextSerial,
  photoJson,
  pieceJson,
  publicPieceJson,
  soldPieceGoneAt,
  statusOf,
  type PieceRecord,
} from '../data/pieces.js';
import {
  addDays,
  brusselsDate,
  isValidBrusselsDate,
  startOfBrusselsDay,
} from '../../shared/brussels.js';
import { parseTagCode, tagCodeForSerial } from '../domain/tagCode.js';
import {
  photoOriginalKey,
  photoPublicKey,
  StorageUnavailable,
} from '../services/storage.js';
import { UnreadablePhoto, makePublicCopy, sniffFormat } from '../services/images.js';
import { copy, fieldCopy } from '../../shared/copy.js';
import { MAX_PHOTOS_PER_PIECE, MAX_PHOTO_BODY_BYTES, MAX_PHOTO_BYTES } from '../../shared/shop.js';
import { isCategory, isCondition, isPieceStatus, isSize } from '../../shared/options.js';

const MAX_INTAKE_DAYS_BACK = 730;
const MIN_ASKING_PRICE_CENTS = 100;
const MAX_ASKING_PRICE_CENTS = 1_000_000;

type PublicVisibility = 'visible' | 'gone' | 'hidden';

export function publicVisibility(piece: PieceRecord, now: number): PublicVisibility {
  const status = statusOf(piece, now);
  if (status === 'on_rail' || status === 'on_hold') return 'visible';
  if (status === 'sold' && piece.sale !== null) {
    return now < soldPieceGoneAt(piece.sale.soldAt) ? 'visible' : 'gone';
  }
  return 'hidden';
}

async function pieceInPath(ctx: RequestContext): Promise<PieceRecord> {
  const piece = await loadPieceById(ctx.app.db, ctx.param('pieceId'), ctx.now);
  if (piece === null) throw notFound();
  return piece;
}

export async function recordAskingPrice(
  tx: Queryable,
  pieceId: string,
  askingPriceCents: number,
  effectiveFrom: number,
): Promise<void> {
  await tx.query(
    `INSERT INTO asking_prices (id, piece_id, asking_price_cents, effective_from)
     VALUES ($1, $2, $3, $4)`,
    [randomUUID(), pieceId, askingPriceCents, instantParam(effectiveFrom)],
  );
}

export function validateIntakeDate(
  problems: FieldProblems,
  intakeDate: string,
  now: number,
): void {
  const today = brusselsDate(now);
  if (
    !isValidBrusselsDate(intakeDate) ||
    intakeDate > today ||
    intakeDate < addDays(today, -MAX_INTAKE_DAYS_BACK)
  ) {
    problems.add('intakeDate', fieldCopy.intakeDate);
  }
}

export function validateAskingPrice(problems: FieldProblems, cents: number | null): void {
  if (cents === null || cents < MIN_ASKING_PRICE_CENTS || cents > MAX_ASKING_PRICE_CENTS) {
    problems.add('askingPriceCents', fieldCopy.askingPrice);
  }
}

export const pieceRoutes: CompiledRoute[] = [
  route({
    method: 'GET',
    path: '/api/public/pieces/:pieceId',
    access: 'public',
    resolve: async (ctx) => {
      const piece = await pieceInPath(ctx);
      const visibility = publicVisibility(piece, ctx.now);
      if (visibility === 'gone') throw gone('piece_gone', copy.pieceGone);
      if (visibility === 'hidden') throw notFound();
      return piece;
    },
    handle: async (ctx, piece) => jsonResponse(200, { piece: publicPieceJson(piece, ctx.now) }),
  }),

  route({
    method: 'GET',
    path: '/api/pieces',
    access: 'desk',
    handle: async (ctx) => {
      const status = ctx.query('status');
      if (status !== null && !isPieceStatus(status)) {
        throw validationFailed({ status: 'Choose a piece status.' });
      }
      const search = ctx.query('q');
      const needle = search === null ? null : search.trim().toLowerCase();
      const { now } = ctx;
      const pieces = (await loadAllPieces(ctx.app.db, now))
        .filter((piece) => status === null || statusOf(piece, now) === status)
        .filter((piece) => {
          if (needle === null || needle === '') return true;
          return (
            piece.description.toLowerCase().includes(needle) ||
            piece.brand.toLowerCase().includes(needle) ||
            piece.tagCode.toLowerCase().includes(needle) ||
            piece.consignorName.toLowerCase().includes(needle)
          );
        })
        .map((piece) => pieceJson(piece, now));
      return jsonResponse(200, { pieces });
    },
  }),

  route({
    method: 'GET',
    path: '/api/pieces/lookup',
    access: 'desk',
    handle: async (ctx) => {
      const tag = ctx.query('tag') ?? '';
      const parsed = parseTagCode(tag);
      if (parsed === null) throw validationFailed({ tag: fieldCopy.tagCode });
      const piece = await loadPieceByTagCode(ctx.app.db, parsed.tagCode, ctx.now);
      if (piece === null) throw notFound();
      return jsonResponse(200, { piece: pieceJson(piece, ctx.now) });
    },
  }),

  route({
    method: 'POST',
    path: '/api/pieces',
    access: 'desk',
    handle: async (ctx) => {
      const body = ctx.json();
      const consignorId = readTrimmed(body, 'consignorId');
      const { rows } = await ctx.app.db.query(
        `SELECT id FROM consignors WHERE id::text = $1 AND status <> 'erased'`,
        [consignorId],
      );
      if (rows.length === 0) throw notFound();

      const problems = new FieldProblems();
      const category = readTrimmed(body, 'category');
      if (!isCategory(category)) problems.add('category', 'Choose a category.');
      const size = readTrimmed(body, 'size');
      if (!isSize(size)) problems.add('size', 'Choose a size.');
      const condition = readTrimmed(body, 'condition');
      if (!isCondition(condition)) problems.add('condition', 'Choose a condition.');
      const brand = readTrimmed(body, 'brand');
      if (brand.length < 1 || brand.length > 60) problems.add('brand', 'Enter a brand.');
      const description = readTrimmed(body, 'description');
      if (description.length < 1 || description.length > 120) {
        problems.add('description', 'Enter a description.');
      }
      const askingPriceCents = readInteger(body, 'askingPriceCents');
      validateAskingPrice(problems, askingPriceCents);
      const intakeDate = readTrimmed(body, 'intakeDate');
      validateIntakeDate(problems, intakeDate, ctx.now);
      problems.throwIfAny();

      const ladder = await ladderInForceOn(ctx.app.db, intakeDate);
      if (ladder === null) throw validationFailed({ intakeDate: fieldCopy.intakeDate });

      const id = randomUUID();
      const serial = await nextSerial(ctx.app.db);
      await ctx.app.db.query(
        `INSERT INTO pieces (id, serial, tag_code, consignor_id, category, brand, description,
                             size, condition, asking_price_cents, intake_date, ladder_id,
                             version, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 1, $13)`,
        [
          id,
          serial,
          tagCodeForSerial(serial),
          consignorId,
          category,
          brand,
          description,
          size,
          condition,
          askingPriceCents,
          intakeDate,
          ladder.id,
          instantParam(ctx.now),
        ],
      );
      // The first asking price is in force from the piece's own intake day, so an earlier
      // sale inside its period gets the price in force then.
      await recordAskingPrice(
        ctx.app.db,
        id,
        askingPriceCents as number,
        startOfBrusselsDay(intakeDate),
      );
      const created = await loadPieceById(ctx.app.db, id, ctx.now);
      return jsonResponse(201, { piece: pieceJson(created as PieceRecord, ctx.now) });
    },
  }),

  route({
    method: 'GET',
    path: '/api/pieces/:pieceId',
    access: 'desk',
    resolve: pieceInPath,
    handle: async (ctx, piece) => jsonResponse(200, { piece: pieceJson(piece, ctx.now) }),
  }),

  route({
    method: 'PATCH',
    path: '/api/pieces/:pieceId',
    access: 'owner',
    resolve: pieceInPath,
    handle: async (ctx, piece) => {
      const body = ctx.json();
      const problems = new FieldProblems();
      const askingPriceCents = readInteger(body, 'askingPriceCents');
      validateAskingPrice(problems, askingPriceCents);
      problems.throwIfAny();

      const status = statusOf(piece, ctx.now);
      if (status === 'sold' || status === 'archived') {
        throw conflict('not_for_sale', `This piece isn't for sale.`);
      }

      const ifMatch = ctx.header('if-match');
      if (ifMatch !== null && ifMatch.replace(/"/g, '') !== String(piece.version)) {
        throw staleEdit(copy.pieceChangedMeanwhile);
      }

      await ctx.app.db.query(
        `UPDATE pieces SET asking_price_cents = $2, version = version + 1 WHERE id = $1`,
        [piece.id, askingPriceCents],
      );
      await recordAskingPrice(ctx.app.db, piece.id, askingPriceCents as number, ctx.now);
      const updated = await loadPieceById(ctx.app.db, piece.id, ctx.now);
      return jsonResponse(200, { piece: pieceJson(updated as PieceRecord, ctx.now) });
    },
  }),

  route({
    method: 'POST',
    path: '/api/pieces/:pieceId/archive',
    access: 'owner',
    expects: 'none',
    resolve: pieceInPath,
    handle: async (ctx, piece) => {
      const status = statusOf(piece, ctx.now);
      if (status === 'on_hold' || status === 'sold' || status === 'archived') {
        throw conflict('cannot_archive', `This piece can't be archived.`);
      }
      await ctx.app.db.query(`UPDATE pieces SET archived_at = $2 WHERE id = $1`, [
        piece.id,
        instantParam(ctx.now),
      ]);
      const updated = await loadPieceById(ctx.app.db, piece.id, ctx.now);
      return jsonResponse(200, { piece: pieceJson(updated as PieceRecord, ctx.now) });
    },
  }),

  route({
    method: 'POST',
    path: '/api/pieces/:pieceId/restore',
    access: 'owner',
    expects: 'none',
    resolve: pieceInPath,
    handle: async (ctx, piece) => {
      if (piece.archivedAt === null) throw conflict('not_archived', `This piece isn't archived.`);
      if (piece.consignorStatus === 'erased') {
        throw conflict('consignor_erased', 'This consignor has been erased.');
      }
      await ctx.app.db.query(`UPDATE pieces SET archived_at = NULL WHERE id = $1`, [piece.id]);
      const updated = await loadPieceById(ctx.app.db, piece.id, ctx.now);
      return jsonResponse(200, { piece: pieceJson(updated as PieceRecord, ctx.now) });
    },
  }),

  route({
    method: 'POST',
    path: '/api/pieces/:pieceId/collected',
    access: 'desk',
    expects: 'none',
    resolve: pieceInPath,
    handle: async (ctx, piece) => {
      if (statusOf(piece, ctx.now) !== 'returns_shelf') {
        throw conflict('not_on_returns_shelf', `This piece isn't on the Returns shelf.`);
      }
      await ctx.app.db.query(`UPDATE pieces SET collected_at = $2 WHERE id = $1`, [
        piece.id,
        instantParam(ctx.now),
      ]);
      const updated = await loadPieceById(ctx.app.db, piece.id, ctx.now);
      return jsonResponse(200, { piece: pieceJson(updated as PieceRecord, ctx.now) });
    },
  }),

  route({
    method: 'POST',
    path: '/api/pieces/:pieceId/photos',
    access: 'desk',
    expects: 'multipart',
    bodyLimit: MAX_PHOTO_BODY_BYTES,
    resolve: pieceInPath,
    handle: async (ctx, piece) => {
      const parts = parseMultipart(ctx.body, ctx.header('content-type') ?? '');
      const part = parts.find((candidate) => candidate.name === 'photo');
      if (part === undefined) throw validationFailed({ photo: copy.photoWrongContent });

      // The photo file is at most 5,000,000 bytes, counted on the file alone.
      if (part.bytes.length > MAX_PHOTO_BYTES) throw payloadTooLarge(copy.photoTooLarge);

      const format = sniffFormat(part.bytes);
      if (format === null) throw validationFailed({ photo: copy.photoWrongContent });

      if (piece.photos.length >= MAX_PHOTOS_PER_PIECE) {
        throw conflict('photo_limit', copy.photoLimit);
      }

      let publicCopy;
      try {
        publicCopy = await makePublicCopy(part.bytes, format);
      } catch (error) {
        if (error instanceof UnreadablePhoto) {
          throw validationFailed({ photo: copy.photoWrongContent });
        }
        throw error;
      }

      const photoId = randomUUID();
      try {
        await ctx.app.storage.putObject(photoOriginalKey(piece.id, photoId), part.bytes, format);
        await ctx.app.storage.putObject(
          photoPublicKey(piece.id, photoId),
          publicCopy.bytes,
          format,
        );
      } catch (error) {
        if (error instanceof StorageUnavailable) {
          await ctx.app.storage
            .deleteObject(photoOriginalKey(piece.id, photoId))
            .catch(() => undefined);
          throw storageUnavailable(copy.photoStorageDown);
        }
        throw error;
      }

      await ctx.app.db.query(
        `INSERT INTO photos (id, piece_id, content_type, width, height, position, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          photoId,
          piece.id,
          format,
          publicCopy.width,
          publicCopy.height,
          piece.photos.length,
          instantParam(ctx.now),
        ],
      );
      return jsonResponse(201, {
        photo: photoJson({
          id: photoId,
          pieceId: piece.id,
          contentType: format,
          width: publicCopy.width,
          height: publicCopy.height,
          createdAt: ctx.now,
        }),
      });
    },
  }),

  route({
    method: 'GET',
    path: '/api/photos/:photoId',
    access: 'public',
    resolve: async (ctx) => {
      const { rows } = await ctx.app.db.query(
        `SELECT id, piece_id, content_type FROM photos WHERE id::text = $1`,
        [ctx.param('photoId')],
      );
      const row = rows[0];
      if (row === undefined) throw notFound();
      const piece = await loadPieceById(ctx.app.db, row['piece_id'] as string, ctx.now);
      if (piece === null) throw notFound();
      if (publicVisibility(piece, ctx.now) !== 'visible') {
        if (ctx.member === null) throw unauthenticated();
        if (ctx.member.role === 'bookkeeper') throw forbidden();
      }
      return { pieceId: piece.id, photoId: row['id'] as string, contentType: row['content_type'] as string };
    },
    handle: async (ctx, photo) => {
      const stored = await ctx.app.storage.getObject(photoPublicKey(photo.pieceId, photo.photoId));
      if (stored === null) throw notFound();
      return {
        kind: 'bytes',
        status: 200,
        body: stored.body,
        contentType: photo.contentType,
        headers: { 'Cache-Control': 'private, max-age=60' },
      };
    },
  }),

  route({
    method: 'GET',
    path: '/api/photos/:photoId/original',
    access: 'owner',
    resolve: async (ctx) => {
      const { rows } = await ctx.app.db.query(
        `SELECT id, piece_id, content_type FROM photos WHERE id::text = $1`,
        [ctx.param('photoId')],
      );
      const row = rows[0];
      if (row === undefined) throw notFound();
      return {
        pieceId: row['piece_id'] as string,
        photoId: row['id'] as string,
        contentType: row['content_type'] as string,
      };
    },
    handle: async (ctx, photo) => {
      const stored = await ctx.app.storage.getObject(
        photoOriginalKey(photo.pieceId, photo.photoId),
      );
      if (stored === null) throw notFound();
      return {
        kind: 'bytes',
        status: 200,
        body: stored.body,
        contentType: photo.contentType,
        headers: {
          'Cache-Control': 'private, no-store',
          'Content-Disposition': `attachment; filename="${photo.photoId}"`,
        },
      };
    },
  }),
];
