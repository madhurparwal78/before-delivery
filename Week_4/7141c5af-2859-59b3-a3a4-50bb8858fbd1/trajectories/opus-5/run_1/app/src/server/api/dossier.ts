/**
 * The conservation dossier's endpoints. Downloads are limited per desk, and a
 * signed dossier never changes.
 */
import { F } from '../../shared/feedback.ts';
import { DOSSIER_DOWNLOAD_LIMIT } from '../config.ts';
import { BUSINESS_ZONE, localMinuteCeil } from '../domain/time.ts';
import { namesMatch } from '../domain/names.ts';
import { fail } from '../http/errors.ts';
import type { Ctx, Route } from '../http/context.ts';
import { resolvePiece, piece as resolved } from './lookup.ts';
import { presentDossier, type Row } from '../present.ts';
import { renderAndStore } from '../features/dossier.ts';
import { storageKeys, StorageUnavailable } from '../services/storage.ts';

async function latestDossier(ctx: Ctx, pieceId: string): Promise<Row | null> {
  return ctx.app.db.one<Row>(
    `SELECT * FROM dossiers WHERE piece_id = $1 ORDER BY id DESC LIMIT 1`,
    [pieceId],
  );
}

async function history(ctx: Ctx, dossierId: string): Promise<Row[]> {
  return ctx.app.db.query<Row>(
    `SELECT at, who, what FROM dossier_history WHERE dossier_id = $1 ORDER BY id`,
    [dossierId],
  );
}

async function body(ctx: Ctx, row: Row): Promise<Row> {
  return presentDossier(row, await history(ctx, String(row.id)));
}

/** Each request of a live session counts; a sixth in the window is refused. */
async function countDownload(ctx: Ctx): Promise<void> {
  const desk = ctx.desk;
  if (!desk) return;
  const windowMs = ctx.app.config.timers.fileRateWindowSeconds * 1000;
  const since = new Date(ctx.app.now() - windowMs);
  const rows = await ctx.app.db.query<Row>(
    `SELECT at FROM dossier_downloads WHERE desk_id = $1 AND at > $2 ORDER BY at`,
    [desk.id, since],
  );
  if (rows.length >= DOSSIER_DOWNLOAD_LIMIT) {
    const first = new Date(rows[0]!.at as string).getTime();
    const retryAt = first + windowMs;
    throw fail.rateLimited(
      F.downloadsBusy(localMinuteCeil(BUSINESS_ZONE, retryAt)),
      (retryAt - ctx.app.now()) / 1000,
    );
  }
  await ctx.app.db.query(`INSERT INTO dossier_downloads (desk_id) VALUES ($1)`, [desk.id]);
}

export const dossierRoutes: readonly Route[] = [
  {
    method: 'POST',
    pattern: '/api/pieces/:id/dossier',
    auth: 'required',
    body: 'json',
    resolve: resolvePiece,
    async handle(ctx) {
      const desk = ctx.requireDesk();
      const piece = resolved(ctx);

      const existing = await latestDossier(ctx, String(piece.id));
      if (existing && existing.state === 'signed') throw fail.conflict(F.dossierLocked);

      const signedEstimate = await ctx.app.db.one<Row>(
        `SELECT id FROM estimates WHERE piece_id = $1 AND state = 'signedOff'
          ORDER BY version DESC LIMIT 1`,
        [piece.id],
      );
      if (!signedEstimate) throw fail.conflict(F.noSignedEstimate);

      const row = await ctx.app.db.one<Row>(
        `INSERT INTO dossiers (desk_id, piece_id, state, estimate_id)
         VALUES ($1,$2,'waiting',$3) RETURNING *`,
        [desk.id, piece.id, signedEstimate.id],
      );
      await ctx.app.db.query(
        `INSERT INTO dossier_history (dossier_id, who, what) VALUES ($1,$2,'asked')`,
        [row!.id, desk.name],
      );

      // The strip follows the server's state while this runs.
      void renderAndStore(
        ctx.app,
        String(row!.id),
        desk.id,
        String(piece.id),
        String(signedEstimate.id),
      ).catch((error: unknown) => {
        process.stderr.write(`dossier render failed: ${String(error)}\n`);
      });

      ctx.json(202, { dossier: await body(ctx, row!) });
    },
  },

  {
    method: 'GET',
    pattern: '/api/pieces/:id/dossier',
    auth: 'required',
    resolve: resolvePiece,
    async handle(ctx) {
      const row = await latestDossier(ctx, String(resolved(ctx).id));
      if (!row) throw fail.notFound();
      ctx.json(200, { dossier: await body(ctx, row) });
    },
  },

  {
    method: 'GET',
    pattern: '/api/pieces/:id/dossier/pdf',
    auth: 'required',
    rateLimit: countDownload,
    resolve: resolvePiece,
    async handle(ctx) {
      const desk = ctx.requireDesk();
      const piece = resolved(ctx);
      const row = await latestDossier(ctx, String(piece.id));
      if (!row) throw fail.notFound();
      if (row.state !== 'stored' && row.state !== 'signed') throw fail.conflict(F.dossierNotStored);

      let bytes: Uint8Array | null;
      try {
        bytes = await ctx.app.storage.get(
          storageKeys.dossier(desk.id, String(piece.id), String(row.id)),
        );
      } catch (error) {
        if (!(error instanceof StorageUnavailable)) throw error;
        throw fail.unavailable(F.storeDown);
      }
      if (!bytes) throw fail.conflict(F.dossierNotStored);
      ctx.bytes(bytes, 'application/pdf', `${String(piece.title)}.pdf`);
    },
  },

  {
    method: 'POST',
    pattern: '/api/pieces/:id/dossier/sign',
    auth: 'required',
    body: 'json',
    resolve: resolvePiece,
    async handle(ctx) {
      const desk = ctx.requireDesk();
      const piece = resolved(ctx);
      const row = await latestDossier(ctx, String(piece.id));
      if (!row) throw fail.notFound();
      if (row.state === 'signed') throw fail.conflict(F.dossierLocked);
      if (row.state !== 'stored') throw fail.conflict(F.dossierNotStored);

      const typedName = ctx.body.typedName;
      if (typeof typedName !== 'string' || typedName.trim().length === 0) {
        throw fail.fields({ typedName: F.required });
      }
      if (!namesMatch(typedName, desk.name)) throw fail.fields({ typedName: F.notDeskName });

      const signed = await ctx.app.db.one<Row>(
        `UPDATE dossiers SET state = 'signed', signed_by = $2, signed_at = now()
          WHERE id = $1 AND state = 'stored' RETURNING *`,
        [row.id, desk.name],
      );
      if (!signed) throw fail.conflict(F.dossierLocked);
      await ctx.app.db.query(
        `INSERT INTO dossier_history (dossier_id, who, what) VALUES ($1,$2,'signed')`,
        [row.id, desk.name],
      );
      ctx.json(200, { dossier: await body(ctx, signed) });
    },
  },
];
