import { query, queryOne, type Transaction } from '../db/pool';
import { inches, squareFeet, squareMetres } from '../shared/units';
import { DELETED_ACCOUNT_NAME } from '../shared/copy';
import { foretriangleView, luffAndFoot, sailAreaView, usedDimensions, type SailKind } from './areas';
import { panelView, type PanelGeometry, type Point } from './panels';
import { firstFit, outlineBounds, placedOutline, type LaidOutline, type Rotation } from './nest';
import { deriveStep, settleStatus, type DrawingStatus, type NestingFacts, type Step } from './transitions';
import { remeasureDue } from './workdays';
import { config } from '../config';

/** The one place that reads the stored records and shapes the published objects. */

export type Reader = Pick<Transaction, 'query' | 'one'>;

export const reader: Reader = {
  query: (text, values) => query(text, values ?? []),
  one: (text, values) => queryOne(text, values ?? []),
};

export function instantOf(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function dateOf(value: Date | string): string {
  return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

export interface RuleSetRow {
  readonly version: number;
  readonly effective_at: Date;
  readonly seam_overlap_mm: number;
  readonly roach_permille: number;
  readonly tolerance_mm: number;
  readonly min_offcut_width_mm: number;
  readonly min_offcut_length_mm: number;
  readonly revision: number;
}

/** The current version is decided on every request, with no job and no restart. */
export async function currentRuleSet(db: Reader, now: Date): Promise<RuleSetRow> {
  const row = await db.one<RuleSetRow>(
    `SELECT * FROM ruleset WHERE effective_at <= $1 ORDER BY effective_at DESC, version DESC LIMIT 1`,
    [now.toISOString()],
  );
  if (row === null) {
    return (await db.one<RuleSetRow>('SELECT * FROM ruleset ORDER BY version ASC LIMIT 1')) as RuleSetRow;
  }
  return row;
}

export async function ruleSetByVersion(db: Reader, version: number): Promise<RuleSetRow | null> {
  return db.one<RuleSetRow>('SELECT * FROM ruleset WHERE version = $1', [version]);
}

export function ruleSetView(row: RuleSetRow, currentVersion: number): Record<string, unknown> {
  return {
    version: row.version,
    effective_at: instantOf(row.effective_at),
    current: row.version === currentVersion,
    seam_overlap_mm: row.seam_overlap_mm,
    roach_permille: row.roach_permille,
    tolerance_mm: row.tolerance_mm,
    min_offcut_width_mm: row.min_offcut_width_mm,
    min_offcut_length_mm: row.min_offcut_length_mm,
    revision: row.revision,
  };
}

export async function loftClosures(db: Reader): Promise<Set<string>> {
  const rows = await db.query<{ closed_on: Date }>('SELECT closed_on FROM closure');
  return new Set(rows.map((row) => dateOf(row.closed_on)));
}

export interface AccountRow {
  readonly id: string;
  readonly email: string;
  readonly display_name: string;
  readonly role: string;
  readonly deleted: boolean;
  readonly keycloak_user_id: string | null;
}

/** Wherever a deleted account's name would show, the deleted-account name shows. */
export function nameOf(account: { display_name: string; deleted: boolean } | null): string {
  if (account === null) return DELETED_ACCOUNT_NAME;
  return account.deleted ? DELETED_ACCOUNT_NAME : account.display_name;
}

export async function accountByEmail(db: Reader, email: string): Promise<AccountRow | null> {
  return db.one<AccountRow>('SELECT * FROM account WHERE email = $1', [email]);
}

export async function accountNames(db: Reader): Promise<Map<string, { email: string; display_name: string }>> {
  const rows = await db.query<AccountRow>('SELECT email, display_name, deleted FROM account');
  return new Map(rows.map((row) => [row.email, { email: row.email, display_name: nameOf(row) }]));
}

export function accountView(row: AccountRow): Record<string, unknown> {
  return { id: row.id, email: row.email, display_name: nameOf(row), role: row.role };
}

export interface ClothRow {
  readonly code: string;
  readonly name: string;
  readonly weight: string;
  readonly width_mm: number;
  readonly usable_width_mm: number;
  readonly rate_pence_per_m2: number;
}

export async function clothByCode(db: Reader, code: string): Promise<ClothRow | null> {
  return db.one<ClothRow>('SELECT * FROM cloth WHERE code = $1', [code]);
}

export function clothView(row: ClothRow): Record<string, unknown> {
  return {
    code: row.code,
    name: row.name,
    weight: row.weight,
    width_mm: row.width_mm,
    usable_width_mm: row.usable_width_mm,
    rate_pence_per_m2: row.rate_pence_per_m2,
  };
}

interface MeasurementRow {
  readonly id: string;
  readonly boat_code: string;
  readonly dimension: string;
  readonly value_mm: number;
  readonly measured_on: Date;
  readonly source: string;
  readonly submission_id: string | null;
  readonly tolerance_mm: number;
  readonly photo_key: string | null;
  readonly photo_size: number | null;
  readonly photo_sha256: string | null;
  readonly photo_content_type: string | null;
}

export interface DimensionState {
  readonly key: string;
  readonly value_mm: number | null;
  readonly status: 'measured' | 'remeasure';
  readonly remeasure_due: string | null;
  readonly measurements: readonly MeasurementRow[];
}

/**
 * A dimension's value is its latest measurement. It is flagged when that
 * measurement differs from the one before it by more than the tolerance that was
 * current when it was recorded, and a later measurement inside the band settles it.
 */
export function dimensionState(key: string, ordered: readonly MeasurementRow[], closures: ReadonlySet<string>): DimensionState {
  if (ordered.length === 0) {
    return { key, value_mm: null, status: 'measured', remeasure_due: null, measurements: [] };
  }
  let flaggedBy: MeasurementRow | null = null;
  for (let i = 1; i < ordered.length; i += 1) {
    const previous = ordered[i - 1] as MeasurementRow;
    const current = ordered[i] as MeasurementRow;
    flaggedBy = Math.abs(current.value_mm - previous.value_mm) > current.tolerance_mm ? current : null;
  }
  const latest = ordered[ordered.length - 1] as MeasurementRow;
  return {
    key,
    value_mm: latest.value_mm,
    status: flaggedBy === null ? 'measured' : 'remeasure',
    remeasure_due: flaggedBy === null ? null : remeasureDue(dateOf(flaggedBy.measured_on), closures),
    measurements: ordered,
  };
}

function measurementView(row: MeasurementRow, forOwner: boolean): Record<string, unknown> {
  const photo =
    row.photo_key === null
      ? null
      : forOwner
        ? { size: row.photo_size, sha256: row.photo_sha256 }
        : {
            key: row.photo_key,
            size: row.photo_size,
            sha256: row.photo_sha256,
            content_type: row.photo_content_type,
          };
  return {
    id: row.id,
    value_mm: row.value_mm,
    value_in: inches(row.value_mm),
    measured_on: dateOf(row.measured_on),
    source: row.source,
    submission_id: row.submission_id,
    photo,
  };
}

export interface BoatRow {
  readonly code: string;
  readonly name: string;
  readonly class_name: string;
  readonly owner_email: string;
  readonly notes: string;
  readonly revision: number;
}

export async function boatByCode(db: Reader, code: string): Promise<BoatRow | null> {
  return db.one<BoatRow>('SELECT * FROM boat WHERE code = $1', [code]);
}

export async function dimensionsOfBoat(
  db: Reader,
  code: string,
  closures: ReadonlySet<string>,
): Promise<Map<string, DimensionState>> {
  const rows = await db.query<MeasurementRow>(
    `SELECT * FROM measurement WHERE boat_code = $1 ORDER BY measured_on ASC, recorded_seq ASC`,
    [code],
  );
  const byKey = new Map<string, MeasurementRow[]>();
  for (const row of rows) {
    const list = byKey.get(row.dimension);
    if (list) list.push(row);
    else byKey.set(row.dimension, [row]);
  }
  const states = new Map<string, DimensionState>();
  for (const key of DIMENSION_ORDER) {
    states.set(key, dimensionState(key, byKey.get(key) ?? [], closures));
  }
  return states;
}

export const DIMENSION_ORDER = ['I', 'J', 'P', 'E', 'LL', 'LP'] as const;

export async function boatView(
  db: Reader,
  row: BoatRow,
  now: Date,
  forOwner: boolean,
): Promise<Record<string, unknown>> {
  const closures = await loftClosures(db);
  const states = await dimensionsOfBoat(db, row.code, closures);
  const ruleset = await currentRuleSet(db, now);
  const owner = await accountByEmail(db, row.owner_email);
  const iValue = states.get('I')?.value_mm ?? null;
  const jValue = states.get('J')?.value_mm ?? null;
  const foretriangle =
    iValue === null || jValue === null
      ? null
      : foretriangleView(iValue, jValue, ruleset.tolerance_mm, ruleset.version);
  const dimensions = DIMENSION_ORDER.map((key) => {
    const state = states.get(key) as DimensionState;
    return {
      key,
      value_mm: state.value_mm,
      value_in: state.value_mm === null ? null : inches(state.value_mm),
      status: state.status,
      remeasure_due: state.remeasure_due,
      measurements: state.measurements.map((measurement) => measurementView(measurement, forOwner)),
    };
  });
  const owned = { email: row.owner_email, display_name: nameOf(owner) };
  if (forOwner) {
    return {
      code: row.code,
      name: row.name,
      class_name: row.class_name,
      owner: owned,
      foretriangle,
      dimensions,
    };
  }
  return {
    code: row.code,
    name: row.name,
    class_name: row.class_name,
    owner: owned,
    notes: row.notes,
    revision: row.revision,
    foretriangle,
    dimensions,
  };
}

export interface DrawingRow {
  readonly code: string;
  readonly boat_code: string;
  readonly sail: SailKind;
  readonly cloth_code: string;
  readonly status: DrawingStatus;
  readonly ruleset_version: number | null;
  readonly assigned_to: string | null;
  readonly luff_mm: number | null;
  readonly foot_mm: number | null;
  readonly area_mm2: string | null;
  readonly area_basis: string | null;
  readonly draw_boat_name: string | null;
  readonly draw_owner_name: string | null;
  readonly draw_dimensions: readonly { key: string; value_mm: number }[] | null;
  readonly predecessor: string | null;
  readonly successor: string | null;
  readonly cut_sheet_sha256: string | null;
  readonly cut_sheet_size: number | null;
  readonly cut_sheet_key: string | null;
}

export interface PanelRow {
  readonly drawing_code: string;
  readonly number: number;
  readonly outline: readonly Point[];
  readonly length_mm: number;
  readonly width_mm: number;
  readonly area_mm2: string;
  readonly cut: boolean;
}

export interface ClaimRow {
  readonly id: string;
  readonly stock_code: string;
  readonly drawing_code: string;
  readonly holder_email: string;
  readonly length_mm: number;
  readonly status: string;
  readonly taken_at: Date;
  readonly expires_at: Date;
}

export interface LayRow {
  readonly claim_id: string;
  readonly panel_number: number;
  readonly x_mm: number;
  readonly y_mm: number;
  readonly rotation: number;
}

export interface StockRow {
  readonly code: string;
  readonly kind: 'roll' | 'offcut';
  readonly cloth_code: string;
  readonly lot: string;
  readonly width_mm: number;
  readonly usable_width_mm: number;
  readonly remaining_mm: number;
  readonly on_hand_mm2: string;
  readonly shelf_location: string;
  readonly note: string;
  readonly last_counted_mm: number | null;
  readonly last_counted_at: Date | null;
  readonly revision: number;
}

export async function drawingByCode(db: Reader, code: string): Promise<DrawingRow | null> {
  return db.one<DrawingRow>('SELECT * FROM drawing WHERE code = $1', [code]);
}

export async function panelsOf(db: Reader, code: string): Promise<PanelRow[]> {
  return db.query<PanelRow>('SELECT * FROM panel WHERE drawing_code = $1 ORDER BY number ASC', [code]);
}

export async function claimsOf(db: Reader, code: string): Promise<ClaimRow[]> {
  return db.query<ClaimRow>(
    'SELECT * FROM claim WHERE drawing_code = $1 ORDER BY taken_at ASC, taken_seq ASC',
    [code],
  );
}

export async function laysOfClaims(db: Reader, claimIds: readonly string[]): Promise<Map<string, LayRow[]>> {
  if (claimIds.length === 0) return new Map();
  const rows = await db.query<LayRow>(
    'SELECT * FROM lay WHERE claim_id = ANY($1) ORDER BY laid_seq ASC',
    [claimIds],
  );
  const byClaim = new Map<string, LayRow[]>();
  for (const row of rows) {
    const list = byClaim.get(row.claim_id);
    if (list) list.push(row);
    else byClaim.set(row.claim_id, [row]);
  }
  return byClaim;
}

/** A hold lapses on the server at its deadline, with no job. */
export function liveStatusOf(claim: ClaimRow, now: Date): string {
  if (claim.status !== 'held') return claim.status;
  return claim.expires_at.getTime() <= now.getTime() ? 'lapsed' : 'held';
}

export function secondsRemaining(claim: ClaimRow, now: Date): number {
  const left = Math.ceil((claim.expires_at.getTime() - now.getTime()) / 1000);
  return left > 0 ? left : 0;
}

export function panelGeometry(row: PanelRow): PanelGeometry {
  return {
    number: row.number,
    outline: row.outline,
    length_mm: row.length_mm,
    width_mm: row.width_mm,
    area_mm2: Number(row.area_mm2),
  };
}

/** A drawing's lot is the lot of its earliest Held or Cut claim, derived on every read. */
export async function lotOf(
  db: Reader,
  claims: readonly ClaimRow[],
  now: Date,
): Promise<string | null> {
  const pinning = claims.filter((claim) => {
    const live = liveStatusOf(claim, now);
    return live === 'held' || live === 'cut';
  });
  if (pinning.length === 0) return null;
  const earliest = pinning[0] as ClaimRow;
  const stock = await db.one<{ lot: string }>('SELECT lot FROM stock WHERE code = $1', [earliest.stock_code]);
  return stock === null ? null : stock.lot;
}

export interface DrawingFacts extends NestingFacts {
  readonly panels: readonly PanelRow[];
  readonly claims: readonly ClaimRow[];
  readonly lays: Map<string, LayRow[]>;
  readonly step: Step;
}

export async function drawingFacts(db: Reader, drawing: DrawingRow, now: Date): Promise<DrawingFacts> {
  const panels = await panelsOf(db, drawing.code);
  const claims = await claimsOf(db, drawing.code);
  const lays = await laysOfClaims(db, claims.map((claim) => claim.id));
  const heldClaimIds = new Set(
    claims.filter((claim) => liveStatusOf(claim, now) === 'held').map((claim) => claim.id),
  );
  const laidOnHeld = new Set<number>();
  for (const [claimId, rows] of lays) {
    if (!heldClaimIds.has(claimId)) continue;
    for (const row of rows) laidOnHeld.add(row.panel_number);
  }
  const uncut = panels.filter((panel) => !panel.cut);
  const facts: NestingFacts = {
    status: drawing.status,
    panelCount: panels.length,
    uncutPanelCount: uncut.length,
    uncutPanelsLaidOnHeldClaim: uncut.filter((panel) => laidOnHeld.has(panel.number)).length,
    cutPanelCount: panels.filter((panel) => panel.cut).length,
  };
  return { ...facts, panels, claims, lays, step: deriveStep(facts) };
}

export async function usedDimensionStates(
  db: Reader,
  drawing: DrawingRow,
  closures: ReadonlySet<string>,
): Promise<DimensionState[]> {
  const states = await dimensionsOfBoat(db, drawing.boat_code, closures);
  return usedDimensions(drawing.sail).map((key) => states.get(key) as DimensionState);
}

/**
 * The status a drawing should carry once its dimensions, lays and cuts are read.
 * Keeping this derivation in one place keeps Remeasure and Stepping back honest.
 */
export async function settleDrawing(db: Transaction, drawing: DrawingRow, now: Date): Promise<DrawingStatus> {
  const closures = await loftClosures(db);
  const used = await usedDimensionStates(db, drawing, closures);
  const flagged = used.some((state) => state.status === 'remeasure');
  const facts = await drawingFacts(db, drawing, now);
  const settled = settleStatus(facts, flagged);
  if (settled !== drawing.status) {
    await db.query('UPDATE drawing SET status = $2 WHERE code = $1', [drawing.code, settled]);
  }
  return settled;
}

export async function stockByCode(db: Reader, code: string): Promise<StockRow | null> {
  return db.one<StockRow>('SELECT * FROM stock WHERE code = $1', [code]);
}

/** `free_mm` leaves out the lengths of the item's live holds. */
export async function liveHoldsOn(db: Reader, stockCode: string, now: Date): Promise<ClaimRow[]> {
  return db.query<ClaimRow>(
    `SELECT * FROM claim WHERE stock_code = $1 AND status = 'held' AND expires_at > $2
      ORDER BY taken_at DESC, taken_seq DESC`,
    [stockCode, now.toISOString()],
  );
}

export function usedMmOf(panels: readonly PanelRow[], lays: readonly LayRow[]): number {
  let used = 0;
  const byNumber = new Map(panels.map((panel) => [panel.number, panel]));
  for (const lay of lays) {
    const panel = byNumber.get(lay.panel_number);
    if (panel === undefined) continue;
    const outline = placedOutline(panelGeometry(panel), lay.rotation as Rotation, lay.x_mm, lay.y_mm);
    used = Math.max(used, outlineBounds(outline).maxX);
  }
  return used;
}

export async function stockView(db: Reader, row: StockRow, now: Date): Promise<Record<string, unknown>> {
  const holds = await liveHoldsOn(db, row.code, now);
  const heldLength = holds.reduce((total, claim) => total + claim.length_mm, 0);
  let usedTotal = 0;
  for (const hold of holds) {
    const panels = await panelsOf(db, hold.drawing_code);
    const lays = await db.query<LayRow>('SELECT * FROM lay WHERE claim_id = $1', [hold.id]);
    usedTotal += usedMmOf(panels, lays);
  }
  const afterLaid = row.remaining_mm - usedTotal;
  const onHand = Number(row.on_hand_mm2);
  return {
    code: row.code,
    kind: row.kind,
    cloth_code: row.cloth_code,
    lot: row.lot,
    width_mm: row.width_mm,
    usable_width_mm: row.usable_width_mm,
    remaining_mm: row.remaining_mm,
    remaining_in: inches(row.remaining_mm),
    free_mm: row.remaining_mm - heldLength,
    after_laid_mm: afterLaid,
    after_laid_in: inches(afterLaid),
    on_hand_mm2: onHand,
    on_hand_m2: squareMetres(onHand),
    on_hand_ft2: squareFeet(onHand),
    shelf_location: row.shelf_location,
    note: row.note,
    last_count:
      row.last_counted_mm === null || row.last_counted_at === null
        ? null
        : { counted_mm: row.last_counted_mm, at: instantOf(row.last_counted_at) },
    revision: row.revision,
  };
}

export async function claimView(db: Reader, claim: ClaimRow, now: Date): Promise<Record<string, unknown>> {
  const live = liveStatusOf(claim, now);
  const holder = await accountByEmail(db, claim.holder_email);
  const stock = (await stockByCode(db, claim.stock_code)) as StockRow;
  const panels = await panelsOf(db, claim.drawing_code);
  const open = live === 'held' || live === 'cut';
  const lays = open ? await db.query<LayRow>('SELECT * FROM lay WHERE claim_id = $1 ORDER BY laid_seq ASC', [claim.id]) : [];
  const byNumber = new Map(panels.map((panel) => [panel.number, panel]));

  const laidOutlines: LaidOutline[] = [];
  const laid = lays.map((lay) => {
    const panel = panelGeometry(byNumber.get(lay.panel_number) as PanelRow);
    const outline = placedOutline(panel, lay.rotation as Rotation, lay.x_mm, lay.y_mm);
    laidOutlines.push({ panel_number: lay.panel_number, outline });
    return {
      panel_number: lay.panel_number,
      x_mm: lay.x_mm,
      y_mm: lay.y_mm,
      rotation: lay.rotation,
      outline,
    };
  });

  const laidNumbers = new Set(lays.map((lay) => lay.panel_number));
  const nextPositions = open
    ? panels
        .filter((panel) => !panel.cut && !laidNumbers.has(panel.number))
        .map((panel) => {
          const fit = firstFit(panelGeometry(panel), laidOutlines, claim.length_mm, stock.usable_width_mm);
          return {
            panel_number: panel.number,
            x_mm: fit === null ? null : fit.x_mm,
            y_mm: fit === null ? null : fit.y_mm,
            rotation: fit === null ? null : fit.rotation,
          };
        })
    : [];

  return {
    id: claim.id,
    stock_code: claim.stock_code,
    drawing_code: claim.drawing_code,
    holder: { email: claim.holder_email, display_name: nameOf(holder) },
    length_mm: claim.length_mm,
    status: live,
    taken_at: instantOf(claim.taken_at),
    expires_at: instantOf(claim.expires_at),
    seconds_remaining: live === 'held' ? secondsRemaining(claim, now) : 0,
    used_mm: usedMmOf(panels, lays),
    lays: laid,
    next_positions: nextPositions,
  };
}

export async function drawingView(
  db: Reader,
  drawing: DrawingRow,
  now: Date,
  forOwner: boolean,
): Promise<Record<string, unknown>> {
  const facts = await drawingFacts(db, drawing, now);
  const boat = (await boatByCode(db, drawing.boat_code)) as BoatRow;
  const assigned = drawing.assigned_to === null ? null : await accountByEmail(db, drawing.assigned_to);
  const area =
    drawing.area_mm2 === null || drawing.area_basis === null
      ? null
      : {
          area_mm2: Number(drawing.area_mm2),
          area_m2: squareMetres(Number(drawing.area_mm2)),
          area_ft2: squareFeet(Number(drawing.area_mm2)),
          basis: drawing.area_basis,
        };

  const laidByPanel = new Map<number, { claim_id: string; stock_code: string; x_mm: number; y_mm: number; rotation: number }>();
  for (const claim of facts.claims) {
    const live = liveStatusOf(claim, now);
    if (live !== 'held' && live !== 'cut') continue;
    for (const lay of facts.lays.get(claim.id) ?? []) {
      laidByPanel.set(lay.panel_number, {
        claim_id: claim.id,
        stock_code: claim.stock_code,
        x_mm: lay.x_mm,
        y_mm: lay.y_mm,
        rotation: lay.rotation,
      });
    }
  }

  const panels = facts.panels.map((panel) => {
    const view = panelView(panelGeometry(panel));
    const common = {
      number: view.number,
      outline: view.outline,
      length_mm: view.length_mm,
      width_mm: view.width_mm,
      area_mm2: view.area_mm2,
      area_m2: view.area_m2,
      area_ft2: view.area_ft2,
      cut: panel.cut,
    };
    return forOwner ? common : { ...common, laid: laidByPanel.get(panel.number) ?? null };
  });

  const superseded =
    drawing.successor === null
      ? null
      : await db.one<{ status: string }>('SELECT status FROM drawing WHERE code = $1', [drawing.successor]);
  const supersededBy = superseded !== null && superseded.status === 'issued' ? drawing.successor : null;

  const cutSheet =
    drawing.cut_sheet_sha256 === null
      ? null
      : forOwner
        ? { sha256: drawing.cut_sheet_sha256, size: drawing.cut_sheet_size, superseded_by: supersededBy }
        : {
            sha256: drawing.cut_sheet_sha256,
            size: drawing.cut_sheet_size,
            key: drawing.cut_sheet_key,
            superseded_by: supersededBy,
          };

  if (forOwner) {
    return {
      code: drawing.code,
      boat_code: drawing.boat_code,
      boat_name: boat.name,
      sail: drawing.sail,
      status: drawing.status,
      area,
      panels,
      cut_sheet: cutSheet,
      predecessor: drawing.predecessor,
      successor: drawing.successor,
    };
  }

  return {
    code: drawing.code,
    boat_code: drawing.boat_code,
    boat_name: boat.name,
    sail: drawing.sail,
    cloth_code: drawing.cloth_code,
    lot: await lotOf(db, facts.claims, now),
    status: drawing.status,
    step: facts.step,
    ruleset_version: drawing.ruleset_version,
    assigned_to:
      drawing.assigned_to === null ? null : { email: drawing.assigned_to, display_name: nameOf(assigned) },
    luff_mm: drawing.luff_mm,
    foot_mm: drawing.foot_mm,
    area,
    panels,
    claim_ids: facts.claims.map((claim) => claim.id),
    cut_sheet: cutSheet,
    predecessor: drawing.predecessor,
    successor: drawing.successor,
  };
}

/** The pinned rule set of a drawing, or the current one when nothing is pinned. */
export async function pinnedOrCurrentRuleSet(db: Reader, drawing: DrawingRow, now: Date): Promise<RuleSetRow> {
  if (drawing.ruleset_version !== null) {
    const pinned = await ruleSetByVersion(db, drawing.ruleset_version);
    if (pinned !== null) return pinned;
  }
  return currentRuleSet(db, now);
}

export function holdDeadline(takenAt: Date): Date {
  return new Date(takenAt.getTime() + config.claimHoldSeconds * 1000);
}

export { sailAreaView, luffAndFoot, usedDimensions };
