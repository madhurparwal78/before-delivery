import { createHash, randomUUID } from 'node:crypto';
import { query, queryOne, transact } from '../db/pool.js';
import { cellGround, cellOnWall, insertSite, listSiteViews, requireSite, siteView, sortedCellNames } from '../data/sites.js';
import { parseLocalShowTime } from '../domain/brussels.js';
import { compare, parseDecimal, toFixed } from '../domain/decimal.js';
import { threeDecimals } from '../domain/format.js';
import { normaliseSiteName } from '../domain/text.js';
import {
  AMBIENT_UNITS,
  LENGTH_SCALE,
  LENGTH_UNITS,
  ambientToLux,
  lengthToMetres,
  type AmbientUnit,
  type LengthUnit,
} from '../domain/units.js';
import { writeEvent } from '../events/outbox.js';
import { fieldCopy } from '../http/fields.js';
import { problem } from '../http/problem.js';
import { route } from '../http/server.js';
import { QUANTITY_SHAPE, Validation, readNumberText, readQuantity, readText, type Quantity } from '../http/validate.js';
import { type ImageFacts, readImageFacts, orientedSize, uprightRaster } from '../media/image.js';
import { encodeRgbPng } from '../media/png.js';
import {
  type PointPair,
  RESIDUAL_LIMIT_METRES,
  fitHomography,
  isDegenerate,
  renderTiles,
  residualMetres,
} from '../media/rectify.js';
import { announceWall } from '../data/layouts.js';
import { StoreUnreachable, getObject, putObject } from '../services/store.js';

const WIDTH_LOW = parseDecimal('1');
const WIDTH_HIGH = parseDecimal('100');
const HEIGHT_HIGH = parseDecimal('40');
const REFLECTANCE_HIGH = parseDecimal('1');
const RECESS_HIGH = parseDecimal('2');
const ZERO = parseDecimal('0');
const OFFSET_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function metresInRange(quantity: Quantity, high: typeof WIDTH_HIGH): boolean {
  const metres = lengthToMetres(quantity.value, quantity.unit as LengthUnit);
  return compare(metres, WIDTH_LOW) >= 0 && compare(metres, high) <= 0;
}

route(
  'GET',
  '/api/sites',
  async () => ({ status: 200, body: { items: await listSiteViews() } }),
);

route(
  'POST',
  '/api/sites',
  async (context) => {
    const check = new Validation();
    const name = readText(check, context.body, 'name');
    const width = readQuantity(check, context.body, 'width', LENGTH_UNITS, 'refused');
    const height = readQuantity(check, context.body, 'height', LENGTH_UNITS, 'refused');
    const showAtLocal = readText(check, context.body, 'showAtLocal');
    const site = name === null ? null : normaliseSiteName(name);
    if (site !== null && !site.ok) check.add('/name', fieldCopy.siteName);
    if (width !== null && !metresInRange(width, WIDTH_HIGH)) check.add('/width', fieldCopy.wallSize);
    if (height !== null && !metresInRange(height, HEIGHT_HIGH)) check.add('/height', fieldCopy.wallSize);
    const showAt = showAtLocal === null ? null : parseLocalShowTime(showAtLocal);
    if (showAtLocal !== null && showAt === null) check.add('/showAtLocal', fieldCopy.showTime);
    check.finish();
    const id = randomUUID();
    await transact(async (client) => {
      await insertSite(client, {
        id,
        name: (site as { value: string }).value,
        width: lengthToMetres((width as Quantity).value, (width as Quantity).unit as LengthUnit),
        height: lengthToMetres((height as Quantity).value, (height as Quantity).unit as LengthUnit),
        showAt: new Date(showAt as number),
        showAtLocal: showAtLocal as string,
        demo: false,
      });
    });
    return { status: 201, body: await siteView(await requireSite(id)) };
  },
  {
    keyed: true,
    shape: { name: true, width: QUANTITY_SHAPE, height: QUANTITY_SHAPE, showAtLocal: true },
  },
);

route('GET', '/api/sites/:siteId', async (context) => ({
  status: 200,
  body: await siteView(await requireSite(context.params['siteId'] as string)),
}));

route(
  'POST',
  '/api/sites/:siteId/photo',
  async (context) => {
    const site = await requireSite(context.params['siteId'] as string);
    const facts = readImageFacts(context.raw);
    if (facts === null) throw problem('photo_not_image');
    const sha256 = createHash('sha256').update(context.raw).digest('hex');
    const header = context.headers['x-file-name'];
    const fileName = typeof header === 'string' ? decodeURIComponent(header) : null;
    const key = `photos/${site.id}/${sha256}`;
    try {
      await putObject(key, context.raw, facts.type === 'jpeg' ? 'image/jpeg' : 'image/png');
    } catch (error) {
      if (error instanceof StoreUnreachable) throw problem('wall_store_unavailable');
      throw error;
    }
    const size = orientedSize(facts);
    await transact(async (client) => {
      await client.query(
        `update sites set photo_sha256 = $2, photo_bytes = $3, photo_file_name = $4, photo_width_px = $5,
           photo_height_px = $6, photo_orientation = $7, photo_key = $8,
           rectified = false, residual_metres = null, homography = null, tiles = null
         where id = $1`,
        [site.id, sha256, context.raw.length, fileName, size.widthPx, size.heightPx, facts.orientation, key],
      );
      await announceWall(client, site.id);
    });
    return {
      status: 201,
      body: {
        sha256,
        bytes: context.raw.length,
        fileName,
        widthPx: size.widthPx,
        heightPx: size.heightPx,
        orientation: facts.orientation,
        key,
      },
    };
  },
  { keyed: true, rawBody: true },
);

route('GET', '/api/sites/:siteId/photo', async (context) => {
  const site = await requireSite(context.params['siteId'] as string);
  if (site.photoKey === null) throw problem('not_found');
  const photo = await storedPhoto(site.photoKey);
  return {
    status: 200,
    raw: photo.bytes,
    contentType: photo.facts.type === 'png' ? 'image/png' : 'image/jpeg',
    headers: { ETag: `"${site.photoSha256 as string}"` },
  };
});

route('GET', '/api/sites/:siteId/photo/upright', async (context) => {
  const site = await requireSite(context.params['siteId'] as string);
  if (site.photoKey === null) throw problem('not_found');
  const photo = await storedPhoto(site.photoKey);
  const raster = uprightRaster(photo.bytes, photo.facts);
  return {
    status: 200,
    raw: encodeRgbPng(raster.width, raster.height, raster.rgba),
    contentType: 'image/png',
  };
});

async function readPhoto(key: string): Promise<Buffer> {
  try {
    const bytes = await getObject(key);
    if (bytes === null) throw problem('not_found');
    return bytes;
  } catch (error) {
    if (error instanceof StoreUnreachable) throw problem('wall_store_unavailable');
    throw error;
  }
}

/** The stored original, whose type was judged by content when it was kept. */
async function storedPhoto(key: string): Promise<{ readonly bytes: Buffer; readonly facts: ImageFacts }> {
  const bytes = await readPhoto(key);
  return { bytes, facts: readImageFacts(bytes) as ImageFacts };
}

interface PointInput {
  readonly pixel: { readonly x: unknown; readonly y: unknown };
  readonly wall: Record<string, unknown>;
}

function readPoint(
  check: Validation,
  raw: unknown,
  pointer: string,
  widthPx: number,
  heightPx: number,
): PointPair | null {
  if (raw === null || typeof raw !== 'object') {
    check.add(pointer, fieldCopy.required);
    return null;
  }
  const input = raw as PointInput;
  const pixel = input.pixel ?? { x: undefined, y: undefined };
  const x = typeof pixel.x === 'number' ? pixel.x : Number.NaN;
  const y = typeof pixel.y === 'number' ? pixel.y : Number.NaN;
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > widthPx || y > heightPx) {
    check.add(`${pointer}/pixel`, fieldCopy.pixel);
  }
  const wall = (input.wall ?? {}) as Record<string, unknown>;
  const across = readQuantity(check, wall, 'across', LENGTH_UNITS, 'refused');
  const down = readQuantity(check, wall, 'down', LENGTH_UNITS, 'refused');
  if (across === null || down === null || check.failed) return null;
  return {
    pixelX: x,
    pixelY: y,
    across: Number(toFixed(lengthToMetres(across.value, across.unit as LengthUnit), LENGTH_SCALE)),
    down: Number(toFixed(lengthToMetres(down.value, down.unit as LengthUnit), LENGTH_SCALE)),
  };
}

route(
  'POST',
  '/api/sites/:siteId/rectification',
  async (context) => {
    const site = await requireSite(context.params['siteId'] as string);
    if (site.photoKey === null) throw problem('photo_missing');
    const check = new Validation();
    const raw = context.body['points'];
    const points = Array.isArray(raw) ? raw : [];
    if (points.length !== 4 || context.body['check'] === undefined) check.add('/points', fieldCopy.pointCount);
    check.finish();
    const widthPx = site.photoWidthPx as number;
    const heightPx = site.photoHeightPx as number;
    const pairs: PointPair[] = [];
    for (const [index, point] of points.entries()) {
      const pair = readPoint(check, point, `/points/${index}`, widthPx, heightPx);
      if (pair !== null) pairs.push(pair);
    }
    const checkPair = readPoint(check, context.body['check'], '/check', widthPx, heightPx);
    check.finish();
    if (isDegenerate(pairs)) throw problem('points_degenerate');
    const homography = fitHomography(pairs);
    if (homography === null) throw problem('points_degenerate');
    const residual = residualMetres(homography, checkPair as PointPair);
    if (residual > RESIDUAL_LIMIT_METRES) {
      throw problem('residual_too_high', { placeholders: { residual: threeDecimals(residual) } });
    }
    const photo = await storedPhoto(site.photoKey);
    const raster = uprightRaster(photo.bytes, photo.facts);
    const tiles = renderTiles(raster, homography, Number(site.widthMetres), Number(site.heightMetres));
    const keys: string[] = [];
    try {
      for (const tile of tiles) {
        const key = `tiles/${site.id}/${site.photoSha256 as string}/${tile.key}.png`;
        await putObject(key, tile.png, 'image/png');
        keys.push(key);
      }
    } catch (error) {
      if (error instanceof StoreUnreachable) throw problem('wall_store_unavailable');
      throw error;
    }
    await transact(async (client) => {
      await client.query(
        `update sites set rectified = true, residual_metres = $2, homography = $3::jsonb, tiles = $4::jsonb where id = $1`,
        [site.id, threeDecimals(residual), JSON.stringify(homography), JSON.stringify(keys)],
      );
      await announceWall(client, site.id);
    });
    return { status: 200, body: { residualMetres: threeDecimals(residual), homography, tiles: keys } };
  },
  {
    shape: {
      points: { pixel: { x: true, y: true }, wall: { across: QUANTITY_SHAPE, down: QUANTITY_SHAPE } },
      check: { pixel: { x: true, y: true }, wall: { across: QUANTITY_SHAPE, down: QUANTITY_SHAPE } },
    },
  },
);

route('GET', '/api/sites/:siteId/cells', async (context) => {
  const site = await requireSite(context.params['siteId'] as string);
  const view = await siteView(site);
  const ground = await cellGround(site.id);
  const items = sortedCellNames(site.columns, site.rows).map((name) => {
    const record = ground.get(name);
    return {
      cell: name,
      ambientLux: record?.ambientLux ?? null,
      reflectance: record?.reflectance ?? null,
      recessMetres: record?.recessMetres ?? null,
      readingCount: record?.readingCount ?? 0,
    };
  });
  return { status: 200, body: { columns: site.columns, rows: site.rows, stale: view.stale, items } };
});

route(
  'PATCH',
  '/api/sites/:siteId/cells/:cell',
  async (context) => {
    const site = await requireSite(context.params['siteId'] as string);
    const cell = context.params['cell'] as string;
    if (!cellOnWall(cell, site.columns, site.rows)) throw problem('not_found');
    const check = new Validation();
    const reflectance = context.body['reflectance'];
    const recess = context.body['recess'] === undefined ? null : readQuantity(check, context.body, 'recess', LENGTH_UNITS, 'refused');
    let reflectanceText: string | null = null;
    if (reflectance !== undefined) {
      const parsed = readNumberText(check, context.body, 'reflectance', 'refused');
      if (parsed !== null) {
        if (compare(parsed.value, ZERO) <= 0 || compare(parsed.value, REFLECTANCE_HIGH) > 0) {
          check.add('/reflectance', fieldCopy.reflectance);
        } else {
          reflectanceText = toFixed(parsed.value, LENGTH_SCALE);
        }
      }
    }
    let recessText: string | null = null;
    if (recess !== null) {
      const metres = lengthToMetres(recess.value, recess.unit as LengthUnit);
      if (compare(metres, ZERO) < 0 || compare(metres, RECESS_HIGH) > 0) check.add('/recess', fieldCopy.recess);
      else recessText = toFixed(metres, LENGTH_SCALE);
    }
    if (reflectanceText === null && recessText === null && !check.failed) check.add('/reflectance', fieldCopy.required);
    check.finish();
    await query(
      `update cells set reflectance = coalesce($3, reflectance), recess_metres = coalesce($4, recess_metres)
       where site_id = $1 and cell = $2`,
      [site.id, cell, reflectanceText, recessText],
    );
    const ground = await cellGround(site.id);
    const record = ground.get(cell);
    return {
      status: 200,
      body: {
        cell,
        ambientLux: record?.ambientLux ?? null,
        reflectance: record?.reflectance,
        recessMetres: record?.recessMetres,
        readingCount: record?.readingCount ?? 0,
      },
    };
  },
  { shape: { reflectance: true, recess: QUANTITY_SHAPE } },
);

interface SyncResult {
  readonly operationId: string;
  readonly status: 'applied' | 'duplicate' | 'rejected' | 'conflict';
  readonly code?: string;
  readonly errors?: Record<string, string>;
  readonly readingId?: string;
}

route(
  'POST',
  '/api/sites/:siteId/readings/sync',
  async (context) => {
    const site = await requireSite(context.params['siteId'] as string);
    const raw = context.body['operations'];
    const operations = Array.isArray(raw) ? raw : [];
    if (operations.length < 1 || operations.length > 500) {
      throw problem('validation_failed', { extensions: { errors: { '/operations': fieldCopy.operations } } });
    }
    const results: SyncResult[] = [];
    for (const operation of operations) {
      results.push(await applyOperation(site.id, site.columns, site.rows, operation));
    }
    return { status: 200, body: { results } };
  },
  {
    shape: {
      operations: { operationId: true, cell: true, value: QUANTITY_SHAPE, capturedAt: true },
    },
  },
);

async function applyOperation(
  siteId: string,
  columns: number,
  rows: number,
  raw: unknown,
): Promise<SyncResult> {
  const operation = (raw ?? {}) as Record<string, unknown>;
  const operationId = typeof operation['operationId'] === 'string' ? operation['operationId'] : '';
  const check = new Validation();
  if (operationId === '') check.add('/operationId', fieldCopy.required);
  const cell = typeof operation['cell'] === 'string' ? operation['cell'] : '';
  if (cell === '' || !cellOnWall(cell, columns, rows)) check.add('/cell', fieldCopy.cell);
  const value = readQuantity(check, operation, 'value', AMBIENT_UNITS, 'allowed');
  if (value !== null && compare(value.value, ZERO) < 0) check.add('/value/text', fieldCopy.belowZero);
  const capturedAt = typeof operation['capturedAt'] === 'string' ? operation['capturedAt'] : '';
  if (!OFFSET_INSTANT.test(capturedAt) || Number.isNaN(Date.parse(capturedAt))) {
    check.add('/capturedAt', fieldCopy.readingTime);
  }
  if (check.failed) {
    return { operationId, status: 'rejected', code: 'validation_failed', errors: check.collected() };
  }
  const quantity = value as Quantity;
  const captured = new Date(capturedAt);
  const existing = await queryOne<{ id: string; cell: string; entered_text: string; entered_unit: string; captured_at: Date }>(
    'select id, cell, entered_text, entered_unit, captured_at from readings where operation_id = $1',
    [operationId],
  );
  if (existing !== null) {
    const same =
      existing.cell === cell &&
      existing.entered_text === quantity.text &&
      existing.entered_unit === quantity.unit &&
      existing.captured_at.getTime() === captured.getTime();
    return same
      ? { operationId, status: 'duplicate', readingId: existing.id }
      : { operationId, status: 'conflict', code: 'operation_id_reused' };
  }
  return transact(async (client) => {
    const ground = await client.query('select reflectance from cells where site_id = $1 and cell = $2', [siteId, cell]);
    const reflectance = parseDecimal(ground.rows[0]?.['reflectance'] as string);
    const lux = ambientToLux(quantity.value, quantity.unit as AmbientUnit, reflectance);
    const acceptedAt = new Date();
    const countedAt = captured.getTime() > acceptedAt.getTime() ? acceptedAt : captured;
    const id = randomUUID();
    const inserted = await client.query(
      `insert into readings (id, operation_id, site_id, cell, entered_text, entered_unit, canonical_lux, captured_at, counted_at, accepted_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       on conflict (operation_id) do nothing
       returning id`,
      [
        id,
        operationId,
        siteId,
        cell,
        quantity.text,
        quantity.unit,
        toFixed(lux, 6),
        captured.toISOString(),
        countedAt.toISOString(),
        acceptedAt.toISOString(),
      ],
    );
    if (inserted.rows.length === 0) {
      const settled = await client.query(
        'select id, cell, entered_text, entered_unit, captured_at from readings where operation_id = $1',
        [operationId],
      );
      const row = settled.rows[0] as Record<string, unknown>;
      const same =
        row['cell'] === cell &&
        row['entered_text'] === quantity.text &&
        row['entered_unit'] === quantity.unit &&
        (row['captured_at'] as Date).getTime() === captured.getTime();
      return same
        ? { operationId, status: 'duplicate' as const, readingId: row['id'] as string }
        : { operationId, status: 'conflict' as const, code: 'operation_id_reused' };
    }
    await writeEvent(client, 'reading.accepted', siteId, {
      readingId: id,
      cell,
      canonicalLux: toFixed(lux, 6),
    });
    return { operationId, status: 'applied' as const, readingId: id };
  });
}

route('GET', '/api/sites/:siteId/cells/:cell/readings', async (context) => {
  const site = await requireSite(context.params['siteId'] as string);
  const cell = context.params['cell'] as string;
  if (!cellOnWall(cell, site.columns, site.rows)) throw problem('not_found');
  const rows = await query(
    `select * from readings where site_id = $1 and cell = $2 order by counted_at desc, accepted_at desc`,
    [site.id, cell],
  );
  return {
    status: 200,
    body: {
      items: rows.map((row, index) => ({
        id: row['id'],
        operationId: row['operation_id'],
        cell: row['cell'],
        entered: { text: row['entered_text'], unit: row['entered_unit'] },
        canonicalLux: row['canonical_lux'],
        capturedAt: (row['captured_at'] as Date).toISOString(),
        countedAt: (row['counted_at'] as Date).toISOString(),
        acceptedAt: (row['accepted_at'] as Date).toISOString(),
        counts: index === 0,
      })),
    },
  };
});
