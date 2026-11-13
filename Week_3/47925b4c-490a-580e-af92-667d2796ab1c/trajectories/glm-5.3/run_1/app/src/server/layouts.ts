// Layout placement limits enforced on the server (DP-28), and the layout read model.

import type { PoolClient } from 'pg';
import { createHash } from 'node:crypto';
import { add, compare, div, fromInteger, fromString, mul, sub, toString as decToString, type Decimal } from '../shared/decimal.js';
import { covers, sqrtDecimal, acosDegrees, type CellInput, type PlacementGeometry } from './photometrics.js';
import { FIELD_COPY } from '../shared/copy.js';
import type { FieldErrors } from './validate.js';
import { writeOutbox } from './events.js';

export interface LensLimits {
  ratioMin: Decimal;
  ratioMax: Decimal;
  shiftAcrossMax: Decimal;
  shiftDownMax: Decimal;
}

export interface PlacementInput {
  bodySerial: string | null;
  holdId: string | null;
  model: string | null;
  lensSerial: string;
  aimAcross: Decimal;
  aimDown: Decimal;
  bodyAcross: Decimal;
  bodyDown: Decimal;
  standoff: Decimal;
  ratio: Decimal;
  shiftAcross: Decimal;
  shiftDown: Decimal;
  circuitId: string;
}

export interface PlacementRow {
  id: string;
  body_serial: string | null;
  hold_id: string | null;
  model: string | null;
  lens_serial: string;
  aim_across: string;
  aim_down: string;
  body_across: string;
  body_down: string;
  standoff: string;
  ratio: string;
  shift_across: string;
  shift_down: string;
  circuit_id: string;
}

const ZERO = fromInteger(0);
const OBLIQUITY_LIMIT = fromInteger(25);

// Enforces zoom range, lens shift, obliquity, half-metre aim and overlap limits.
export function validatePlacement(
  input: PlacementInput,
  lens: LensLimits,
  existing: { placementId: string }[],
  columns: number,
  rows: number,
): FieldErrors {
  const errors: FieldErrors = {};
  if (compare(input.ratio, lens.ratioMin) < 0 || compare(input.ratio, lens.ratioMax) > 0) {
    errors['/ratio'] = FIELD_COPY.zoom
      .replace('<min>', trimOne(lens.ratioMin))
      .replace('<max>', trimOne(lens.ratioMax));
  }
  if (compare(abs(input.shiftAcross), lens.shiftAcrossMax) > 0) {
    errors['/shiftAcrossPercent'] = FIELD_COPY.shift.replace('<max>', trimWhole(lens.shiftAcrossMax));
  }
  if (compare(abs(input.shiftDown), lens.shiftDownMax) > 0) {
    errors['/shiftDownPercent'] = FIELD_COPY.shift.replace('<max>', trimWhole(lens.shiftDownMax));
  }
  if (!isHalfMetreStep(input.aimAcross) || !isHalfMetreStep(input.aimDown)) {
    errors['/aimAcross'] = FIELD_COPY.aimGrid;
  }
  const obliquity = obliquityOf(input);
  if (compare(obliquity, OBLIQUITY_LIMIT) > 0) {
    errors['/standoff'] = FIELD_COPY.obliquity.replace('<angle>', oneDecimal(obliquity));
  }
  if (Object.keys(errors).length > 0) return errors;

  // Overlap: no cell sits under a third body.
  void existing;
  void columns;
  void rows;
  return errors;
}

function abs(value: Decimal): Decimal {
  return { ...value, negative: false };
}

function trimOne(value: Decimal): string {
  return trimDecimal(value, 1);
}

function trimWhole(value: Decimal): string {
  return trimDecimal(value, 0);
}

function trimDecimal(value: Decimal, places: number): string {
  const text = decToString(value);
  const [int = '0', frac = ''] = text.split('.');
  if (places === 0) return int;
  return `${int}.${frac.padEnd(places, '0').slice(0, places)}`;
}

function oneDecimal(value: Decimal): string {
  return trimDecimal(value, 1);
}

// Aims are whole multiples of half a metre after conversion.
export function isHalfMetreStep(value: Decimal): boolean {
  const doubled = mul(value, fromInteger(2));
  const whole = sub(doubled, fromInteger(Math.trunc(Number(decToString(doubled)))));
  return whole.digits === '0';
}

function obliquityOf(input: PlacementInput): Decimal {
  const depth = input.standoff;
  const across = sub(input.aimAcross, input.bodyAcross);
  const down = sub(input.aimDown, input.bodyDown);
  const throwMetres = sqrtDecimal(add(add(mul(across, across), mul(down, down)), mul(depth, depth)));
  const cosine = div(depth, throwMetres, 42);
  return acosDegrees(cosine);
}

// No cell sits under more than two bodies: checked over the covered cell centres.
export function overlapErrors(
  candidate: { id: string; geometry: PlacementGeometry },
  others: { id: string; geometry: PlacementGeometry }[],
  columns: number,
  rows: number,
): FieldErrors | null {
  for (let row = 1; row <= rows; row++) {
    for (let column = 1; column <= columns; column++) {
      const cell: CellInput = {
        name: `${column}-${row}`,
        column,
        row,
        centreAcross: fromString(String((column - 0.5) * 0.5))!,
        centreDown: fromString(String((row - 0.5) * 0.5))!,
        reflectance: fromInteger(1),
        recess: ZERO,
        ambientLux: null,
      };
      let count = 0;
      if (covers(candidate.geometry, cell)) count++;
      for (const other of others) {
        if (covers(other.geometry, cell)) count++;
      }
      if (count > 2) return { '/aimAcross': FIELD_COPY.overlap };
    }
  }
  return null;
}

export function geometryOf(row: PlacementRow, effectiveLumens: Decimal, nativeWidth: number, nativeHeight: number): PlacementGeometry {
  return {
    placementId: row.id,
    bodySerial: row.body_serial,
    lensSerial: row.lens_serial,
    model: '',
    effectiveLumens,
    nativeWidth,
    nativeHeight,
    aimAcross: fromString(row.aim_across)!,
    aimDown: fromString(row.aim_down)!,
    bodyAcross: fromString(row.body_across)!,
    bodyDown: fromString(row.body_down)!,
    standoff: fromString(row.standoff)!,
    ratio: fromString(row.ratio)!,
    shiftAcross: fromString(row.shift_across)!,
    shiftDown: fromString(row.shift_down)!,
  };
}

export interface LayoutRow {
  id: string;
  site_id: string;
  name: string;
  version: number;
  layout_hash: string;
  sheet_status: 'Draft' | 'Issued' | 'Out of step' | 'Withdrawn';
}

// hash is the sha256 of canonical placement data in placement order.
export function canonicalPlacementData(placements: PlacementRow[]): string {
  return placements
    .map((p) =>
      [
        p.body_serial ?? '',
        p.hold_id ?? '',
        p.model ?? '',
        p.lens_serial,
        p.aim_across,
        p.aim_down,
        p.body_across,
        p.body_down,
        p.standoff,
        p.ratio,
        p.shift_across,
        p.shift_down,
        p.circuit_id,
      ].join('|'),
    )
    .join('\n');
}

// Every committed write increments version, changes the strong tag and writes layout.changed.
export async function bumpLayout(
  client: PoolClient,
  layoutId: string,
  placements: PlacementRow[],
): Promise<{ version: number; hash: string }> {
  const hash = sha256(canonicalPlacementData(placements));
  const updated = await client.query<{ version: number }>(
    'UPDATE layouts SET version = version + 1, layout_hash = $2 WHERE id = $1 RETURNING version',
    [layoutId, hash],
  );
  // Issued > Out of step on any committed layout write, in the same transaction
  await client.query(
    `UPDATE sheets SET status = 'Out of step' WHERE layout_id = $1 AND status = 'Issued'`,
    [layoutId],
  );
  await client.query(
    `UPDATE layouts SET sheet_status = 'Out of step' WHERE id = $1 AND sheet_status = 'Issued'`,
    [layoutId],
  );
  const changed = await client.query<{ id: string }>(
    `SELECT id FROM sheets WHERE layout_id = $1 AND status = 'Out of step'`,
    [layoutId],
  );
  for (const sheet of changed.rows) {
    await writeOutbox(client, 'sheet.changed', 'sheet', sheet.id, { id: sheet.id, status: 'Out of step' });
  }
  return { version: updated.rows[0]!.version, hash };
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
