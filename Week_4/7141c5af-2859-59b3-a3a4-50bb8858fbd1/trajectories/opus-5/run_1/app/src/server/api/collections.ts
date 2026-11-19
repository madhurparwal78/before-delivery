/**
 * Courier collections. A collection is booked in the client's local wall time,
 * sent as a whole-second UTC instant, and reads `Booked` only once the courier
 * has confirmed and its label is stored.
 */
import { createHash } from 'node:crypto';
import { F } from '../../shared/feedback.ts';
import { parseDec } from '../domain/decimal.ts';
import { formatAmount, type Currency } from '../domain/money.ts';
import {
  BUSINESS_ZONE,
  dateText,
  englishDate,
  instantText,
  localTime,
  resolveWall,
  timeText,
  TOWN_ZONE,
  type Town,
} from '../domain/time.ts';
import { fail } from '../http/errors.ts';
import { Check } from '../http/validate.ts';
import type { Ctx, Route } from '../http/context.ts';
import { resolvePiece, piece as resolved } from './lookup.ts';
import { collectionTimeText, presentCollection, type Row } from '../present.ts';
import { storageKeys, StorageUnavailable } from '../services/storage.ts';
import { ProviderUnavailable, SlotTaken } from '../services/providers.ts';
import { guardProvider, providerFailure } from './providerGuard.ts';

const COURIER_COPY = { busy: F.courierBusy, down: F.courierUnconfirmed } as const;
const QUOTE_COPY = { busy: F.courierBusy, down: F.quoteFailed } as const;

/** The server reads a collection's state at most once per 30 seconds. */
const STATE_READ_GAP_MS = 30_000;

function needsMeasurements(piece: Row): boolean {
  return (
    piece.width_cm === null ||
    piece.depth_cm === null ||
    piece.height_cm === null ||
    piece.weight_kg === null
  );
}

async function refreshStates(ctx: Ctx, pieceId: string): Promise<void> {
  const rows = await ctx.app.db.query<Row>(
    `SELECT id, courier_id, read_at FROM collections
      WHERE piece_id = $1 AND courier_id IS NOT NULL AND state <> 'waiting'`,
    [pieceId],
  );
  for (const row of rows) {
    const readAt = row.read_at === null ? 0 : new Date(row.read_at as string).getTime();
    if (ctx.app.now() - readAt < STATE_READ_GAP_MS) continue;
    try {
      const answer = await ctx.app.providers.readCollection(String(row.courier_id));
      await ctx.app.db.query(`UPDATE collections SET state = $2, read_at = now() WHERE id = $1`, [
        row.id,
        answer.state,
      ]);
    } catch {
      // A failed read keeps the last known state.
      await ctx.app.db.query(`UPDATE collections SET read_at = now() WHERE id = $1`, [row.id]);
    }
  }
}

export const collectionRoutes: readonly Route[] = [
  {
    method: 'POST',
    pattern: '/api/pieces/:id/collections/quote',
    auth: 'required',
    body: 'json',
    resolve: resolvePiece,
    async handle(ctx) {
      const desk = ctx.requireDesk();
      const piece = resolved(ctx);
      if (needsMeasurements(piece)) throw fail.conflict(F.needMeasurements);
      await guardProvider(ctx, 'courier', F.courierBusy);

      let quote;
      try {
        quote = await ctx.app.providers.quote({
          fromTown: 'Turin',
          toTown: String(piece.town),
          widthCm: Number(piece.width_cm),
          depthCm: Number(piece.depth_cm),
          heightCm: Number(piece.height_cm),
          weightKg: String(piece.weight_kg),
        });
      } catch (error) {
        return providerFailure(ctx, 'courier', error, QUOTE_COPY);
      }

      await ctx.app.db.query(
        `INSERT INTO quotes (desk_id, piece_id, quote_id, amount, currency) VALUES ($1,$2,$3,$4,$5)`,
        [desk.id, piece.id, quote.quoteId, quote.amount, quote.currency],
      );
      ctx.json(200, {
        quote: {
          quoteId: quote.quoteId,
          amount: quote.amount,
          currency: quote.currency,
          display: displayAmount(quote.currency, quote.amount),
        },
      });
    },
  },

  {
    method: 'GET',
    pattern: '/api/pieces/:id/collections',
    auth: 'required',
    resolve: resolvePiece,
    async handle(ctx) {
      const piece = resolved(ctx);
      await refreshStates(ctx, String(piece.id));
      const rows = await ctx.app.db.query<Row>(
        `SELECT * FROM collections WHERE piece_id = $1 ORDER BY collect_at`,
        [piece.id],
      );
      ctx.json(200, { collections: rows.map(presentCollection) });
    },
  },

  {
    method: 'POST',
    pattern: '/api/pieces/:id/collections',
    auth: 'required',
    body: 'json',
    resolve: resolvePiece,
    async handle(ctx) {
      const desk = ctx.requireDesk();
      const piece = resolved(ctx);
      const town = String(piece.town) as Town;

      const check = new Check(ctx.body);
      const quoteId = check.text('quoteId', 60);
      const localDate = check.date('localDate');
      const localTimeValue = check.time('localTime');
      check.done();

      // A wall time that does not exist in the client's town is refused.
      const wall = resolveWall(TOWN_ZONE[town], {
        ...localDate!,
        hour: localTimeValue!.hour,
        minute: localTimeValue!.minute,
        second: 0,
      });
      if (wall.kind === 'absent') {
        throw fail.invalid(
          F.noSuchTime(
            timeText(localTimeValue!.hour, localTimeValue!.minute),
            town,
            englishDate(localDate!),
          ),
        );
      }
      const collectAt = wall.ms;

      const already = await ctx.app.db.query<Row>(
        `SELECT * FROM collections WHERE piece_id = $1 AND quote_id = $2`,
        [piece.id, quoteId],
      );
      const same = already.find(
        (row) => new Date(row.collect_at as string).getTime() === collectAt,
      );
      if (same) {
        ctx.json(200, { collection: presentCollection(same) });
        return;
      }
      const other = already[0];
      if (other) {
        throw fail.conflict(
          F.alreadyBooked(
            collectionTimeText(
              String(other.town) as Town,
              new Date(other.collect_at as string).getTime(),
            ),
          ),
        );
      }

      // The file store is checked first: with it down, no call goes out.
      if (!(await ctx.app.storage.reachable())) throw fail.unavailable(F.courierUnconfirmed);
      await guardProvider(ctx, 'courier', F.courierBusy);

      const repeatKey = createHash('sha256')
        .update(`collection|${piece.id}|${quoteId}`)
        .digest('hex')
        .slice(0, 40);

      let booking;
      try {
        booking = await ctx.app.providers.book(repeatKey, {
          quoteId: quoteId!,
          collectAt: instantText(collectAt),
          town,
        });
      } catch (error) {
        if (error instanceof SlotTaken) {
          throw fail.conflict(F.slotTaken(localTime(BUSINESS_ZONE, ctx.app.now())));
        }
        return providerFailure(ctx, 'courier', error, COURIER_COPY);
      }

      let label: Uint8Array;
      try {
        label = await ctx.app.providers.readLabel(booking.labelPath);
      } catch (error) {
        if (error instanceof ProviderUnavailable) throw fail.unavailable(F.courierUnconfirmed);
        return providerFailure(ctx, 'courier', error, COURIER_COPY);
      }

      const row = await ctx.app.db.one<Row>(
        `INSERT INTO collections (desk_id, piece_id, quote_id, courier_id, state, collect_at,
           local_date, local_time, town, repeat_key)
         VALUES ($1,$2,$3,$4,'waiting',$5,$6,$7,$8,$9)
         ON CONFLICT (repeat_key) DO NOTHING RETURNING *`,
        [
          desk.id,
          piece.id,
          quoteId,
          booking.id,
          new Date(collectAt),
          dateText(localDate!),
          timeText(localTimeValue!.hour, localTimeValue!.minute),
          town,
          repeatKey,
        ],
      );
      if (!row) {
        // Another window booked first under the same key.
        const existing = await ctx.app.db.one<Row>(
          `SELECT * FROM collections WHERE repeat_key = $1`,
          [repeatKey],
        );
        ctx.json(200, { collection: presentCollection(existing!) });
        return;
      }

      try {
        await ctx.app.storage.put(
          storageKeys.label(desk.id, String(piece.id), String(row.id)),
          label,
          'application/pdf',
        );
      } catch (error) {
        if (!(error instanceof StorageUnavailable)) throw error;
        await ctx.app.db.query(`DELETE FROM collections WHERE id = $1`, [row.id]);
        throw fail.unavailable(F.courierUnconfirmed);
      }

      const labelSha = createHash('sha256').update(label).digest('hex');
      const booked = await ctx.app.db.one<Row>(
        `UPDATE collections SET state = 'booked', label_sha256 = $2 WHERE id = $1 RETURNING *`,
        [row.id, labelSha],
      );
      ctx.json(201, { collection: presentCollection(booked!) });
    },
  },

  {
    method: 'GET',
    pattern: '/api/pieces/:id/collections/:collectionId/label',
    auth: 'required',
    resolve: resolvePiece,
    async handle(ctx) {
      const desk = ctx.requireDesk();
      const piece = resolved(ctx);
      const collectionId = ctx.param('collectionId');
      if (!/^\d+$/.test(collectionId)) throw fail.notFound();
      const row = await ctx.app.db.one<Row>(
        `SELECT * FROM collections WHERE id = $1 AND piece_id = $2`,
        [collectionId, piece.id],
      );
      if (!row) throw fail.notFound();
      if (row.label_sha256 === null) throw fail.unavailable(F.storeDown);

      let bytes: Uint8Array | null;
      try {
        bytes = await ctx.app.storage.get(
          storageKeys.label(desk.id, String(piece.id), String(row.id)),
        );
      } catch (error) {
        if (!(error instanceof StorageUnavailable)) throw error;
        throw fail.unavailable(F.storeDown);
      }
      if (!bytes) throw fail.unavailable(F.storeDown);
      ctx.bytes(bytes, 'application/pdf');
    },
  },
];


/** The quote printed in the published form for its currency. */
function displayAmount(currency: string, amount: string): string {
  const parsed = parseDec(amount);
  if (!parsed) return amount;
  return formatAmount(currency as Currency, parsed);
}
