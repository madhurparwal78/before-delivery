// Holds (DP-19 to DP-23, DP-20, DP-21, DP-22).

import crypto from 'node:crypto';
import type { Route, RouteContext } from '../http.js';
import { sendJson, parseJsonBody, asObject, str } from '../http.js';
import { ApiError } from '../errors.js';
import { brusselsTimeParts, toZ, cutToSecond } from '../../shared/time.js';
import { formatTagCode } from '../../shared/tagcode.js';
import { findPieceById, activeHoldOf } from '../rows.js';
import { SHOP } from '../config.js';
import { euros } from '../../shared/money.js';
import { holdMail } from '../mails.js';

export const holdRoutes: Route[] = [
  {
    method: 'POST', pattern: '/api/pieces/:id/holds', bodyLimit: 65536, auth: 'public',
    handle: async (ctx) => {
      const piece = await findPieceById(ctx.services.pool, ctx.params.id!);
      if (!piece) throw new ApiError(404, 'not_found', 'Not found.');
      requireJson(ctx);
      const body = asObject(parseJsonBody(ctx));
      const fields: Record<string, string> = {};
      const name = str(body.name);
      const email = str(body.email);
      if (!name || name.trim().length === 0 || name.length > 80) fields.name = 'Enter a name.';
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fields.email = 'Enter an email address like name@example.be.';
      if (Object.keys(fields).length > 0) throw new ApiError(422, 'validation_failed', 'There\u2019s a problem.', fields);

      const now = cutToSecond(new Date());
      const holdSeconds = ctx.services.config.timers.holdSeconds;
      // The hold lasts HOLD_SECONDS, ending earlier at its period end (DP-21).
      const endsAt = new Date(now.getTime() + holdSeconds * 1000);

      const hold = await withHoldLock(ctx, piece.id, async () => {
        const existing = await activeHoldOf(ctx.services.pool, piece.id);
        if (existing) {
          if (existing.ends_at.getTime() <= now.getTime()) {
            await ctx.services.pool.query("UPDATE holds SET status = 'ended' WHERE id = $1", [existing.id]);
          } else {
            throw holdTaken(existing.ends_at);
          }
        }
        if (piece.status === 'sold' || piece.status === 'archived' || piece.status === 'returns_shelf'
            || piece.status === 'donation_box' || piece.status === 'returned') {
          throw new ApiError(409, 'not_for_sale', 'This piece is not on the rail.');
        }
        const id = crypto.randomUUID();
        const token = crypto.randomBytes(24).toString('base64url');
        await ctx.services.pool.query(
          `INSERT INTO holds (id, piece_id, shopper_name, shopper_email, starts_at, ends_at, status, token, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, $8)`,
          [id, piece.id, name!.trim(), email!, now, endsAt, token, now]
        );
        await ctx.services.pool.query("UPDATE pieces SET status = 'on_hold' WHERE id = $1 AND status = 'on_rail'", [piece.id]);
        return id;
      });

      // One mail, carrying only the published content (DP-22); refused with nothing saved while Mailpit is down.
      const holdRow = await holdById(ctx, hold!);
      try {
        await sendHoldMail(ctx, piece.id, holdRow);
      } catch {
        // Refused with nothing saved: roll the hold back.
        await ctx.services.pool.query('DELETE FROM holds WHERE id = $1', [holdRow.id]);
        await ctx.services.pool.query("UPDATE pieces SET status = 'on_rail' WHERE id = $1 AND status = 'on_hold'", [piece.id]);
        throw new ApiError(503, 'mail_unavailable', 'We can\u2019t send your confirmation right now. Nothing was saved \u2014 try again in a moment.');
      }
      sendJson(ctx.res, 201, { hold: holdJson(holdRow) });
    },
  },
  {
    method: 'GET', pattern: '/api/holds', bodyLimit: 0, auth: 'desk',
    handle: async (ctx) => {
      const now = new Date();
      await endExpiredHolds(ctx, now);
      const { rows } = await ctx.services.pool.query<HoldRecord & { tag_digits: string }>(`
        SELECT h.*, p.tag_digits FROM holds h JOIN pieces p ON p.id = h.piece_id
        WHERE h.status = 'active' ORDER BY h.ends_at`);
      sendJson(ctx.res, 200, { holds: rows.map((h) => ({ ...holdJson(h), tagCode: tagCodeOf(h), pieceId: h.piece_id })) });
    },
  },
  {
    method: 'GET', pattern: '/api/holds/:id', bodyLimit: 0, auth: 'desk',
    handle: async (ctx) => {
      await endExpiredHolds(ctx, new Date());
      const row = await holdById(ctx, ctx.params.id!);
      sendJson(ctx.res, 200, { hold: { ...holdJson(row), tagCode: tagCodeOf(row), pieceId: row.piece_id } });
    },
  },
  {
    method: 'POST', pattern: '/api/holds/:id/release', bodyLimit: 0, auth: 'desk',
    handle: async (ctx) => {
      await endExpiredHolds(ctx, new Date());
      const row = await holdById(ctx, ctx.params.id!);
      if (row.status !== 'active') throw new ApiError(409, 'hold_ended', 'This hold has ended.');
      await ctx.services.pool.query("UPDATE holds SET status = 'released' WHERE id = $1", [row.id]);
      await ctx.services.pool.query("UPDATE pieces SET status = 'on_rail' WHERE id = $1 AND status = 'on_hold'", [row.piece_id]);
      const updated = await holdById(ctx, row.id);
      sendJson(ctx.res, 200, { hold: { ...holdJson(updated), tagCode: tagCodeOf(updated), pieceId: updated.piece_id } });
    },
  },
  {
    method: 'GET', pattern: '/api/holds/by-token/:token', bodyLimit: 0, auth: 'public',
    handle: async (ctx) => {
      await endExpiredHolds(ctx, new Date());
      const row = await holdByToken(ctx, ctx.params.token!);
      sendJson(ctx.res, 200, { hold: await holdPageJson(ctx, row) });
    },
  },
  {
    method: 'POST', pattern: '/api/holds/by-token/:token/release', bodyLimit: 0, auth: 'public',
    handle: async (ctx) => {
      await endExpiredHolds(ctx, new Date());
      const row = await holdByToken(ctx, ctx.params.token!);
      if (row.status !== 'active') throw new ApiError(409, 'hold_ended', 'This hold has ended.');
      await ctx.services.pool.query("UPDATE holds SET status = 'released' WHERE id = $1", [row.id]);
      await ctx.services.pool.query("UPDATE pieces SET status = 'on_rail' WHERE id = $1 AND status = 'on_hold'", [row.piece_id]);
      const updated = await holdByToken(ctx, ctx.params.token!);
      sendJson(ctx.res, 200, { hold: await holdPageJson(ctx, updated) });
    },
  },
];

/** One hold per piece: two holds at the same moment produce exactly one row (DP-20). */
async function withHoldLock<T>(ctx: RouteContext, pieceId: string, fn: () => Promise<T>): Promise<T> {
  const client = await ctx.services.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`hold:${pieceId}`]);
    const result = await fn();
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function holdById(ctx: RouteContext, id: string): Promise<HoldRecord & { tag_digits: string }> {
  const { rows } = await ctx.services.pool.query<HoldRecord & { tag_digits: string }>(
    'SELECT h.*, p.tag_digits FROM holds h JOIN pieces p ON p.id = h.piece_id WHERE h.id = $1', [id]
  );
  if (rows.length === 0) throw new ApiError(404, 'not_found', 'Not found.');
  return rows[0]!;
}

async function holdByToken(ctx: RouteContext, token: string): Promise<HoldRecord> {
  const { rows } = await ctx.services.pool.query<HoldRecord>('SELECT * FROM holds WHERE token = $1', [token]);
  if (rows.length === 0) throw new ApiError(404, 'not_found', 'Not found.');
  return rows[0]!;
}

interface HoldRecord {
  id: string; piece_id: string; shopper_name: string; shopper_email: string;
  starts_at: Date; ends_at: Date; status: string; token: string;
}

interface HoldJson { id: string; pieceId: string; startsAt: string; endsAt: string; status: string }

function holdJson(h: HoldRecord): HoldJson {
  return {
    id: h.id,
    pieceId: h.piece_id,
    startsAt: toZ(new Date(h.starts_at)),
    endsAt: toZ(new Date(h.ends_at)),
    status: h.status,
  };
}

function tagCodeOf(h: { tag_digits: string }): string {
  return formatTagCode(h.tag_digits);
}

function requireJson(ctx: RouteContext): void {
  const type = ctx.req.headers['content-type'] ?? '';
  if (!type.toLowerCase().startsWith('application/json')) {
    throw new ApiError(415, 'unsupported_media_type', 'Send JSON with a content type of application/json.');
  }
}

function holdTaken(winnerEndsAt: Date): ApiError {
  const { hour, minute } = brusselsTimeParts(new Date(winnerEndsAt));
  return new ApiError(409, 'hold_taken',
    `Someone else is holding this piece until ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}.`);
}

/** A hold ends exactly at its end instant (DP-21). */
async function endExpiredHolds(ctx: RouteContext, now: Date): Promise<void> {
  const nowSec = cutToSecond(now);
  const { rows } = await ctx.services.pool.query(
    "UPDATE holds SET status = 'ended' WHERE status = 'active' AND ends_at <= $1 RETURNING piece_id",
    [nowSec]
  );
  if (rows.length > 0) {
    for (const row of rows) {
      await ctx.services.pool.query("UPDATE pieces SET status = 'on_rail' WHERE id = $1 AND status = 'on_hold'", [row.piece_id]);
    }
  }
}

async function holdPageJson(ctx: RouteContext, h: HoldRecord): Promise<unknown> {
  const piece = await findPieceById(ctx.services.pool, h.piece_id);
  const photo = (await ctx.services.pool.query('SELECT id FROM photos WHERE piece_id = $1 ORDER BY position LIMIT 1', [h.piece_id])).rows[0];
  const photoUrl = photo ? `/api/photos/${photo.id}` : null;
  const tag = piece ? formatTagCode(piece.tag_digits) : '';
  return {
    status: h.status,
    endsAt: toZ(new Date(h.ends_at)),
    secondsLeft: Math.max(0, Math.floor((h.ends_at.getTime() - cutToSecond(new Date()).getTime()) / 1000)),
    piece: piece ? {
      tagCode: tag,
      description: piece.description,
      brand: piece.brand,
      size: piece.size,
      currentPriceCents: piece.asking_price_cents,
      photoUrl,
    } : null,
    shopAddress: SHOP.address,
  };
}

async function sendHoldMail(ctx: RouteContext, pieceId: string, hold: HoldRecord): Promise<void> {
  const piece = await findPieceById(ctx.services.pool, pieceId);
  const url = `${ctx.services.config.publicUrl}/h/${hold.token}`;
  await holdMail(
    { mailer: ctx.services.mailer, mailFrom: ctx.services.config.mailFrom },
    {
      to: hold.shopper_email,
      tagCode: formatTagCode(piece!.tag_digits),
      description: piece!.description,
      brand: piece!.brand,
      size: piece!.size,
      price: euros(piece!.asking_price_cents),
      endsAt: hold.ends_at,
      holdPageUrl: url,
    }
  );
}

