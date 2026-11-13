import type { Queryable } from '../server/db.js';
import type {
  KitComponent,
  KitDetailView,
  KitUnitView,
  KitView,
  PriceQuote,
} from '../shared/types.js';
import { daysBetween } from '../shared/dates.js';
import { billableDaysFor, hireDaySchedule } from '../shared/pricing.js';
import {
  freeForDatesByKit,
  unitAvailability,
  unitLocations,
  type DateRange,
} from './availability.js';
import { readyToGoByKit } from './ledger.js';
import { activeRates, activeRateCardVersion } from './ratecards.js';

interface KitRecord {
  id: string;
  name: string;
  category: string;
  seq: number;
}

export interface UnitClassRecord {
  id: string;
  kitId: string;
  name: string;
  replacementValueCents: number;
  seq: number;
}

export async function listKitRecords(client: Queryable): Promise<KitRecord[]> {
  const result = await client.query<{
    id: string;
    name: string;
    category: string;
    seq: number;
  }>(`SELECT id, name, category, seq FROM kits ORDER BY seq ASC`);
  return result.rows;
}

export async function findKitRecord(
  client: Queryable,
  kitId: string,
): Promise<KitRecord | null> {
  const result = await client.query<{
    id: string;
    name: string;
    category: string;
    seq: number;
  }>(`SELECT id, name, category, seq FROM kits WHERE id = $1`, [kitId]);
  return result.rows[0] ?? null;
}

async function listUnitClasses(client: Queryable): Promise<UnitClassRecord[]> {
  const result = await client.query<{
    id: string;
    kit_id: string;
    name: string;
    replacement_value_cents: number;
    seq: number;
  }>(
    `SELECT id, kit_id, name, replacement_value_cents, seq
       FROM unit_classes ORDER BY kit_id ASC, seq ASC`,
  );
  return result.rows.map((row) => ({
    id: row.id,
    kitId: row.kit_id,
    name: row.name,
    replacementValueCents: row.replacement_value_cents,
    seq: row.seq,
  }));
}

export async function classesForKit(
  client: Queryable,
  kitId: string,
): Promise<UnitClassRecord[]> {
  const classes = await listUnitClasses(client);
  return classes.filter((unitClass) => unitClass.kitId === kitId);
}

/** A kit's replacement value is the sum of one unit per component class. */
export function kitReplacementValueCents(classes: UnitClassRecord[]): number {
  return classes.reduce((total, unitClass) => total + unitClass.replacementValueCents, 0);
}

function componentsOf(classes: UnitClassRecord[]): KitComponent[] {
  return classes.map((unitClass) => ({
    classId: unitClass.id,
    name: unitClass.name,
    replacementValueCents: unitClass.replacementValueCents,
  }));
}

export async function kitViews(
  client: Queryable,
  range: DateRange | null,
): Promise<KitView[]> {
  const kits = await listKitRecords(client);
  const classes = await listUnitClasses(client);
  const readyToGo = await readyToGoByKit(client);
  const version = await activeRateCardVersion(client);
  const rates = await activeRates(client);
  const freeForDates = range === null ? null : await freeForDatesByKit(client, range);
  const hireDays = range === null ? 0 : daysBetween(range.pickupDate, range.returnDate);
  const billableDays =
    range === null ? 0 : billableDaysFor(range.pickupDate, hireDays);

  return kits.map((kit) => {
    const kitClasses = classes.filter((unitClass) => unitClass.kitId === kit.id);
    const rate = rates.get(kit.id);
    if (rate === undefined) throw new Error(`Rate card v${version} has no rate for ${kit.id}`);
    return {
      id: kit.id,
      name: kit.name,
      category: kit.category,
      replacementValueCents: kitReplacementValueCents(kitClasses),
      dayRateCents: rate.dayRateCents,
      depositCents: rate.depositCents,
      rateCardVersion: version,
      readyToGo: readyToGo.get(kit.id) ?? 0,
      freeForDates: freeForDates === null ? null : (freeForDates.get(kit.id) ?? 0),
      price:
        range === null
          ? null
          : { billableDays, hirePriceCents: billableDays * rate.dayRateCents },
      components: componentsOf(kitClasses),
    };
  });
}

export async function kitDetailView(
  client: Queryable,
  kit: KitRecord,
  range: DateRange | null,
): Promise<KitDetailView> {
  const views = await kitViews(client, range);
  const view = views.find((candidate) => candidate.id === kit.id);
  if (view === undefined) throw new Error(`Kit ${kit.id} is missing from the catalogue`);
  const kitClasses = await classesForKit(client, kit.id);
  const classIds = new Set(kitClasses.map((unitClass) => unitClass.id));
  const units: KitUnitView[] =
    range === null
      ? (await unitLocations(client)).map((place) => ({ ...place, status: null }))
      : await unitAvailability(client, range, null);
  return { ...view, units: units.filter((unit) => classIds.has(unit.classId)) };
}

export async function priceQuote(
  client: Queryable,
  kitId: string,
  pickupDate: string,
  returnDate: string,
): Promise<PriceQuote> {
  const version = await activeRateCardVersion(client);
  const rates = await ratesFor(client, version, kitId);
  const hireDays = daysBetween(pickupDate, returnDate);
  const billableDays = billableDaysFor(pickupDate, hireDays);
  const hirePriceCents = billableDays * rates.dayRateCents;
  return {
    kitId,
    pickupDate,
    returnDate,
    hireDays,
    billableDays,
    dayRateCents: rates.dayRateCents,
    hirePriceCents,
    depositCents: rates.depositCents,
    totalCents: hirePriceCents + rates.depositCents,
    rateCardVersion: version,
    days: hireDaySchedule(pickupDate, hireDays),
  };
}

async function ratesFor(
  client: Queryable,
  version: number,
  kitId: string,
): Promise<{ dayRateCents: number; depositCents: number }> {
  const rates = await activeRates(client);
  const rate = rates.get(kitId);
  if (rate === undefined) throw new Error(`Rate card v${version} has no rate for ${kitId}`);
  return rate;
}
