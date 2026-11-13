/**
 * The consignor's own page. Every response here carries only that consignor's own pieces
 * and earnings: never shopper names or emails, other consignors, sale prices, the shop's
 * commission or VAT, or more of the IBAN than its last four characters.
 */

import { jsonResponse, type RequestContext } from '../http/context.js';
import { conflict, gone, notFound, validationFailed } from '../http/errors.js';
import { route, type CompiledRoute } from '../http/router.js';
import { instantOf, type Queryable } from '../db.js';
import { isChoiceOpen, loadPiecesOfConsignor, portalPieceJson, statusOf } from '../data/pieces.js';
import { brusselsMonth, isoSeconds } from '../../shared/brussels.js';
import { isValidIban } from '../domain/iban.js';
import { copy } from '../../shared/copy.js';
import { isChoice } from '../../shared/options.js';

interface PortalPage {
  token: string;
  consignorId: string;
  consignorName: string;
  iban: string | null;
  pageEndsAt: number;
}

/** A page address lasts PORTAL_PAGE_SECONDS; an ended or expired one answers 410. */
async function pageByToken(ctx: RequestContext): Promise<PortalPage> {
  const { rows } = await ctx.app.db.query(
    `SELECT l.token, l.consignor_id, l.ends_at, l.ended_at, c.name, c.iban
       FROM portal_links l JOIN consignors c ON c.id = l.consignor_id
      WHERE l.token = $1`,
    [ctx.param('token')],
  );
  const row = rows[0];
  if (row === undefined) throw notFound();
  const endsAt = instantOf(row['ends_at']);
  if (row['ended_at'] !== null || ctx.now >= endsAt) {
    throw gone('page_ended', copy.portalPageEnded);
  }
  return {
    token: row['token'] as string,
    consignorId: row['consignor_id'] as string,
    consignorName: row['name'] as string,
    iban: (row['iban'] as string | null) ?? null,
    pageEndsAt: endsAt,
  };
}

async function earningsOf(db: Queryable, consignorId: string): Promise<unknown[]> {
  const { rows } = await db.query(
    `SELECT s.sold_at, s.consignor_share_cents FROM sales s
       JOIN pieces p ON p.id = s.piece_id
      WHERE p.consignor_id = $1 AND s.refunded_at IS NULL`,
    [consignorId],
  );
  const byMonth = new Map<string, number>();
  for (const row of rows) {
    const month = brusselsMonth(instantOf(row['sold_at']));
    byMonth.set(month, (byMonth.get(month) ?? 0) + Number(row['consignor_share_cents']));
  }
  return [...byMonth.entries()]
    .sort((left, right) => (left[0] < right[0] ? 1 : -1))
    .map(([month, shareCents]) => ({ month, shareCents }));
}

async function ownPieces(ctx: RequestContext, page: PortalPage) {
  const pieces = await loadPiecesOfConsignor(ctx.app.db, page.consignorId, ctx.now);
  return pieces.filter((piece) => statusOf(piece, ctx.now) !== 'archived');
}

export const portalRoutes: CompiledRoute[] = [
  route({
    method: 'GET',
    path: '/api/portal/:token',
    access: 'public',
    resolve: pageByToken,
    handle: async (ctx, page) => {
      const pieces = await ownPieces(ctx, page);
      return jsonResponse(200, {
        consignor: {
          name: page.consignorName,
          ibanLast4: page.iban === null ? null : page.iban.slice(-4),
          ibanValid: isValidIban(page.iban),
        },
        pageEndsAt: isoSeconds(page.pageEndsAt),
        pieces: pieces.map((piece) => portalPieceJson(piece, ctx.now)),
        earnings: await earningsOf(ctx.app.db, page.consignorId),
      });
    },
  }),

  route({
    method: 'GET',
    path: '/api/portal/:token/pieces/:pieceId',
    access: 'public',
    resolve: pageByToken,
    handle: async (ctx, page) => {
      const pieces = await ownPieces(ctx, page);
      const piece = pieces.find((candidate) => candidate.id === ctx.param('pieceId'));
      if (piece === undefined) throw notFound();
      return jsonResponse(200, { piece: portalPieceJson(piece, ctx.now) });
    },
  }),

  route({
    method: 'PUT',
    path: '/api/portal/:token/choices',
    access: 'public',
    resolve: pageByToken,
    handle: async (ctx, page) => {
      const body = ctx.json();
      const asked = body['choices'];
      if (!Array.isArray(asked)) {
        throw validationFailed({ choices: 'Send one choice per piece.' });
      }

      const pieces = await ownPieces(ctx, page);
      const byId = new Map(pieces.map((piece) => [piece.id, piece]));

      const wanted: { pieceId: string; choice: string }[] = [];
      for (const entry of asked) {
        const pieceId =
          entry !== null && typeof entry === 'object'
            ? (entry as Record<string, unknown>)['pieceId']
            : null;
        const choice =
          entry !== null && typeof entry === 'object'
            ? (entry as Record<string, unknown>)['choice']
            : null;
        if (typeof pieceId !== 'string' || !byId.has(pieceId)) throw notFound();
        wanted.push({ pieceId, choice: typeof choice === 'string' ? choice : '' });
      }

      for (const entry of wanted) {
        if (!isChoice(entry.choice)) {
          throw validationFailed({ choice: 'Choose Return to me or Donate.' });
        }
      }

      for (const entry of wanted) {
        const piece = byId.get(entry.pieceId);
        if (piece === undefined || !isChoiceOpen(piece, ctx.now)) {
          throw conflict('choice_closed', copy.choiceClosed(piece?.tagCode ?? ''));
        }
      }

      for (const entry of wanted) {
        await ctx.app.db.query(`UPDATE pieces SET choice = $2 WHERE id = $1`, [
          entry.pieceId,
          entry.choice,
        ]);
      }

      const updated = await ownPieces(ctx, page);
      return jsonResponse(200, {
        pieces: updated.map((piece) => portalPieceJson(piece, ctx.now)),
      });
    },
  }),
];
