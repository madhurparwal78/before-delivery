import { insertSite } from '../data/sites.js';
import { postMovement, SHELF, OUTSIDE } from '../data/kit.js';
import { MODELS } from '../domain/catalogue.js';
import { parseLocalShowTime } from '../domain/brussels.js';
import { parseDecimal, toFixed } from '../domain/decimal.js';
import { ambientToLux } from '../domain/units.js';
import { layoutHash } from '../domain/layouthash.js';
import type { Queryable } from './pool.js';

const SITE_ID = 'zuiderhal';
const LAYOUT_ID = 'zuiderhal-launch';
const SHOW_AT_LOCAL = '2027-02-12T19:30';

const CIRCUITS = [
  { id: '7a1f0b3e-0000-4000-8000-000000000001', name: 'Stage left', kind: '230V-16A' },
  { id: '7a1f0b3e-0000-4000-8000-000000000002', name: 'Stage right', kind: '230V-16A' },
  { id: '7a1f0b3e-0000-4000-8000-000000000003', name: 'Yard', kind: '400V-CEE-32A' },
] as const;

const BODIES = [
  { serial: 'NW-B01', model: 'VK-20', hours: '0' },
  { serial: 'NW-B02', model: 'VK-20', hours: '4000' },
  { serial: 'NW-B03', model: 'VK-20', hours: '10000' },
  { serial: 'NW-B04', model: 'VK-20', hours: '20000' },
  { serial: 'NW-B05', model: 'VK-12', hours: '0' },
] as const;

const LENSES = [
  { serial: 'NW-L01', model: 'LS-13' },
  { serial: 'NW-L02', model: 'LS-13' },
  { serial: 'NW-L03', model: 'LS-13' },
  { serial: 'NW-L04', model: 'LS-20' },
] as const;

const PLACEMENTS = [
  {
    id: '7a1f0b3e-0001-4000-8000-000000000001',
    bodySerial: 'NW-B01',
    lensSerial: 'NW-L01',
    aimAcross: '6.5',
    aimDown: '6.0',
    circuitId: CIRCUITS[0].id,
  },
  {
    id: '7a1f0b3e-0001-4000-8000-000000000002',
    bodySerial: 'NW-B02',
    lensSerial: 'NW-L02',
    aimAcross: '17.5',
    aimDown: '6.0',
    circuitId: CIRCUITS[1].id,
  },
] as const;

const RECESSED_COLUMNS = ['J', 'K'];
const RECESSED_ROWS = [9, 10, 11, 12];

/** The invented starting records, applied once however many processes boot. */
export async function seed(client: Queryable): Promise<void> {
  for (const model of MODELS) {
    if (model.kind === 'body') {
      await client.query(
        `insert into models (code, kind, rated_lumens, rated_hours, native_width_px, native_height_px, watts)
         values ($1, 'body', $2, $3, $4, $5, $6) on conflict (code) do nothing`,
        [model.code, model.ratedLumens, model.ratedHours, model.nativeWidthPx, model.nativeHeightPx, model.watts],
      );
    } else {
      await client.query(
        `insert into models (code, kind, ratio_min, ratio_max, shift_across_percent, shift_down_percent)
         values ($1, 'lens', $2, $3, $4, $5) on conflict (code) do nothing`,
        [model.code, model.ratioMin, model.ratioMax, model.shiftAcrossPercent, model.shiftDownPercent],
      );
    }
  }

  const planted = await client.query('select id from sites where id = $1', [SITE_ID]);
  if (planted.rows.length > 0) return;

  for (const unit of [...BODIES.map((body) => ({ ...body, kind: 'body' })), ...LENSES.map((lens) => ({ ...lens, kind: 'lens', hours: '0' }))]) {
    await client.query(
      `insert into units (serial, kind, model, location, logged_hours) values ($1, $2, $3, $4, $5)
       on conflict (serial) do nothing`,
      [unit.serial, unit.kind, unit.model, OUTSIDE, unit.hours],
    );
    await postMovement(client, unit.serial, 'bought', OUTSIDE, SHELF, null);
  }

  await insertSite(client, {
    id: SITE_ID,
    name: 'Zuiderhal',
    width: parseDecimal('24'),
    height: parseDecimal('12'),
    showAt: new Date(parseLocalShowTime(SHOW_AT_LOCAL) as number),
    showAtLocal: SHOW_AT_LOCAL,
    demo: true,
    rectified: true,
    residualMetres: '0.000',
    layoutId: LAYOUT_ID,
    layoutName: 'Zuiderhal launch',
    circuitIds: CIRCUITS.map((circuit) => circuit.id),
    circuits: CIRCUITS.map((circuit) => ({ name: circuit.name, kind: circuit.kind })),
  });

  await client.query(
    `update cells set reflectance = 0.1, recess_metres = 0.4
     where site_id = $1 and substring(cell from '^[A-Z]+') = any($2::text[])
       and (substring(cell from '[0-9]+$'))::int = any($3::int[])`,
    [SITE_ID, RECESSED_COLUMNS, RECESSED_ROWS],
  );

  const capturedAt = new Date(Date.now() - 86_400_000).toISOString();
  const cells = await client.query('select cell, reflectance from cells where site_id = $1', [SITE_ID]);
  for (const row of cells.rows) {
    const cell = row['cell'] as string;
    const letters = /^[A-Z]+/.exec(cell)?.[0] ?? '';
    const footCandles = letters.length === 1 && letters <= 'F';
    const entered = footCandles ? { text: '8', unit: 'fc' as const } : { text: '30', unit: 'lx' as const };
    const lux = ambientToLux(parseDecimal(entered.text), entered.unit, parseDecimal(row['reflectance'] as string));
    await client.query(
      `insert into readings (id, operation_id, site_id, cell, entered_text, entered_unit, canonical_lux, captured_at, counted_at, accepted_at)
       values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $7, now())
       on conflict (operation_id) do nothing`,
      [`seed-${SITE_ID}-${cell}`, SITE_ID, cell, entered.text, entered.unit, toFixed(lux, 6), capturedAt],
    );
  }

  for (const [index, placement] of PLACEMENTS.entries()) {
    await client.query(
      `insert into placements (id, layout_id, ordinal, body_serial, model, lens_serial,
         aim_across, aim_down, body_across, body_down, standoff, ratio,
         shift_across_percent, shift_down_percent, circuit_id)
       values ($1, $2, $3, $4, 'VK-20', $5, $6, $7, $6, $7, 18, 1.3, 0, 0, $8)
       on conflict (id) do nothing`,
      [
        placement.id,
        LAYOUT_ID,
        index + 1,
        placement.bodySerial,
        placement.lensSerial,
        placement.aimAcross,
        placement.aimDown,
        placement.circuitId,
      ],
    );
  }
  await client.query(`select setval('placement_ordinal', $1)`, [PLACEMENTS.length + 1]);

  const placed = await client.query(
    `select p.*, m.rated_lumens, m.rated_hours, m.native_width_px, m.native_height_px, m.watts,
            u.logged_hours, null as hold_status
     from placements p join models m on m.code = p.model
     left join units u on u.serial = p.body_serial
     where p.layout_id = $1 order by p.ordinal`,
    [LAYOUT_ID],
  );
  await client.query('update layouts set hash = $2 where id = $1', [
    LAYOUT_ID,
    layoutHash(
      placed.rows.map((row) => ({
        bodySerial: row['body_serial'] as string,
        holdId: null,
        model: row['model'] as string,
        lensSerial: row['lens_serial'] as string,
        aimAcross: row['aim_across'] as string,
        aimDown: row['aim_down'] as string,
        bodyAcross: row['body_across'] as string,
        bodyDown: row['body_down'] as string,
        standoff: row['standoff'] as string,
        ratio: row['ratio'] as string,
        shiftAcrossPercent: row['shift_across_percent'] as string,
        shiftDownPercent: row['shift_down_percent'] as string,
        circuitId: row['circuit_id'] as string,
      })),
    ),
  ]);
}
