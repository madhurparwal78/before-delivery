import { Router } from 'express';
import { pool, withTransaction } from '../../db/pool.js';
import {
  cardInForce,
  loadRateCards,
  loadStations,
  rateCardView,
} from '../../domain/kitchens.js';
import { newId } from '../../domain/secrets.js';
import { isValidDate, kitchenToday } from '../../domain/time.js';
import { requireKitchen, requireRole, requireUser } from '../access.js';
import { created, ok, param, route } from '../context.js';
import { failures } from '../errors.js';
import { asInteger, asIntegerArray, asStringRecord } from '../fields.js';

export const rateRoutes = Router();

rateRoutes.get(
  '/kitchens/:kitchen_id/rate-cards',
  route(async (ctx) => {
    const user = requireUser(ctx.user);
    const kitchen = await requireKitchen(pool, user, param(ctx.req, 'kitchen_id'));
    requireRole(user, 'operator', 'bookkeeper');
    const today = kitchenToday(kitchen.timezone, ctx.now);
    const cards = await loadRateCards(pool, kitchen.id);
    const inForce = cardInForce(cards, today);
    return ok({ rate_cards: cards.map((card) => rateCardView(card, inForce ? inForce.id : null)) });
  }),
);

rateRoutes.post(
  '/kitchens/:kitchen_id/rate-cards',
  route(async (ctx) => {
    const user = requireUser(ctx.user);
    const kitchen = await requireKitchen(pool, user, param(ctx.req, 'kitchen_id'));
    requireRole(user, 'operator');
    const today = kitchenToday(kitchen.timezone, ctx.now);
    const stations = await loadStations(pool, kitchen.id);

    const errors: Record<string, string> = {};
    const effectiveFrom = ctx.body.effective_from;
    if (!isValidDate(effectiveFrom) || effectiveFrom < today) {
      errors.effective_from = 'Choose today or a later date.';
    }
    const tierValues = asIntegerArray(ctx.body.tier_rates_cents, 4);
    if (tierValues === null || tierValues.some((value) => value <= 0)) {
      errors.tier_rates_cents = 'Enter an amount in dollars and cents.';
    }
    const surcharges = asStringRecord(ctx.body.station_surcharges_cents);
    const surchargeMap: Record<string, number> = {};
    if (surcharges === null) {
      errors.station_surcharges_cents = 'Enter a surcharge for every station.';
    } else {
      for (const station of stations) {
        const value = asInteger(surcharges[station.id]);
        if (value === null || value < 0) {
          errors.station_surcharges_cents = 'Enter an amount in dollars and cents.';
          break;
        }
        surchargeMap[station.id] = value;
      }
      if (
        errors.station_surcharges_cents === undefined &&
        Object.keys(surcharges).some((key) => !stations.some((station) => station.id === key))
      ) {
        errors.station_surcharges_cents = 'Enter a surcharge for every station.';
      }
    }
    const windowHours = asInteger(ctx.body.cancellation_window_hours);
    if (windowHours === null || windowHours < 0 || windowHours > 336) {
      errors.cancellation_window_hours = 'Enter whole hours from 0 to 336.';
    }
    const packPrice = asInteger(ctx.body.pack_price_cents);
    if (packPrice === null || packPrice <= 0) {
      errors.pack_price_cents = 'Enter an amount in dollars and cents.';
    }
    if (Object.keys(errors).length > 0) throw failures.validation(errors);
    if (!isValidDate(effectiveFrom) || tierValues === null || windowHours === null || packPrice === null) {
      throw failures.validation(errors);
    }

    const date = effectiveFrom;
    const existing = await loadRateCards(pool, kitchen.id);
    if (existing.some((card) => card.effective_from === date)) {
      throw failures.rateCardExists(date);
    }

    const id = newId('rc');
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO rate_cards
           (id, kitchen_id, effective_from, tier_1_cents, tier_2_cents, tier_3_cents, tier_4_cents,
            cancellation_window_hours, pack_price_cents, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          id,
          kitchen.id,
          date,
          tierValues[0],
          tierValues[1],
          tierValues[2],
          tierValues[3],
          windowHours,
          packPrice,
          ctx.now,
        ],
      );
      for (const station of stations) {
        await client.query(
          'INSERT INTO rate_card_surcharges (rate_card_id, station_id, surcharge_cents) VALUES ($1, $2, $3)',
          [id, station.id, surchargeMap[station.id]],
        );
      }
    });

    const cards = await loadRateCards(pool, kitchen.id);
    const inForce = cardInForce(cards, today);
    const card = cards.find((entry) => entry.id === id);
    if (!card) throw failures.notFound();
    return created({ rate_card: rateCardView(card, inForce ? inForce.id : null) });
  }),
);
