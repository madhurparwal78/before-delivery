/** Boats, rig dimensions and measurements: the tolerance bands and the Remeasure flag are decided here. */
import { one, rows, run, opaqueId, type Queryable, type Row } from "./db.js";
import { currentRuleSet, remeasureDueDates, type RuleSetRow } from "./rules.js";
import { displayNameOf, type AccountRow } from "./accounts.js";
import { now } from "./time.js";
import { foretriangleArea } from "../shared/geometry.js";
import { inchesOf, squareFeetOf, squareMetresOf } from "../shared/units.js";
import { projectBoat } from "./projection.js";
import { DIMENSION_KEYS, type AreaFigure, type Boat, type Dimension, type DimensionKey, type Measurement, type Photo, type Role } from "../shared/types.js";

export interface MeasurementRow {
  id: string;
  seq: number;
  boat_code: string;
  dimension: DimensionKey;
  value_mm: number;
  measured_on: string;
  source: "sailmaker" | "submission";
  submission_id: string | null;
  tolerance_mm: number;
  photo_key: string | null;
  photo_size: number | null;
  photo_sha256: string | null;
  photo_type: string | null;
}

export interface DimensionState {
  value_mm: number | null;
  flagged: boolean;
  flaggedOn: string | null;
  measurements: MeasurementRow[];
}

/** Measurements are ordered by the day measured, then by recording order. */
function sortMeasurements(list: MeasurementRow[]): MeasurementRow[] {
  return [...list].sort((a, b) => (a.measured_on < b.measured_on ? -1 : a.measured_on > b.measured_on ? 1 : a.seq - b.seq));
}

/** A dimension's value is its latest measurement; it is flagged when that one left the band of the one before it. */
export function dimensionState(list: MeasurementRow[]): DimensionState {
  const ordered = sortMeasurements(list);
  const last = ordered[ordered.length - 1];
  if (!last) return { value_mm: null, flagged: false, flaggedOn: null, measurements: [] };
  const previous = ordered[ordered.length - 2];
  const flagged = previous !== undefined && Math.abs(last.value_mm - previous.value_mm) > last.tolerance_mm;
  return { value_mm: last.value_mm, flagged, flaggedOn: flagged ? last.measured_on : null, measurements: ordered };
}

export function statesOf(list: MeasurementRow[]): Record<DimensionKey, DimensionState> {
  const states = {} as Record<DimensionKey, DimensionState>;
  for (const key of DIMENSION_KEYS) states[key] = dimensionState(list.filter((m) => m.dimension === key));
  return states;
}

export function areaFigure(areaMm2: number, basis: string): AreaFigure {
  return { area_mm2: areaMm2, area_m2: squareMetresOf(areaMm2), area_ft2: squareFeetOf(areaMm2), basis };
}

const foretriangleBasis = (rule: RuleSetRow): string => `I × J / 2 · tolerance ±${rule.tolerance_mm} mm · rule set v${rule.version}`;

function photoView(row: MeasurementRow): Photo | null {
  if (!row.photo_sha256) return null;
  return { key: row.photo_key!, size: row.photo_size!, sha256: row.photo_sha256, content_type: row.photo_type! };
}

function dimensionView(key: DimensionKey, state: DimensionState, due: Map<string, string>): Dimension {
  const measurements: Measurement[] = state.measurements.map((m) => ({
    id: m.id,
    value_mm: m.value_mm,
    value_in: inchesOf(m.value_mm),
    measured_on: m.measured_on,
    source: m.source,
    submission_id: m.submission_id,
    photo: photoView(m),
  }));
  return {
    key,
    value_mm: state.value_mm,
    value_in: state.value_mm === null ? null : inchesOf(state.value_mm),
    status: state.flagged ? "remeasure" : "measured",
    remeasure_due: state.flaggedOn ? (due.get(state.flaggedOn) ?? null) : null,
    measurements,
  };
}

export async function measurementsOf(db: Queryable, boatCodes: string[]): Promise<MeasurementRow[]> {
  if (boatCodes.length === 0) return [];
  return rows<MeasurementRow>(db, "SELECT * FROM measurement WHERE boat_code = ANY($1)", [boatCodes]);
}

export async function boatViews(db: Queryable, boatRows: Row[], role: Role): Promise<Boat[]> {
  if (boatRows.length === 0) return [];
  const all = await measurementsOf(db, boatRows.map((b) => b.code));
  const rule = await currentRuleSet(db, now());
  const flaggedDates = new Set<string>();
  const perBoat = new Map<string, Record<DimensionKey, DimensionState>>();
  for (const boat of boatRows) {
    const states = statesOf(all.filter((m) => m.boat_code === boat.code));
    perBoat.set(boat.code, states);
    for (const key of DIMENSION_KEYS) if (states[key].flaggedOn) flaggedDates.add(states[key].flaggedOn!);
  }
  const due = await remeasureDueDates(db, [...flaggedDates]);
  return boatRows.map((boat) => {
    const states = perBoat.get(boat.code)!;
    const area = states.I.value_mm !== null && states.J.value_mm !== null ? foretriangleArea(states.I.value_mm, states.J.value_mm) : 0;
    const view: Boat = {
      code: boat.code,
      name: boat.name,
      class_name: boat.class_name,
      owner: { email: boat.owner_email, display_name: displayNameOf({ display_name: boat.owner_name, deleted: boat.owner_deleted } as AccountRow) },
      notes: boat.notes,
      revision: boat.revision,
      foretriangle: areaFigure(area, foretriangleBasis(rule)),
      dimensions: DIMENSION_KEYS.map((key) => dimensionView(key, states[key], due)),
    };
    return projectBoat(view, role);
  });
}

const BOAT_SELECT = `SELECT b.*, o.email AS owner_email, o.display_name AS owner_name, o.deleted AS owner_deleted
  FROM boat b JOIN account o ON o.id = b.owner_id`;

export async function boatRow(db: Queryable, code: string): Promise<Row | null> {
  return one(db, `${BOAT_SELECT} WHERE b.code = $1`, [code]);
}

async function boatView(db: Queryable, code: string, role: Role): Promise<Boat> {
  const row = await boatRow(db, code);
  return (await boatViews(db, [row!], role))[0]!;
}

interface NewMeasurement {
  boatCode: string;
  dimension: DimensionKey;
  valueMm: number;
  measuredOn: string;
  source: "sailmaker" | "submission";
  submissionId: string | null;
}

export async function insertMeasurement(db: Queryable, input: NewMeasurement): Promise<string> {
  const id = await opaqueId(db, "m-");
  const rule = await currentRuleSet(db, now());
  await run(
    db,
    `INSERT INTO measurement (id, boat_code, dimension, value_mm, measured_on, source, submission_id, tolerance_mm)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, input.boatCode, input.dimension, input.valueMm, input.measuredOn, input.source, input.submissionId, rule.tolerance_mm],
  );
  return id;
}

export async function currentValue(db: Queryable, boatCode: string, dimension: DimensionKey): Promise<number | null> {
  const list = await rows<MeasurementRow>(db, "SELECT * FROM measurement WHERE boat_code = $1 AND dimension = $2", [boatCode, dimension]);
  return dimensionState(list).value_mm;
}

export async function dimensionOfMeasurement(db: Queryable, measurementId: string, role: Role): Promise<Dimension> {
  const found = await one<MeasurementRow>(db, "SELECT * FROM measurement WHERE id = $1", [measurementId]);
  const boat = await boatView(db, found!.boat_code, role);
  return boat.dimensions.find((d) => d.key === found!.dimension)!;
}
