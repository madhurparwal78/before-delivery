/** Every published response object, shaped for its caller's role. */
import { expiryStatus, isCurrent } from '../domain/documents.js';
import { statusAt, versionAt } from '../domain/rates.js';
import { formatInstant, localDateOf, localMonthOf } from '../domain/time.js';
import { offeredActions, type Actor } from '../domain/transitions.js';
import type {
  BookingRow,
  DocumentRow,
  InspectorLink,
  Kitchen,
  Member,
  OutOfServiceWindow,
  RateVersion,
  Role,
  SanitationEntry,
  Station,
} from '../domain/types.js';

export function kitchenObject(kitchen: Kitchen, nowMs: number): Record<string, unknown> {
  return {
    id: kitchen.id,
    name: kitchen.name,
    slug: kitchen.slug,
    timeZone: kitchen.timeZone,
    today: localDateOf(kitchen.timeZone, nowMs),
    currentMonth: localMonthOf(kitchen.timeZone, nowMs),
    peakWindows: kitchen.peakWindows,
    requiredDocuments: kitchen.requiredDocuments,
    rulesVersion: kitchen.rulesVersion,
  };
}

export function memberRecord(member: Member, role: Role): Record<string, unknown> {
  const base = { id: member.id, name: member.name, businessName: member.businessName };
  return role === 'shift_lead' ? base : { ...base, email: member.email };
}

export function hourBank(
  month: string,
  allowanceQuarters: number,
  used: number,
): Record<string, unknown> {
  return {
    month,
    allowanceHours: allowanceQuarters / 4,
    usedHours: used / 4,
    balanceHours: Math.max(0, allowanceQuarters - used) / 4,
  };
}

export type BillingState = 'not_billed' | 'billed' | 'pending_billing';

export type BookingContext = {
  kitchen: Kitchen;
  stationNames: Map<string, string>;
  businessNames: Map<string, string>;
  pendingBookingIds: Set<string>;
  closedMonths: Set<string>;
  actor: Actor;
  nowMs: number;
};

function billingStatus(booking: BookingRow, context: BookingContext): BillingState {
  if (booking.confirmedAtMs === null) return 'not_billed';
  return context.pendingBookingIds.has(booking.id) ? 'pending_billing' : 'billed';
}

export function bookingObject(
  booking: BookingRow,
  context: BookingContext,
): Record<string, unknown> {
  const zone = context.kitchen.timeZone;
  return {
    id: booking.id,
    memberId: booking.memberId,
    businessName: context.businessNames.get(booking.memberId) ?? '',
    stationId: booking.stationId,
    stationName: context.stationNames.get(booking.stationId) ?? '',
    kind: booking.kind,
    localDate: booking.localDate,
    localStart: booking.localStart,
    localEnd: booking.localEnd,
    days: booking.days,
    start: formatInstant(zone, booking.startMs),
    end: formatInstant(zone, booking.endMs),
    status: booking.status,
    billingStatus: billingStatus(booking, context),
    hours: booking.quarterHours / 4,
    peakHours: booking.peakQuarters / 4,
    chargeCents: booking.chargeCents,
    penaltyCents: booking.penaltyCents,
    penaltyWaived: booking.penaltyWaived,
    conflict: booking.conflict,
    seriesId: booking.seriesId,
    notes: booking.notes,
    holdExpiresAt:
      booking.holdExpiresAtMs === null ? null : formatInstant(zone, booking.holdExpiresAtMs),
    confirmedAt:
      booking.confirmedAtMs === null ? null : formatInstant(zone, booking.confirmedAtMs),
    actions: offeredActions(
      booking,
      context.actor,
      context.nowMs,
      context.closedMonths.has(booking.month),
    ),
    version: booking.version,
  };
}

/** Another member's block on a shared board. */
export function bookedShape(booking: BookingRow, zone: string): Record<string, unknown> {
  return {
    id: booking.id,
    stationId: booking.stationId,
    localDate: booking.localDate,
    localStart: booking.localStart,
    localEnd: booking.localEnd,
    days: booking.days,
    start: formatInstant(zone, booking.startMs),
    end: formatInstant(zone, booking.endMs),
    status: 'booked',
  };
}

export function rateObject(
  station: Station,
  version: RateVersion,
  zone: string,
  nowMs: number,
): Record<string, unknown> {
  const base = {
    effectiveFrom: version.effectiveFrom,
    effectiveAt: formatInstant(zone, version.effectiveAtMs),
    status: statusAt(station.rates, version, nowMs),
  };
  return station.kind === 'shelf'
    ? { ...base, shelfDayCents: version.shelfDayCents }
    : {
        ...base,
        offPeakHourlyCents: version.offPeakHourlyCents,
        peakHourlyCents: version.peakHourlyCents,
      };
}

export function stationObject(
  station: Station,
  zone: string,
  nowMs: number,
): Record<string, unknown> {
  return {
    id: station.id,
    name: station.name,
    kind: station.kind,
    capacity: station.capacity,
    currentRate: rateObject(station, versionAt(station.rates, nowMs), zone, nowMs),
    rates: station.rates
      .slice()
      .sort((a, b) => a.effectiveAtMs - b.effectiveAtMs)
      .map((version) => rateObject(station, version, zone, nowMs)),
  };
}

export function windowObject(window: OutOfServiceWindow, zone: string): Record<string, unknown> {
  return {
    id: window.id,
    stationId: window.stationId,
    start: formatInstant(zone, window.startMs),
    end: formatInstant(zone, window.endMs),
    localDate: window.localDate,
    localStart: window.localStart,
    localEnd: window.localEnd,
    reason: window.reason,
  };
}

export function documentObject(
  document: DocumentRow,
  siblings: DocumentRow[],
  businessName: string,
  zone: string,
  nowMs: number,
): Record<string, unknown> {
  return {
    id: document.id,
    memberId: document.memberId,
    businessName,
    type: document.type,
    expiryDate: document.expiryDate,
    status: expiryStatus(document, localDateOf(zone, nowMs)),
    current: isCurrent(siblings, document),
    fileName: document.fileName,
    contentType: document.contentType,
    sizeBytes: document.sizeBytes,
    uploadedAt: formatInstant(zone, document.uploadedAtMs),
    approvedAt: document.approvedAtMs === null ? null : formatInstant(zone, document.approvedAtMs),
    version: document.version,
  };
}

export function sanitationEntryObject(
  entry: SanitationEntry,
  zone: string,
): Record<string, unknown> {
  return {
    id: entry.id,
    area: entry.area,
    task: entry.task,
    sanitizerPpm: entry.sanitizerPpm,
    initials: entry.initials,
    notes: entry.notes,
    loggedAt: formatInstant(zone, entry.loggedAtMs),
    localDate: localDateOf(zone, entry.loggedAtMs),
    localTime: formatInstant(zone, entry.loggedAtMs).slice(11, 16),
    loggedBy: entry.loggedBy,
  };
}

export type LinkStatus = 'active' | 'expired' | 'revoked';

export function linkStatus(link: InspectorLink, nowMs: number): LinkStatus {
  if (link.revokedAtMs !== null) return 'revoked';
  return nowMs >= link.expiresAtMs ? 'expired' : 'active';
}

export function inspectorLinkObject(
  link: InspectorLink,
  zone: string,
  nowMs: number,
  url?: string,
): Record<string, unknown> {
  const last = link.records[0];
  const base: Record<string, unknown> = {
    id: link.id,
    email: link.email,
    expiresAt: formatInstant(zone, link.expiresAtMs),
    status: linkStatus(link, nowMs),
    lastAccessAt: last ? formatInstant(zone, last.atMs) : null,
    views: link.records.filter((record) => record.action === 'view').length,
    downloads: link.records.filter((record) => record.action !== 'view').length,
    access: link.records.slice(0, 50).map((record) => ({
      at: formatInstant(zone, record.atMs),
      action: record.action,
      target: record.target,
    })),
  };
  return url === undefined ? base : { ...base, url };
}
