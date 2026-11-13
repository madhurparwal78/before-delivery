import { query, type Db } from './db';
import { kitchenIso } from './kitchen-time';
import {
  BOOKING_COLUMNS,
  bookingStanding,
  cancelCreditMinutesOf,
  checkInOpensAtOf,
  cutoffOf,
  doorActionsOf,
  movableOf,
  type BookingRow,
} from './domain/bookings';
import { deliveryStateOf, mailRowFor, mailRowsFor } from './domain/mail';
import {
  coverReading,
  currentOf,
  documentsOfTenant,
  isCurrentDocument,
  type DocumentRow,
} from './domain/documents';
import { packsOfTenant, refundableCentsOf, type PackFigures } from './domain/packs';
import { clearanceFor, tenantStanding, TENANT_COLUMNS, type TenantRow } from './domain/tenants';
import type {
  Booking,
  BookingEmailStatus,
  DocumentRecord,
  DoorEntry,
  DoorLogEntry,
  Interval,
  LedgerEntry,
  Me,
  Pack,
  PackDetail,
  Role,
  Station,
  StationKind,
  TenantDetail,
  TenantRecord,
} from '../shared/types';
import type { OccupiedPeriod, StationMetrics } from './domain/occupancy';

export interface StationRow {
  id: string;
  name: string;
  kind: StationKind;
  cleanup_minutes: number;
  col: number;
  row_index: number;
  seed_order: number;
}

export async function loadStations(client: Db): Promise<StationRow[]> {
  return query<StationRow>(
    client,
    'select id, name, kind, cleanup_minutes, col, row_index, seed_order from stations order by seed_order',
  );
}

export function stationMap(stations: ReadonlyArray<StationRow>): Map<string, StationRow> {
  return new Map(stations.map((station) => [station.id, station]));
}

export function meView(user: { id: string; role: Role; email: string; displayName: string }, tenant: {
  id: string;
  businessName: string;
  status: Me['tenant'] extends null ? never : NonNullable<Me['tenant']>['status'];
  suspendedReason: NonNullable<Me['tenant']>['suspendedReason'];
} | null): Me {
  return {
    id: user.id,
    role: user.role,
    email: user.email,
    displayName: user.displayName,
    tenant:
      tenant === null
        ? null
        : {
            id: tenant.id,
            businessName: tenant.businessName,
            status: tenant.status,
            suspendedReason: tenant.suspendedReason,
          },
  };
}

export function intervalView(
  period: OccupiedPeriod,
  role: Role,
  viewerTenantId: string | null,
): Interval {
  if (role === 'tenant') {
    return {
      start: kitchenIso(period.start),
      end: kitchenIso(period.end),
      bufferEnd: kitchenIso(period.bufferEnd),
      mine: period.tenantId === viewerTenantId,
    };
  }
  return {
    start: kitchenIso(period.start),
    end: kitchenIso(period.end),
    bufferEnd: kitchenIso(period.bufferEnd),
    bookingId: period.bookingId,
    status: period.status,
    tenantId: period.tenantId,
    tenantName: period.tenantName,
  };
}

export function stationView(
  station: StationRow,
  intervals: Interval[],
  metrics: StationMetrics | null,
): Station {
  const view: Station = {
    id: station.id,
    name: station.name,
    kind: station.kind,
    cleanupMinutes: station.cleanup_minutes,
    col: station.col,
    row: station.row_index,
    intervals,
  };
  if (metrics !== null) {
    view.occupiedMinutes = metrics.occupiedMinutes;
    view.bufferMinutes = metrics.bufferMinutes;
    view.freeMinutes = metrics.freeMinutes;
  }
  return view;
}

async function bookingEmailsOf(client: Db, bookingId: string): Promise<BookingEmailStatus[]> {
  const rows = await mailRowsFor(client, bookingId, ['booking_confirmed', 'booking_moved']);
  const emails: BookingEmailStatus[] = [];
  for (const row of rows) {
    const state = deliveryStateOf(row);
    if (state === null) continue;
    emails.push({
      kind: row.kind === 'booking_moved' ? 'booking_moved' : 'booking_confirmed',
      status: state.status,
      sentAt: state.sentAt,
    });
  }
  return emails;
}

async function doorLogOf(client: Db, bookingIds: ReadonlyArray<string>): Promise<Map<string, DoorLogEntry[]>> {
  const log = new Map<string, DoorLogEntry[]>();
  if (bookingIds.length === 0) return log;
  const rows = await query<{ booking_id: string; action: DoorLogEntry['action']; at: Date; by_name: string }>(
    client,
    `select booking_id, action, at, by_name from door_log
     where booking_id = any($1::uuid[]) order by id`,
    [bookingIds as string[]],
  );
  for (const row of rows) {
    const list = log.get(row.booking_id) ?? [];
    list.push({ action: row.action, at: kitchenIso(row.at), by: row.by_name });
    log.set(row.booking_id, list);
  }
  return log;
}

export async function loadBookingViews(
  client: Db,
  bookings: ReadonlyArray<BookingRow>,
  role: Role,
  now: Date,
): Promise<Booking[]> {
  if (bookings.length === 0) return [];
  const stations = stationMap(await loadStations(client));
  const tenantNames = new Map(
    (
      await query<{ id: string; business_name: string }>(
        client,
        'select id, business_name from tenants where id = any($1::uuid[])',
        [bookings.map((booking) => booking.tenant_id)],
      )
    ).map((row) => [row.id, row.business_name]),
  );
  const doorLogs = role === 'tenant' ? new Map<string, DoorLogEntry[]>() : await doorLogOf(
    client,
    bookings.map((booking) => booking.id),
  );

  const views: Booking[] = [];
  for (const booking of bookings) {
    const standing = bookingStanding(booking, now);
    const view: Booking = {
      id: booking.id,
      stationId: booking.station_id,
      stationName: stations.get(booking.station_id)?.name ?? booking.station_id,
      shelfId: booking.shelf_id,
      shelfName: booking.shelf_id === null ? null : stations.get(booking.shelf_id)?.name ?? booking.shelf_id,
      start: kitchenIso(booking.start_at),
      end: kitchenIso(booking.end_at),
      bufferEnd: kitchenIso(booking.buffer_end_at),
      status: standing.status,
      holdExpiresAt: booking.hold_expires_at === null ? null : kitchenIso(booking.hold_expires_at),
      packId: booking.pack_id,
      debitedMinutes: booking.debited_minutes,
      refundedMinutes: booking.refunded_minutes,
      cancelReason: standing.cancelReason,
      createdAt: kitchenIso(booking.created_at),
      cutoffAt: kitchenIso(cutoffOf(booking.start_at)),
      cancelCreditMinutes: cancelCreditMinutesOf(booking, now),
      moveCount: booking.move_count,
      movable: movableOf(booking, now),
      emails: await bookingEmailsOf(client, booking.id),
    };
    if (role !== 'tenant') {
      view.tenantId = booking.tenant_id;
      view.tenantName = tenantNames.get(booking.tenant_id) ?? '';
      view.doorLog = doorLogs.get(booking.id) ?? [];
      view.cleanupNote = booking.cleanup_note;
    }
    views.push(view);
  }
  return views;
}

export async function loadDoorEntries(client: Db, bookings: ReadonlyArray<BookingRow>, date: string, now: Date, today: string): Promise<DoorEntry[]> {
  if (bookings.length === 0) return [];
  const stations = stationMap(await loadStations(client));
  const tenantIds = [...new Set(bookings.map((booking) => booking.tenant_id))];
  const tenants = await query<TenantRow>(
    client,
    `select ${TENANT_COLUMNS} from tenants where id = any($1::uuid[])`,
    [tenantIds],
  );
  const doorLogs = await doorLogOf(
    client,
    bookings.map((booking) => booking.id),
  );

  const standings = new Map<string, { name: string; cleared: boolean; reason: DoorEntry['reason']; clearedToday: boolean }>();
  for (const tenant of tenants) {
    const documents = currentOf(await documentsOfTenant(client, tenant.id));
    const standing = tenantStanding(tenant, documents, today);
    const forDate = clearanceFor(standing, documents, date);
    const forToday = clearanceFor(standing, documents, today);
    standings.set(tenant.id, {
      name: tenant.business_name,
      cleared: forDate.cleared,
      reason: forDate.reason,
      clearedToday: forToday.cleared,
    });
  }

  return bookings.map((booking) => {
    const tenant = standings.get(booking.tenant_id);
    const standing = bookingStanding(booking, now);
    return {
      bookingId: booking.id,
      tenantId: booking.tenant_id,
      tenantName: tenant?.name ?? '',
      stationId: booking.station_id,
      stationName: stations.get(booking.station_id)?.name ?? booking.station_id,
      shelfId: booking.shelf_id,
      shelfName: booking.shelf_id === null ? null : stations.get(booking.shelf_id)?.name ?? booking.shelf_id,
      start: kitchenIso(booking.start_at),
      end: kitchenIso(booking.end_at),
      status: standing.status,
      cleared: tenant?.cleared ?? false,
      reason: tenant?.reason ?? 'not_approved',
      checkInOpensAt: kitchenIso(checkInOpensAtOf(booking.start_at)),
      actions: doorActionsOf(booking, now, {
        cleared: tenant?.clearedToday ?? false,
        reason: tenant?.reason ?? null,
      }),
      doorLog: doorLogs.get(booking.id) ?? [],
      cleanupNote: booking.cleanup_note,
    };
  });
}

async function packReceiptState(client: Db, packId: string): Promise<Pack['receiptEmail']> {
  const row = await mailRowFor(client, packId, 'pack_receipt');
  const state = deliveryStateOf(row);
  return state === null ? { status: 'queued', sentAt: null } : { status: state.status, sentAt: state.sentAt };
}

export async function packView(client: Db, figures: PackFigures): Promise<Pack> {
  return {
    id: figures.row.id,
    hours: figures.row.hours,
    purchasedMinutes: figures.row.purchased_minutes,
    balanceMinutes: figures.balanceMinutes,
    heldMinutes: figures.heldMinutes,
    availableMinutes: figures.availableMinutes,
    priceCents: figures.row.price_cents,
    status: figures.row.status,
    invoiceId: figures.row.invoice_id,
    purchasedAt: kitchenIso(figures.row.purchased_at),
    receiptEmail: await packReceiptState(client, figures.row.id),
  };
}

export async function packDetailView(client: Db, figures: PackFigures): Promise<PackDetail> {
  const entries = await query<{
    id: string;
    movement_id: string;
    movement: LedgerEntry['movement'];
    side: 'pack' | 'kitchen';
    minutes: number;
    booking_id: string | null;
    created_at: Date;
  }>(
    client,
    `select e.id, e.movement_id, m.movement, e.side, e.minutes, e.booking_id, e.created_at
     from ledger_entries e join ledger_movements m on m.id = e.movement_id
     where e.pack_id = $1 order by e.created_at, e.id`,
    [figures.row.id],
  );
  return {
    ...(await packView(client, figures)),
    refundableCents: refundableCentsOf(figures),
    refundedCents: figures.row.refunded_cents,
    entries: entries.map((entry) => ({
      id: entry.id,
      movementId: entry.movement_id,
      movement: entry.movement,
      side: entry.side,
      minutes: entry.minutes,
      bookingId: entry.booking_id,
      createdAt: kitchenIso(entry.created_at),
    })),
  };
}

export async function documentView(
  client: Db,
  document: DocumentRow,
  current: boolean,
  today: string,
): Promise<DocumentRecord> {
  const rows = await mailRowsFor(client, document.id, ['notice_seven_days', 'notice_today']);
  const cover = coverReading(document, current, today);
  return {
    id: document.id,
    tenantId: document.tenant_id,
    kind: document.kind,
    expiresOn: document.expires_on,
    perOccurrenceLimit: document.per_occurrence_limit,
    additionalInsured: document.additional_insured,
    contentType: document.content_type,
    sizeBytes: document.size_bytes,
    sha256: document.sha256,
    hasFile: document.has_file,
    current,
    coverState: cover.coverState,
    daysLeft: cover.daysLeft,
    uploadedAt: kitchenIso(document.uploaded_at),
    notices: rows.flatMap((row) => {
      const state = deliveryStateOf(row);
      if (state === null) return [];
      return [
        {
          point: row.kind === 'notice_seven_days' ? ('seven_days' as const) : ('today' as const),
          status: state.status,
          sentAt: state.sentAt,
        },
      ];
    }),
  };
}

export async function loadDocumentViews(
  client: Db,
  tenantId: string,
  today: string,
): Promise<DocumentRecord[]> {
  const documents = await documentsOfTenant(client, tenantId);
  const current = currentOf(documents);
  const views: DocumentRecord[] = [];
  for (const document of documents) {
    views.push(await documentView(client, document, isCurrentDocument(document, current), today));
  }
  return views;
}

export async function tenantView(client: Db, tenant: TenantRow, today: string): Promise<TenantRecord> {
  const documents = await documentsOfTenant(client, tenant.id);
  const current = currentOf(documents);
  const standing = tenantStanding(tenant, current, today);
  return {
    id: tenant.id,
    businessName: tenant.business_name,
    contactName: tenant.contact_name,
    email: tenant.email,
    status: standing.status,
    suspendedReason: standing.suspendedReason,
    insuranceExpiresOn: current.insurance?.expires_on ?? null,
    foodHandlerExpiresOn: current.foodHandler?.expires_on ?? null,
    createdAt: kitchenIso(tenant.created_at),
  };
}

export async function tenantDetailView(
  client: Db,
  tenant: TenantRow,
  today: string,
  now: Date,
): Promise<TenantDetail> {
  const base = await tenantView(client, tenant, today);
  const packs = await packsOfTenant(client, tenant.id, now);
  const packDetails: PackDetail[] = [];
  for (const pack of packs) {
    packDetails.push(await packDetailView(client, pack));
  }
  return {
    ...base,
    packs: packDetails,
    documents: await loadDocumentViews(client, tenant.id, today),
  };
}

export async function bookingsOfTenant(
  client: Db,
  tenantId: string,
  fromDateInstant: Date | null,
): Promise<BookingRow[]> {
  if (fromDateInstant === null) {
    return query<BookingRow>(
      client,
      `select ${BOOKING_COLUMNS} from bookings where tenant_id = $1 order by start_at, id`,
      [tenantId],
    );
  }
  return query<BookingRow>(
    client,
    `select ${BOOKING_COLUMNS} from bookings where tenant_id = $1 and start_at >= $2 order by start_at, id`,
    [tenantId, fromDateInstant],
  );
}

export async function bookingsStartingOn(
  client: Db,
  from: Date,
  to: Date,
): Promise<BookingRow[]> {
  return query<BookingRow>(
    client,
    `select ${BOOKING_COLUMNS} from bookings where start_at >= $1 and start_at < $2 order by start_at, id`,
    [from, to],
  );
}
