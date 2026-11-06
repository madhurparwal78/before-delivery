/** Renter reads, operator transitions, hour adjustments and the hour ledger. */

import { db, transaction } from '../db.js';
import * as errors from '../http/errors.js';
import { Validator } from '../http/validate.js';
import { json, type Route, type RouteResult, type SessionContext } from '../http/router.js';
import { requireResolved } from '../http/resolve.js';
import { kitchenToday, nowMs } from '../domain/clock.js';
import {
  activationDocumentsSatisfied,
  blockingDocumentsCurrent,
} from '../domain/compliance.js';
import {
  InsufficientHours,
  balanceMinutes,
  heldMinutes,
  lockRenterHours,
  recordMovement,
} from '../domain/ledger.js';
import { reconcileShelfSubscription } from '../domain/shelf.js';
import {
  canOperatorRequestRenterMove,
  isRenterStatus,
} from '../domain/transitions.js';
import { renterDocumentFacts, renterSummary } from './present.js';
import type { LedgerEntry, RenterStatus } from '../../shared/types.js';
import type { RenterRow } from '../rows.js';

const ALL_ROLES = ['operator', 'shift_lead', 'renter'] as const;
const STAFF = ['operator', 'shift_lead'] as const;

async function loadRenterRow(renterId: string): Promise<RenterRow> {
  return db.one<RenterRow>(
    `SELECT id, user_id, business_name, contact_name, email, phone, status, killbill_account_id
       FROM renters WHERE id = $1`,
    [renterId],
  );
}

interface LedgerEntryRow {
  id: string;
  movement_id: string;
  kind: LedgerEntry['kind'];
  account: string;
  direction: 'debit' | 'credit';
  minutes: number;
  booking_id: string | null;
  purchase_id: string | null;
  note: string | null;
  created_at: Date;
}

export const renterRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/renters',
    auth: 'session',
    roles: [...STAFF],
    async handle() {
      const rows = await db.query<RenterRow>(
        `SELECT id, user_id, business_name, contact_name, email, phone, status, killbill_account_id
           FROM renters ORDER BY business_name`,
      );
      const renters = [];
      for (const row of rows) renters.push(await renterSummary(db, row));
      return json(200, { renters });
    },
  },
  {
    method: 'GET',
    path: '/api/renters/:renter_id',
    auth: 'session',
    roles: [...ALL_ROLES],
    resolve: ['renter'],
    async handle(context) {
      const renter = requireResolved(context.resolved, 'renter');
      const summary = await renterSummary(db, renter);
      const shelf = await reconcileShelfSubscription(renter.id);
      return json(200, { renter: { ...summary, shelf_subscription: shelf } });
    },
  },
  {
    method: 'POST',
    path: '/api/renters/:renter_id/transitions',
    auth: 'session',
    roles: ['operator'],
    body: 'json',
    resolve: ['renter'],
    async handle(context): Promise<RouteResult> {
      const renter = requireResolved(context.resolved, 'renter');
      const requested = context.body['to'];
      if (!isRenterStatus(requested)) {
        Validator.one('to', 'Choose one of: active, offboarded.');
      }
      const to: RenterStatus = requested;
      if (!canOperatorRequestRenterMove(renter.status, to)) {
        throw errors.invalidTransition(renter.status, to);
      }

      const today = kitchenToday();
      const documents = await renterDocumentFacts(db, renter.id);
      if (to === 'active') {
        const satisfied =
          renter.status === 'suspended'
            ? blockingDocumentsCurrent(documents, today)
            : activationDocumentsSatisfied(documents, today);
        if (!satisfied) throw errors.documentsIncomplete();
      }
      if (to === 'offboarded') {
        const future = await db.maybeOne<{ id: string }>(
          `SELECT id FROM bookings
            WHERE renter_id = $1 AND status IN ('hold','confirmed') AND starts_at > now() LIMIT 1`,
          [renter.id],
        );
        if (future) throw errors.hasFutureBookings();
      }

      await db.query('UPDATE renters SET status = $2 WHERE id = $1', [renter.id, to]);
      return json(200, { renter: await renterSummary(db, await loadRenterRow(renter.id)) });
    },
  },
  {
    method: 'GET',
    path: '/api/renters/:renter_id/ledger',
    auth: 'session',
    roles: [...ALL_ROLES],
    resolve: ['renter'],
    async handle(context) {
      const renter = requireResolved(context.resolved, 'renter');
      const rows = await db.query<LedgerEntryRow>(
        `SELECT e.id, e.movement_id, m.kind, e.account, e.direction, e.minutes,
                m.booking_id, m.purchase_id, m.note, e.created_at
           FROM ledger_entries e
           JOIN movements m ON m.id = e.movement_id
          WHERE e.renter_id = $1
          ORDER BY e.seq`,
        [renter.id],
      );
      return json(200, {
        balance_minutes: await balanceMinutes(db, renter.id),
        held_minutes: await heldMinutes(db, renter.id),
        entries: rows.map((row) => ({
          id: row.id,
          movement_id: row.movement_id,
          kind: row.kind,
          account: row.account,
          direction: row.direction,
          minutes: row.minutes,
          booking_id: row.booking_id,
          purchase_id: row.purchase_id,
          note: row.note,
          created_at: row.created_at.toISOString(),
        })),
      });
    },
  },
  {
    method: 'POST',
    path: '/api/renters/:renter_id/adjustments',
    auth: 'session',
    roles: ['operator'],
    body: 'json',
    resolve: ['renter'],
    async handle(context) {
      const renter = requireResolved(context.resolved, 'renter');
      const validator = new Validator(context.body);
      const minutes = validator.integer('minutes', -24_000, 24_000);
      if (!validator.hasFailed('minutes') && (minutes === 0 || minutes % 15 !== 0)) {
        validator.fail('minutes', 'Enter a non-zero multiple of 15 minutes.');
      }
      const reason = validator.text('reason', 1, 200);
      validator.done();

      try {
        return await transaction(async (tx) => {
          await lockRenterHours(tx, renter.id);
          const movementId = await recordMovement(tx, {
            renterId: renter.id,
            kind: 'adjustment',
            minutes,
            note: reason,
          });
          return json(201, {
            movement_id: movementId,
            balance_minutes: await balanceMinutes(tx, renter.id),
          });
        });
      } catch (error) {
        if (error instanceof InsufficientHours) {
          throw errors.insufficientHours(error.balanceMinutes, error.neededMinutes);
        }
        throw error;
      }
    },
  },
];

