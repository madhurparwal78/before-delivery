import { isMonth } from '../../shared/calendar.js';
import { db, lock, transact, type Queryable } from '../db/pool.js';
import { localMonthOf } from '../domain/time.js';
import type { BillingItem, Member, Station } from '../domain/types.js';
import { requireRole, type RequestContext } from '../http/context.js';
import { errors, fieldCopy } from '../http/errors.js';
import { json, storedJson, type Result } from '../http/respond.js';
import { queueMail, statementMessage } from '../api/emails.js';
import { hourBank } from '../api/shapes.js';
import { usageCsv, type AdjustmentRow } from '../api/usageCsv.js';
import { exactBody } from '../api/validate.js';
import { loadBooking, monthBookingsAll } from '../store/bookings.js';
import { loadMembers } from '../store/kitchens.js';
import { itemsFor, itemsForKitchenMonth, monthHasPendingItems, usedQuarters } from '../store/ledger.js';
import { closeMonth, frozenMonth, isMonthClosed } from '../store/months.js';
import { BillingUnavailable } from '../services/killbill.js';
import { commitMonthInvoice, flushMailNow, killBillAmountFor } from '../services/outbox.js';
import { loadStations } from '../store/stations.js';

const countedStatuses = new Set(['confirmed', 'checked_in', 'completed', 'no_show']);

type Utilisation = {
  month: string;
  stations: Array<{
    stationId: string;
    name: string;
    bookedHours: number;
    peakHours: number;
    shelfDays: number;
    revenueCents: number;
  }>;
  totals: {
    bookedHours: number;
    peakHours: number;
    shelfDays: number;
    revenueCents: number;
    adjustmentCents: number;
  };
};

function adjustmentItems(items: BillingItem[]): BillingItem[] {
  return items.filter((item) => item.itemKind === 'Adjustment');
}

async function utilisationFor(
  client: Queryable,
  kitchenId: string,
  month: string,
): Promise<Utilisation> {
  const stations = await loadStations(client, kitchenId);
  const bookings = await monthBookingsAll(client, kitchenId, month);
  const items = await itemsForKitchenMonth(client, kitchenId, month);
  const rows = stations.map((station) => {
    const own = bookings.filter((booking) => booking.stationId === station.id);
    const counted = own.filter((booking) => countedStatuses.has(booking.status));
    const fees = own
      .filter((booking) => booking.status === 'cancelled_late' && !booking.penaltyWaived)
      .reduce((sum, booking) => sum + booking.penaltyCents, 0);
    return {
      stationId: station.id,
      name: station.name,
      bookedHours: counted.reduce((sum, booking) => sum + booking.quarterHours, 0) / 4,
      peakHours: counted.reduce((sum, booking) => sum + booking.peakQuarters, 0) / 4,
      shelfDays: counted.reduce((sum, booking) => sum + (booking.days ?? 0), 0),
      revenueCents: counted.reduce((sum, booking) => sum + booking.chargeCents, 0) + fees,
    };
  });
  return {
    month,
    stations: rows,
    totals: {
      bookedHours: rows.reduce((sum, row) => sum + row.bookedHours, 0),
      peakHours: rows.reduce((sum, row) => sum + row.peakHours, 0),
      shelfDays: rows.reduce((sum, row) => sum + row.shelfDays, 0),
      revenueCents: rows.reduce((sum, row) => sum + row.revenueCents, 0),
      adjustmentCents: adjustmentItems(items).reduce((sum, item) => sum + item.amountCents, 0),
    },
  };
}

/** GET /api/reports/utilisation */
export async function readUtilisation(context: RequestContext): Promise<Result> {
  const signedContext = requireRole(context, ['operator']);
  const kitchen = signedContext.kitchen;
  const requested = signedContext.query.get('month');
  if (requested !== null && !isMonth(requested)) {
    throw errors.validationFailed({ month: fieldCopy.month });
  }
  const month = requested ?? localMonthOf(kitchen.timeZone, signedContext.nowMs);
  const frozen = await frozenMonth(db(), kitchen.id, month);
  if (frozen) return storedJson(200, frozen.report);
  return json(200, await utilisationFor(db(), kitchen.id, month));
}

async function csvFor(
  client: Queryable,
  kitchenId: string,
  month: string,
  names: Map<string, string>,
): Promise<string> {
  const stations = await loadStations(client, kitchenId);
  const stationMap = new Map<string, Station>(stations.map((station) => [station.id, station]));
  const bookings = await monthBookingsAll(client, kitchenId, month);
  const items = await itemsForKitchenMonth(client, kitchenId, month);
  const members = await loadMembers(client, kitchenId);

  const balanceHours = new Map<string, number>();
  for (const member of members) {
    const used = await usedQuarters(client, member.id, month);
    balanceHours.set(member.id, Math.max(0, member.allowanceQuarters - used) / 4);
  }
  const pendingBookingIds = new Set(
    items.filter((item) => !item.recorded).map((item) => item.bookingId),
  );
  const pendingItemIds = new Set(items.filter((item) => !item.recorded).map((item) => item.id));

  const adjustments: AdjustmentRow[] = [];
  for (const item of adjustmentItems(items)) {
    const booking = await loadBooking(client, kitchenId, item.bookingId);
    adjustments.push({
      item,
      stationName: booking ? stationMap.get(booking.stationId)?.name ?? '' : '',
    });
  }

  return usageCsv({
    bookings,
    adjustments,
    stations: stationMap,
    businessNames: names,
    balanceHours,
    pendingBookingIds,
    pendingItemIds,
  });
}

/** GET /api/exports/usage.csv */
export async function exportUsage(context: RequestContext): Promise<Result> {
  const signedContext = requireRole(context, ['operator']);
  const kitchen = signedContext.kitchen;
  const requested = signedContext.query.get('month');
  if (requested !== null && !isMonth(requested)) {
    throw errors.validationFailed({ month: fieldCopy.month });
  }
  const month = requested ?? localMonthOf(kitchen.timeZone, signedContext.nowMs);
  const frozen = await frozenMonth(db(), kitchen.id, month);
  const members = await loadMembers(db(), kitchen.id);
  const names = frozen
    ? new Map(Object.entries(frozen.closeNames))
    : new Map(members.map((member) => [member.id, member.businessName]));
  const body = frozen ? frozen.csv : await csvFor(db(), kitchen.id, month, names);
  return {
    kind: 'binary',
    status: 200,
    body: Buffer.from(body, 'utf8'),
    contentType: 'text/csv; charset=utf-8',
    headers: {
      'content-disposition':
        `attachment; filename="lineboard-usage-${kitchen.slug}-${month}.csv"`,
    },
  };
}

type InvoiceSnapshot = {
  memberId: string;
  month: string;
  status: 'closed';
  lines: Array<{
    kind: string;
    bookingId: string;
    description: string;
    amountCents: number;
    billingStatus: 'billed' | 'pending_billing';
  }>;
  totalCents: number;
  hourBank: Record<string, unknown>;
};

async function invoiceSnapshot(
  client: Queryable,
  member: Member,
  month: string,
): Promise<InvoiceSnapshot> {
  const items = await itemsFor(client, member.id, month);
  const lines = items.map((item) => ({
    kind: item.lineKind,
    bookingId: item.bookingId,
    description: item.description,
    amountCents: item.amountCents,
    billingStatus: (item.recorded ? 'billed' : 'pending_billing') as 'billed' | 'pending_billing',
  }));
  return {
    memberId: member.id,
    month,
    status: 'closed',
    lines,
    totalCents: lines.reduce((sum, line) => sum + line.amountCents, 0),
    hourBank: hourBank(
      month,
      member.allowanceQuarters,
      await usedQuarters(client, member.id, month),
    ),
  };
}

/** POST /api/months/{month}/close */
export async function closeMonthRoute(
  context: RequestContext,
  month: string,
): Promise<Result> {
  const signedContext = requireRole(context, ['operator']);
  const kitchen = signedContext.kitchen;
  if (!isMonth(month)) throw errors.validationFailed({ month: fieldCopy.month });
  exactBody(signedContext.json, []);

  const outcome = await transact(async (client) => {
    await lock(client, 'monthClose', `${kitchen.id}:${month}`);
    if (await isMonthClosed(client, kitchen.id, month)) throw errors.monthClosed(month);
    if (await monthHasPendingItems(client, kitchen.id, month)) throw errors.billingPending();

    const members = await loadMembers(client, kitchen.id);
    const totals = new Map<string, number>();
    for (const member of members) {
      const items = await itemsFor(client, member.id, month);
      totals.set(
        member.id,
        items.reduce((sum, item) => sum + item.amountCents, 0),
      );
    }

    const mismatched: string[] = [];
    try {
      for (const member of members) {
        const amount = await killBillAmountFor(member.id, month);
        if (amount !== (totals.get(member.id) ?? 0)) mismatched.push(member.id);
      }
    } catch (error) {
      if (error instanceof BillingUnavailable) throw errors.billingUnavailable();
      throw error;
    }
    if (mismatched.length > 0) {
      const sorted = mismatched.slice().sort();
      const first = members.find((member) => member.id === sorted[0])!;
      throw errors.billingMismatch(sorted, first.businessName);
    }

    try {
      for (const member of members) {
        await commitMonthInvoice(member.id, month);
      }
    } catch (error) {
      if (error instanceof BillingUnavailable) throw errors.billingUnavailable();
      throw error;
    }

    const closeNames: Record<string, string> = {};
    for (const member of members) closeNames[member.id] = member.businessName;
    const snapshots: Array<{ memberId: string; body: InvoiceSnapshot }> = [];
    for (const member of members) {
      snapshots.push({ memberId: member.id, body: await invoiceSnapshot(client, member, month) });
    }
    const report = await utilisationFor(client, kitchen.id, month);
    const csv = await csvFor(client, kitchen.id, month, new Map(Object.entries(closeNames)));

    await closeMonth(
      client,
      kitchen.id,
      month,
      signedContext.nowMs,
      report,
      csv,
      closeNames,
      snapshots.map((snapshot) => ({ memberId: snapshot.memberId, body: snapshot.body })),
    );

    const invoices: Array<{ memberId: string; totalCents: number }> = [];
    for (const snapshot of snapshots) {
      if (snapshot.body.lines.length === 0) continue;
      const member = members.find((candidate) => candidate.id === snapshot.memberId)!;
      invoices.push({ memberId: member.id, totalCents: snapshot.body.totalCents });
      await queueMail(
        client,
        statementMessage({
          to: member.email,
          business: closeNames[member.id]!,
          month,
          lines: snapshot.body.lines,
          totalCents: snapshot.body.totalCents,
        }),
      );
    }
    return { invoices };
  });

  void flushMailNow();
  return json(200, { month, invoices: outcome.invoices });
}
