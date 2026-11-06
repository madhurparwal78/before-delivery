import { randomUUID } from 'node:crypto';
import { addDays, isOpenDay, today } from '../../domain/calendar.js';
import { firstFreeUnit, freeUnits } from '../../domain/occupancy.js';
import {
  canCancelHold,
  canMarkReady,
  effectiveHoldStatus,
  HOLD_STATUS_WORDS,
} from '../../domain/states.js';
import { FIELD_COPY, noSuchCopy } from '../../shared/errors.js';
import { requireBorrowingAllowed } from '../core/borrowing.js';
import { findItem, listUnits, loadOccupyingSpans, spansFor } from '../core/catalogue.js';
import type { AppContext } from '../core/context.js';
import { encodeCursor, decodeCursor } from '../core/cursor.js';
import { queueMessage, readyMessage } from '../core/mailer.js';
import { isStaff, presentHold } from '../core/present.js';
import { findHold, listHolds } from '../core/records.js';
import { inTransaction } from '../db/pool.js';
import { fail, failTransition, failValidation } from '../http/apiError.js';
import type { HandlerResult } from '../http/context.js';
import { sessionRoute, type Route } from '../http/routes.js';
import { readDate, readPageParameters, readString, resolveHold } from './shared.js';
import type { HoldStatus } from '../../domain/states.js';

const BOOKING_HORIZON_DAYS = 28;
const MAX_LOAN_DAYS = 7;

const HOLD_STATUS_VALUES: readonly HoldStatus[] = [
  'requested',
  'ready',
  'collected',
  'expired',
  'cancelled',
];

export function holdRoutes(app: AppContext): Route[] {
  return [
    sessionRoute({
      method: 'POST',
      pattern: '/api/holds',
      body: 'json',
      keyed: true,
      roles: ['member'],
      handle: async (context): Promise<HandlerResult> => {
        const itemId = readString(context.json, 'item_id');
        const startDate = readDate(context.json, 'start_date');
        const endDate = readDate(context.json, 'end_date');
        const localToday = today(app.library.calendar, context.now);
        const fields: Record<string, string> = {};

        const item = itemId === null ? null : await findItem(app.pool, itemId);
        if (item === null) fields['item_id'] = noSuchCopy('item');
        if (
          startDate === null ||
          startDate < localToday ||
          startDate > addDays(localToday, BOOKING_HORIZON_DAYS - 1) ||
          !isOpenDay(app.library.calendar, startDate)
        ) {
          fields['start_date'] = FIELD_COPY.start_date;
        }
        if (
          endDate === null ||
          startDate === null ||
          endDate < startDate ||
          endDate > addDays(startDate, MAX_LOAN_DAYS) ||
          !isOpenDay(app.library.calendar, endDate)
        ) {
          fields['end_date'] = FIELD_COPY.end_date;
        }
        if (Object.keys(fields).length > 0) throw failValidation(fields);
        if (item === null || startDate === null || endDate === null) throw failValidation(fields);

        const claim = await inTransaction(app.pool, async (client) => {
          await client.query(`select id from person where id = $1 for no key update`, [context.caller.id]);
          await client.query(`select id from item where id = $1 for no key update`, [item.id]);

          await requireBorrowingAllowed(client, app.library, context.caller.id, context.now, true);

          const units = await listUnits(client, item.id);
          const spans = spansFor(
            await loadOccupyingSpans(client, app.library, context.now, item.id),
            item.id,
          );
          const unit = firstFreeUnit(units, spans, startDate, endDate);
          if (unit === null) throw fail('no_unit_free');

          const holdId = randomUUID();
          await client.query(
            `insert into hold (id, item_id, unit_id, member_id, status, start_date, end_date, created_at)
             values ($1, $2, $3, $4, 'requested', $5, $6, now())`,
            [holdId, item.id, unit.id, context.caller.id, startDate, endDate],
          );

          const spansAfter = spansFor(
            await loadOccupyingSpans(client, app.library, context.now, item.id),
            item.id,
          );
          const unitsFree = freeUnits(units, spansAfter, startDate, endDate).length;
          const hold = await findHold(client, holdId);
          if (hold === null) throw fail('not_found');
          return { hold, unitsFree, unitCount: units.length };
        });

        return {
          kind: 'json',
          status: 201,
          value: {
            hold: presentHold(claim.hold, context.now),
            units_free: claim.unitsFree,
            unit_count: claim.unitCount,
          },
        };
      },
    }),

    sessionRoute({
      method: 'GET',
      pattern: '/api/holds',
      handle: async (context): Promise<HandlerResult> => {
        const page = readPageParameters(context.query);
        const rawStatus = context.query.get('status');
        const status = HOLD_STATUS_VALUES.find((value) => value === rawStatus) ?? null;
        const position =
          page.cursor === null ? null : decodeCursor(app.secret, 'holds', page.cursor);
        if (page.cursor !== null && position === null) {
          throw failValidation({ cursor: FIELD_COPY.cursor });
        }
        const holds = await listHolds(app.pool, {
          memberId: isStaff(context.caller) ? null : context.caller.id,
          status,
          now: context.now,
          limit: page.limit + 1,
          cursorInstant: position === null ? null : position.instant,
          cursorId: position === null ? null : position.id,
        });
        const pageRows = holds.slice(0, page.limit);
        const last = pageRows[pageRows.length - 1];
        return {
          kind: 'json',
          status: 200,
          value: {
            holds: pageRows.map((hold) => presentHold(hold, context.now)),
            next_cursor:
              holds.length > page.limit && last !== undefined
                ? encodeCursor(app.secret, 'holds', {
                    instant: last.createdAt.toISOString(),
                    id: last.id,
                  })
                : null,
          },
        };
      },
    }),

    sessionRoute({
      method: 'GET',
      pattern: '/api/holds/:holdId',
      resolve: (context) => resolveHold(app, context),
      handle: async (context, hold): Promise<HandlerResult> => ({
        kind: 'json',
        status: 200,
        value: { hold: presentHold(hold, context.now) },
      }),
    }),

    sessionRoute({
      method: 'POST',
      pattern: '/api/holds/:holdId/ready',
      body: 'json',
      roles: ['volunteer', 'founder'],
      resolve: (context) => resolveHold(app, context),
      handle: async (context, resolved): Promise<HandlerResult> => {
        const hold = await inTransaction(app.pool, async (client) => {
          const locked = await client.query<{ status: string; pickup_deadline: Date | null }>(
            `select status, pickup_deadline from hold where id = $1 for no key update`,
            [resolved.id],
          );
          const row = locked.rows[0];
          if (row === undefined) throw fail('not_found');
          const status = effectiveHoldStatus(
            row.status as HoldStatus,
            row.pickup_deadline,
            context.now,
          );
          if (!canMarkReady(status)) throw failTransition('hold', HOLD_STATUS_WORDS[status]);

          await client.query(
            `update hold set status = 'ready', ready_at = $2::timestamptz,
                    pickup_deadline = $2::timestamptz + make_interval(secs => $3::double precision)
             where id = $1`,
            [resolved.id, context.now, app.config.pickupWindowSeconds],
          );
          const updated = await findHold(client, resolved.id);
          if (updated === null || updated.pickupDeadline === null) throw fail('not_found');

          const member = await client.query<{ email: string }>(
            `select email from person where id = $1`,
            [updated.memberId],
          );
          await queueMessage(
            client,
            readyMessage(app.library.calendar, {
              holdId: updated.id,
              itemName: updated.itemName,
              unitLabel: updated.unit.label,
              pickupDeadline: updated.pickupDeadline,
              memberEmail: member.rows[0]?.email ?? '',
            }),
          );
          return updated;
        });
        return { kind: 'json', status: 200, value: { hold: presentHold(hold, context.now) } };
      },
    }),

    sessionRoute({
      method: 'POST',
      pattern: '/api/holds/:holdId/cancel',
      body: 'json',
      resolve: (context) => resolveHold(app, context),
      handle: async (context, resolved): Promise<HandlerResult> => {
        const hold = await inTransaction(app.pool, async (client) => {
          const locked = await client.query<{ status: string; pickup_deadline: Date | null }>(
            `select status, pickup_deadline from hold where id = $1 for no key update`,
            [resolved.id],
          );
          const row = locked.rows[0];
          if (row === undefined) throw fail('not_found');
          const status = effectiveHoldStatus(
            row.status as HoldStatus,
            row.pickup_deadline,
            context.now,
          );
          if (!canCancelHold(status)) throw failTransition('hold', HOLD_STATUS_WORDS[status]);
          await client.query(`update hold set status = 'cancelled' where id = $1`, [resolved.id]);
          const updated = await findHold(client, resolved.id);
          if (updated === null) throw fail('not_found');
          return updated;
        });
        return { kind: 'json', status: 200, value: { hold: presentHold(hold, context.now) } };
      },
    }),
  ];
}
