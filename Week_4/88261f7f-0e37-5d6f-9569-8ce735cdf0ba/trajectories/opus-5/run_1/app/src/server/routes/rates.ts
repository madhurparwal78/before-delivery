import { randomUUID } from 'node:crypto';
import { one, pool, withTransaction } from '../db';
import { DESK_ROLES, OWNER_ONLY } from '../domain/roles';
import { isTaxPercentText } from '../../shared/rates';
import { invalid, notFoundError, validationTexts } from '../http/errors';
import { Router } from '../http/router';
import { listRatePlans, listTaxRates } from '../repo/hotels';
import { rangeReport, MAX_REPORT_NIGHTS, rangeNightCount } from '../repo/reports';
import { publishChange } from '../services/live';
import { dateField, hotelOf, integerField, queryDate, textField } from './support';

export function registerRateRoutes(router: Router): void {
  router.add({
    method: 'GET',
    pattern: '/api/rate-plans',
    access: DESK_ROLES,
    bodyMode: 'none',
    handler: async (ctx) => {
      const hotel = await hotelOf(ctx);
      return { status: 200, json: { ratePlans: await listRatePlans(pool, hotel.id) } };
    },
  });

  router.add({
    method: 'PATCH',
    pattern: '/api/rate-plans/:id',
    access: OWNER_ONLY,
    bodyMode: 'json',
    handler: async (ctx) => {
      const hotel = await hotelOf(ctx);
      const plans = await listRatePlans(pool, hotel.id);
      const plan = plans.find((candidate) => candidate.id === ctx.params.id);
      if (!plan) throw notFoundError();
      const weeknightCents = integerField(ctx.body, 'weeknightCents');
      const weekendCents = integerField(ctx.body, 'weekendCents');
      const errors: Record<string, string> = {};
      if (weeknightCents === null || weeknightCents <= 0) {
        errors.weeknightCents = validationTexts.amountAboveZero;
      }
      if (weekendCents === null || weekendCents <= 0) {
        errors.weekendCents = validationTexts.amountAboveZero;
      }
      if (Object.keys(errors).length > 0) throw invalid(errors);
      await withTransaction(async (db) => {
        await db.query(
          'update rate_plans set weeknight_cents = $2, weekend_cents = $3 where id = $1',
          [plan.id, weeknightCents, weekendCents],
        );
        await publishChange(db, hotel.id, { type: 'report', notice: null });
      });
      return {
        status: 200,
        json: {
          id: plan.id,
          name: plan.name,
          weeknightCents: weeknightCents as number,
          weekendCents: weekendCents as number,
        },
      };
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/tax-rates',
    access: DESK_ROLES,
    bodyMode: 'none',
    handler: async (ctx) => {
      const hotel = await hotelOf(ctx);
      return { status: 200, json: { taxRates: await listTaxRates(pool, hotel.id) } };
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/tax-rates',
    access: OWNER_ONLY,
    bodyMode: 'json',
    handler: async (ctx) => {
      const hotel = await hotelOf(ctx);
      const percent = textField(ctx.body, 'percent').trim();
      const startDate = dateField(ctx.body, 'startDate');
      const errors: Record<string, string> = {};
      if (!isTaxPercentText(percent)) errors.percent = validationTexts.taxPercent;
      if (startDate === null || startDate <= hotel.businessDate) {
        errors.startDate = validationTexts.taxStartDate;
      }
      if (Object.keys(errors).length > 0) throw invalid(errors);
      const created = await withTransaction(async (db) => {
        const row = await one<{ id: string; percent: string; start_date: string }>(
          db,
          `insert into tax_rates (id, hotel_id, percent, start_date) values ($1,$2,$3,$4)
           on conflict (hotel_id, start_date) do update set percent = excluded.percent
           returning id, percent, start_date`,
          [randomUUID(), hotel.id, percent, startDate],
        );
        await publishChange(db, hotel.id, { type: 'report', notice: null });
        return row;
      });
      return {
        status: 201,
        json: created
          ? { id: created.id, percent: created.percent, startDate: created.start_date }
          : null,
      };
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/reports',
    access: OWNER_ONLY,
    bodyMode: 'none',
    handler: async (ctx) => {
      const hotel = await hotelOf(ctx);
      const from = queryDate(ctx, 'from');
      const to = queryDate(ctx, 'to');
      const errors: Record<string, string> = {};
      if (from === null) errors.from = validationTexts.dateRange;
      if (to === null) errors.to = validationTexts.dateRange;
      if (from !== null && to !== null) {
        const nights = rangeNightCount(from, to);
        if (nights < 1 || nights > MAX_REPORT_NIGHTS) errors.to = validationTexts.dateRange;
      }
      if (Object.keys(errors).length > 0) throw invalid(errors);
      return {
        status: 200,
        json: await rangeReport(pool, hotel.id, from as string, to as string),
      };
    },
  });
}
