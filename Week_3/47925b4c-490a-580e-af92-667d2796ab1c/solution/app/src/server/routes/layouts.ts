import { randomUUID } from 'node:crypto';
import { query, queryOne, transact } from '../db/pool.js';
import { findHold, holdRecords, holdView, statusAt } from '../data/holds.js';
import { ensureBodyModel } from '../data/kit.js';
import {
  type LayoutRecord,
  type PlacementRecord,
  type PlacementWrite,
  circuitLoads,
  commitLayoutWrite,
  entityTag,
  insertPlacement,
  layoutCells,
  layoutView,
  lockAtVersion,
  opticsOf,
  overlapsTooMany,
  requireLayout,
  unitsForSite,
  updatePlacement,
} from '../data/layouts.js';
import { cellOnWall, requireSite, staleFacts } from '../data/sites.js';
import { CIRCUIT_CAPACITY_WATTS, CIRCUIT_KINDS, effectiveLumens } from '../domain/catalogue.js';
import { type Decimal, compare, fromInteger, isWhole, multiply, parseDecimal, toFixed } from '../domain/decimal.js';
import { oneDecimal, wholeNumber } from '../domain/format.js';
import { EMPTY_LAYOUT_HASH } from '../domain/layouthash.js';
import { OBLIQUITY_LIMIT_DEGREES, projectionOf } from '../domain/photometrics.js';
import { LENGTH_SCALE, LENGTH_UNITS, lengthToMetres, type LengthUnit } from '../domain/units.js';
import { aimGridCopy, fieldCopy, lensCopy, obliquityCopy, overlapCopy, shiftCopy, zoomCopy } from '../http/fields.js';
import { problem } from '../http/problem.js';
import { type RequestContext, route } from '../http/server.js';
import { QUANTITY_SHAPE, Validation, readNumberText, readQuantity, readString } from '../http/validate.js';

const ZERO = parseDecimal('0');

const PLACEMENT_SHAPE = {
  bodySerial: true,
  holdId: true,
  model: true,
  lensSerial: true,
  aimAcross: QUANTITY_SHAPE,
  aimDown: QUANTITY_SHAPE,
  bodyAcross: QUANTITY_SHAPE,
  bodyDown: QUANTITY_SHAPE,
  standoff: QUANTITY_SHAPE,
  ratio: true,
  shiftAcrossPercent: true,
  shiftDownPercent: true,
  circuitId: true,
} as const;

function strongTag(header: string | string[] | undefined): string[] | null {
  const value = Array.isArray(header) ? header[0] : header;
  if (value === undefined || value.trim() === '' || value.trim() === '*') return null;
  return value.split(',').map((tag) => tag.trim());
}

/** RFC 9110 conditional writes on the layout's strong entity tag. */
function requireMatch(context: RequestContext, layout: LayoutRecord): void {
  const tags = strongTag(context.headers['if-match']);
  if (tags === null) throw problem('precondition_required');
  if (!tags.includes(entityTag(layout))) throw problem('layout_changed');
}

route(
  'POST',
  '/api/sites/:siteId/circuits',
  async (context) => {
    const site = await requireSite(context.params['siteId'] as string);
    const check = new Validation();
    const name = readString(check, context.body, 'name');
    const kind = readString(check, context.body, 'kind');
    if (kind !== null && !CIRCUIT_KINDS.includes(kind)) check.add('/kind', fieldCopy.required);
    check.finish();
    const id = randomUUID();
    await query('insert into circuits (id, site_id, name, kind) values ($1, $2, $3, $4)', [id, site.id, name, kind]);
    return {
      status: 201,
      body: { id, name, kind, capacityWatts: CIRCUIT_CAPACITY_WATTS[kind as string] },
    };
  },
  { keyed: true, shape: { name: true, kind: true } },
);

route(
  'POST',
  '/api/sites/:siteId/layouts',
  async (context) => {
    const site = await requireSite(context.params['siteId'] as string);
    const check = new Validation();
    const name = readString(check, context.body, 'name');
    check.finish();
    const id = randomUUID();
    await transact(async (client) => {
      await client.query('insert into layouts (id, site_id, name, hash) values ($1, $2, $3, $4)', [
        id,
        site.id,
        name,
        EMPTY_LAYOUT_HASH,
      ]);
    });
    const layout = await requireLayout(id);
    return { status: 201, body: layoutView(layout), headers: { ETag: entityTag(layout) } };
  },
  { keyed: true, shape: { name: true } },
);

route('GET', '/api/layouts/:layoutId', async (context) => {
  const layout = await requireLayout(context.params['layoutId'] as string);
  const tag = entityTag(layout);
  const asked = strongTag(context.headers['if-none-match']);
  if (asked !== null && asked.includes(tag)) return { status: 304, headers: { ETag: tag } };
  return { status: 200, body: layoutView(layout), headers: { ETag: tag } };
});

route('GET', '/api/layouts/:layoutId/picker', async (context) => {
  const layout = await requireLayout(context.params['layoutId'] as string);
  const units = await unitsForSite(layout.siteId);
  const holds = await holdRecords();
  const now = Date.now();
  const models = new Map<string, number>();
  for (const unit of units) {
    if (unit.kind !== 'body') continue;
    models.set(unit.model, (models.get(unit.model) ?? 0) + (unit.free ? 1 : 0));
  }
  return {
    status: 200,
    body: {
      models: [...models.entries()]
        .map(([model, free]) => ({ model, free }))
        .sort((left, right) => left.model.localeCompare(right.model)),
      bodies: units
        .filter((unit) => unit.kind === 'body')
        .map(({ serial, model, location, free }) => ({ serial, model, location, free })),
      lenses: units
        .filter((unit) => unit.kind === 'lens')
        .map(({ serial, model, location, free }) => ({ serial, model, location, free })),
      holds: holds
        .map((hold) => holdView(hold, now))
        .filter((hold) => hold.status === 'Held')
        .map(({ id, model, serial, status }) => ({ id, model, serial, status })),
    },
  };
});

route('GET', '/api/layouts/:layoutId/cells', async (context) => {
  const layout = await requireLayout(context.params['layoutId'] as string);
  const stale = await staleFacts(layout.siteId);
  const cells = await layoutCells(layout, stale.stale);
  return { status: 200, body: { items: cells.cells } };
});

route('GET', '/api/layouts/:layoutId/cells/:cell', async (context) => {
  const layout = await requireLayout(context.params['layoutId'] as string);
  const site = await requireSite(layout.siteId);
  const cell = context.params['cell'] as string;
  if (!cellOnWall(cell, site.columns, site.rows)) throw problem('not_found');
  const stale = await staleFacts(layout.siteId);
  const cells = await layoutCells(layout, stale.stale);
  const found = cells.cells.find((entry) => entry.cell === cell);
  if (found === undefined) throw problem('not_found');
  return { status: 200, body: found };
});

route('GET', '/api/layouts/:layoutId/circuits', async (context) => {
  const layout = await requireLayout(context.params['layoutId'] as string);
  return { status: 200, body: { items: await circuitLoads(layout) } };
});

interface LensFacts {
  readonly ratioMin: string;
  readonly ratioMax: string;
  readonly shiftAcrossPercent: string;
  readonly shiftDownPercent: string;
}

function onHalfMetre(value: Decimal): boolean {
  return isWhole(multiply(value, fromInteger(2)));
}

async function readPlacement(
  context: RequestContext,
  layoutId: string,
  siteId: string,
  existing: PlacementRecord | null,
): Promise<PlacementWrite> {
  const body = context.body;
  const check = new Validation();
  const bodySerial = typeof body['bodySerial'] === 'string' ? body['bodySerial'] : null;
  const holdId = typeof body['holdId'] === 'string' ? body['holdId'] : null;
  if (bodySerial !== null && holdId !== null) check.add('/holdId', fieldCopy.required);
  const lensSerial = readString(check, body, 'lensSerial');
  const aimAcross = readQuantity(check, body, 'aimAcross', LENGTH_UNITS, 'refused');
  const aimDown = readQuantity(check, body, 'aimDown', LENGTH_UNITS, 'refused');
  const bodyAcross = readQuantity(check, body, 'bodyAcross', LENGTH_UNITS, 'allowed');
  const bodyDown = readQuantity(check, body, 'bodyDown', LENGTH_UNITS, 'allowed');
  const standoff = readQuantity(check, body, 'standoff', LENGTH_UNITS, 'refused');
  const ratio = readNumberText(check, body, 'ratio', 'refused');
  const shiftAcross = readNumberText(check, body, 'shiftAcrossPercent', 'allowed');
  const shiftDown = readNumberText(check, body, 'shiftDownPercent', 'allowed');
  const circuitId = readString(check, body, 'circuitId');

  const units = await unitsForSite(siteId);
  const available = new Map(units.map((unit) => [unit.serial, unit]));

  let model: string | null = null;
  if (bodySerial !== null) {
    const unit = available.get(bodySerial);
    if (unit === undefined || unit.kind !== 'body') {
      throw problem('body_not_available', { placeholders: { serial: bodySerial } });
    }
    const taken = await queryOne(
      'select id from placements where layout_id = $1 and body_serial = $2 and ($3::uuid is null or id <> $3::uuid)',
      [layoutId, bodySerial, existing?.id ?? null],
    );
    if (taken !== null) throw problem('body_already_in_layout', { placeholders: { serial: bodySerial } });
    model = unit.model;
  } else if (holdId !== null) {
    const hold = await findHold(holdId);
    if (hold === null || statusAt(hold, Date.now()) !== 'Held') throw problem('hold_not_held');
    model = hold.model;
  } else {
    model = readString(check, body, 'model');
  }

  if (lensSerial !== null) {
    const lens = available.get(lensSerial);
    if (lens === undefined || lens.kind !== 'lens') check.add('/lensSerial', lensCopy(lensSerial));
    const taken = await queryOne(
      'select id from placements where layout_id = $1 and lens_serial = $2 and ($3::uuid is null or id <> $3::uuid)',
      [layoutId, lensSerial, existing?.id ?? null],
    );
    if (taken !== null) throw problem('body_already_in_layout', { placeholders: { serial: lensSerial } });
  }
  if (circuitId !== null) {
    const circuit = await queryOne('select id from circuits where id = $1 and site_id = $2', [circuitId, siteId]);
    if (circuit === null) check.add('/circuitId', fieldCopy.required);
  }
  check.finish();

  const lensRow = await queryOne('select * from models where code = (select model from units where serial = $1)', [
    lensSerial,
  ]);
  const lens: LensFacts = {
    ratioMin: lensRow?.['ratio_min'] as string,
    ratioMax: lensRow?.['ratio_max'] as string,
    shiftAcrossPercent: lensRow?.['shift_across_percent'] as string,
    shiftDownPercent: lensRow?.['shift_down_percent'] as string,
  };

  const write: PlacementWrite = {
    bodySerial,
    holdId,
    model: model as string,
    lensSerial: lensSerial as string,
    aimAcross: metres(aimAcross),
    aimDown: metres(aimDown),
    bodyAcross: metres(bodyAcross),
    bodyDown: metres(bodyDown),
    standoff: metres(standoff),
    ratio: (ratio as { value: Decimal }).value,
    shiftAcrossPercent: (shiftAcross as { value: Decimal }).value,
    shiftDownPercent: (shiftDown as { value: Decimal }).value,
    circuitId: circuitId as string,
  };

  if (compare(write.ratio, parseDecimal(lens.ratioMin)) < 0 || compare(write.ratio, parseDecimal(lens.ratioMax)) > 0) {
    check.add('/ratio', zoomCopy(oneDecimal(Number(lens.ratioMin)), oneDecimal(Number(lens.ratioMax))));
  }
  if (absolute(write.shiftAcrossPercent, parseDecimal(lens.shiftAcrossPercent))) {
    check.add('/shiftAcrossPercent', shiftCopy(wholeNumber(Number(lens.shiftAcrossPercent))));
  }
  if (absolute(write.shiftDownPercent, parseDecimal(lens.shiftDownPercent))) {
    check.add('/shiftDownPercent', shiftCopy(wholeNumber(Number(lens.shiftDownPercent))));
  }
  if (!onHalfMetre(write.aimAcross)) check.add('/aimAcross', aimGridCopy);
  if (!onHalfMetre(write.aimDown)) check.add('/aimDown', aimGridCopy);

  const facts = await bodyFacts(model as string, bodySerial, holdId);
  const optics = {
    id: existing?.id ?? 'new',
    ordinal: existing?.ordinal ?? Number.MAX_SAFE_INTEGER,
    aimAcross: Number(toFixed(write.aimAcross, LENGTH_SCALE)),
    aimDown: Number(toFixed(write.aimDown, LENGTH_SCALE)),
    bodyAcross: Number(toFixed(write.bodyAcross, LENGTH_SCALE)),
    bodyDown: Number(toFixed(write.bodyDown, LENGTH_SCALE)),
    standoff: Number(toFixed(write.standoff, LENGTH_SCALE)),
    ratio: Number(toFixed(write.ratio, LENGTH_SCALE)),
    shiftAcrossPercent: Number(toFixed(write.shiftAcrossPercent, LENGTH_SCALE)),
    shiftDownPercent: Number(toFixed(write.shiftDownPercent, LENGTH_SCALE)),
    effectiveLumens: facts.effectiveLumens,
    nativeWidthPx: facts.nativeWidthPx,
    nativeHeightPx: facts.nativeHeightPx,
  };
  if (compare(write.standoff, ZERO) <= 0) check.add('/standoff', obliquityCopy('90.0'));
  check.finish();

  const projection = projectionOf(optics);
  if (projection.obliquityDegrees > OBLIQUITY_LIMIT_DEGREES) {
    check.add('/standoff', obliquityCopy(oneDecimal(projection.obliquityDegrees)));
  }
  const layout = await requireLayout(layoutId);
  const site = await requireSite(siteId);
  const others = layout.placements.filter((placement) => placement.id !== existing?.id).map(opticsOf);
  if (overlapsTooMany([...others, optics], site.columns, site.rows)) check.add('/aimAcross', overlapCopy);
  check.finish();
  return write;
}

function metres(quantity: { value: Decimal; unit: string } | null): Decimal {
  const given = quantity as { value: Decimal; unit: string };
  return lengthToMetres(given.value, given.unit as LengthUnit);
}

function absolute(value: Decimal, limit: Decimal): boolean {
  const magnitude = compare(value, ZERO) < 0 ? multiply(value, fromInteger(-1)) : value;
  return compare(magnitude, limit) > 0;
}

async function bodyFacts(
  model: string,
  bodySerial: string | null,
  holdId: string | null,
): Promise<{ effectiveLumens: number; nativeWidthPx: number; nativeHeightPx: number }> {
  const row = await queryOne('select * from models where code = $1', [model]);
  const rated = Number(row?.['rated_lumens']);
  const ratedHours = Number(row?.['rated_hours']);
  let loggedHours = 0;
  if (bodySerial !== null) {
    const unit = await queryOne<{ logged_hours: string }>('select logged_hours from units where serial = $1', [
      bodySerial,
    ]);
    loggedHours = Number(unit?.logged_hours ?? '0');
  } else if (holdId !== null) {
    const hold = await queryOne<{ logged_hours: string | null }>('select logged_hours from holds where id = $1', [
      holdId,
    ]);
    loggedHours = Number(hold?.logged_hours ?? '0');
  }
  return {
    effectiveLumens: effectiveLumens(rated, ratedHours, loggedHours),
    nativeWidthPx: Number(row?.['native_width_px']),
    nativeHeightPx: Number(row?.['native_height_px']),
  };
}

route(
  'POST',
  '/api/layouts/:layoutId/placements',
  async (context) => {
    const layout = await requireLayout(context.params['layoutId'] as string);
    requireMatch(context, layout);
    const write = await readPlacement(context, layout.id, layout.siteId, null);
    await transact(async (client) => {
      await lockAtVersion(client, layout);
      await ensureBodyModel(client, write.model);
      await insertPlacement(client, layout.id, write);
      await commitLayoutWrite(client, layout.id);
    });
    const updated = await requireLayout(layout.id);
    return { status: 201, body: layoutView(updated), headers: { ETag: entityTag(updated) } };
  },
  { keyed: true, shape: PLACEMENT_SHAPE },
);

route(
  'PATCH',
  '/api/layouts/:layoutId/placements/:placementId',
  async (context) => {
    const layout = await requireLayout(context.params['layoutId'] as string);
    const placementId = context.params['placementId'] as string;
    const existing = layout.placements.find((placement) => placement.id === placementId);
    if (existing === undefined) throw problem('not_found');
    requireMatch(context, layout);
    const merged: Record<string, unknown> = { ...placementOf(existing), ...context.body };
    const write = await readPlacement({ ...context, body: merged }, layout.id, layout.siteId, existing);
    await transact(async (client) => {
      await lockAtVersion(client, layout);
      await ensureBodyModel(client, write.model);
      await updatePlacement(client, placementId, write);
      await commitLayoutWrite(client, layout.id);
    });
    const updated = await requireLayout(layout.id);
    return { status: 200, body: layoutView(updated), headers: { ETag: entityTag(updated) } };
  },
  { shape: PLACEMENT_SHAPE },
);

function placementOf(placement: PlacementRecord): Record<string, unknown> {
  return {
    bodySerial: placement.bodySerial,
    holdId: placement.holdId,
    model: placement.model,
    lensSerial: placement.lensSerial,
    aimAcross: { text: placement.aimAcross, unit: 'm' },
    aimDown: { text: placement.aimDown, unit: 'm' },
    bodyAcross: { text: placement.bodyAcross, unit: 'm' },
    bodyDown: { text: placement.bodyDown, unit: 'm' },
    standoff: { text: placement.standoff, unit: 'm' },
    ratio: placement.ratio,
    shiftAcrossPercent: placement.shiftAcrossPercent,
    shiftDownPercent: placement.shiftDownPercent,
    circuitId: placement.circuitId,
  };
}

route('DELETE', '/api/layouts/:layoutId/placements/:placementId', async (context) => {
  const layout = await requireLayout(context.params['layoutId'] as string);
  const placementId = context.params['placementId'] as string;
  if (!layout.placements.some((placement) => placement.id === placementId)) throw problem('not_found');
  requireMatch(context, layout);
  await transact(async (client) => {
    await lockAtVersion(client, layout);
    await client.query('delete from placements where id = $1', [placementId]);
    await commitLayoutWrite(client, layout.id);
  });
  const updated = await requireLayout(layout.id);
  return { status: 200, body: layoutView(updated), headers: { ETag: entityTag(updated) } };
});
