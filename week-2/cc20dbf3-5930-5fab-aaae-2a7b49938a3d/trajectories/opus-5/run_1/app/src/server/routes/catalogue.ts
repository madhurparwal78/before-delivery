import { addDays, isLocalDate, today, type LocalDate } from '../../domain/calendar.js';
import { rateOn } from '../../domain/lateFee.js';
import { freeUnits, unitIsBusy } from '../../domain/occupancy.js';
import { FIELD_COPY } from '../../shared/errors.js';
import type { Lane, LanesResponse } from '../../shared/api.js';
import {
  findItem,
  listItems,
  listUnits,
  loadOccupyingSpans,
  spansFor,
} from '../core/catalogue.js';
import type { AppContext } from '../core/context.js';
import { presentItem, presentSpan } from '../core/present.js';
import { fail, failValidation } from '../http/apiError.js';
import type { HandlerResult } from '../http/context.js';
import { sessionRoute, type Route } from '../http/routes.js';

const WINDOW_DAYS = 28;

export function catalogueRoutes(app: AppContext): Route[] {
  return [
    sessionRoute({
      method: 'GET',
      pattern: '/api/library',
      handle: async (context): Promise<HandlerResult> => {
        const localToday = today(app.library.calendar, context.now);
        return {
          kind: 'json',
          status: 200,
          value: {
            name: app.library.name,
            time_zone: app.library.calendar.timeZone,
            open_days: app.library.calendar.openDays,
            closed_dates: app.library.calendar.closedDates,
            opening_time: app.library.calendar.openingTime,
            closing_time: app.library.calendar.closingTime,
            late_fee_schedule: app.library.lateFeeSchedule.map((entry) => ({
              effective_from: entry.effectiveFrom,
              cents_per_day: entry.centsPerDay,
            })),
            late_fee_cents_per_day: rateOn(app.library.lateFeeSchedule, localToday),
            max_active_per_member: app.library.maxActivePerMember,
            pickup_window_seconds: app.config.pickupWindowSeconds,
          },
        };
      },
    }),

    sessionRoute({
      method: 'GET',
      pattern: '/api/items',
      handle: async (context): Promise<HandlerResult> => {
        const items = await listItems(app.pool);
        const units = await listUnits(app.pool);
        const spans = await loadOccupyingSpans(app.pool, app.library, context.now);
        const localToday = today(app.library.calendar, context.now);
        return {
          kind: 'json',
          status: 200,
          value: {
            items: items.map((item) => {
              const itemUnits = units.filter((unit) => unit.itemId === item.id);
              const itemSpans = spansFor(spans, item.id);
              const free = itemUnits.filter(
                (unit) => !unitIsBusy(itemSpans, unit.id, localToday, localToday),
              ).length;
              return presentItem(item, itemUnits.length, free);
            }),
          },
        };
      },
    }),

    sessionRoute({
      method: 'GET',
      pattern: '/api/items/:itemId',
      handle: async (context): Promise<HandlerResult> => {
        const item = await findItem(app.pool, context.params['itemId'] ?? '');
        if (item === null) throw fail('not_found');
        const units = await listUnits(app.pool, item.id);
        const spans = await loadOccupyingSpans(app.pool, app.library, context.now, item.id);
        const localToday = today(app.library.calendar, context.now);
        const free = units.filter(
          (unit) => !unitIsBusy(spansFor(spans, item.id), unit.id, localToday, localToday),
        ).length;
        return {
          kind: 'json',
          status: 200,
          value: { item: presentItem(item, units.length, free) },
        };
      },
    }),

    sessionRoute({
      method: 'GET',
      pattern: '/api/items/:itemId/lanes',
      handle: async (context): Promise<HandlerResult> => {
        const item = await findItem(app.pool, context.params['itemId'] ?? '');
        if (item === null) throw fail('not_found');

        const rawFrom = context.query.get('from');
        if (rawFrom !== null && !isLocalDate(rawFrom)) {
          throw failValidation({ from: FIELD_COPY.start_date });
        }
        const from: LocalDate = rawFrom ?? today(app.library.calendar, context.now);
        const to = addDays(from, WINDOW_DAYS - 1);

        const rawStart = context.query.get('start');
        const rawEnd = context.query.get('end');
        if (rawStart !== null && rawEnd === null) throw failValidation({ end_date: FIELD_COPY.end_date });
        if (rawEnd !== null && rawStart === null) throw failValidation({ start_date: FIELD_COPY.start_date });
        if (rawStart !== null && !isLocalDate(rawStart)) {
          throw failValidation({ start_date: FIELD_COPY.start_date });
        }
        if (rawEnd !== null && !isLocalDate(rawEnd)) {
          throw failValidation({ end_date: FIELD_COPY.end_date });
        }

        const units = await listUnits(app.pool, item.id);
        const spans = spansFor(
          await loadOccupyingSpans(app.pool, app.library, context.now, item.id),
          item.id,
        );

        const lanes: Lane[] = units.map((unit) => ({
          lane_index: unit.laneIndex,
          unit_id: unit.id,
          label: unit.label,
          busy_for_range:
            rawStart === null || rawEnd === null
              ? null
              : unitIsBusy(spans, unit.id, rawStart, rawEnd),
          spans: spans
            .filter(
              (span) => span.unitId === unit.id && span.startDate <= to && span.endDate >= from,
            )
            .sort((left, right) => (left.startDate < right.startDate ? -1 : 1))
            .map((span) => presentSpan(app.library.calendar, span, context.caller)),
        }));

        const response: LanesResponse = {
          item_id: item.id,
          from,
          to,
          unit_count: units.length,
          units_free:
            rawStart === null || rawEnd === null
              ? null
              : freeUnits(units, spans, rawStart, rawEnd).length,
          lanes,
        };
        return { kind: 'json', status: 200, value: response };
      },
    }),

    sessionRoute({
      method: 'GET',
      pattern: '/api/counter/status',
      roles: ['volunteer', 'founder'],
      handle: async (context): Promise<HandlerResult> => {
        const [billingUp, storageUp] = await Promise.all([
          app.probes.billingUp(),
          app.probes.photoStorageUp(),
        ]);
        return {
          kind: 'json',
          status: 200,
          value: {
            billing: billingUp ? 'up' : 'down',
            photo_storage: storageUp ? 'up' : 'down',
            checked_at: context.now.toISOString(),
          },
        };
      },
    }),
  ];
}
