/**
 * Photographs. A file is judged by its own header bytes, kept byte for byte in
 * MinIO, and only then does a row read `Stored`.
 */
import { createHash } from 'node:crypto';
import { F } from '../../shared/feedback.ts';
import { fail } from '../http/errors.ts';
import { fieldValue } from '../http/request.ts';
import type { Route } from '../http/context.ts';
import { resolvePiece, piece as resolved } from './lookup.ts';
import { presentPhotograph, type Row } from '../present.ts';
import { storageKeys, StorageUnavailable } from '../services/storage.ts';

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

/** Judged from the file's own header bytes, never its name or declared type. */
export function imageKind(bytes: Uint8Array): 'png' | 'jpeg' | null {
  if (PNG_MAGIC.every((b, i) => bytes[i] === b)) return 'png';
  if (JPEG_MAGIC.every((b, i) => bytes[i] === b)) return 'jpeg';
  return null;
}

export const photographRoutes: readonly Route[] = [
  {
    method: 'GET',
    pattern: '/api/pieces/:id/photographs',
    auth: 'required',
    resolve: resolvePiece,
    async handle(ctx) {
      const rows = await ctx.app.db.query<Row>(
        `SELECT * FROM photographs WHERE piece_id = $1 ORDER BY number`,
        [resolved(ctx).id],
      );
      ctx.json(200, { photographs: rows.map(presentPhotograph) });
    },
  },

  {
    method: 'POST',
    pattern: '/api/pieces/:id/photographs',
    auth: 'required',
    body: 'photograph',
    resolve: resolvePiece,
    async handle(ctx) {
      const desk = ctx.requireDesk();
      const piece = resolved(ctx);
      const parts = ctx.multipart;
      const file = parts?.files.find((f) => f.name === 'file');
      if (!file) throw fail.fields({ file: F.required });

      const sideText = fieldValue(parts!, 'side') ?? 'before';
      if (sideText !== 'before' && sideText !== 'after') throw fail.fields({ side: F.outOfRange });

      if (!imageKind(file.bytes)) throw fail.invalid(F.notImage);

      const sha256 = createHash('sha256').update(file.bytes).digest('hex');
      const already = await ctx.app.db.one<Row>(
        `SELECT number FROM photographs WHERE piece_id = $1 AND sha256 = $2`,
        [piece.id, sha256],
      );
      if (already) throw fail.conflict(F.photographRepeat(Number(already.number)));

      try {
        await ctx.app.storage.put(
          storageKeys.photograph(desk.id, String(piece.id), sha256),
          file.bytes,
          imageKind(file.bytes) === 'png' ? 'image/png' : 'image/jpeg',
        );
      } catch (error) {
        if (!(error instanceof StorageUnavailable)) throw error;
        throw fail.unavailable(F.storeDown);
      }

      const counted = await ctx.app.db.one<Row>(
        `UPDATE pieces SET photo_high = photo_high + 1 WHERE id = $1 RETURNING photo_high`,
        [piece.id],
      );
      const row = await ctx.app.db.one<Row>(
        `INSERT INTO photographs (piece_id, number, side, sha256, bytes, state)
         VALUES ($1,$2,$3,$4,$5,'stored') RETURNING *`,
        [piece.id, counted!.photo_high, sideText, sha256, file.bytes.length],
      );
      ctx.json(201, { photograph: presentPhotograph(row!) });
    },
  },

  {
    method: 'GET',
    pattern: '/api/pieces/:id/photographs/:photoId/file',
    auth: 'required',
    resolve: resolvePiece,
    async handle(ctx) {
      const desk = ctx.requireDesk();
      const piece = resolved(ctx);
      const photoId = ctx.param('photoId');
      if (!/^\d+$/.test(photoId)) throw fail.notFound();
      const row = await ctx.app.db.one<Row>(
        `SELECT * FROM photographs WHERE id = $1 AND piece_id = $2`,
        [photoId, piece.id],
      );
      if (!row) throw fail.notFound();
      if (row.state !== 'stored') throw fail.unavailable(F.storeDown);

      let bytes: Uint8Array | null;
      try {
        bytes = await ctx.app.storage.get(
          storageKeys.photograph(desk.id, String(piece.id), String(row.sha256)),
        );
      } catch (error) {
        if (!(error instanceof StorageUnavailable)) throw error;
        throw fail.unavailable(F.storeDown);
      }
      if (!bytes) throw fail.unavailable(F.storeDown);
      ctx.bytes(bytes, imageKind(bytes) === 'jpeg' ? 'image/jpeg' : 'image/png');
    },
  },
];
