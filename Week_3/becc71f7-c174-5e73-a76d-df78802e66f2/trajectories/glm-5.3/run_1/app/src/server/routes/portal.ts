// The private consignor page (DP-34 to DP-37).

import type { Route, RouteContext } from '../http.js';
import { sendJson, parseJsonBody, asObject } from '../http.js';
import { ApiError } from '../errors.js';
import { brusselsMidnight, cutToSecond, toZ, addDays } from '../../shared/time.js';
import { formatTagCode } from '../../shared/tagcode.js';
import { stationsAt, currentPriceCents, previousPriceCents, type StationJson } from '../pricing.js';
import { ladderJson } from '../views.js';
import { priceHistory } from '../rows.js';
import type { PieceRow, LadderRow } from '../rows.js';
import { ibanPassesMod97 } from '../../shared/iban.js';

export const portalRoutes: Route[] = [
  {
    method: 'GET', pattern: '/api/portal/:token', bodyLimit: 0, auth: 'public',
    handle: async (ctx) => {
      const page = await pageOf(ctx, ctx.params.token!);
      const now = new Date();
      await refreshPieceStates(ctx, page.consignor_id, now);
      const { rows: pieces } = await ctx.services.pool.query<PieceRow>(
        `SELECT * FROM pieces WHERE consignor_id = $1 AND status <> 'archived' ORDER BY intake_date DESC, tag_digits`,
        [page.consignor_id]
      );
      const earnings = await earningsOf(ctx, page.consignor_id);
      sendJson(ctx.res, 200, {
        consignor: {
          name: page.name,
          ibanLast4: page.iban ? page.iban.slice(-4) : null,
          ibanValid: page.iban !== null && ibanPassesMod97(page.iban),
        },
        pageEndsAt: toZ(new Date(page.ends_at)),
        pieces: await Promise.all(pieces.map((p) => portalPieceJson(ctx, p, now))),
        earnings,
      });
    },
  },
  {
    method: 'GET', pattern: '/api/portal/:token/pieces/:pieceId', bodyLimit: 0, auth: 'public',
    handle: async (ctx) => {
      const page = await pageOf(ctx, ctx.params.token!);
      const piece = await pieceOfConsignor(ctx, page.consignor_id, ctx.params.pieceId!);
      sendJson(ctx.res, 200, { piece: await portalPieceJson(ctx, piece, new Date()) });
    },
  },
  {
    method: 'PUT', pattern: '/api/portal/:token/choices', bodyLimit: 65536, auth: 'public',
    handle: async (ctx) => {
      requireJson(ctx);
      const page = await pageOf(ctx, ctx.params.token!);
      const body = asObject(parseJsonBody(ctx));
      const choices = body.choices;
      if (!Array.isArray(choices)) {
        throw new ApiError(422, 'validation_failed', 'There\u2019s a problem.', { choices: 'Choose what to do with each piece.' });
      }
      const now = new Date();
      const parsed: { pieceId: string; choice: 'return' | 'donate' }[] = [];
      const seen = new Set<string>();
      for (const raw of choices) {
        if (raw === null || typeof raw !== 'object') {
          throw new ApiError(422, 'validation_failed', 'There\u2019s a problem.', { choices: 'Choose what to do with each piece.' });
        }
        const c = raw as Record<string, unknown>;
        const pieceId = typeof c.pieceId === 'string' ? c.pieceId : null;
        const choice = typeof c.choice === 'string' ? c.choice : null;
        if (!pieceId || (choice !== 'return' && choice !== 'donate')) {
          throw new ApiError(422, 'validation_failed', 'There\u2019s a problem.', { choices: 'Choose what to do with each piece.' });
        }
        if (seen.has(pieceId)) continue;
        seen.add(pieceId);
        parsed.push({ pieceId, choice });
      }
      // Body ids before validation and state (ladder step 10): a piece that is not
      // this consignor's answers 404 with nothing saved.
      for (const c of parsed) {
        const piece = await pieceOfConsignor(ctx, page.consignor_id, c.pieceId);
        void piece;
      }
      // State: a closed choice refuses the whole request with nothing saved (DP-37).
      for (const c of parsed) {
        const piece = await pieceOfConsignor(ctx, page.consignor_id, c.pieceId);
        const ladder = (await ctx.services.pool.query<LadderRow>('SELECT * FROM ladders WHERE id = $1', [piece.ladder_id])).rows[0]!;
        const l = ladderJson(ladder);
        const opensAt = brusselsMidnight(addDays(piece.intake_date, l.periodEndDay - 14));
        const closesAt = brusselsMidnight(addDays(piece.intake_date, l.periodEndDay));
        const open = now.getTime() >= opensAt.getTime() && now.getTime() < closesAt.getTime() && piece.status !== 'sold';
        if (!open) {
          throw new ApiError(409, 'choice_closed', `The choice for ${formatTagCode(piece.tag_digits)} is closed.`);
        }
      }
      for (const c of parsed) {
        await ctx.services.pool.query('UPDATE pieces SET choice = $1 WHERE id = $2', [c.choice, c.pieceId]);
      }
      await refreshPieceStates(ctx, page.consignor_id, now);
      const { rows: pieces } = await ctx.services.pool.query<PieceRow>(
        `SELECT * FROM pieces WHERE consignor_id = $1 AND status <> 'archived' ORDER BY intake_date DESC, tag_digits`,
        [page.consignor_id]
      );
      sendJson(ctx.res, 200, { pieces: await Promise.all(pieces.map((p) => portalPieceJson(ctx, p, now))) });
    },
  },
];

interface PageRow { consignor_id: string; name: string; iban: string | null; email: string | null; ends_at: Date; status: string }

/** The page and its consignor, ended pages answer 410 (DP-36). */
async function pageOf(ctx: RouteContext, token: string): Promise<PageRow> {
  const { rows } = await ctx.services.pool.query<PageRow>(`
    SELECT pl.consignor_id, pl.ends_at, c.name, c.iban, c.email, c.status
    FROM portal_links pl JOIN consignors c ON c.id = pl.consignor_id
    WHERE pl.token = $1`, [token]);
  const page = rows[0];
  if (!page) throw new ApiError(404, 'not_found', 'Not found.');
  if (cutToSecond(new Date()).getTime() >= new Date(page.ends_at).getTime()) {
    throw new ApiError(410, 'page_ended', 'This page has ended. Ask the shop for a new link.');
  }
  return page;
}

/** Only this consignor's pieces; another consignor's piece id answers 404 (DP-35). */
async function pieceOfConsignor(ctx: RouteContext, consignorId: string, pieceId: string): Promise<PieceRow> {
  const { rows } = await ctx.services.pool.query<PieceRow>(
    'SELECT * FROM pieces WHERE id = $1 AND consignor_id = $2', [pieceId, consignorId]
  );
  if (rows.length === 0) throw new ApiError(404, 'not_found', 'Not found.');
  return rows[0]!;
}

/** portalPiece: no sale prices, no commission, no shopper data (DP-35). */
async function portalPieceJson(ctx: RouteContext, piece: PieceRow, now: Date): Promise<unknown> {
  const ladder = (await ctx.services.pool.query<LadderRow>('SELECT * FROM ladders WHERE id = $1', [piece.ladder_id])).rows[0]!;
  const l = ladderJson(ladder);
  const history = await priceHistory(ctx.services.pool, piece.id);
  const sale = (await ctx.services.pool.query<{ share_cents: number; sold_at: Date }>(
    'SELECT consignor_share_cents AS share_cents, sold_at FROM sales WHERE piece_id = $1 AND refunded_at IS NULL', [piece.id]
  )).rows[0];
  const sold = piece.status === 'sold' && sale !== undefined;
  const instants = stationsAt(l, piece.intake_date, now, history);
  const opensAt = brusselsMidnight(addDays(piece.intake_date, l.periodEndDay - 14));
  const closesAt = brusselsMidnight(addDays(piece.intake_date, l.periodEndDay));
  const choiceOpen = now.getTime() >= opensAt.getTime() && now.getTime() < closesAt.getTime() && !sold;
  return {
    id: piece.id,
    tagCode: formatTagCode(piece.tag_digits),
    description: piece.description,
    category: piece.category,
    brand: piece.brand,
    size: piece.size,
    status: piece.status,
    station: sold ? 'sold' : instants.current,
    currentPriceCents: sold ? null : currentPriceCents(l, piece.intake_date, now, history),
    previousPriceCents: sold ? null : previousPriceCents(l, piece.intake_date, now, history),
    stations: (sold ? instants.stations.map((s: StationJson) => ({ ...s, priceCents: null })) : instants.stations),
    choice: piece.choice,
    choiceOpen,
    choiceOpensAt: toZ(opensAt),
    choiceClosesAt: toZ(closesAt),
    shareCents: sold ? sale!.share_cents : null,
  };
}

/** Earnings per month: this consignor's shares of unrefunded sales (DP-35). */
async function earningsOf(ctx: RouteContext, consignorId: string): Promise<{ month: string; shareCents: number }[]> {
  const { rows } = await ctx.services.pool.query<{ month: string; share: number }>(`
    SELECT to_char(s.sold_at AT TIME ZONE 'Europe/Brussels', 'YYYY-MM') AS month, SUM(s.consignor_share_cents) AS share
    FROM sales s JOIN pieces p ON p.id = s.piece_id
    WHERE p.consignor_id = $1 AND s.refunded_at IS NULL
    GROUP BY 1 ORDER BY 1 DESC`, [consignorId]);
  return rows.map((r) => ({ month: r.month, shareCents: Number(r.share) }));
}

async function refreshPieceStates(ctx: RouteContext, consignorId: string, now: Date): Promise<void> {
  const { rows } = await ctx.services.pool.query<PieceRow>(
    "SELECT * FROM pieces WHERE consignor_id = $1 AND status IN ('on_rail', 'on_hold', 'returns_shelf')", [consignorId]
  );
  for (const piece of rows) {
    const ladder = (await ctx.services.pool.query<LadderRow>('SELECT * FROM ladders WHERE id = $1', [piece.ladder_id])).rows[0]!;
    const l = ladderJson(ladder);
    const endsAt = brusselsMidnight(addDays(piece.intake_date, l.periodEndDay));
    const shelfDeadline = brusselsMidnight(addDays(piece.intake_date, l.periodEndDay + 14));
    if (now.getTime() >= endsAt.getTime() && (piece.status === 'on_rail' || piece.status === 'on_hold')) {
      await ctx.services.pool.query('UPDATE pieces SET status = $1 WHERE id = $2',
        [piece.choice === 'return' ? 'returns_shelf' : 'donation_box', piece.id]);
    } else if (now.getTime() >= shelfDeadline.getTime() && piece.status === 'returns_shelf') {
      await ctx.services.pool.query("UPDATE pieces SET status = 'donation_box' WHERE id = $1", [piece.id]);
    }
  }
}

function requireJson(ctx: RouteContext): void {
  const type = ctx.req.headers['content-type'] ?? '';
  if (!type.toLowerCase().startsWith('application/json')) {
    throw new ApiError(415, 'unsupported_media_type', 'Send JSON with a content type of application/json.');
  }
}
