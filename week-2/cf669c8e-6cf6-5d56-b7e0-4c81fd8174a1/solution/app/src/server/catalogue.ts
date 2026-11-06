/** The catalogue tables, read from PostgreSQL whenever a connection comes up, and the published rule constants. */
import type pg from 'pg';
import { PARTS } from '../shared/parts.js';
import { REG_COUNTRIES, type Catalogue, type RoadClass } from '../shared/types.js';
import { addDays } from './clock.js';
import { SEED_BIKES, SEED_DONORS, SEED_FIXED_LINES, SEED_HOLIDAYS, SEED_HUB_STATIONS, SEED_HUBS, SEED_INSPECTION_FEES, SEED_PACKS, SEED_ROAD_CLASSES } from './seed-data.js';

interface PackStation { id: string; name: string; travelT: number; openWidthT: number; openHeightT: number }
export interface Donor {
  model: string;
  name: string;
  powerKwT: number;
  wheelbaseT: number;
  chassis: { massT: number; xT: number };
  engine: { massT: number; xT: number };
  tank: { massT: number; xT: number };
  bayXT: number;
  /** Station sets by revision. */
  packStations: { A: PackStation[]; B?: PackStation[] };
  /** First admission year from which revision B applies (when there is one). */
  revisionBFrom: number | null;
  hub: { mouthT: number; armT: number; sprocketT: number };
}
interface HubStation { id: string; name: string; travelT: number }
export interface Pack { id: string; widthT: number; heightT: number; wh: number; massT: number; growthT: number; grossCents: number }
export interface Hub { id: string; widthT: number; shaftT: number; kwT: number; massT: number; grossCents: number }
export interface Bike { id: string; name: string; roadClass: RoadClass; rangeKm: number; grossCents: number }
interface DonorRow {
  model: string; name: string; power_kw_t: number; wheelbase_t: number; chassis_mass_t: number; chassis_x_t: number; engine_mass_t: number; engine_x_t: number;
  tank_mass_t: number; tank_x_t: number; bay_x_t: number; revision_b_from: number | null; hub_mouth_t: number; hub_arm_t: number; hub_sprocket_t: number;
}

// Immutable product data once seeded. Every route that reads these waits for the database first (http.ts).
let DONORS: readonly Donor[] = [];
export let HUB_STATIONS: readonly HubStation[] = [];
let PACKS: readonly Pack[] = [];
let HUBS: readonly Hub[] = [];
export let BIKES: readonly Bike[] = [];
export let CONTROLLER: { massT: number; xT: number };
export let FIXED: Record<string, { name: string; grossCents: number }> = {};
export let ROAD_CLASS_NAMES: Record<string, Record<number, string>> = {};
export let INSPECTION_FEES: Record<string, { changesOn: string; beforeCents: number; afterCents: number }> = {};
export let HOLIDAYS: Record<string, readonly string[]> = {};

export const CATALOGUE_SCHEMA = `
CREATE TABLE IF NOT EXISTS donors (
  model text PRIMARY KEY, position int NOT NULL, name text NOT NULL, power_kw_t int NOT NULL, wheelbase_t int NOT NULL,
  chassis_mass_t int NOT NULL, chassis_x_t int NOT NULL, engine_mass_t int NOT NULL, engine_x_t int NOT NULL,
  tank_mass_t int NOT NULL, tank_x_t int NOT NULL, bay_x_t int NOT NULL, revision_b_from int,
  hub_mouth_t int NOT NULL, hub_arm_t int NOT NULL, hub_sprocket_t int NOT NULL
);
CREATE TABLE IF NOT EXISTS pack_stations (
  model text NOT NULL REFERENCES donors(model), revision text NOT NULL, station text NOT NULL, position int NOT NULL, name text NOT NULL,
  travel_t int NOT NULL, open_width_t int NOT NULL, open_height_t int NOT NULL, PRIMARY KEY (model, revision, station)
);
CREATE TABLE IF NOT EXISTS hub_stations (station text PRIMARY KEY, position int NOT NULL, name text NOT NULL, travel_t int NOT NULL);
CREATE TABLE IF NOT EXISTS packs (
  id text PRIMARY KEY, width_t int NOT NULL, height_t int NOT NULL, wh int NOT NULL, mass_t int NOT NULL, growth_t int NOT NULL, gross_cents int NOT NULL
);
CREATE TABLE IF NOT EXISTS hubs (
  id text PRIMARY KEY, width_t int NOT NULL, shaft_t int NOT NULL, kw_t int NOT NULL, mass_t int NOT NULL, gross_cents int NOT NULL
);
CREATE TABLE IF NOT EXISTS fixed_lines (code text PRIMARY KEY, position int NOT NULL, name text NOT NULL, gross_cents int NOT NULL, mass_t int, x_t int);
CREATE TABLE IF NOT EXISTS road_classes (country text NOT NULL, road_class int NOT NULL, name text NOT NULL, PRIMARY KEY (country, road_class));
CREATE TABLE IF NOT EXISTS inspection_fees (country text PRIMARY KEY, changes_on date NOT NULL, before_cents int NOT NULL, after_cents int NOT NULL);
CREATE TABLE IF NOT EXISTS withdrawal_holidays (country text NOT NULL, day date NOT NULL, PRIMARY KEY (country, day));
CREATE TABLE IF NOT EXISTS bikes (id text PRIMARY KEY, position int NOT NULL, name text NOT NULL, road_class int NOT NULL, range_km int NOT NULL, gross_cents int NOT NULL);
`;

/** Writes the seed rows into the catalogue tables; rows already there stay as they are. */
export async function seedCatalogue(client: pg.PoolClient): Promise<void> {
  const insert = (table: string, values: unknown[]): Promise<unknown> =>
    client.query(`INSERT INTO ${table} VALUES (${values.map((_, i) => `$${i + 1}`).join(',')}) ON CONFLICT DO NOTHING`, values);
  for (const [position, d] of SEED_DONORS.entries()) {
    await insert('donors', [d.model, position, d.name, d.powerKwT, d.wheelbaseT, d.chassis.massT, d.chassis.xT, d.engine.massT, d.engine.xT,
      d.tank.massT, d.tank.xT, d.bayXT, d.revisionBFrom, d.hub.mouthT, d.hub.armT, d.hub.sprocketT]);
    for (const [revision, stations] of Object.entries(d.packStations)) {
      for (const [order, s] of stations.entries()) await insert('pack_stations', [d.model, revision, s.id, order, s.name, s.travelT, s.openWidthT, s.openHeightT]);
    }
  }
  for (const [position, s] of SEED_HUB_STATIONS.entries()) await insert('hub_stations', [s.id, position, s.name, s.travelT]);
  for (const p of SEED_PACKS) await insert('packs', [p.id, p.widthT, p.heightT, p.wh, p.massT, p.growthT, p.grossCents]);
  for (const h of SEED_HUBS) await insert('hubs', [h.id, h.widthT, h.shaftT, h.kwT, h.massT, h.grossCents]);
  for (const [position, f] of SEED_FIXED_LINES.entries()) await insert('fixed_lines', [f.code, position, f.name, f.grossCents, f.massT, f.xT]);
  for (const r of SEED_ROAD_CLASSES) await insert('road_classes', [r.country, r.roadClass, r.name]);
  for (const f of SEED_INSPECTION_FEES) await insert('inspection_fees', [f.country, f.changesOn, f.beforeCents, f.afterCents]);
  for (const [country, days] of Object.entries(SEED_HOLIDAYS)) {
    for (const day of days) await insert('withdrawal_holidays', [country, day]);
  }
  for (const [position, b] of SEED_BIKES.entries()) await insert('bikes', [b.id, position, b.name, b.roadClass, b.rangeKm, b.grossCents]);
}

/** Reads every catalogue table. Runs after migration, so a reconnect picks up the database's rows. */
export async function loadCatalogue(client: pg.PoolClient): Promise<void> {
  const rows = async <T extends pg.QueryResultRow>(text: string): Promise<T[]> => (await client.query<T>(text)).rows;
  const stations = await rows<PackStation & { model: string; revision: 'A' | 'B' }>(
    'SELECT model, revision, station AS id, name, travel_t AS "travelT", open_width_t AS "openWidthT", open_height_t AS "openHeightT" FROM pack_stations ORDER BY model, revision, position',
  );
  const stationsOf = (model: string, revision: 'A' | 'B'): PackStation[] => stations
    .filter((s) => s.model === model && s.revision === revision)
    .map(({ id, name, travelT, openWidthT, openHeightT }) => ({ id, name, travelT, openWidthT, openHeightT }));
  const donors = await rows<DonorRow>('SELECT * FROM donors ORDER BY position');
  DONORS = donors.map((d) => {
    const revisionB = stationsOf(d.model, 'B');
    return {
      model: d.model, name: d.name, powerKwT: d.power_kw_t, wheelbaseT: d.wheelbase_t,
      chassis: { massT: d.chassis_mass_t, xT: d.chassis_x_t }, engine: { massT: d.engine_mass_t, xT: d.engine_x_t }, tank: { massT: d.tank_mass_t, xT: d.tank_x_t },
      bayXT: d.bay_x_t, packStations: revisionB.length ? { A: stationsOf(d.model, 'A'), B: revisionB } : { A: stationsOf(d.model, 'A') },
      revisionBFrom: d.revision_b_from, hub: { mouthT: d.hub_mouth_t, armT: d.hub_arm_t, sprocketT: d.hub_sprocket_t },
    };
  });
  HUB_STATIONS = await rows<HubStation & pg.QueryResultRow>('SELECT station AS id, name, travel_t AS "travelT" FROM hub_stations ORDER BY position');
  PACKS = await rows<Pack & pg.QueryResultRow>('SELECT id, width_t AS "widthT", height_t AS "heightT", wh, mass_t AS "massT", growth_t AS "growthT", gross_cents AS "grossCents" FROM packs ORDER BY id');
  HUBS = await rows<Hub & pg.QueryResultRow>('SELECT id, width_t AS "widthT", shaft_t AS "shaftT", kw_t AS "kwT", mass_t AS "massT", gross_cents AS "grossCents" FROM hubs ORDER BY id');
  BIKES = await rows<Bike & pg.QueryResultRow>('SELECT id, name, road_class AS "roadClass", range_km AS "rangeKm", gross_cents AS "grossCents" FROM bikes ORDER BY position');
  const fixed = await rows<{ code: string; name: string; grossCents: number; massT: number; xT: number }>('SELECT code, name, gross_cents AS "grossCents", mass_t AS "massT", x_t AS "xT" FROM fixed_lines ORDER BY position');
  FIXED = Object.fromEntries(fixed.map((f) => [f.code, { name: f.name, grossCents: f.grossCents }]));
  CONTROLLER = fixed.filter((f) => f.code === 'CTRL')[0];
  const names: Record<string, Record<number, string>> = {};
  for (const r of await rows<{ country: string; road_class: number; name: string }>('SELECT * FROM road_classes')) (names[r.country] ??= {})[r.road_class] = r.name;
  ROAD_CLASS_NAMES = names;
  const fees = await rows<{ country: string; changesOn: string; beforeCents: number; afterCents: number }>('SELECT country, changes_on AS "changesOn", before_cents AS "beforeCents", after_cents AS "afterCents" FROM inspection_fees');
  INSPECTION_FEES = Object.fromEntries(fees.map(({ country, ...fee }) => [country, fee]));
  const holidays: Record<string, string[]> = {};
  for (const h of await rows<{ country: string; day: string }>('SELECT * FROM withdrawal_holidays ORDER BY day')) (holidays[h.country] ??= []).push(h.day);
  HOLIDAYS = holidays;
}

export const MIN_GAP_T = 30;
export const AXLE_LIMIT_POINTS = 10;
export const CLASS_POWER_LIMIT_KW_T: Record<RoadClass, number> = { 25: 10, 45: 40 };
export const CONSUMPTION_WH_PER_KM: Record<RoadClass, number> = { 25: 22, 45: 31 };

/** VAT rate percent by delivery country. */
export const VAT_RATE: Record<string, number> = { NL: 21, BE: 21, DE: 19, LU: 17 };
export const WORKSHOP_RATE = 21;

export function donorOf(model: string): Donor | undefined {
  return DONORS.find((d) => d.model === model);
}
export function packOf(id: string): Pack | undefined {
  return PACKS.find((p) => p.id === id);
}
export function hubOf(id: string): Hub | undefined {
  return HUBS.find((h) => h.id === id);
}
/** The pack and hub an accepted order names: order creation has already found them in these tables. */
export const orderedPack = (id: string): Pack => PACKS.filter((p) => p.id === id)[0];
export const orderedHub = (id: string): Hub => HUBS.filter((h) => h.id === id)[0];

export function tenthsText(tenths: number): string {
  const sign = tenths < 0 ? '-' : '';
  const abs = Math.abs(tenths);
  return `${sign}${Math.floor(abs / 10)}.${abs % 10}`;
}

/** Parse a decimal text with at most one decimal into tenths; null when it is not one. */
export function parseTenths(value: unknown): number | null {
  const text = typeof value === 'number' ? String(value) : value;
  if (typeof text !== 'string' || !/^-?\d+(\.\d)?$/.test(text.trim())) return null;
  const [whole, frac = ''] = text.trim().split('.');
  const negative = whole.startsWith('-');
  const tenths = Math.abs(Number(whole)) * 10 + Number(frac.padEnd(1, '0'));
  return negative ? -tenths : tenths;
}

const stationMm = (s: PackStation) => ({ id: s.id, name: s.name, travelMm: tenthsText(s.travelT), openWidthMm: tenthsText(s.openWidthT), openHeightMm: tenthsText(s.openHeightT) });

export function catalogue(): Catalogue {
  return {
    donors: DONORS.map((d) => ({
      model: d.model, name: d.name, powerKw: tenthsText(d.powerKwT), wheelbaseMm: tenthsText(d.wheelbaseT), bayXMm: tenthsText(d.bayXT),
      revisions: d.revisionBFrom === null || !d.packStations.B
        ? [{ revision: 'A' as const, fromYear: null, toYear: null, stations: d.packStations.A.map(stationMm) }]
        : [{ revision: 'A' as const, fromYear: null, toYear: d.revisionBFrom - 1, stations: d.packStations.A.map(stationMm) }, { revision: 'B' as const, fromYear: d.revisionBFrom, toYear: null, stations: d.packStations.B.map(stationMm) }],
      hubRail: { mouthWidthMm: tenthsText(d.hub.mouthT), armWidthMm: tenthsText(d.hub.armT), sprocketLineMm: tenthsText(d.hub.sprocketT) },
    })),
    packs: PACKS.map((p) => ({ id: p.id, widthMm: tenthsText(p.widthT), heightMm: tenthsText(p.heightT), wh: p.wh, massKg: tenthsText(p.massT), growth: p.growthT ? `length ${tenthsText(p.growthT)}` : 'none', grossCents: p.grossCents })),
    hubs: HUBS.map((h) => ({ id: h.id, widthMm: tenthsText(h.widthT), shaftMm: tenthsText(h.shaftT), kw: tenthsText(h.kwT), massKg: tenthsText(h.massT), grossCents: h.grossCents })),
    parts: [...PARTS],
    roadClasses: REG_COUNTRIES.flatMap((country) => ([25, 45] as const).map((roadClass) => ({ country, roadClass, name: ROAD_CLASS_NAMES[country][roadClass] }))),
    fixedLines: Object.entries(FIXED).map(([code, v]) => ({ code, name: v.name, grossCents: v.grossCents })),
    inspectionFees: REG_COUNTRIES.map((country) => ({
      code: `INSPECT-${country}`, upToAndIncluding: addDays(INSPECTION_FEES[country].changesOn, -1), fromDate: INSPECTION_FEES[country].changesOn,
      before: INSPECTION_FEES[country].beforeCents, after: INSPECTION_FEES[country].afterCents,
    })),
  };
}
