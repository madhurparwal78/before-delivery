// Cell inputs, geometries and photometric JSON shared by the routes modules.

import type { PoolClient } from 'pg';
import { fromInteger, fromString, roundHalfEven, toString as decToString, type Decimal } from '../shared/decimal.js';
import { computeCell, bandWord } from './photometrics.js';
import type { PlacementGeometry } from './photometrics.js';
import { deratedLumens } from './money.js';
import type { EnrichedPlacement, ModelRecord, SiteRecord } from './layout-types.js';

export async function cellInputs(client: PoolClient, site: SiteRecord) {
  const rows = await client.query<{ name: string; reflectance: string; recess_metres: string }>(
    'SELECT name, reflectance, recess_metres FROM cells WHERE site_id = $1',
    [site.id],
  );
  const readings = await client.query<{ cell: string; canonical_lux: string }>(
    `SELECT cell, canonical_lux FROM readings
      WHERE site_id = $1 AND counts
      ORDER BY counted_at DESC, accepted_at DESC`,
    [site.id],
  );
  const counted = new Map<string, string>();
  for (const row of readings.rows) {
    if (!counted.has(row.cell)) counted.set(row.cell, row.canonical_lux);
  }
  const byName = new Map(rows.rows.map((r) => [r.name, r]));
  const out = [];
  for (let row = 1; row <= site.rows; row++) {
    for (let column = 1; column <= site.columns; column++) {
      const name = columnNameOf(column, row);
      const info = byName.get(name);
      out.push({
        name,
        column,
        row,
        centreAcross: fromString(String((column - 0.5) * 0.5))!,
        centreDown: fromString(String((row - 0.5) * 0.5))!,
        reflectance: fromString(info?.reflectance ?? '0.6')!,
        recess: fromString(info?.recess_metres ?? '0')!,
        ambientLux: counted.has(name) ? fromString(counted.get(name)!) : null,
      });
    }
  }
  return out;
}

export function columnNameOf(column: number, row: number): string {
  let n = column;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters + row;
}

export async function geometriesOf(client: PoolClient, placements: EnrichedPlacement[]): Promise<PlacementGeometry[]> {
  const out: PlacementGeometry[] = [];
  for (const placement of placements) {
    const bodySerial = placement.body_serial;
    let bodyModel: ModelRecord | undefined;
    let loggedHours = '0';
    if (bodySerial !== null) {
      const bodyUnit = await client.query<{ model_code: string; logged_hours: string }>('SELECT model_code, logged_hours FROM units WHERE serial = $1', [bodySerial]);
      bodyModel = (await client.query<ModelRecord>('SELECT * FROM models WHERE code = $1', [bodyUnit.rows[0]?.model_code ?? ''])).rows[0];
      loggedHours = bodyUnit.rows[0]?.logged_hours ?? '0';
    } else {
      bodyModel = (await client.query<ModelRecord>('SELECT * FROM models WHERE code = $1', [placement.model ?? 'VK-20'])).rows[0];
    }
    if (bodyModel === undefined) continue;
    const effective = deratedLumens(bodyModel.rated_lumens, hoursToBigInt(loggedHours), bodyModel.rated_hours);
    out.push({
      placementId: placement.id,
      bodySerial: placement.body_serial,
      lensSerial: placement.lens_serial,
      model: bodyModel.code,
      effectiveLumens: fromInteger(effective),
      nativeWidth: bodyModel.native_width,
      nativeHeight: bodyModel.native_height,
      aimAcross: fromString(placement.aim_across)!,
      aimDown: fromString(placement.aim_down)!,
      bodyAcross: fromString(placement.body_across)!,
      bodyDown: fromString(placement.body_down)!,
      standoff: fromString(placement.standoff)!,
      ratio: fromString(placement.ratio)!,
      shiftAcross: fromString(placement.shift_across)!,
      shiftDown: fromString(placement.shift_down)!,
    });
  }
  return out;
}

function hoursToBigInt(text: string): bigint {
  const [int = '0', frac = ''] = text.split('.');
  const padded = int.replace('-', '') + frac.padEnd(6, '0');
  const value = BigInt(padded);
  return frac.length > 6 ? value / 10n ** BigInt(frac.length - 6) : value / 10n ** BigInt(6 - frac.length);
}

export function cellJson(figures: ReturnType<typeof computeCell>): Record<string, unknown> {
  return {
    cell: figures.cell,
    ambientLux: figures.ambientLux === null ? null : decToString(roundHalfEven(figures.ambientLux, 6)),
    projectedLux: four(figures.projectedLux),
    totalLux: four(figures.totalLux),
    luminanceCdM2: four(figures.luminanceCdM2),
    contrast: figures.contrast === null ? null : four(figures.contrast),
    contrastText: figures.contrast === null ? null : oneDecimal(figures.contrast) + ' to 1',
    band: bandWord(figures.band),
    pixelsPerMetre: figures.pixelsPerMetre,
    blended: figures.blended,
    stale: false,
    litLevel: figures.litLevel === null ? null : four(figures.litLevel),
    hatched: figures.hatched,
    contributions: figures.contributions.map((c) => ({
      placementId: c.placementId,
      effectiveLumens: four(c.effectiveLumens),
      throwMetres: four(c.throwMetres),
      obliquityDegrees: four(c.obliquityDegrees),
      share: four(c.share),
      lux: four(c.lux),
    })),
  };
}

export function four(value: Decimal): number {
  return Number(decToString(roundHalfEven(value, 4)));
}

export function oneDecimal(value: Decimal): string {
  return decToString(roundHalfEven(value, 1));
}
