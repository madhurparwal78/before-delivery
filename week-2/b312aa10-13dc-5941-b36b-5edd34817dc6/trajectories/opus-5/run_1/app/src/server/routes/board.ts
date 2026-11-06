import { addDays, isDate, minutesOfDay, monthOfDate, weekdayOrder } from '../../shared/calendar.js';
import { db, lock, transact } from '../db/pool.js';
import {
  dayStartInstant,
  formatInstant,
  localDateOf,
  localTimeOf,
  localToInstant,
  parseEffectiveFrom,
  wallDate,
  wallTime,
  wallToInstant,
} from '../domain/time.js';
import type { PeakWindow } from '../domain/types.js';
import { requireRole, type RequestContext, type SignedContext } from '../http/context.js';
import { errors, fieldCopy } from '../http/errors.js';
import { json, type Result } from '../http/respond.js';
import { applyDueLapse, bookingContext } from '../api/bookingView.js';
import {
  bookedShape,
  bookingObject,
  hourBank,
  kitchenObject,
  stationObject,
  windowObject,
} from '../api/shapes.js';
import { asInteger, asString, exactBody, FieldErrors } from '../api/validate.js';
import {
  boardBookings,
  deleteWindow,
  insertWindow,
  loadWindow,
  setConflict,
  setStatus,
  stationBookingsInStatuses,
  stationWindows,
  windowsOverlappingDate,
} from '../store/bookings.js';
import { loadKitchen, loadMember, saveKitchenRules } from '../store/kitchens.js';
import { usedQuarters } from '../store/ledger.js';
import { closedMonths } from '../store/months.js';
import { insertRateVersion, loadStation, loadStations } from '../store/stations.js';

/** GET /api/board */
export async function readBoard(context: RequestContext): Promise<Result> {
  const signedContext = context as SignedContext;
  const kitchen = signedContext.kitchen;
  const nowMs = signedContext.nowMs;
  const requested = signedContext.query.get('date');
  if (requested !== null && !isDate(requested)) {
    throw errors.validationFailed({ date: fieldCopy.date });
  }
  const today = localDateOf(kitchen.timeZone, nowMs);
  const date = requested ?? today;
  const dayStart = dayStartInstant(kitchen.timeZone, date);
  const dayEnd = dayStartInstant(kitchen.timeZone, addDays(date, 1));

  const stations = await loadStations(db(), kitchen.id);
  const closed = new Set(await closedMonths(db(), kitchen.id));
  const raw = await boardBookings(db(), kitchen.id, date);
  const settled = await transact(async (client) => {
    const rows = [];
    for (const booking of raw) {
      rows.push(await applyDueLapse(client, booking, nowMs, closed.has(booking.month)));
    }
    return rows;
  });

  const actor = { role: signedContext.person.role, memberId: signedContext.person.memberId };
  const view = await bookingContext(db(), kitchen, actor, nowMs);
  const isMember = signedContext.person.role === 'member';
  const blocks = settled
    .filter((booking) => {
      if (booking.status === 'expired') {
        return isMember && booking.memberId === signedContext.person.memberId;
      }
      return true;
    })
    .map((booking) =>
      !isMember || booking.memberId === signedContext.person.memberId
        ? bookingObject(booking, view)
        : bookedShape(booking, kitchen.timeZone),
    );

  let bank: Record<string, unknown> | null = null;
  if (isMember) {
    const member = (await loadMember(db(), kitchen.id, signedContext.person.memberId!))!;
    const month = monthOfDate(date);
    bank = hourBank(
      month,
      member.allowanceQuarters,
      await usedQuarters(db(), member.id, month),
    );
  }

  const windows = await windowsOverlappingDate(db(), kitchen.id, dayStart, dayEnd);
  return json(200, {
    date,
    today,
    now: formatInstant(kitchen.timeZone, nowMs),
    timeZone: kitchen.timeZone,
    stations: stations.map((station) => ({
      id: station.id,
      name: station.name,
      kind: station.kind,
      capacity: station.capacity,
    })),
    peakWindows: kitchen.peakWindows,
    blocks,
    outOfService: windows.map((window) => windowObject(window, kitchen.timeZone)),
    hourBank: bank,
  });
}

/** GET /api/stations */
export async function readStations(context: RequestContext): Promise<Result> {
  const signedContext = context as SignedContext;
  const stations = await loadStations(db(), signedContext.kitchen.id);
  return json(200, {
    stations: stations.map((station) =>
      stationObject(station, signedContext.kitchen.timeZone, signedContext.nowMs),
    ),
  });
}

function validateRate(fieldErrors: FieldErrors, key: string, value: unknown): number {
  const cents = asInteger(value);
  if (cents === null || cents < 1 || cents > 100_000) {
    fieldErrors.add(key, fieldCopy.rateRange);
    return 0;
  }
  return cents;
}

/** POST /api/stations/{stationId}/rates */
export async function createRateVersion(
  context: RequestContext,
  stationId: string,
): Promise<Result> {
  const signedContext = context as SignedContext;
  const kitchen = signedContext.kitchen;
  const station = await loadStation(db(), kitchen.id, stationId);
  if (!station) throw errors.notFound();
  requireRole(signedContext, ['operator']);

  const shelf = station.kind === 'shelf';
  const body = exactBody(
    signedContext.json,
    shelf
      ? ['shelfDayCents', 'effectiveFrom']
      : ['offPeakHourlyCents', 'peakHourlyCents', 'effectiveFrom'],
  );
  const fieldErrors = new FieldErrors();
  const offPeak = shelf ? null : validateRate(fieldErrors, 'offPeakHourlyCents', body['offPeakHourlyCents']);
  const peak = shelf ? null : validateRate(fieldErrors, 'peakHourlyCents', body['peakHourlyCents']);
  const shelfDay = shelf ? validateRate(fieldErrors, 'shelfDayCents', body['shelfDayCents']) : null;

  const wall = parseEffectiveFrom(body['effectiveFrom']);
  if (wall === null) {
    fieldErrors.add('effectiveFrom', fieldCopy.effectiveFromFuture);
    fieldErrors.throwIfAny();
  }
  const resolved = wallToInstant(kitchen.timeZone, wall!);
  if (resolved.kind === 'gap') {
    fieldErrors.add(
      'effectiveFrom',
      fieldCopy.nonexistentTime(wallTime(wall!), wallDate(wall!), kitchen.timeZone),
    );
  } else if (resolved.instantMs <= signedContext.nowMs) {
    fieldErrors.add('effectiveFrom', fieldCopy.effectiveFromFuture);
  }
  fieldErrors.throwIfAny();
  const effectiveAtMs = (resolved as { instantMs: number }).instantMs;

  const inserted = await insertRateVersion(db(), station.id, {
    effectiveFrom: `${wallDate(wall!)}T${wallTime(wall!)}`,
    effectiveAtMs,
    offPeakHourlyCents: offPeak,
    peakHourlyCents: peak,
    shelfDayCents: shelfDay,
  });
  if (!inserted) {
    throw errors.rateVersionExists(
      station.name,
      localDateOf(kitchen.timeZone, effectiveAtMs),
      localTimeOf(kitchen.timeZone, effectiveAtMs),
    );
  }
  const updated = (await loadStation(db(), kitchen.id, station.id))!;
  return json(201, {
    station: stationObject(updated, kitchen.timeZone, signedContext.nowMs),
  });
}

function validWindow(window: unknown): PeakWindow | null {
  if (typeof window !== 'object' || window === null || Array.isArray(window)) return null;
  const keys = Object.keys(window);
  if (keys.length !== 3 || !keys.includes('days') || !keys.includes('start') || !keys.includes('end')) {
    return null;
  }
  const candidate = window as { days: unknown; start: unknown; end: unknown };
  if (!Array.isArray(candidate.days) || candidate.days.length === 0) return null;
  for (const day of candidate.days) {
    if (typeof day !== 'string' || !weekdayOrder.includes(day as PeakWindow['days'][number])) {
      return null;
    }
  }
  const start = asString(candidate.start);
  const end = asString(candidate.end);
  if (start === null || end === null) return null;
  if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) return null;
  const startMinutes = minutesOfDay(start);
  const endMinutes = minutesOfDay(end);
  if (startMinutes % 15 !== 0 || endMinutes % 15 !== 0) return null;
  if (startMinutes >= 1440 || endMinutes > 1440) return null;
  if (startMinutes >= endMinutes) return null;
  return { days: candidate.days as PeakWindow['days'], start, end };
}

/** PUT /api/kitchen/peak-windows */
export async function savePeakWindows(context: RequestContext): Promise<Result> {
  const signedContext = requireRole(context, ['operator']);
  const body = exactBody(signedContext.json, ['windows', 'rulesVersion']);
  const fieldErrors = new FieldErrors();
  const rulesVersion = asInteger(body['rulesVersion']);
  if (rulesVersion === null) fieldErrors.add('rulesVersion', fieldCopy.version);
  const raw = body['windows'];
  const windows: PeakWindow[] = [];
  if (!Array.isArray(raw) || raw.length > 10) {
    fieldErrors.add('windows', fieldCopy.peakWindows);
  } else {
    for (const entry of raw) {
      const window = validWindow(entry);
      if (!window) {
        fieldErrors.add('windows', fieldCopy.peakWindows);
        break;
      }
      windows.push(window);
    }
  }
  fieldErrors.throwIfAny();

  const kitchen = await transact(async (client) => {
    await lock(client, 'kitchenRules', signedContext.kitchen.id);
    const current = await loadKitchen(client, signedContext.kitchen.id);
    if (current.rulesVersion !== rulesVersion) {
      throw errors.staleVersionRules(kitchenObject(current, signedContext.nowMs));
    }
    await saveKitchenRules(client, current.id, { peakWindows: windows });
    return loadKitchen(client, current.id);
  });
  return json(200, kitchenObject(kitchen, signedContext.nowMs));
}

/** PUT /api/kitchen/document-requirements */
export async function saveDocumentRequirements(context: RequestContext): Promise<Result> {
  const signedContext = requireRole(context, ['operator']);
  const body = exactBody(signedContext.json, ['required', 'rulesVersion']);
  const fieldErrors = new FieldErrors();
  const rulesVersion = asInteger(body['rulesVersion']);
  if (rulesVersion === null) fieldErrors.add('rulesVersion', fieldCopy.version);
  const raw = body['required'];
  const allowed = ['insurance_certificate', 'food_handler_card'];
  if (
    !Array.isArray(raw) ||
    raw.some((entry) => typeof entry !== 'string' || !allowed.includes(entry)) ||
    new Set(raw).size !== raw.length
  ) {
    fieldErrors.add('required', fieldCopy.documentType);
  }
  fieldErrors.throwIfAny();

  const kitchen = await transact(async (client) => {
    await lock(client, 'kitchenRules', signedContext.kitchen.id);
    const current = await loadKitchen(client, signedContext.kitchen.id);
    if (current.rulesVersion !== rulesVersion) {
      throw errors.staleVersionRules(kitchenObject(current, signedContext.nowMs));
    }
    await saveKitchenRules(client, current.id, {
      requiredDocuments: allowed.filter((type) => (raw as string[]).includes(type)) as never,
    });
    return loadKitchen(client, current.id);
  });
  return json(200, kitchenObject(kitchen, signedContext.nowMs));
}

/** POST /api/out-of-service */
export async function createOutOfService(context: RequestContext): Promise<Result> {
  const signedContext = context as SignedContext;
  const kitchen = signedContext.kitchen;
  const body = (signedContext.json ?? {}) as Record<string, unknown>;
  const stationId = asString(body['stationId']);
  const station = stationId ? await loadStation(db(), kitchen.id, stationId) : null;
  if (stationId !== null && station === null) throw errors.notFound();
  requireRole(signedContext, ['shift_lead', 'operator']);

  const parsed = exactBody(signedContext.json, ['stationId', 'date', 'start', 'end', 'reason']);
  const fieldErrors = new FieldErrors();
  const date = asString(parsed['date']);
  if (date === null || !isDate(date)) fieldErrors.add('date', fieldCopy.date);
  const reason = asString(parsed['reason']);
  if (reason === null || [...reason.normalize('NFC')].length < 1 || [...reason.normalize('NFC')].length > 120) {
    fieldErrors.add('reason', fieldCopy.reason);
  }
  const start = asString(parsed['start']) ?? '';
  const end = asString(parsed['end']) ?? '';
  const startValid = /^\d{2}:\d{2}$/.test(start) && minutesOfDay(start) % 15 === 0 && minutesOfDay(start) < 1440;
  const endValid = /^\d{2}:\d{2}$/.test(end) && minutesOfDay(end) % 15 === 0 && minutesOfDay(end) <= 1440;
  if (!startValid) fieldErrors.add('start', fieldCopy.quarterHour);
  if (!endValid) fieldErrors.add('end', fieldCopy.quarterHour);
  fieldErrors.throwIfAny();
  if (minutesOfDay(end) <= minutesOfDay(start)) {
    throw errors.validationFailed({ end: fieldCopy.endAfterStart });
  }

  const startMs = localToInstant(kitchen.timeZone, date!, start);
  const endMs = localToInstant(kitchen.timeZone, date!, end);
  if (startMs === null) {
    throw errors.validationFailed({
      start: fieldCopy.nonexistentTime(start, date!, kitchen.timeZone),
    });
  }
  if (endMs === null) {
    throw errors.validationFailed({
      end: fieldCopy.nonexistentTime(end, date!, kitchen.timeZone),
    });
  }

  const outcome = await transact(async (client) => {
    await lock(client, 'station', station!.id);
    const window = await insertWindow(client, {
      kitchenId: kitchen.id,
      stationId: station!.id,
      startMs,
      endMs,
      localDate: date!,
      localStart: start,
      localEnd: end,
      reason: reason!.normalize('NFC'),
    });
    const held = await stationBookingsInStatuses(client, station!.id, ['held']);
    for (const booking of held) {
      if (booking.startMs < endMs && booking.endMs > startMs) {
        await setStatus(client, booking.id, 'cancelled_free');
      }
    }
    const live = await stationBookingsInStatuses(client, station!.id, ['confirmed', 'checked_in']);
    const conflicts: string[] = [];
    for (const booking of live) {
      if (booking.startMs < endMs && booking.endMs > startMs) {
        await setConflict(client, booking.id, true);
        conflicts.push(booking.id);
      }
    }
    return { window, conflicts };
  });

  return json(201, {
    window: windowObject(outcome.window, kitchen.timeZone),
    conflicts: outcome.conflicts,
  });
}

/** DELETE /api/out-of-service/{id} */
export async function removeOutOfService(
  context: RequestContext,
  windowId: string,
): Promise<Result> {
  const signedContext = context as SignedContext;
  const kitchen = signedContext.kitchen;
  const window = await loadWindow(db(), kitchen.id, windowId);
  if (!window) throw errors.notFound();
  requireRole(signedContext, ['shift_lead', 'operator']);

  const conflicts = await transact(async (client) => {
    await lock(client, 'station', window.stationId);
    await deleteWindow(client, window.id);
    const windows = await stationWindows(client, window.stationId);
    const live = await stationBookingsInStatuses(client, window.stationId, [
      'confirmed',
      'checked_in',
    ]);
    const remaining: string[] = [];
    for (const booking of live) {
      const clashes = windows.some(
        (candidate) => candidate.startMs < booking.endMs && candidate.endMs > booking.startMs,
      );
      await setConflict(client, booking.id, clashes);
      if (clashes) remaining.push(booking.id);
    }
    return remaining;
  });
  return json(200, { conflicts });
}
