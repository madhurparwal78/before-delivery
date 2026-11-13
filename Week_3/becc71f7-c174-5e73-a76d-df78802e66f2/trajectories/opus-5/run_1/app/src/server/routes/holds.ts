import { randomUUID } from 'node:crypto';
import { jsonResponse, type RequestContext } from '../http/context.js';
import { conflict, mailUnavailable, notFound } from '../http/errors.js';
import { route, type CompiledRoute } from '../http/router.js';
import { FieldProblems, requireEmail, requireName } from '../http/validate.js';
import { inTransaction, instantOf, instantParam, maybeInstant, type Queryable } from '../db.js';
import { loadPieceById, statusOf, priceContextOf, type PieceRecord } from '../data/pieces.js';
import { currentPriceCents, periodEndInstant } from '../domain/ladder.js';
import { formatTime, isoSeconds } from '../../shared/brussels.js';
import { copy } from '../../shared/copy.js';
import { shop } from '../../shared/shop.js';
import { newToken } from '../http/sessions.js';
import { MailUnavailable } from '../services/mail.js';

export type HoldStatus = 'active' | 'released' | 'ended';

export interface HoldRecord {
  id: string;
  pieceId: string;
  token: string;
  shopperName: string;
  shopperEmail: string;
  startsAt: number;
  endsAt: number;
  releasedAt: number | null;
}

const HOLD_COLUMNS = `id, piece_id, token, shopper_name, shopper_email, starts_at, ends_at, released_at`;

function holdOf(row: Record<string, unknown>): HoldRecord {
  return {
    id: row['id'] as string,
    pieceId: row['piece_id'] as string,
    token: row['token'] as string,
    shopperName: row['shopper_name'] as string,
    shopperEmail: row['shopper_email'] as string,
    startsAt: instantOf(row['starts_at']),
    endsAt: instantOf(row['ends_at']),
    releasedAt: maybeInstant(row['released_at']),
  };
}

export function holdStatus(hold: HoldRecord, now: number): HoldStatus {
  if (hold.releasedAt !== null) return 'released';
  return now >= hold.endsAt ? 'ended' : 'active';
}

function holdJson(hold: HoldRecord, now: number): unknown {
  return {
    id: hold.id,
    pieceId: hold.pieceId,
    startsAt: isoSeconds(hold.startsAt),
    endsAt: isoSeconds(hold.endsAt),
    status: holdStatus(hold, now),
  };
}

/** A piece has at most one active hold. */
export async function activeHoldOf(
  db: Queryable,
  pieceId: string,
  now: number,
): Promise<HoldRecord | null> {
  const { rows } = await db.query(
    `SELECT ${HOLD_COLUMNS} FROM holds
      WHERE piece_id = $1 AND released_at IS NULL AND ends_at > $2
      ORDER BY starts_at DESC LIMIT 1`,
    [pieceId, instantParam(now)],
  );
  const row = rows[0];
  return row === undefined ? null : holdOf(row);
}

async function holdById(ctx: RequestContext, id: string): Promise<HoldRecord> {
  const { rows } = await ctx.app.db.query(`SELECT ${HOLD_COLUMNS} FROM holds WHERE id::text = $1`, [
    id,
  ]);
  const row = rows[0];
  if (row === undefined) throw notFound();
  return holdOf(row);
}

async function holdByToken(ctx: RequestContext): Promise<HoldRecord> {
  const { rows } = await ctx.app.db.query(`SELECT ${HOLD_COLUMNS} FROM holds WHERE token = $1`, [
    ctx.param('token'),
  ]);
  const row = rows[0];
  if (row === undefined) throw notFound();
  return holdOf(row);
}

async function releaseHold(ctx: RequestContext, hold: HoldRecord): Promise<HoldRecord> {
  if (holdStatus(hold, ctx.now) !== 'active') throw conflict('hold_ended', copy.holdEnded);
  const { rowCount } = await ctx.app.db.query(
    `UPDATE holds SET released_at = $2 WHERE id = $1 AND released_at IS NULL AND ends_at > $2`,
    [hold.id, instantParam(ctx.now)],
  );
  if (rowCount === 0) throw conflict('hold_ended', copy.holdEnded);
  return { ...hold, releasedAt: ctx.now };
}

async function holdPageBody(ctx: RequestContext, hold: HoldRecord): Promise<unknown> {
  const piece = (await loadPieceById(ctx.app.db, hold.pieceId, ctx.now)) as PieceRecord;
  return {
    hold: {
      status: holdStatus(hold, ctx.now),
      endsAt: isoSeconds(hold.endsAt),
      secondsLeft: Math.max(0, Math.floor((hold.endsAt - ctx.now) / 1_000)),
      piece: {
        tagCode: piece.tagCode,
        description: piece.description,
        brand: piece.brand,
        size: piece.size,
        currentPriceCents: currentPriceCents(priceContextOf(piece), ctx.now),
        photoUrl: piece.photos[0] === undefined ? null : `/api/photos/${piece.photos[0].id}`,
      },
      shopAddress: shop.address,
    },
  };
}

export const holdRoutes: CompiledRoute[] = [
  route({
    method: 'POST',
    path: '/api/pieces/:pieceId/holds',
    access: 'public',
    resolve: async (ctx) => {
      const piece = await loadPieceById(ctx.app.db, ctx.param('pieceId'), ctx.now);
      if (piece === null) throw notFound();
      return piece;
    },
    handle: async (ctx, piece) => {
      const body = ctx.json();
      const problems = new FieldProblems();
      const name = requireName(problems, body);
      const email = requireEmail(problems, body);
      problems.throwIfAny();

      const startsAt = Math.floor(ctx.now / 1_000) * 1_000;
      const periodEnd = periodEndInstant(piece.ladder, piece.intakeDate);
      const endsAt = Math.min(startsAt + ctx.app.config.holdSeconds * 1_000, periodEnd);
      const token = newToken();
      const id = randomUUID();

      const created = await inTransaction(ctx.app.db, async (tx) => {
        await tx.query(`SELECT id FROM pieces WHERE id = $1 FOR UPDATE`, [piece.id]);
        const fresh = (await loadPieceById(tx, piece.id, ctx.now)) as PieceRecord;
        const status = statusOf(fresh, ctx.now);
        if (status === 'on_hold') {
          const winner = await activeHoldOf(tx, piece.id, ctx.now);
          throw conflict(
            'hold_taken',
            copy.holdTaken(formatTime(winner === null ? endsAt : winner.endsAt)),
          );
        }
        if (status !== 'on_rail') throw conflict('not_for_sale', `This piece isn't for sale.`);

        await tx.query(
          `INSERT INTO holds (id, piece_id, token, shopper_name, shopper_email, starts_at, ends_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [id, piece.id, token, name, email, instantParam(startsAt), instantParam(endsAt)],
        );

        // The mail goes out before the hold is committed, so a Mailpit outage saves nothing.
        try {
          await ctx.app.mailer.sendHold({
            to: email,
            tagCode: fresh.tagCode,
            description: fresh.description,
            brand: fresh.brand,
            size: fresh.size,
            priceCents: currentPriceCents(priceContextOf(fresh), ctx.now),
            endsAt,
            holdPageUrl: `${ctx.app.config.publicUrl}/h/${token}`,
          });
        } catch (error) {
          if (error instanceof MailUnavailable) throw mailUnavailable(copy.mailDown);
          throw error;
        }

        return holdOf({
          id,
          piece_id: piece.id,
          token,
          shopper_name: name,
          shopper_email: email,
          starts_at: instantParam(startsAt),
          ends_at: instantParam(endsAt),
          released_at: null,
        });
      });

      return jsonResponse(201, { hold: holdJson(created, ctx.now) });
    },
  }),

  route({
    method: 'GET',
    path: '/api/holds',
    access: 'desk',
    handle: async (ctx) => {
      const { rows } = await ctx.app.db.query(
        `SELECT h.id, h.piece_id, h.token, h.shopper_name, h.shopper_email, h.starts_at,
                h.ends_at, h.released_at, p.tag_code
           FROM holds h JOIN pieces p ON p.id = h.piece_id
          WHERE h.released_at IS NULL AND h.ends_at > $1
          ORDER BY h.ends_at`,
        [instantParam(ctx.now)],
      );
      return jsonResponse(200, {
        holds: rows.map((row) => {
          const hold = holdOf(row);
          return {
            id: hold.id,
            pieceId: hold.pieceId,
            tagCode: row['tag_code'] as string,
            shopperName: hold.shopperName,
            shopperEmail: hold.shopperEmail,
            startsAt: isoSeconds(hold.startsAt),
            endsAt: isoSeconds(hold.endsAt),
            status: holdStatus(hold, ctx.now),
          };
        }),
      });
    },
  }),

  route({
    method: 'GET',
    path: '/api/holds/:holdId',
    access: 'desk',
    resolve: async (ctx) => holdById(ctx, ctx.param('holdId')),
    handle: async (ctx, hold) => {
      const { rows } = await ctx.app.db.query(`SELECT tag_code FROM pieces WHERE id = $1`, [
        hold.pieceId,
      ]);
      return jsonResponse(200, {
        hold: {
          id: hold.id,
          pieceId: hold.pieceId,
          tagCode: rows[0]?.['tag_code'] as string,
          shopperName: hold.shopperName,
          shopperEmail: hold.shopperEmail,
          startsAt: isoSeconds(hold.startsAt),
          endsAt: isoSeconds(hold.endsAt),
          status: holdStatus(hold, ctx.now),
        },
      });
    },
  }),

  route({
    method: 'POST',
    path: '/api/holds/:holdId/release',
    access: 'desk',
    expects: 'none',
    resolve: async (ctx) => holdById(ctx, ctx.param('holdId')),
    handle: async (ctx, hold) => {
      const released = await releaseHold(ctx, hold);
      return jsonResponse(200, { hold: holdJson(released, ctx.now) });
    },
  }),

  route({
    method: 'GET',
    path: '/api/holds/by-token/:token',
    access: 'public',
    resolve: holdByToken,
    handle: async (ctx, hold) => jsonResponse(200, await holdPageBody(ctx, hold)),
  }),

  route({
    method: 'POST',
    path: '/api/holds/by-token/:token/release',
    access: 'public',
    expects: 'none',
    resolve: holdByToken,
    handle: async (ctx, hold) => {
      const released = await releaseHold(ctx, hold);
      return jsonResponse(200, await holdPageBody(ctx, released));
    },
  }),
];
