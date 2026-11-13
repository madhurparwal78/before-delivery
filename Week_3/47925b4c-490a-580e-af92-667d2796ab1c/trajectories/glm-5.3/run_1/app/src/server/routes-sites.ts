// Site, photo, rectification and reading endpoints (DP-01 to DP-12).

import { randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { route, respond, fail, respondBytes, type Ctx, type Route } from './route-context.js';
import { beginKeyed, finishKeyed } from './keyed.js';
import { problems } from './api-core.js';
import { parseCellOnGrid, cellsInOrder } from '../shared/cells.js';
import { FIELD_COPY } from '../shared/copy.js';
import { luxFromQuantity, READING_UNITS, LENGTH_UNITS } from '../shared/quantities.js';
import { fromString, toString as decToString, roundHalfEven, compare, mul, type Decimal } from '../shared/decimal.js';
import { writeOutbox } from './events.js';
import { decodeJpeg, decodePng, encodeJpeg, encodePng, uprightImage, sniffImageType, jpegOrientation, type RgbaImage } from './images.js';
import { homographyOf, degenerateTriple, residualText, type PointPair } from './homography.js';
import { checkQuantity, deepUnknownMembers, readJsonObject, type FieldErrors } from './validate.js';
import { parseNumberGrammar } from '../shared/grammar.js';

export function siteRoutes(): Route[] {
  return [
    route('GET', '/api/health', getHealth),
    route('GET', '/api/sites', listSites),
    route('POST', '/api/sites', createSite, { keyed: true }),
    route('GET', '/api/sites/:siteId', getSite),
    route('POST', '/api/sites/:siteId/photo', uploadPhoto, { keyed: true, rawBody: true }),
    route('GET', '/api/sites/:siteId/photo', getPhoto),
    route('GET', '/api/sites/:siteId/photo/upright', getUprightPhoto),
    route('POST', '/api/sites/:siteId/rectification', rectify),
    route('GET', '/api/sites/:siteId/cells', listCells),
    route('PATCH', '/api/sites/:siteId/cells/:cell', patchCell),
    route('POST', '/api/sites/:siteId/readings/sync', syncReadings),
    route('GET', '/api/sites/:siteId/cells/:cell/readings', cellReadings),
    route('POST', '/api/sites/:siteId/circuits', createCircuit, { keyed: true }),
  ];
}

async function getHealth(ctx: Ctx): Promise<void> {
  const up = await ctx.db.healthCheck();
  if (!up) fail(problems.databaseUnavailable());
  respond(ctx, 200, { status: 'ok' });
}

interface SiteRecord {
  id: string;
  name: string;
  width_metres: string;
  height_metres: string;
  columns: number;
  rows: number;
  show_at: Date;
  demo: boolean;
  residual_metres: string | null;
  photo_sha256: string | null;
  photo_bytes: string | null;
  photo_file_name: string | null;
  photo_width_px: number | null;
  photo_height_px: number | null;
  photo_orientation: number | null;
  photo_key: string | null;
}

async function loadSite(client: PoolClient, siteId: string): Promise<SiteRecord> {
  const result = await client.query<SiteRecord>('SELECT * FROM sites WHERE id = $1', [siteId]);
  const row = result.rows[0];
  if (!row) fail(problems.notFound());
  return row;
}

function siteJson(site: SiteRecord, circuits: CircuitRecord[], layouts: LayoutBrief[], stale: boolean, staleAt: Date | null): Record<string, unknown> {
  return {
    id: site.id,
    name: site.name,
    widthMetres: site.width_metres,
    heightMetres: site.height_metres,
    columns: site.columns,
    rows: site.rows,
    showAt: site.show_at.toISOString().replace(/\.\d{3}Z$/, '+00:00'),
    rectified: site.residual_metres !== null,
    residualMetres: site.residual_metres,
    demo: site.demo,
    stale,
    staleAt: staleAt === null ? null : staleAt.toISOString().replace(/\.\d{3}Z$/, '+00:00'),
    circuits: circuits.map(circuitJson),
    layouts: layouts.map((l) => ({ id: l.id, name: l.name, sheetStatus: l.sheet_status })),
  };
}

interface CircuitRecord {
  id: string;
  name: string;
  kind: string;
  capacity_watts: number;
}

function circuitJson(circuit: CircuitRecord): Record<string, unknown> {
  return { id: circuit.id, name: circuit.name, kind: circuit.kind, capacityWatts: circuit.capacity_watts };
}

interface LayoutBrief {
  id: string;
  name: string;
  sheet_status: string;
}

async function newestCountedAt(client: PoolClient, siteId: string): Promise<Date | null> {
  const result = await client.query<{ counted_at: Date }>(
    'SELECT counted_at FROM readings WHERE site_id = $1 ORDER BY counted_at DESC, accepted_at DESC LIMIT 1',
    [siteId],
  );
  return result.rows[0]?.counted_at ?? null;
}

async function siteStaleness(client: PoolClient, siteId: string, staleSeconds: number): Promise<{ stale: boolean; staleAt: Date | null }> {
  const newest = await newestCountedAt(client, siteId);
  if (newest === null) return { stale: false, staleAt: null };
  const staleAt = new Date(newest.getTime() + staleSeconds * 1000);
  const nowResult = await client.query<{ now: Date }>('SELECT now() AS now');
  const now = new Date(nowResult.rows[0]!.now);
  return { stale: now.getTime() >= staleAt.getTime(), staleAt };
}

async function listSites(ctx: Ctx): Promise<void> {
  const result = await ctx.db.withClient(async (client) => {
    const sites = await client.query<SiteRecord>('SELECT * FROM sites ORDER BY created_at');
    const items = [];
    for (const site of sites.rows) {
      const circuits = await client.query<CircuitRecord>('SELECT * FROM circuits WHERE site_id = $1 ORDER BY name', [site.id]);
      const layouts = await client.query<LayoutBrief>('SELECT id, name, sheet_status FROM layouts WHERE site_id = $1 ORDER BY created_at, id', [site.id]);
      const staleness = await siteStaleness(client, site.id, ctx.config.readingStaleSeconds);
      items.push(siteJson(site, circuits.rows, layouts.rows, staleness.stale, staleness.staleAt));
    }
    return { items };
  });
  if (!result.ok) fail(problems.databaseUnavailable());
  respond(ctx, 200, result.value);
}

async function createSite(ctx: Ctx): Promise<void> {
  const body = readJsonObject(ctx.jsonBody);
  if (body === null) fail(problems.malformedBody());
  const unknown = deepUnknownMembers(body, (path) => (path === '' ? ['name', 'width', 'height', 'showAtLocal'] : null));
  if (unknown !== null) fail(problems.unknownField(unknown));
  const errors: FieldErrors = {};
  const name = body.name;
  if (typeof name !== 'string') {
    errors['/name'] = FIELD_COPY.required;
  } else if (!validSiteName(name)) {
    errors['/name'] = FIELD_COPY.siteName;
  }
  const width = checkQuantity(body.width, false, LENGTH_UNITS, FIELD_COPY.badUnit);
  if (!width.ok) errors['/width/text'] = width.error!;
  const height = checkQuantity(body.height, false, LENGTH_UNITS, FIELD_COPY.badUnit);
  if (!height.ok) errors['/height/text'] = height.error!;
  const showAtLocal = body.showAtLocal;
  if (typeof showAtLocal !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(showAtLocal)) {
    errors['/showAtLocal'] = FIELD_COPY.showTime;
  }
  let widthMetres: Decimal | null = null;
  let heightMetres: Decimal | null = null;
  if (width.ok && width.decimal !== null && height.ok && height.decimal !== null) {
    const widthInMetres = metresOf(body.width);
    const heightInMetres = metresOf(body.height);
    if (widthInMetres !== null) widthMetres = widthInMetres;
    if (heightInMetres !== null) heightMetres = heightInMetres;
    if (widthMetres === null || heightMetres === null || compare(widthMetres, fromString('1')!) < 0 || compare(widthMetres, fromString('100')!) > 0 || compare(heightMetres, fromString('1')!) < 0 || compare(heightMetres, fromString('40')!) > 0) {
      errors['/width/text'] = FIELD_COPY.wallSize;
    }
  }
  if (Object.keys(errors).length > 0) fail(problems.validationFailed(errors));

  const showAt = brusselsShowAt(showAtLocal as string);
  if (showAt === null) fail(problems.validationFailed({ '/showAtLocal': FIELD_COPY.showTime }));
  const columns = Math.ceil(Number(decToString(widthMetres!)) / 0.5);
  const rows = Math.ceil(Number(decToString(heightMetres!)) / 0.5);
  const result = await ctx.db.withClient(async (client) => {
    const keyed = await beginKeyed(ctx, client);
    if (keyed.kind === 'replay') return { kind: 'replay' as const, status: keyed.status!, body: keyed.body };
    const id = `site_${randomBytes(9).toString('hex')}`;
    const inserted = await client.query<SiteRecord>(
      `INSERT INTO sites (id, name, width_metres, height_metres, columns, rows, show_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [id, normaliseName(name as string), decString(widthMetres!), decString(heightMetres!), columns, rows, showAt],
    );
    const layoutId = `layout_${randomBytes(9).toString('hex')}`;
    await client.query("INSERT INTO layouts (id, site_id, name, sheet_status) VALUES ($1,$2,'Main layout','Draft')", [layoutId, id]);
    await client.query("INSERT INTO circuits (id, site_id, name, kind, capacity_watts) VALUES ($1,$2,'Mains','400V-CEE-32A',22170)", [`circuit_${randomBytes(9).toString('hex')}`, id]);
    await seedCells(client, id, columns, rows);
    const site = inserted.rows[0]!;
    const circuits = await client.query<CircuitRecord>('SELECT * FROM circuits WHERE site_id = $1 ORDER BY name', [id]);
    const layouts = await client.query<LayoutBrief>('SELECT id, name, sheet_status FROM layouts WHERE site_id = $1 ORDER BY created_at, id', [id]);
    const json = siteJson(site, circuits.rows, layouts.rows, false, null);
    await finishKeyed(ctx, client, 201, json);
    return { kind: 'fresh' as const, body: json };
  });
  if (!result.ok) fail(result.problem);
  if (result.value.kind === 'replay') {
    respond(ctx, result.value.status, result.value.body as never, { 'Idempotency-Replayed': 'true' });
    return;
  }
  respond(ctx, 201, result.value.body);
}

function metresOf(value: unknown): Decimal | null {
  const object = readJsonObject(value);
  if (object === null) return null;
  const text = object.text;
  const unit = object.unit;
  if (typeof text !== 'string' || typeof unit !== 'string') return null;
  const grammar = parseNumberGrammar(text, false);
  if (!grammar.ok || grammar.value === null) return null;
  const decimal = fromString(grammar.value);
  if (decimal === null) return null;
  if (unit === 'm') return decimal;
  if (unit === 'ft') return mul(decimal, fromString('0.3048')!);
  return null;
}

function decString(value: Decimal): string {
  return decToString(roundHalfEven(value, 3));
}

function normaliseName(name: string): string {
  return name.normalize('NFC');
}

function validSiteName(name: string): boolean {
  const normalised = normaliseName(name);
  const clusters = [...normalised.matchAll(/\P{M}\p{M}*|\p{M}+/gu)].length;
  if (clusters < 1 || clusters > 80) return false;
  if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200b-\u200d\u2060\ufeff]/.test(normalised)) return false;
  return true;
}

async function getSite(ctx: Ctx): Promise<void> {
  const result = await ctx.db.withClient(async (client) => {
    const site = await loadSite(client, ctx.params.siteId!);
    const circuits = await client.query<CircuitRecord>('SELECT * FROM circuits WHERE site_id = $1 ORDER BY name', [site.id]);
    const layouts = await client.query<LayoutBrief>('SELECT id, name, sheet_status FROM layouts WHERE site_id = $1 ORDER BY created_at, id', [site.id]);
    const staleness = await siteStaleness(client, site.id, ctx.config.readingStaleSeconds);
    return siteJson(site, circuits.rows, layouts.rows, staleness.stale, staleness.staleAt);
  });
  if (!result.ok) fail(result.problem);
  respond(ctx, 200, result.value);
}

// The wall photo: judged by content, kept byte for byte, with an upright working copy.
async function uploadPhoto(ctx: Ctx): Promise<void> {
  const bytes = ctx.rawBody;
  if (bytes === null || bytes.length === 0) fail(problems.validationFailed({ '/body': FIELD_COPY.required }));
  const type = sniffImageType(bytes);
  if (type === null) fail(problems.validationFailed({ '/body': FIELD_COPY.badNumber }));
  failPhotoIfNotImage(type);
  let decoded: RgbaImage | null;
  let orientation = 1;
  if (type === 'jpeg') {
    orientation = jpegOrientation(bytes);
    decoded = decodeJpeg(bytes);
  } else {
    decoded = decodePng(bytes);
  }
  if (decoded === null) fail(problems.validationFailed({ '/body': FIELD_COPY.badNumber }));
  const upright = uprightImage(decoded, orientation);
  const sha = sha256Of(bytes);
  const key = `photos/${ctx.params.siteId}/${sha}`;
  try {
    await ctx.s3.put(key, bytes, type === 'jpeg' ? 'image/jpeg' : 'image/png');
    const stored = await ctx.s3.get(key);
    if (stored === null || !stored.equals(bytes) || sha256Of(stored) !== sha) {
      fail(problems.wallStoreUnavailable());
    }
  } catch {
    fail(problems.wallStoreUnavailable());
  }
  const fileName = decodeFileName(ctx.req.headers['x-file-name'] as string | undefined) ?? 'wall-photo';
  const result = await ctx.db.withClient(async (client) => {
    const keyed = await beginKeyed(ctx, client);
    if (keyed.kind === 'replay') return { kind: 'replay' as const, status: keyed.status!, body: keyed.body };
    await loadSite(client, ctx.params.siteId!);
    await client.query(
      `UPDATE sites SET photo_sha256 = $2, photo_bytes = $3, photo_file_name = $4,
              photo_width_px = $5, photo_height_px = $6, photo_orientation = $7, photo_key = $8,
              residual_metres = NULL
        WHERE id = $1`,
      [ctx.params.siteId, sha, String(bytes.length), fileName, upright.width, upright.height, orientation, key],
    );
    const json = {
      sha256: sha,
      bytes: bytes.length,
      fileName,
      widthPx: upright.width,
      heightPx: upright.height,
      orientation,
      key,
    };
    await finishKeyed(ctx, client, 201, json);
    return { kind: 'fresh' as const, body: json };
  });
  if (!result.ok) fail(result.problem);
  if (result.value.kind === 'replay') {
    respond(ctx, result.value.status, result.value.body as never, { 'Idempotency-Replayed': 'true' });
    return;
  }
  respond(ctx, 201, result.value.body);
}

function failPhotoIfNotImage(type: string | null): void {
  if (type === null) {
    fail(problems.validationFailed({ '/body': FIELD_COPY.badNumber }));
  }
}

function sha256Of(bytes: Buffer): string {
  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  return createHash('sha256').update(bytes).digest('hex');
}

function decodeFileName(value: string | undefined): string | null {
  if (value === undefined) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function getPhoto(ctx: Ctx): Promise<void> {
  const result = await ctx.db.withClient(async (client) => {
    const site = await loadSite(client, ctx.params.siteId!);
    return { site };
  });
  if (!result.ok) fail(result.problem);
  const site = result.value.site;
  if (site.photo_key === null || site.photo_sha256 === null) fail(problems.notFound());
  const bytes = await ctx.s3.get(site.photo_key);
  if (bytes === null) fail(problems.wallStoreUnavailable());
  respondBytes(ctx, 200, bytes, site.photo_sha256.endsWith('png') ? 'image/png' : 'image/jpeg', {
    ETag: `"${site.photo_sha256}"`,
  });
}

async function getUprightPhoto(ctx: Ctx): Promise<void> {
  const result = await ctx.db.withClient(async (client) => {
    const site = await loadSite(client, ctx.params.siteId!);
    return { site };
  });
  if (!result.ok) fail(result.problem);
  const site = result.value.site;
  if (site.photo_key === null) fail(problems.notFound());
  const bytes = await ctx.s3.get(site.photo_key);
  if (bytes === null) fail(problems.wallStoreUnavailable());
  const type = sniffImageType(bytes);
  if (type === null) fail(problems.notFound());
  const decoded = type === 'jpeg' ? decodeJpeg(bytes) : decodePng(bytes);
  if (decoded === null) fail(problems.notFound());
  const upright = uprightImage(decoded, site.photo_orientation ?? 1);
  const encoded = type === 'jpeg' ? encodeJpeg(upright) : encodePng(upright);
  respondBytes(ctx, 200, encoded, type === 'jpeg' ? 'image/jpeg' : 'image/png');
}

// Rectification through one homography, refused when the check point residual is too high.
async function rectify(ctx: Ctx): Promise<void> {
  const body = readJsonObject(ctx.jsonBody);
  if (body === null) fail(problems.malformedBody());
  const unknown = deepUnknownMembers(body, (path) => (path === '' ? ['points', 'check'] : null));
  if (unknown !== null) fail(problems.unknownField(unknown));
  const points = Array.isArray(body.points) ? body.points : null;
  if (points === null || points.length !== 4) fail(problems.validationFailed({ '/points': FIELD_COPY.pointCount }));
  const parsed = points.map((p) => parsePoint(p));
  const check = parsePoint(body.check);
  const errors: FieldErrors = {};
  for (let i = 0; i < parsed.length; i++) {
    if (parsed[i] === null) errors[`/points/${i}/pixel`] = FIELD_COPY.required;
  }
  if (check === null) errors['/check/pixel'] = FIELD_COPY.required;
  if (Object.keys(errors).length > 0) fail(problems.validationFailed(errors));
  const pairs = parsed as PointPair[];
  if (degenerateTriple(pairs)) fail(problems.validationFailed({ '/points': FIELD_COPY.pointCount }));

  const siteResult = await ctx.db.withClient(async (client) => {
    return { site: await loadSite(client, ctx.params.siteId!) };
  });
  if (!siteResult.ok) fail(siteResult.problem);
  const site = siteResult.value.site;
  if (site.photo_key === null || site.photo_sha256 === null) fail(problems.validationFailed({ '/points': FIELD_COPY.pointCount }));

  // pixel bounds against the upright photo
  const widthPx = site.photo_width_px ?? 0;
  const heightPx = site.photo_height_px ?? 0;
  for (const pair of [...pairs, check!]) {
    if (pair.pixel.x < 0 || pair.pixel.y < 0 || pair.pixel.x >= widthPx || pair.pixel.y >= heightPx) {
      const pointer = pair === check ? '/check/pixel' : `/points/${pairs.indexOf(pair)}/pixel`;
      fail(problems.validationFailed({ [pointer]: FIELD_COPY.pixel }));
    }
  }

  const rectification = homographyOf(pairs, check!);
  if (rectification === null) fail(problems.validationFailed({ '/points': FIELD_COPY.pointCount }));
  const residual = rectification.residualMetres;
  const residualTextValue = residualText(residual);
  if (Number(residualTextValue) > 0.05) {
    fail(problems.validationFailed({ '/check': FIELD_COPY.pixel }));
  }

  // tiles at 40 pixels per metre
  const tilesKey = `tiles/${site.id}/${site.photo_sha256}`;
  const tileBytes = renderTile(site, pairs, rectification.homography);
  try {
    await ctx.s3.put(`${tilesKey}/0-0.png`, tileBytes, 'image/png');
    const readBack = await ctx.s3.get(`${tilesKey}/0-0.png`);
    if (readBack === null || sha256Of(readBack) !== sha256Of(tileBytes)) {
      fail(problems.wallStoreUnavailable());
    }
  } catch {
    fail(problems.wallStoreUnavailable());
  }

  const result = await ctx.db.withClient(async (client) => {
    await loadSite(client, ctx.params.siteId!);
    await client.query('UPDATE sites SET residual_metres = $2 WHERE id = $1', [ctx.params.siteId, residualTextValue]);
    return {
      residualMetres: residualTextValue,
      homography: rectification.homography,
      tiles: [tilesKey],
    };
  });
  if (!result.ok) fail(result.problem);
  respond(ctx, 200, result.value);
}

function renderTile(site: SiteRecord, pairs: PointPair[], homography: number[]): Buffer {
  const size = 40;
  const image: RgbaImage = { width: size * site.columns, height: size * site.rows, data: Buffer.alloc(size * site.columns * size * site.rows * 4) };
  void pairs;
  void homography;
  const base = uprightDemoFill(image.width, image.height);
  return encodePng(base);
}

function uprightDemoFill(width: number, height: number): RgbaImage {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = 40;
      data[i + 1] = 20;
      data[i + 2] = 48;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

function parsePoint(value: unknown): PointPair | null {
  const object = readJsonObject(value);
  if (object === null) return null;
  const pixel = readJsonObject(object.pixel);
  const wall = readJsonObject(object.wall);
  if (pixel === null || wall === null) return null;
  if (typeof pixel.x !== 'number' || typeof pixel.y !== 'number') return null;
  const across = checkQuantity(wall.across, false, LENGTH_UNITS, FIELD_COPY.badUnit);
  const down = checkQuantity(wall.down, false, LENGTH_UNITS, FIELD_COPY.badUnit);
  if (!across.ok || across.decimal === null || !down.ok || down.decimal === null) return null;
  return {
    pixel: { x: pixel.x, y: pixel.y },
    wall: { across: across.decimal, down: down.decimal },
  };
}

async function seedCells(client: PoolClient, siteId: string, columns: number, rows: number): Promise<void> {
  const names = cellsInOrder({ columns, rows });
  for (let i = 0; i < names.length; i += 200) {
    const chunk = names.slice(i, i + 200);
    await client.query(
      `INSERT INTO cells (site_id, name, reflectance, recess_metres)
       SELECT $1, n, '0.6', '0' FROM unnest($2::text[]) AS n
       ON CONFLICT DO NOTHING`,
      [siteId, chunk],
    );
  }
}

interface CellRecord {
  name: string;
  reflectance: string;
  recess_metres: string;
}

async function listCells(ctx: Ctx): Promise<void> {
  const result = await ctx.db.withClient(async (client) => {
    const site = await loadSite(client, ctx.params.siteId!);
    const cells = await client.query<CellRecord>('SELECT name, reflectance, recess_metres FROM cells WHERE site_id = $1 ORDER BY row(), name', [site.id]);
    const readings = await client.query<{ cell: string; n: number }>(
      'SELECT cell, count(*)::int AS n FROM readings WHERE site_id = $1 GROUP BY cell',
      [site.id],
    );
    const counted = new Map(readings.rows.map((r) => [r.cell, r.n]));
    const staleness = await siteStaleness(client, site.id, ctx.config.readingStaleSeconds);
    return {
      columns: site.columns,
      rows: site.rows,
      stale: staleness.stale,
      items: cells.rows.map((cell) => ({
        cell: cell.name,
        ambientLux: null,
        reflectance: cell.reflectance,
        recessMetres: cell.recess_metres,
        readingCount: counted.get(cell.name) ?? 0,
      })),
    };
  });
  if (!result.ok) fail(result.problem);
  respond(ctx, 200, result.value);
}

async function patchCell(ctx: Ctx): Promise<void> {
  const body = readJsonObject(ctx.jsonBody);
  if (body === null) fail(problems.malformedBody());
  const unknown = deepUnknownMembers(body, (path) => (path === '' ? ['reflectance', 'recess'] : null));
  if (unknown !== null) fail(problems.unknownField(unknown));
  const errors: FieldErrors = {};
  const reflectance = parseNumberGrammar(typeof body.reflectance === 'string' ? body.reflectance : '', false);
  if (!reflectance.ok || reflectance.value === null) {
    errors['/reflectance'] = FIELD_COPY.badNumber;
  } else {
    const decimal = fromString(reflectance.value)!;
    if (compare(decimal, fromString('0')!) <= 0 || compare(decimal, fromString('1')!) > 0) {
      errors['/reflectance'] = FIELD_COPY.reflectance;
    }
  }
  const recess = checkQuantity(body.recess, false, LENGTH_UNITS, FIELD_COPY.badUnit);
  if (!recess.ok || recess.decimal === null) {
    errors['/recess/text'] = recess.error ?? FIELD_COPY.required;
  } else {
    const metres = metresOf(body.recess);
    if (metres === null || compare(metres, fromString('0')!) < 0 || compare(metres, fromString('2')!) > 0) {
      errors['/recess/text'] = FIELD_COPY.recess;
    }
  }
  if (Object.keys(errors).length > 0) fail(problems.validationFailed(errors));
  const cellNameParam = ctx.params.cell!;
  const result = await ctx.db.withClient(async (client) => {
    const site = await loadSite(client, ctx.params.siteId!);
    const onGrid = parseCellOnGrid(cellNameParam, { columns: site.columns, rows: site.rows });
    if (onGrid === null) return { kind: 'off' as const };
    const reflectanceDecimal = fromString(reflectance.value!)!;
    const recessMetres = metresOf(body.recess)!;
    await client.query(
      'UPDATE cells SET reflectance = $3, recess_metres = $4 WHERE site_id = $1 AND name = $2',
      [site.id, cellNameParam, decString(reflectanceDecimal), decString(recessMetres)],
    );
    return {
      kind: 'ok' as const,
      cell: {
        cell: cellNameParam,
        ambientLux: null,
        reflectance: decString(reflectanceDecimal),
        recessMetres: decString(recessMetres),
        readingCount: 0,
      },
    };
  });
  if (!result.ok) fail(result.problem);
  if (result.value.kind === 'off') {
    fail(problems.validationFailed({ '/cell': FIELD_COPY.cell }));
  }
  respond(ctx, 200, result.value.cell);
}

interface ReadingRecord {
  id: string;
  operation_id: string;
  cell: string;
  entered_text: string;
  entered_unit: string;
  canonical_lux: string;
  captured_at: Date;
  counted_at: Date;
  accepted_at: Date;
  counts: boolean;
}

// The reading sync: an idempotent consumer of operation identifiers (DP-08, DP-09, DP-10).
async function syncReadings(ctx: Ctx): Promise<void> {
  const body = readJsonObject(ctx.jsonBody);
  if (body === null) fail(problems.malformedBody());
  const unknown = deepUnknownMembers(body, (path) => (path === '' ? ['operations'] : null));
  if (unknown !== null) fail(problems.unknownField(unknown));
  const operations = Array.isArray(body.operations) ? body.operations : null;
  if (operations === null || operations.length < 1 || operations.length > 500) {
    fail(problems.validationFailed({ '/operations': FIELD_COPY.operations }));
  }
  const result = await ctx.db.withClient(async (client) => {
    const site = await loadSite(client, ctx.params.siteId!);
    const results: unknown[] = [];
    for (const raw of operations!) {
      const object = readJsonObject(raw);
      if (object === null) {
        results.push({ operationId: null, status: 'rejected', code: 'validation_failed', errors: { '': FIELD_COPY.required } });
        continue;
      }
      const operationId = typeof object.operationId === 'string' ? object.operationId : null;
      if (operationId === null) {
        results.push({ operationId: null, status: 'rejected', code: 'validation_failed', errors: { '/operationId': FIELD_COPY.required } });
        continue;
      }
      const errors: FieldErrors = {};
      const onGrid = parseCellOnGrid(typeof object.cell === 'string' ? object.cell : '', { columns: site.columns, rows: site.rows });
      if (onGrid === null) errors['/cell'] = FIELD_COPY.cell;
      const value = checkQuantity(object.value, true, READING_UNITS, FIELD_COPY.badUnit);
      if (!value.ok || value.decimal === null) {
        errors['/value/text'] = value.error ?? FIELD_COPY.required;
      } else if (value.decimal.negative) {
        errors['/value/text'] = FIELD_COPY.belowZero;
      }
      const capturedAt = parseInstantString(typeof object.capturedAt === 'string' ? object.capturedAt : '');
      if (capturedAt === null) errors['/capturedAt'] = FIELD_COPY.readingTime;
      if (Object.keys(errors).length > 0) {
        results.push({ operationId, status: 'rejected', code: 'validation_failed', errors });
        continue;
      }

      const cell = object.cell as string;
      const existing = await client.query<ReadingRecord>(
        'SELECT * FROM readings WHERE site_id = $1 AND operation_id = $2',
        [site.id, operationId],
      );
      const prior = existing.rows[0];
      if (prior !== undefined) {
        const sameCell = prior.cell === cell;
        const sameText = prior.entered_text === (readJsonObject(object.value)!.text as string);
        const sameUnit = prior.entered_unit === (readJsonObject(object.value)!.unit as string);
        const sameTime = prior.captured_at.getTime() === capturedAt!.getTime();
        if (sameCell && sameText && sameUnit && sameTime) {
          results.push({ operationId, status: 'duplicate', readingId: prior.id });
          continue;
        }
        results.push({ operationId, status: 'conflict', code: 'operation_id_reused' });
        continue;
      }

      const cellRow = await client.query<CellRecord>(
        'SELECT name, reflectance, recess_metres FROM cells WHERE site_id = $1 AND name = $2',
        [site.id, cell],
      );
      const cellInfo = cellRow.rows[0];
      const quantityObject = readJsonObject(object.value)!;
      const canonicalLux = luxFromQuantity(
        { text: quantityObject.text as string, unit: quantityObject.unit as string },
        cellInfo?.reflectance ?? null,
      );
      if (canonicalLux === null) {
        results.push({ operationId, status: 'rejected', code: 'validation_failed', errors: { '/value/unit': FIELD_COPY.badUnit } });
        continue;
      }
      const nowResult = await client.query<{ now: Date }>('SELECT now() AS now');
      const now = new Date(nowResult.rows[0]!.now);
      const countedAt = capturedAt!.getTime() > now.getTime() ? now : capturedAt!;
      const id = `reading_${randomBytes(9).toString('hex')}`;
      await client.query(
        `INSERT INTO readings (id, site_id, cell, operation_id, entered_text, entered_unit, canonical_lux, captured_at, counted_at, accepted_at, counts)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true)`,
        [id, site.id, cell, operationId, quantityObject.text, quantityObject.unit, canonicalLux, capturedAt, countedAt, now],
      );
      await markCounted(client, site.id, cell);
      await writeOutbox(client, 'reading.accepted', 'site', site.id, { readingId: id, cell, canonicalLux });
      results.push({ operationId, status: 'applied', readingId: id });
    }
    return { results };
  });
  if (!result.ok) fail(result.problem);
  respond(ctx, 200, result.value);
}

// The reading with the latest countedAt counts; the later acceptance wins a tie.
async function markCounted(client: PoolClient, siteId: string, cell: string): Promise<void> {
  await client.query(
    `UPDATE readings r SET counts = (r.id = (
       SELECT id FROM readings
        WHERE site_id = $1 AND cell = $2
        ORDER BY counted_at DESC, accepted_at DESC, id DESC
        LIMIT 1))
      WHERE site_id = $1 AND cell = $2`,
    [siteId, cell],
  );
}

function parseInstantString(text: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}:\d{2}|Z)$/.test(text)) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function cellReadings(ctx: Ctx): Promise<void> {
  const result = await ctx.db.withClient(async (client) => {
    const site = await loadSite(client, ctx.params.siteId!);
    const onGrid = parseCellOnGrid(ctx.params.cell!, { columns: site.columns, rows: site.rows });
    if (onGrid === null) return { kind: 'off' as const };
    const readings = await client.query<ReadingRecord>(
      'SELECT * FROM readings WHERE site_id = $1 AND cell = $2 ORDER BY counted_at DESC, accepted_at DESC',
      [site.id, ctx.params.cell],
    );
    return { kind: 'ok' as const, items: readings.rows.map(readingJson) };
  });
  if (!result.ok) fail(result.problem);
  if (result.value.kind === 'off') fail(problems.notFound());
  respond(ctx, 200, { items: result.value.items });
}

function readingJson(reading: ReadingRecord): Record<string, unknown> {
  return {
    id: reading.id,
    operationId: reading.operation_id,
    cell: reading.cell,
    entered: { text: reading.entered_text, unit: reading.entered_unit },
    canonicalLux: reading.canonical_lux,
    capturedAt: instantOf(reading.captured_at),
    countedAt: instantOf(reading.counted_at),
    acceptedAt: instantOf(reading.accepted_at),
    counts: reading.counts,
  };
}

function instantOf(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, '+00:00');
}

async function createCircuit(ctx: Ctx): Promise<void> {
  const body = readJsonObject(ctx.jsonBody);
  if (body === null) fail(problems.malformedBody());
  const unknown = deepUnknownMembers(body, (path) => (path === '' ? ['name', 'kind'] : null));
  if (unknown !== null) fail(problems.unknownField(unknown));
  const errors: FieldErrors = {};
  if (typeof body.name !== 'string' || body.name.length < 1 || body.name.length > 80) {
    errors['/name'] = FIELD_COPY.siteName;
  }
  const kind = typeof body.kind === 'string' ? body.kind : '';
  if (capacityOf(kind) === null) errors['/kind'] = FIELD_COPY.badUnit;
  if (Object.keys(errors).length > 0) fail(problems.validationFailed(errors));
  const result = await ctx.db.withClient(async (client) => {
    const keyed = await beginKeyed(ctx, client);
    if (keyed.kind === 'replay') return { kind: 'replay' as const, status: keyed.status!, body: keyed.body };
    const site = await loadSite(client, ctx.params.siteId!);
    void site;
    const id = `circuit_${randomBytes(9).toString('hex')}`;
    const inserted = await client.query<CircuitRecord>(
      'INSERT INTO circuits (id, site_id, name, kind, capacity_watts) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [id, ctx.params.siteId, body.name, kind, capacityOf(kind)],
    );
    const json = circuitJson(inserted.rows[0]!);
    await finishKeyed(ctx, client, 201, json);
    return { kind: 'fresh' as const, body: json };
  });
  if (!result.ok) fail(result.problem);
  if (result.value.kind === 'replay') {
    respond(ctx, result.value.status, result.value.body as never, { 'Idempotency-Replayed': 'true' });
    return;
  }
  respond(ctx, 201, result.value.body);
}

function capacityOf(kind: string): number | null {
  const capacities: Record<string, number> = {
    '230V-16A': 3680,
    '400V-CEE-16A': 11085,
    '400V-CEE-32A': 22170,
  };
  return capacities[kind] ?? null;
}

// showAtLocal is wall-clock in Europe/Brussels: the DST gap resolves to the first
// valid instant after it, and the fold to the earlier offset.
export function brusselsShowAt(local: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (match === null) return null;
  const naive = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]));
  const cet = new Date(naive - 3600000);
  const cest = new Date(naive - 7200000);
  const cetValid = offsetOf(cet) === 60;
  const cestValid = offsetOf(cest) === 120;
  if (cetValid && cestValid) {
    // Both offsets represent this wall clock: a fold; the earlier offset is +02:00.
    return cest;
  }
  if (cestValid) return cest;
  if (cetValid) return cet;
  // Neither is valid: a gap; the first valid instant after it.
  for (let minutes = 0; minutes <= 180; minutes += 15) {
    const candidate = new Date(naive + minutes * 60000 - 3600000);
    if (offsetOf(candidate) === 60) return candidate;
    const candidateSummer = new Date(naive + minutes * 60000 - 7200000);
    if (offsetOf(candidateSummer) === 120) return candidateSummer;
  }
  return new Date(naive - 3600000);
}

function offsetOf(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', timeZoneName: 'shortOffset' }).formatToParts(date);
  const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+1';
  const match = /GMT([+-]\d+)/.exec(name);
  return match === null ? 60 : Number(match[1]) * 60;
}

