import { STYLE_PAGE_SIZE } from '../config';
import { one, query } from '../db/pool';
import { Decimal, dec } from '../domain/decimal';
import { copy } from '../domain/copy';
import { MATERIALS, isCountry, isMaterial, isMode } from '../domain/factors';
import { LISBON, localDate } from '../domain/time';
import { checkGtin, fold } from '../domain/text';
import { newId, nextSortIndex } from '../ids';
import { problem } from '../http/problem';
import type { Ctx, Reply } from '../http/router';
import {
  FieldCollector,
  optionalText,
  readBaseVersion,
  readBaseVersionParameter,
  readBoolean,
  readDecimal,
  readWhole,
  requiredText,
} from '../store/fields';
import { checkBaseVersion, requireWritable } from '../store/guards';
import {
  climateShownOf,
  findLabel,
  findStyle,
  latestResult,
  legShape,
  lineShape,
  measuresOf,
  readLegs,
  readLines,
  styleShape,
  supplierNames,
} from '../store/read';
import { labelOfStyle } from './labels';
import type { FibreShare, LabelRow, LegRow, LineRow, StyleRowRecord, Tier } from '../store/rows';

const GARMENTS = ['tshirt', 'shirt', 'jeans', 'coat'] as const;
type Garment = (typeof GARMENTS)[number];

function isGarment(value: unknown): value is Garment {
  return typeof value === 'string' && (GARMENTS as readonly string[]).includes(value);
}

export async function bumpVersion(styleId: string, now: number, changedBy: string | null): Promise<void> {
  await query('update styles set version = version + 1, changed_at = $1, changed_by = $2 where id = $3', [
    now,
    changedBy,
    styleId,
  ]);
}

interface ListedStyle {
  style: StyleRowRecord;
  labelName: string;
  suppliers: string[];
  climate: Decimal | null;
  climateShown: string | null;
}

async function listedStyles(deskId: string): Promise<ListedStyle[]> {
  const styles = await query<StyleRowRecord & { label_name: string }>(
    `select s.*, l.name as label_name from styles s join labels l on l.id = s.label_id
     where s.assessor_id = $1 and l.state <> 'erased' order by s.sort_index`,
    [deskId],
  );
  const listed: ListedStyle[] = [];
  for (const style of styles) {
    const result = await latestResult(style.id);
    const climate = result
      ? dec(measuresOf(result).find((measure) => measure.measure === 'climate')?.total ?? '0')
      : null;
    listed.push({
      style,
      labelName: style.label_name,
      suppliers: await supplierNames(style.id),
      climate,
      climateShown: climateShownOf(result),
    });
  }
  return listed;
}

function sortKey(entry: ListedStyle, sort: 'name' | 'climate'): string | null {
  return sort === 'name' ? fold(entry.style.name) : entry.climate === null ? null : entry.climate.toFixed();
}

function compare(a: ListedStyle, b: ListedStyle, sort: 'name' | 'climate'): number {
  if (sort === 'name') {
    const left = fold(a.style.name);
    const right = fold(b.style.name);
    if (left !== right) return left < right ? -1 : 1;
    return a.style.id < b.style.id ? -1 : a.style.id > b.style.id ? 1 : 0;
  }
  if (a.climate === null && b.climate === null) {
    return a.style.id < b.style.id ? -1 : a.style.id > b.style.id ? 1 : 0;
  }
  if (a.climate === null) return 1;
  if (b.climate === null) return -1;
  if (!a.climate.equals(b.climate)) return a.climate.lessThan(b.climate) ? -1 : 1;
  return a.style.id < b.style.id ? -1 : a.style.id > b.style.id ? 1 : 0;
}

function afterCursor(entry: ListedStyle, cursor: { key: string | null; id: string }, sort: 'name' | 'climate'): boolean {
  const key = sortKey(entry, sort);
  if (sort === 'name') {
    const left = key as string;
    const right = cursor.key as string;
    if (left !== right) return left > right;
    return entry.style.id > cursor.id;
  }
  if (key === null && cursor.key === null) return entry.style.id > cursor.id;
  if (key === null) return true;
  if (cursor.key === null) return false;
  const left = dec(key);
  const right = dec(cursor.key);
  if (!left.equals(right)) return left.greaterThan(right);
  return entry.style.id > cursor.id;
}

function readCursor(text: string | null): { key: string | null; id: string } | null {
  if (text === null || text === '') return null;
  try {
    const parsed = JSON.parse(Buffer.from(text, 'base64url').toString('utf8')) as {
      key?: unknown;
      id?: unknown;
    };
    if (typeof parsed.id !== 'string') return null;
    return { key: typeof parsed.key === 'string' ? parsed.key : null, id: parsed.id };
  } catch {
    return null;
  }
}

function writeCursor(entry: ListedStyle, sort: 'name' | 'climate'): string {
  return Buffer.from(JSON.stringify({ key: sortKey(entry, sort), id: entry.style.id })).toString('base64url');
}

export interface StyleListPage {
  rows: ListedStyle[];
  nextCursor: string | null;
  shownCount: number;
}

export async function styleListPage(deskId: string, parameters: URLSearchParams): Promise<StyleListPage> {
  const label = parameters.get('label');
  const season = parameters.get('season');
  const state = parameters.get('state');
  const sort = parameters.get('sort') === 'climate' ? 'climate' : 'name';
  const search = parameters.get('q');
  const cursor = readCursor(parameters.get('cursor'));

  let rows = await listedStyles(deskId);
  if (label) rows = rows.filter((entry) => entry.style.label_id === label);
  if (season) rows = rows.filter((entry) => entry.style.season === season);
  if (state) rows = rows.filter((entry) => entry.style.state === state);
  else rows = rows.filter((entry) => entry.style.state !== 'archived');
  if (search && search.trim() !== '') {
    const needle = fold(search.trim());
    rows = rows.filter(
      (entry) =>
        fold(entry.style.name).includes(needle) ||
        entry.suppliers.some((supplier) => fold(supplier).includes(needle)),
    );
  }
  rows.sort((a, b) => compare(a, b, sort));
  if (cursor) rows = rows.filter((entry) => afterCursor(entry, cursor, sort));
  const page = rows.slice(0, STYLE_PAGE_SIZE);
  const nextCursor =
    rows.length > STYLE_PAGE_SIZE && page.length > 0 ? writeCursor(page[page.length - 1] as ListedStyle, sort) : null;
  return { rows: page, nextCursor, shownCount: page.length };
}

function styleRowJson(entry: ListedStyle): Record<string, unknown> {
  return {
    id: entry.style.id,
    labelId: entry.style.label_id,
    labelName: entry.labelName,
    styleCode: entry.style.style_code,
    name: entry.style.name,
    season: entry.style.season,
    gtin: entry.style.gtin,
    garment: entry.style.garment,
    state: entry.style.state,
    suppliers: entry.suppliers,
    climateShown: entry.climateShown,
  };
}

export async function listStyles(ctx: Ctx): Promise<Reply> {
  const desk = ctx.requireDesk();
  const page = await styleListPage(desk.id, ctx.query);
  return { status: 200, json: { styles: page.rows.map(styleRowJson), nextCursor: page.nextCursor } };
}

function readGtin(body: Record<string, unknown>, problems: FieldCollector): string {
  const value = body.gtin;
  if (typeof value !== 'string' || value.trim() === '') {
    problems.add('gtin', copy.emptyField);
    return '';
  }
  const found = checkGtin(value.trim());
  if (found) {
    problems.add('gtin', found.kind === 'length' ? copy.gtinLength : copy.gtinCheckDigit(found.digit));
    return '';
  }
  return value.trim();
}

async function requireFreeStyleCode(
  labelId: string,
  styleCode: string | null,
  exceptStyleId: string | null,
): Promise<void> {
  if (styleCode === null) return;
  const taken = await one<{ id: string }>(
    `select id from styles where label_id = $1 and style_code = $2 and ($3::text is null or id <> $3)`,
    [labelId, styleCode, exceptStyleId],
  );
  if (taken) throw problem.fields({ styleCode: copy.styleCodeTaken });
}

export async function createStyle(ctx: Ctx): Promise<Reply> {
  const desk = ctx.requireDesk();
  const body = ctx.json();
  const labelId = typeof body.labelId === 'string' ? body.labelId : '';
  const label = await findLabel(desk.id, labelId);

  const problems = new FieldCollector();
  const name = requiredText(body, 'name', problems);
  const season = requiredText(body, 'season', problems);
  const gtin = readGtin(body, problems);
  const styleCode = optionalText(body, 'styleCode', problems, 120);
  const garment = body.garment === undefined || body.garment === null ? 'tshirt' : body.garment;
  if (!isGarment(garment)) problems.add('garment', copy.emptyField);
  const washes = readWhole(body, 'washes', problems);
  const repairService = readBoolean(body, 'repairService', problems);
  const rangeSize = readWhole(body, 'rangeSize', problems);
  const notes = optionalText(body, 'notes', problems, 2000);
  problems.throwIfAny();
  await requireFreeStyleCode(label.id, styleCode, null);
  if (label.state !== 'open') throw problem.conflict(copy.labelClosed);

  const id = newId();
  await query(
    `insert into styles (id, assessor_id, label_id, style_code, name, season, gtin, garment, washes,
      repair_service, range_size, notes, state, version, changed_at, created_at, sort_index)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'draft',1,$13,$13,$14)`,
    [
      id,
      desk.id,
      label.id,
      styleCode,
      name,
      season,
      gtin,
      garment as Garment,
      washes ?? 30,
      repairService,
      rangeSize,
      notes,
      ctx.now,
      nextSortIndex(),
    ],
  );
  const style = await findStyle(desk.id, id);
  return { status: 201, json: await styleShape(style, label.name, localDate(ctx.now, LISBON)) };
}

export async function readStyle(ctx: Ctx): Promise<Reply> {
  const desk = ctx.requireDesk();
  const style = await findStyle(desk.id, ctx.params.id as string);
  const label = await labelOfStyle(style);
  return { status: 200, json: await styleShape(style, label.name, localDate(ctx.now, LISBON)) };
}

export async function patchStyle(ctx: Ctx): Promise<Reply> {
  const desk = ctx.requireDesk();
  const style = await findStyle(desk.id, ctx.params.id as string);
  const label = await labelOfStyle(style);
  const body = ctx.json();
  const problems = new FieldCollector();
  const baseVersion = readBaseVersion(body, problems);

  const next: Record<string, unknown> = {};
  if ('name' in body) next.name = requiredText(body, 'name', problems);
  if ('season' in body) next.season = requiredText(body, 'season', problems);
  if ('gtin' in body) next.gtin = readGtin(body, problems);
  if ('styleCode' in body) next.style_code = optionalText(body, 'styleCode', problems, 120);
  if ('garment' in body) {
    if (!isGarment(body.garment)) problems.add('garment', copy.emptyField);
    else next.garment = body.garment;
  }
  if ('washes' in body) next.washes = readWhole(body, 'washes', problems) ?? 30;
  if ('repairService' in body) next.repair_service = readBoolean(body, 'repairService', problems);
  if ('rangeSize' in body) next.range_size = readWhole(body, 'rangeSize', problems);
  if ('notes' in body) next.notes = optionalText(body, 'notes', problems, 2000);
  problems.throwIfAny();
  if ('style_code' in next) await requireFreeStyleCode(label.id, next.style_code as string | null, style.id);

  requireWritable(style, label);
  checkBaseVersion(style, baseVersion);

  const keys = Object.keys(next);
  if (keys.length > 0) {
    const sets = keys.map((key, index) => `${key} = $${index + 1}`).join(', ');
    await query(`update styles set ${sets} where id = $${keys.length + 1}`, [
      ...keys.map((key) => next[key]),
      style.id,
    ]);
  }
  await bumpVersion(style.id, ctx.now, null);
  const after = await findStyle(desk.id, style.id);
  await markScoreOutdated(style.id);
  return { status: 200, json: await styleShape(after, label.name, localDate(ctx.now, LISBON)) };
}

export async function markScoreOutdated(styleId: string): Promise<void> {
  await query(`update scores set state = 'outdated' where style_id = $1 and state = 'current'`, [styleId]);
}

export async function duplicateStyle(ctx: Ctx): Promise<Reply> {
  const desk = ctx.requireDesk();
  const style = await findStyle(desk.id, ctx.params.id as string);
  const label = await labelOfStyle(style);
  requireWritable(style, label);

  const id = newId();
  await query(
    `insert into styles (id, assessor_id, label_id, style_code, name, season, gtin, garment, washes,
      repair_service, range_size, notes, state, version, changed_at, created_at, sort_index)
     values ($1,$2,$3,null,$4,$5,$6,$7,$8,$9,$10,$11,'draft',1,$12,$12,$13)`,
    [
      id,
      desk.id,
      style.label_id,
      `${style.name} (copy)`,
      style.season,
      style.gtin,
      style.garment,
      style.washes,
      style.repair_service,
      style.range_size,
      style.notes,
      ctx.now,
      nextSortIndex(),
    ],
  );
  const lines = await readLines(style.id);
  for (const line of lines) {
    await query(
      `insert into material_lines (id, style_id, position, material_id, fabric_weight_gsm, area_m2,
        mass_grams, fibres, tier1, tier2, tier3, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        newId(),
        id,
        line.position,
        line.material_id,
        line.fabric_weight_gsm,
        line.area_m2,
        line.mass_grams,
        JSON.stringify(line.fibres),
        line.tier1 === null ? null : JSON.stringify(line.tier1),
        line.tier2 === null ? null : JSON.stringify(line.tier2),
        line.tier3 === null ? null : JSON.stringify(line.tier3),
        ctx.now,
      ],
    );
  }
  const legs = await readLegs(style.id);
  for (const leg of legs) {
    await query(
      'insert into transport_legs (id, style_id, position, mode, km, created_at) values ($1,$2,$3,$4,$5,$6)',
      [newId(), id, leg.position, leg.mode, leg.km, ctx.now],
    );
  }
  const made = await findStyle(desk.id, id);
  return { status: 201, json: await styleShape(made, label.name, localDate(ctx.now, LISBON)) };
}

export async function archiveStyle(ctx: Ctx): Promise<Reply> {
  const desk = ctx.requireDesk();
  const style = await findStyle(desk.id, ctx.params.id as string);
  const label = await labelOfStyle(style);
  if (label.state !== 'open') throw problem.conflict(copy.labelClosed);
  if (style.state === 'archived') throw problem.conflict(copy.styleArchived);
  if (style.state === 'published') throw problem.conflict(copy.archiveWithPassport);
  await query(`update styles set state = 'archived' where id = $1`, [style.id]);
  await bumpVersion(style.id, ctx.now, null);
  const after = await findStyle(desk.id, style.id);
  return { status: 200, json: await styleShape(after, label.name, localDate(ctx.now, LISBON)) };
}

export function listMaterials(ctx: Ctx): Reply {
  const search = ctx.query.get('q');
  const materials =
    search === null || search.trim() === ''
      ? MATERIALS
      : MATERIALS.filter((material) => fold(material.name).includes(fold(search.trim())));
  return { status: 200, json: { materials } };
}

export async function listLines(ctx: Ctx): Promise<Reply> {
  const desk = ctx.requireDesk();
  const style = await findStyle(desk.id, ctx.params.id as string);
  const lines = await readLines(style.id);
  return { status: 200, json: { lines: lines.map(lineShape), version: style.version } };
}

function readTier(body: Record<string, unknown>, key: string, problems: FieldCollector): Tier | null {
  const value = body[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    problems.add(`${key}.country`, copy.emptyField);
    return null;
  }
  const given = value as Record<string, unknown>;
  const factory = typeof given.factory === 'string' && given.factory.trim() !== '' ? given.factory.trim() : null;
  const town = typeof given.town === 'string' && given.town.trim() !== '' ? given.town.trim() : null;
  const country = given.country === undefined || given.country === null || given.country === '' ? null : given.country;
  if (country !== null && !isCountry(country)) {
    problems.add(`${key}.country`, copy.emptyField);
    return null;
  }
  if (factory === null && town === null && country === null) return null;
  return { factory, town, country: country as Tier['country'] };
}

interface LineFields {
  materialId: string;
  fabricWeightGsm: Decimal | null;
  areaM2: Decimal | null;
  massGrams: Decimal;
  fibres: FibreShare[];
  tier1: Tier | null;
  tier2: Tier | null;
  tier3: Tier | null;
}

function readLineFields(body: Record<string, unknown>, problems: FieldCollector, existing: LineRow | null): LineFields {
  const materialId =
    'materialId' in body || existing === null ? (body.materialId as unknown) : existing.material_id;
  if (!isMaterial(materialId)) problems.add('materialId', copy.emptyField);

  const hasWeight = 'fabricWeightGsm' in body || 'areaM2' in body;
  const hasMass = 'massGrams' in body;
  let fabricWeightGsm: Decimal | null = existing?.fabric_weight_gsm ? dec(existing.fabric_weight_gsm) : null;
  let areaM2: Decimal | null = existing?.area_m2 ? dec(existing.area_m2) : null;
  let massGrams: Decimal | null = existing ? dec(existing.mass_grams) : null;

  if (hasWeight) {
    fabricWeightGsm = readDecimal(body, 'fabricWeightGsm', problems, copy.massForm);
    areaM2 = readDecimal(body, 'areaM2', problems, copy.massForm);
    if (fabricWeightGsm === null || areaM2 === null) {
      problems.add('massGrams', copy.massForm);
      massGrams = null;
    } else {
      massGrams = fabricWeightGsm.times(areaM2);
    }
  } else if (hasMass) {
    const plainMass = readDecimal(body, 'massGrams', problems, copy.massForm);
    if (plainMass === null) problems.add('massGrams', copy.massForm);
    massGrams = plainMass;
    fabricWeightGsm = null;
    areaM2 = null;
  } else if (existing === null) {
    problems.add('massGrams', copy.massForm);
  }

  const fibresGiven = 'fibres' in body ? body.fibres : existing?.fibres;
  const fibres: FibreShare[] = [];
  if (!Array.isArray(fibresGiven) || fibresGiven.length === 0) {
    problems.add('fibres', copy.fibresOff('0.0'));
  } else {
    let total = new Decimal(0);
    fibresGiven.forEach((entry, index) => {
      const given = (entry ?? {}) as Record<string, unknown>;
      const name = typeof given.name === 'string' && given.name.trim() !== '' ? given.name.trim() : null;
      if (name === null) problems.add(`fibres.${index}.name`, copy.emptyField);
      const share = typeof given.sharePercent === 'string' ? given.sharePercent : '';
      if (!/^\d+\.\d$/.test(share)) {
        problems.add(`fibres.${index}.sharePercent`, copy.fibreShareForm);
        return;
      }
      total = total.plus(new Decimal(share));
      fibres.push({ name: name ?? '', sharePercent: share });
    });
    if (fibres.length === fibresGiven.length && !total.equals(new Decimal('100.0'))) {
      problems.add('fibres', copy.fibresOff(total.toFixed(1)));
    }
  }

  const tier1 = 'tier1' in body ? readTier(body, 'tier1', problems) : (existing?.tier1 ?? null);
  const tier2 = 'tier2' in body ? readTier(body, 'tier2', problems) : (existing?.tier2 ?? null);
  const tier3 = 'tier3' in body ? readTier(body, 'tier3', problems) : (existing?.tier3 ?? null);

  return {
    materialId: materialId as string,
    fabricWeightGsm,
    areaM2,
    massGrams: massGrams ?? new Decimal(0),
    fibres,
    tier1,
    tier2,
    tier3,
  };
}

async function openStyleForWrite(ctx: Ctx): Promise<{ style: StyleRowRecord; label: LabelRow }> {
  const desk = ctx.requireDesk();
  const style = await findStyle(desk.id, ctx.params.id as string);
  const label = await labelOfStyle(style);
  return { style, label };
}

export async function createLine(ctx: Ctx): Promise<Reply> {
  const { style, label } = await openStyleForWrite(ctx);
  const body = ctx.json();
  const problems = new FieldCollector();
  const baseVersion = readBaseVersion(body, problems);
  const fields = readLineFields(body, problems, null);
  problems.throwIfAny();
  requireWritable(style, label);
  checkBaseVersion(style, baseVersion);

  const lines = await readLines(style.id);
  const id = newId();
  await query(
    `insert into material_lines (id, style_id, position, material_id, fabric_weight_gsm, area_m2,
      mass_grams, fibres, tier1, tier2, tier3, created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      id,
      style.id,
      lines.length + 1,
      fields.materialId,
      fields.fabricWeightGsm?.toFixed() ?? null,
      fields.areaM2?.toFixed() ?? null,
      fields.massGrams.toFixed(),
      JSON.stringify(fields.fibres),
      fields.tier1 === null ? null : JSON.stringify(fields.tier1),
      fields.tier2 === null ? null : JSON.stringify(fields.tier2),
      fields.tier3 === null ? null : JSON.stringify(fields.tier3),
      ctx.now,
    ],
  );
  await bumpVersion(style.id, ctx.now, null);
  await markScoreOutdated(style.id);
  const made = await one<LineRow>('select * from material_lines where id = $1', [id]);
  return { status: 201, json: lineShape(made as LineRow) };
}

export async function patchLine(ctx: Ctx): Promise<Reply> {
  const { style, label } = await openStyleForWrite(ctx);
  const line = await one<LineRow>('select * from material_lines where id = $1 and style_id = $2', [
    ctx.params.lineId as string,
    style.id,
  ]);
  if (!line) throw problem.notFound();
  const body = ctx.json();
  const problems = new FieldCollector();
  const baseVersion = readBaseVersion(body, problems);
  const fields = readLineFields(body, problems, line);
  problems.throwIfAny();
  requireWritable(style, label);
  checkBaseVersion(style, baseVersion);

  await query(
    `update material_lines set material_id = $1, fabric_weight_gsm = $2, area_m2 = $3, mass_grams = $4,
      fibres = $5, tier1 = $6, tier2 = $7, tier3 = $8 where id = $9`,
    [
      fields.materialId,
      fields.fabricWeightGsm?.toFixed() ?? null,
      fields.areaM2?.toFixed() ?? null,
      fields.massGrams.toFixed(),
      JSON.stringify(fields.fibres),
      fields.tier1 === null ? null : JSON.stringify(fields.tier1),
      fields.tier2 === null ? null : JSON.stringify(fields.tier2),
      fields.tier3 === null ? null : JSON.stringify(fields.tier3),
      line.id,
    ],
  );
  await bumpVersion(style.id, ctx.now, null);
  await markScoreOutdated(style.id);
  const after = await one<LineRow>('select * from material_lines where id = $1', [line.id]);
  return { status: 200, json: lineShape(after as LineRow) };
}

export async function deleteLine(ctx: Ctx): Promise<Reply> {
  const { style, label } = await openStyleForWrite(ctx);
  const line = await one<LineRow>('select * from material_lines where id = $1 and style_id = $2', [
    ctx.params.lineId as string,
    style.id,
  ]);
  if (!line) throw problem.notFound();
  const baseVersion = readBaseVersionParameter(ctx.query);
  requireWritable(style, label);
  checkBaseVersion(style, baseVersion);

  await query('delete from material_lines where id = $1', [line.id]);
  const left = await readLines(style.id);
  for (let index = 0; index < left.length; index += 1) {
    await query('update material_lines set position = $1 where id = $2', [index + 1, (left[index] as LineRow).id]);
  }
  await bumpVersion(style.id, ctx.now, null);
  await markScoreOutdated(style.id);
  return { status: 204 };
}

export async function moveLine(ctx: Ctx): Promise<Reply> {
  const { style, label } = await openStyleForWrite(ctx);
  const line = await one<LineRow>('select * from material_lines where id = $1 and style_id = $2', [
    ctx.params.lineId as string,
    style.id,
  ]);
  if (!line) throw problem.notFound();
  const body = ctx.json();
  const problems = new FieldCollector();
  const baseVersion = readBaseVersion(body, problems);
  const direction = body.direction;
  if (direction !== 'up' && direction !== 'down') problems.add('direction', copy.emptyField);
  problems.throwIfAny();
  requireWritable(style, label);
  // A move with an old baseVersion answers 412 even when its line is now at the end.
  checkBaseVersion(style, baseVersion);

  const lines = await readLines(style.id);
  const at = lines.findIndex((entry) => entry.id === line.id);
  const to = direction === 'up' ? at - 1 : at + 1;
  if (to < 0 || to >= lines.length) throw problem.conflict(copy.lineAtEnd);

  const neighbour = lines[to] as LineRow;
  await query('update material_lines set position = $1 where id = $2', [0, line.id]);
  await query('update material_lines set position = $1 where id = $2', [line.position, neighbour.id]);
  await query('update material_lines set position = $1 where id = $2', [neighbour.position, line.id]);
  await bumpVersion(style.id, ctx.now, null);

  const after = await readLines(style.id);
  const moved = await findStyle(ctx.requireDesk().id, style.id);
  return {
    status: 200,
    json: {
      lines: after.map(lineShape),
      position: to + 1,
      total: after.length,
      version: moved.version,
    },
  };
}

export async function createLeg(ctx: Ctx): Promise<Reply> {
  const { style, label } = await openStyleForWrite(ctx);
  const body = ctx.json();
  const problems = new FieldCollector();
  const baseVersion = readBaseVersion(body, problems);
  if (!isMode(body.mode)) problems.add('mode', copy.emptyField);
  const km = readDecimal(body, 'km', problems, copy.emptyField);
  if (km === null) problems.add('km', copy.emptyField);
  problems.throwIfAny();
  requireWritable(style, label);
  checkBaseVersion(style, baseVersion);

  const legs = await readLegs(style.id);
  const id = newId();
  await query(
    'insert into transport_legs (id, style_id, position, mode, km, created_at) values ($1,$2,$3,$4,$5,$6)',
    [id, style.id, legs.length + 1, body.mode as string, (km as Decimal).toFixed(), ctx.now],
  );
  await bumpVersion(style.id, ctx.now, null);
  await markScoreOutdated(style.id);
  const after = await findStyle(ctx.requireDesk().id, style.id);
  const made = await one<LegRow>('select * from transport_legs where id = $1', [id]);
  return { status: 201, json: { ...legShape(made as LegRow), version: after.version } };
}

export async function deleteLeg(ctx: Ctx): Promise<Reply> {
  const { style, label } = await openStyleForWrite(ctx);
  const leg = await one<LegRow>('select * from transport_legs where id = $1 and style_id = $2', [
    ctx.params.legId as string,
    style.id,
  ]);
  if (!leg) throw problem.notFound();
  const baseVersion = readBaseVersionParameter(ctx.query);
  requireWritable(style, label);
  checkBaseVersion(style, baseVersion);

  await query('delete from transport_legs where id = $1', [leg.id]);
  const left = await readLegs(style.id);
  for (let index = 0; index < left.length; index += 1) {
    await query('update transport_legs set position = $1 where id = $2', [index + 1, (left[index] as LegRow).id]);
  }
  await bumpVersion(style.id, ctx.now, null);
  await markScoreOutdated(style.id);
  return { status: 204 };
}
