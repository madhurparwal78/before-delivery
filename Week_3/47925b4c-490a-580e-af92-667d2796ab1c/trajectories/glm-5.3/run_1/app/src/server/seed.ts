import { schemaSql, seedData } from './resources.js';
import { brusselsShowAt as resolveShowAt } from './routes-sites.js';
import type { Pool, PoolClient } from 'pg';

interface SeedModel {
  code: string;
  kind: 'body' | 'lens';
  ratedLumens: number;
  ratedHours: number;
  nativeWidth: number;
  nativeHeight: number;
  ratedWatts: number;
  ratioMin: string | null;
  ratioMax: string | null;
  shiftAcrossMax: string | null;
  shiftDownMax: string | null;
}

interface SeedUnit {
  serial: string;
  model: string;
  loggedHours: string;
}

interface SeedFile {
  models: SeedModel[];
  units: SeedUnit[];
  site: { id: string; name: string; demo: boolean; widthMetres: string; heightMetres: string; showAtLocal: string };
  circuits: { id: string; name: string; kind: string }[];
  layout: { id: string; name: string };
  placements: { bodySerial: string; lensSerial: string; aimAcross: string; aimDown: string; bodyAcross: string; bodyDown: string; standoff: string; ratio: string; shiftAcross: string; shiftDown: string; circuitId: string }[];
  seededAt: string;
  windowReadings: { reflectance: string; recess: string; columns: string[]; rows: number[] };
}

export async function applySchemaAndSeed(pool: Pool): Promise<void> {
  await pool.query(schemaSql());
  const seed = seedData() as SeedFile;
  await seedFixedIdentifiers(pool, seed);
}

async function seedFixedIdentifiers(pool: Pool, seed: SeedFile): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const model of seed.models) {
      await client.query(
        `INSERT INTO models (code, kind, rated_lumens, rated_hours, native_width, native_height, rated_watts, ratio_min, ratio_max, shift_across_max, shift_down_max)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (code) DO NOTHING`,
        [model.code, model.kind, model.ratedLumens, model.ratedHours, model.nativeWidth, model.nativeHeight, model.ratedWatts, model.ratioMin, model.ratioMax, model.shiftAcrossMax, model.shiftDownMax],
      );
    }
    for (const unit of seed.units) {
      await client.query(
        `INSERT INTO units (serial, model_code, logged_hours) VALUES ($1,$2,$3)
         ON CONFLICT (serial) DO UPDATE SET model_code = EXCLUDED.model_code, logged_hours = units.logged_hours`,
        [unit.serial, unit.model, unit.loggedHours],
      );
    }

    const site = seed.site;
    const seededAt = new Date(seed.seededAt);
    await client.query(
      `INSERT INTO sites (id, name, width_metres, height_metres, columns, rows, show_at, demo, residual_metres)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'0.000')
       ON CONFLICT (id) DO NOTHING`,
      [site.id, site.name, site.widthMetres, site.heightMetres, 48, 24, resolveShowAt(site.showAtLocal)!, site.demo],
    );

    for (const circuit of seed.circuits) {
      await client.query(
        `INSERT INTO circuits (id, site_id, name, kind, capacity_watts) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (id) DO NOTHING`,
        [circuit.id, site.id, circuit.name, circuit.kind, capacityWatts(circuit.kind)],
      );
    }

    const layout = seed.layout;
    await client.query(
      `INSERT INTO layouts (id, site_id, name, sheet_status) VALUES ($1,$2,$3,'Draft')
       ON CONFLICT (id) DO NOTHING`,
      [layout.id, site.id, layout.name],
    );

    for (let i = 0; i < seed.placements.length; i++) {
      const p = seed.placements[i]!;
      await client.query(
        `INSERT INTO placements (id, layout_id, position, body_serial, lens_serial, aim_across, aim_down, body_across, body_down, standoff, ratio, shift_across, shift_down, circuit_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (id) DO NOTHING`,
        [`${layout.id}-p${i + 1}`, layout.id, i, p.bodySerial, p.lensSerial, p.aimAcross, p.aimDown, p.bodyAcross, p.bodyDown, p.standoff, p.ratio, p.shiftAcross, p.shiftDown, p.circuitId],
      );
    }

    for (const movement of [...seed.units].map((u) => u.serial)) {
      const row = await client.query<{ id: string }>(
        'SELECT id FROM movements WHERE serial = $1 AND kind = $2 LIMIT 1',
        [movement, 'bought'],
      );
      if (row.rowCount === 0) {
        const result = await client.query<{ id: string }>(
          `INSERT INTO movements (id, kind, serial, at, from_location, to_location)
           VALUES ($1,'bought',$2,$3,'outside','shelf') RETURNING id`,
          [seededMovementId(movement), movement, seededAt],
        );
        await client.query(
          'INSERT INTO movement_entries (movement_id, location, delta) VALUES ($1,$2,-1),($1,$3,1)',
          [result.rows[0]!.id, 'outside', 'shelf'],
        );
      }
    }

    await seedReadings(client, site.id, seed);
    await client.query('COMMIT');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // session already gone
    }
    throw err;
  } finally {
    client.release();
  }
}

function seededMovementId(serial: string): string {
  return `mv-seed-${serial.toLowerCase()}`;
}

const CAPACITIES: { [kind: string]: number } = {
  '230V-16A': 3680,
  '400V-CEE-16A': 11085,
  '400V-CEE-32A': 22170,
};

export function capacityWatts(kind: string): number {
  const capacity = CAPACITIES[kind];
  if (capacity === undefined) throw new Error(`Unknown circuit kind ${kind}`);
  return capacity;
}

// showAtLocal is wall-clock in Europe/Brussels; the fold resolves to the earlier offset.
// The routes module holds the one copy of the Brussels wall-clock rule.

async function seedReadings(client: PoolClient, siteId: string, seed: SeedFile): Promise<void> {
  const existing = await client.query<{ n: number }>('SELECT count(*)::int AS n FROM cells WHERE site_id = $1', [siteId]);
  if (existing.rows[0]!.n > 0) return;
  const capturedAt = new Date(seed.seededAt);
  const columns = 48;
  const rows = 24;
  const values: unknown[][] = [];
  const cellValues: unknown[][] = [];
  for (let row = 1; row <= rows; row++) {
    for (let column = 1; column <= columns; column++) {
      const name = cellName(column, row);
      const isWindow = isWindowCell(seed.windowReadings, column, row);
      cellValues.push([siteId, name, isWindow ? seed.windowReadings.reflectance : '0.6', isWindow ? seed.windowReadings.recess : '0']);
      const bright = column <= 6;
      values.push([
        `rd-seed-${siteId}-${name}`,
        siteId,
        name,
        `op-seed-${siteId}-${name}`,
        bright ? '8' : '30',
        bright ? 'fc' : 'lx',
        bright ? '86.111283' : '30.000000',
        capturedAt,
        capturedAt,
        capturedAt,
        true,
      ]);
    }
  }
  for (let i = 0; i < cellValues.length; i += 200) {
    const chunk = cellValues.slice(i, i + 200);
    await client.query(
      'INSERT INTO cells (site_id, name, reflectance, recess_metres) SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[])',
      [chunk.map((c) => c[0]), chunk.map((c) => c[1]), chunk.map((c) => c[2]), chunk.map((c) => c[3])],
    );
  }
  for (let i = 0; i < values.length; i += 200) {
    const chunk = values.slice(i, i + 200);
    await client.query(
      `INSERT INTO readings (id, site_id, cell, operation_id, entered_text, entered_unit, canonical_lux, captured_at, counted_at, accepted_at, counts)
       SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::timestamptz[], $9::timestamptz[], $10::timestamptz[], $11::boolean[])
       ON CONFLICT (site_id, operation_id) DO NOTHING`,
      [
        chunk.map((v) => v[0]), chunk.map((v) => v[1]), chunk.map((v) => v[2]), chunk.map((v) => v[3]),
        chunk.map((v) => v[4]), chunk.map((v) => v[5]), chunk.map((v) => v[6]), chunk.map((v) => v[7]),
        chunk.map((v) => v[8]), chunk.map((v) => v[9]), chunk.map((v) => v[10]),
      ],
    );
  }
}

function isWindowCell(window: SeedFile['windowReadings'], column: number, row: number): boolean {
  const columnLetters = window.columns.map((letters) => columnNumber(letters));
  return columnLetters.includes(column) && window.rows.includes(row);
}

function cellName(column: number, row: number): string {
  let n = column;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out + row;
}

function columnNumber(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
