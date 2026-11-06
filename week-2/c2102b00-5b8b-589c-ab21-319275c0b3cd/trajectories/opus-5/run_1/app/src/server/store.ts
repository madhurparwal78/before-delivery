import { db } from './db.ts';
import type {
  Bag,
  Credit,
  Cycle,
  CycleStatus,
  CycleSummary,
  Line,
  LineStatus,
  Movement,
  Role,
  UnitKind,
} from '../shared/types.ts';
import { acceptingPledges, effectiveStatus } from './domain/cycleState.ts';
import { cellsFor, effectiveLineStatus, pledgedUnits, unitsToGo, type PledgeRecord } from './domain/lines.ts';
import { creditOf, holdForUnits, householdAccount } from './domain/credit.ts';
import { cutoffDisplay, pickupDisplay } from './domain/clubTime.ts';

export interface ClubRow {
  name: string;
  time_zone: string;
  distributor: string;
  created_at: string;
}

export interface ProductRow {
  id: string;
  case_name: string;
  pack: number;
  unit: UnitKind;
  price_cents: number;
  position: number;
}

export interface HouseholdRow {
  code: string;
  name: string;
  email: string;
  position: number;
}

export interface CycleRow {
  id: string;
  name: string;
  status: CycleStatus;
  revision: number;
  cutoff_at: string | null;
  pickup_start_at: string | null;
  pickup_end_at: string | null;
  created_at: string;
  position: number;
}

export interface LineRow {
  cycle_id: string;
  product_id: string;
  position: number;
  version: number;
  status: LineStatus;
}

export interface Viewer {
  role: Role;
  name: string;
  householdCode: string | null;
}

export function getClub(): ClubRow {
  return db.prepare('SELECT name, time_zone, distributor, created_at FROM club WHERE id = 1').get() as ClubRow;
}

export function timeZone(): string {
  return getClub().time_zone;
}

export function listProducts(): ProductRow[] {
  return db.prepare('SELECT * FROM products ORDER BY position').all() as ProductRow[];
}

export function getProduct(id: string): ProductRow | undefined {
  return db.prepare('SELECT * FROM products WHERE id = ?').get(id) as ProductRow | undefined;
}

export function listHouseholds(): HouseholdRow[] {
  return db.prepare('SELECT * FROM households ORDER BY position').all() as HouseholdRow[];
}

export function getHousehold(code: string): HouseholdRow | undefined {
  return db.prepare('SELECT * FROM households WHERE code = ?').get(code) as HouseholdRow | undefined;
}

export function getCycleRow(id: string): CycleRow | undefined {
  return db.prepare('SELECT * FROM cycles WHERE id = ?').get(id) as CycleRow | undefined;
}

export function listCycleRows(): CycleRow[] {
  return db.prepare('SELECT * FROM cycles ORDER BY position').all() as CycleRow[];
}

export function listLineRows(cycleId: string): LineRow[] {
  return db.prepare('SELECT * FROM cycle_lines WHERE cycle_id = ? ORDER BY position').all(cycleId) as LineRow[];
}

export function getLineRow(cycleId: string, productId: string): LineRow | undefined {
  return db.prepare('SELECT * FROM cycle_lines WHERE cycle_id = ? AND product_id = ?').get(cycleId, productId) as
    | LineRow
    | undefined;
}

export function listPledges(cycleId: string, productId: string): PledgeRecord[] {
  return db
    .prepare('SELECT id, pledger, units FROM pledges WHERE cycle_id = ? AND product_id = ? ORDER BY id')
    .all(cycleId, productId) as PledgeRecord[];
}

export function pledgeOf(cycleId: string, productId: string, pledger: string): PledgeRecord | undefined {
  return db
    .prepare('SELECT id, pledger, units FROM pledges WHERE cycle_id = ? AND product_id = ? AND pledger = ?')
    .get(cycleId, productId, pledger) as PledgeRecord | undefined;
}

export function shortUnitNumbers(cycleId: string, productId: string): Set<number> {
  const rows = db
    .prepare('SELECT unit_number FROM short_units WHERE cycle_id = ? AND product_id = ?')
    .all(cycleId, productId) as { unit_number: number }[];
  return new Set(rows.map((row) => row.unit_number));
}

export function shortUnitCount(cycleId: string, productId: string): number {
  const row = db
    .prepare('SELECT COUNT(*) AS count FROM short_units WHERE cycle_id = ? AND product_id = ?')
    .get(cycleId, productId) as { count: number };
  return row.count;
}

export function balanceCents(householdCode: string): number {
  const row = db
    .prepare('SELECT COALESCE(SUM(amount_cents), 0) AS total FROM legs WHERE account = ?')
    .get(householdAccount(householdCode)) as { total: number };
  return row.total;
}

/** Holds on every cycle that is not closed, excluding dropped cases. */
export function heldCents(householdCode: string): number {
  const rows = db
    .prepare(
      `SELECT p.units AS units, pr.price_cents AS price_cents, pr.pack AS pack
       FROM pledges p
       JOIN cycles c ON c.id = p.cycle_id
       JOIN cycle_lines l ON l.cycle_id = p.cycle_id AND l.product_id = p.product_id
       JOIN products pr ON pr.id = p.product_id
       WHERE p.pledger = ? AND c.status != 'closed' AND l.status != 'dropped'`,
    )
    .all(householdCode) as { units: number; price_cents: number; pack: number }[];
  return rows.reduce((total, row) => total + holdForUnits(row.units, row.price_cents, row.pack), 0);
}

export function creditFor(householdCode: string): Credit {
  return creditOf(balanceCents(householdCode), heldCents(householdCode));
}

function instantMs(iso: string | null): number | null {
  return iso === null ? null : Date.parse(iso);
}

export function buildLine(
  cycle: CycleRow,
  lineRow: LineRow,
  product: ProductRow,
  viewer: Viewer,
): Line {
  const pledges = listPledges(cycle.id, product.id);
  const viewerCode = viewer.role === 'member' ? viewer.householdCode : null;
  const mine = viewerCode === null ? null : pledges.find((pledge) => pledge.pledger === viewerCode);
  return {
    product_id: product.id,
    case_name: product.case_name,
    pack: product.pack,
    unit: product.unit,
    price_cents: product.price_cents,
    version: lineRow.version,
    pledged_units: pledgedUnits(pledges),
    units_to_go: unitsToGo(product.pack, pledges),
    status: effectiveLineStatus(lineRow.status, product.pack, pledges),
    short_units: shortUnitCount(cycle.id, product.id),
    my_units: viewerCode === null ? null : (mine?.units ?? 0),
    cells: cellsFor(product.pack, pledges, viewerCode),
  };
}

export function buildCycle(cycle: CycleRow, viewer: Viewer, nowMs: number): Cycle {
  const zone = timeZone();
  const cutoffMs = instantMs(cycle.cutoff_at);
  const startMs = instantMs(cycle.pickup_start_at);
  const endMs = instantMs(cycle.pickup_end_at);
  const products = new Map(listProducts().map((product) => [product.id, product]));
  const lines = listLineRows(cycle.id).map((lineRow) => {
    const product = products.get(lineRow.product_id)!;
    return buildLine(cycle, lineRow, product, viewer);
  });
  return {
    id: cycle.id,
    name: cycle.name,
    status: effectiveStatus(cycle.status, cutoffMs, nowMs),
    revision: cycle.revision,
    cutoff_at: cycle.cutoff_at,
    cutoff_display: cutoffMs === null ? null : cutoffDisplay(cutoffMs, zone),
    pickup_start_at: cycle.pickup_start_at,
    pickup_end_at: cycle.pickup_end_at,
    pickup_display: startMs === null || endMs === null ? null : pickupDisplay(startMs, endMs, zone),
    accepting_pledges: acceptingPledges(cycle.status, cutoffMs, nowMs),
    credit: viewer.role === 'member' && viewer.householdCode ? creditFor(viewer.householdCode) : null,
    lines,
  };
}

export function cycleSummary(cycle: CycleRow, nowMs: number): CycleSummary {
  const cutoffMs = instantMs(cycle.cutoff_at);
  return {
    id: cycle.id,
    name: cycle.name,
    status: effectiveStatus(cycle.status, cutoffMs, nowMs),
    cutoff_display: cutoffMs === null ? null : cutoffDisplay(cutoffMs, timeZone()),
  };
}

export function bumpLineVersion(cycleId: string, productId: string): void {
  db.prepare('UPDATE cycle_lines SET version = version + 1 WHERE cycle_id = ? AND product_id = ?').run(
    cycleId,
    productId,
  );
}

export function bumpRevision(cycleId: string): void {
  db.prepare('UPDATE cycles SET revision = revision + 1 WHERE id = ?').run(cycleId);
}

/** Records the cutoff switch so stored state follows the clock, without touching the revision. */
export function persistCutoffSwitch(cycle: CycleRow, nowMs: number): CycleRow {
  const cutoffMs = instantMs(cycle.cutoff_at);
  if (effectiveStatus(cycle.status, cutoffMs, nowMs) === 'sealing' && cycle.status === 'open') {
    db.prepare("UPDATE cycles SET status = 'sealing' WHERE id = ? AND status = 'open'").run(cycle.id);
    return { ...cycle, status: 'sealing' };
  }
  return cycle;
}

export function movementsForAccount(account: string, limit: number, before: { createdAt: string; id: number } | null): Movement[] {
  const rows = before
    ? (db
        .prepare(
          `SELECT m.id, m.kind, m.cycle_id, m.memo, m.created_at
           FROM movements m JOIN legs l ON l.movement_id = m.id
           WHERE l.account = ? AND (m.created_at < ? OR (m.created_at = ? AND m.id < ?))
           GROUP BY m.id
           ORDER BY m.created_at DESC, m.id DESC
           LIMIT ?`,
        )
        .all(account, before.createdAt, before.createdAt, before.id, limit) as {
        id: number;
        kind: string;
        cycle_id: string | null;
        memo: string;
        created_at: string;
      }[])
    : (db
        .prepare(
          `SELECT m.id, m.kind, m.cycle_id, m.memo, m.created_at
           FROM movements m JOIN legs l ON l.movement_id = m.id
           WHERE l.account = ?
           GROUP BY m.id
           ORDER BY m.created_at DESC, m.id DESC
           LIMIT ?`,
        )
        .all(account, limit) as {
        id: number;
        kind: string;
        cycle_id: string | null;
        memo: string;
        created_at: string;
      }[]);
  const legStatement = db.prepare('SELECT account, amount_cents FROM legs WHERE movement_id = ? ORDER BY id');
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    cycle_id: row.cycle_id,
    memo: row.memo,
    created_at: row.created_at,
    legs: legStatement.all(row.id) as { account: string; amount_cents: number }[],
  }));
}

export function countMovementsForAccount(account: string): number {
  const row = db
    .prepare('SELECT COUNT(DISTINCT movement_id) AS count FROM legs WHERE account = ?')
    .get(account) as { count: number };
  return row.count;
}

export function nextCyclePosition(): number {
  const row = db.prepare('SELECT COALESCE(MAX(position), 0) AS position FROM cycles').get() as { position: number };
  return row.position + 1;
}

export function buildBags(cycle: CycleRow): Bag[] {
  const products = new Map(listProducts().map((product) => [product.id, product]));
  const lineRows = listLineRows(cycle.id).filter((line) => line.status !== 'dropped');
  const households = listHouseholds();
  const packedRows = db
    .prepare('SELECT household_code, product_id, packed FROM bag_items WHERE cycle_id = ?')
    .all(cycle.id) as { household_code: string; product_id: string; packed: number }[];
  const packedLookup = new Map(packedRows.map((row) => [`${row.household_code}|${row.product_id}`, row.packed === 1]));
  const flagRows = db
    .prepare('SELECT household_code, product_id, SUM(units) AS units FROM flags WHERE cycle_id = ? GROUP BY household_code, product_id')
    .all(cycle.id) as { household_code: string; product_id: string; units: number }[];
  const flagLookup = new Map(flagRows.map((row) => [`${row.household_code}|${row.product_id}`, row.units]));

  const bags: Bag[] = [];
  for (const household of households) {
    const items = [];
    for (const lineRow of lineRows) {
      const product = products.get(lineRow.product_id)!;
      const pledge = pledgeOf(cycle.id, product.id, household.code);
      if (!pledge) continue;
      const shortUnits = householdShortUnits(cycle.id, product.id, household.code);
      const units = pledge.units - shortUnits;
      if (units <= 0) continue;
      items.push({
        product_id: product.id,
        case_name: product.case_name,
        units,
        packed: packedLookup.get(`${household.code}|${product.id}`) ?? false,
        flagged_units: flagLookup.get(`${household.code}|${product.id}`) ?? 0,
      });
    }
    if (items.length === 0) continue;
    bags.push({
      household_code: household.code,
      household_name: household.name,
      packed: items.every((item) => item.packed),
      items,
    });
  }
  return bags;
}

/** The number of a household's units on a case that are recorded short. */
export function householdShortUnits(cycleId: string, productId: string, householdCode: string): number {
  const pledges = listPledges(cycleId, productId);
  const shorts = shortUnitNumbers(cycleId, productId);
  let unit = 1;
  let count = 0;
  for (const pledge of pledges) {
    for (let index = 0; index < pledge.units; index += 1) {
      if (pledge.pledger === householdCode && shorts.has(unit)) count += 1;
      unit += 1;
    }
  }
  return count;
}
