/**
 * Path identifier resolution, which is step 6 of the error precedence: an
 * unknown identifier and an identifier owned by another renter both answer the
 * same `404 not_found`, so a renter never learns that another renter's record
 * exists.
 */

import { db } from '../db.js';
import * as errors from './errors.js';
import type { Principal } from './auth.js';
import {
  BOOKING_COLUMNS,
  DOCUMENT_COLUMNS,
  type BookingRow,
  type ComplianceLinkRow,
  type DocumentRow,
  type MaintenanceBlockRow,
  type RenterRow,
  type StationRow,
  type StatementRow,
} from '../rows.js';

export type ResolverName =
  | 'renter'
  | 'booking'
  | 'document'
  | 'station'
  | 'statement'
  | 'block'
  | 'link';

export interface ResolvedEntities {
  renter?: RenterRow;
  booking?: BookingRow;
  document?: DocumentRow;
  station?: StationRow;
  statement?: StatementRow;
  block?: MaintenanceBlockRow;
  link?: ComplianceLinkRow;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuid(value: string | undefined): string {
  if (value === undefined || !UUID.test(value)) throw errors.notFound();
  return value;
}

/** A renter caller may only reach their own records. */
function guardOwnership(principal: Principal | null, ownerRenterId: string): void {
  if (principal?.role === 'renter' && principal.renterId !== ownerRenterId) {
    throw errors.notFound();
  }
}

async function loadRenter(id: string): Promise<RenterRow> {
  const row = await db.maybeOne<RenterRow>(
    `SELECT id, user_id, business_name, contact_name, email, phone, status, killbill_account_id
       FROM renters WHERE id = $1`,
    [requireUuid(id)],
  );
  if (!row) throw errors.notFound();
  return row;
}

export async function resolveAll(
  names: readonly ResolverName[],
  params: Record<string, string>,
  principal: Principal | null,
): Promise<ResolvedEntities> {
  const resolved: ResolvedEntities = {};
  for (const name of names) {
    switch (name) {
      case 'renter': {
        const renter = await loadRenter(params['renter_id']);
        guardOwnership(principal, renter.id);
        resolved.renter = renter;
        break;
      }
      case 'booking': {
        const booking = await db.maybeOne<BookingRow>(
          `SELECT ${BOOKING_COLUMNS} FROM bookings b
             JOIN stations s ON s.id = b.station_id
            WHERE b.id = $1`,
          [requireUuid(params['booking_id'])],
        );
        if (!booking) throw errors.notFound();
        guardOwnership(principal, booking.renter_id);
        resolved.booking = booking;
        break;
      }
      case 'document': {
        const document = await db.maybeOne<DocumentRow>(
          `SELECT ${DOCUMENT_COLUMNS} FROM documents WHERE id = $1`,
          [requireUuid(params['document_id'])],
        );
        if (!document) throw errors.notFound();
        guardOwnership(principal, document.renter_id);
        resolved.document = document;
        break;
      }
      case 'statement': {
        const statement = await db.maybeOne<StatementRow>(
          `SELECT id, renter_id, month, object_key, created_at FROM statements WHERE id = $1`,
          [requireUuid(params['statement_id'])],
        );
        if (!statement) throw errors.notFound();
        guardOwnership(principal, statement.renter_id);
        resolved.statement = statement;
        break;
      }
      case 'station': {
        const station = await db.maybeOne<StationRow>(
          'SELECT id, name, sort_order FROM stations WHERE id = $1',
          [params['station_id']],
        );
        if (!station) throw errors.notFound();
        resolved.station = station;
        break;
      }
      case 'block': {
        const block = await db.maybeOne<MaintenanceBlockRow>(
          `SELECT id, station_id, date, start_hhmm, end_hhmm, starts_at, ends_at, reason
             FROM maintenance_blocks WHERE id = $1`,
          [requireUuid(params['block_id'])],
        );
        if (!block) throw errors.notFound();
        resolved.block = block;
        break;
      }
      case 'link': {
        const link = await db.maybeOne<ComplianceLinkRow>(
          `SELECT id, label, token, expires_in_seconds, expires_at, revoked_at, created_at
             FROM compliance_links WHERE id = $1`,
          [requireUuid(params['link_id'])],
        );
        if (!link) throw errors.notFound();
        resolved.link = link;
        break;
      }
    }
  }
  return resolved;
}

export function requireResolved<K extends keyof ResolvedEntities>(
  resolved: ResolvedEntities,
  key: K,
): NonNullable<ResolvedEntities[K]> {
  const value = resolved[key];
  if (value === undefined) throw new Error(`route did not resolve ${String(key)}`);
  return value as NonNullable<ResolvedEntities[K]>;
}
