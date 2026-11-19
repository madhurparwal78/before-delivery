import { config } from '../config';
import { one, query } from '../db/pool';
import { copy } from '../domain/copy';
import { nowSeconds } from '../domain/time';
import { checkGtin } from '../domain/text';
import { newId, nextSortIndex } from '../ids';
import { problem } from '../http/problem';
import type { Ctx, Reply } from '../http/router';
import { FieldCollector, requiredEmail, requiredText } from '../store/fields';
import { findLabel, labelShape, supplierShapes } from '../store/read';
import type { LabelRow, StyleRowRecord } from '../store/rows';

export async function listLabels(ctx: Ctx): Promise<Reply> {
  const desk = ctx.requireDesk();
  const labels = await query<LabelRow>('select * from labels where assessor_id = $1 order by sort_index', [
    desk.id,
  ]);
  return { status: 200, json: { labels: labels.map(labelShape) } };
}

export async function createLabel(ctx: Ctx): Promise<Reply> {
  const desk = ctx.requireDesk();
  const body = ctx.json();
  const problems = new FieldCollector();
  const name = requiredText(body, 'name', problems);
  const contactName = requiredText(body, 'contactName', problems);
  const contactEmail = requiredEmail(body, 'contactEmail', problems);
  problems.throwIfAny();

  const id = newId();
  await query(
    `insert into labels (id, assessor_id, name, contact_name, contact_email, state, created_at, sort_index)
     values ($1,$2,$3,$4,$5,'open',$6,$7)`,
    [id, desk.id, name, contactName, contactEmail, ctx.now, nextSortIndex()],
  );
  const label = await findLabel(desk.id, id);
  return { status: 201, json: labelShape(label) };
}

export async function readLabel(ctx: Ctx): Promise<Reply> {
  const desk = ctx.requireDesk();
  const label = await findLabel(desk.id, ctx.params.id as string);
  return {
    status: 200,
    json: {
      ...labelShape(label),
      suppliers: label.state === 'erased' ? [] : await supplierShapes(label.id),
    },
  };
}

export async function renameLabel(ctx: Ctx): Promise<Reply> {
  const desk = ctx.requireDesk();
  const label = await findLabel(desk.id, ctx.params.id as string);
  const body = ctx.json();
  const problems = new FieldCollector();
  const name = requiredText(body, 'name', problems);
  problems.throwIfAny();
  if (label.state !== 'open') throw problem.conflict(copy.labelClosed);
  await query('update labels set name = $1 where id = $2', [name, label.id]);
  return { status: 200, json: labelShape(await findLabel(desk.id, label.id)) };
}

export async function deleteLabel(ctx: Ctx): Promise<Reply> {
  const desk = ctx.requireDesk();
  const label = await findLabel(desk.id, ctx.params.id as string);
  const keys = await query<{ object_key: string }>(
    `select object_key from evidence_files where label_id = $1
     union all select object_key from dossiers where label_id = $1 and object_key is not null`,
    [label.id],
  );
  for (const key of keys) {
    await query('insert into file_deletions (id, object_key) values ($1, $2)', [newId(), key.object_key]);
  }
  await query(
    'update published_gtins set withdrawn = true where style_id in (select id from styles where label_id = $1)',
    [label.id],
  );
  await query('delete from labels where id = $1', [label.id]);
  return { status: 204 };
}

export async function closeLabel(ctx: Ctx): Promise<Reply> {
  const desk = ctx.requireDesk();
  const label = await findLabel(desk.id, ctx.params.id as string);
  if (label.state !== 'open') throw problem.conflict(copy.labelClosed);
  await query('update labels set state = $1, closed_at = $2, erase_at = $3 where id = $4', [
    'closed',
    ctx.now,
    ctx.now + config.closureWaitSeconds,
    label.id,
  ]);
  return { status: 200, json: labelShape(await findLabel(desk.id, label.id)) };
}

export async function bringBackLabel(ctx: Ctx): Promise<Reply> {
  const desk = ctx.requireDesk();
  const label = await findLabel(desk.id, ctx.params.id as string);
  if (label.state !== 'closed' || label.erase_at === null || nowSeconds() >= Number(label.erase_at)) {
    throw problem.conflict('This label cannot be brought back.');
  }
  await query('update labels set state = $1, closed_at = null, erase_at = null where id = $2', [
    'open',
    label.id,
  ]);
  return { status: 200, json: labelShape(await findLabel(desk.id, label.id)) };
}

interface CatalogueRow {
  row: number;
  styleCode: string;
  name: string;
  season: string;
  gtin: string;
  outcome: 'new' | 'matched' | 'refused';
  reason: string | null;
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index] as string;
    if (quoted) {
      if (character === '"') {
        if (line[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      cells.push(cell);
      cell = '';
    } else {
      cell += character;
    }
  }
  cells.push(cell);
  return cells;
}

/** A catalogue file, UTF-8 with or without a byte order mark and LF or CRLF. */
function readCatalogue(text: string): string[][] {
  const withoutMark = text.startsWith('\ufeff') ? text.slice(1) : text;
  const lines = withoutMark.split(/\r\n|\n/);
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.map(splitCsvLine);
}

async function judgeCatalogue(labelId: string, text: string): Promise<CatalogueRow[]> {
  const lines = readCatalogue(text);
  const header = lines[0];
  if (
    !header ||
    header.length < 4 ||
    header[0]?.trim() !== 'styleCode' ||
    header[1]?.trim() !== 'name' ||
    header[2]?.trim() !== 'season' ||
    header[3]?.trim() !== 'gtin'
  ) {
    throw problem.validation(copy.catalogueHeader);
  }
  const existing = await query<{ style_code: string | null }>(
    'select style_code from styles where label_id = $1',
    [labelId],
  );
  const taken = new Set(existing.map((style) => style.style_code).filter((code): code is string => code !== null));

  const judged: CatalogueRow[] = [];
  const seenCodes = new Map<string, number>();
  for (let index = 1; index < lines.length; index += 1) {
    const cells = lines[index] as string[];
    if (cells.length === 1 && (cells[0] ?? '').trim() === '') continue;
    const styleCode = (cells[0] ?? '').trim();
    const name = (cells[1] ?? '').trim();
    const season = (cells[2] ?? '').trim();
    const gtin = (cells[3] ?? '').trim();
    const row = index + 1;
    let reason: string | null = null;
    const earlier = seenCodes.get(styleCode);
    if (name === '') reason = copy.catalogueName;
    else if (season === '') reason = copy.catalogueSeason;
    else {
      const gtinProblem = checkGtin(gtin);
      if (gtinProblem) {
        reason = gtinProblem.kind === 'length' ? copy.gtinLength : copy.gtinCheckDigit(gtinProblem.digit);
      } else if (earlier !== undefined) {
        reason = copy.catalogueRepeat(earlier);
      }
    }
    if (earlier === undefined) seenCodes.set(styleCode, row);
    const outcome: CatalogueRow['outcome'] = reason !== null ? 'refused' : taken.has(styleCode) ? 'matched' : 'new';
    judged.push({ row, styleCode, name, season, gtin, outcome, reason });
  }
  return judged;
}

function counts(rows: CatalogueRow[]): { newCount: number; matchedCount: number; refusedCount: number } {
  return {
    newCount: rows.filter((row) => row.outcome === 'new').length,
    matchedCount: rows.filter((row) => row.outcome === 'matched').length,
    refusedCount: rows.filter((row) => row.outcome === 'refused').length,
  };
}

function requireCsv(ctx: Ctx): string {
  const kind = (ctx.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
  if (kind !== 'text/csv') throw problem.unsupportedMediaType();
  return ctx.text();
}

export async function previewCatalogue(ctx: Ctx): Promise<Reply> {
  const desk = ctx.requireDesk();
  const label = await findLabel(desk.id, ctx.params.id as string);
  const rows = await judgeCatalogue(label.id, requireCsv(ctx));
  return { status: 200, json: { rows, ...counts(rows) } };
}

export async function saveCatalogue(ctx: Ctx): Promise<Reply> {
  const desk = ctx.requireDesk();
  const label = await findLabel(desk.id, ctx.params.id as string);
  const rows = await judgeCatalogue(label.id, requireCsv(ctx));
  if (label.state !== 'open') throw problem.conflict(copy.labelClosed);
  for (const row of rows) {
    if (row.outcome !== 'new') continue;
    const id = newId();
    await query(
      `insert into styles (id, assessor_id, label_id, style_code, name, season, gtin, garment, washes,
        state, version, changed_at, created_at, sort_index)
       values ($1,$2,$3,$4,$5,$6,$7,'tshirt',30,'draft',1,$8,$8,$9)`,
      [id, desk.id, label.id, row.styleCode, row.name, row.season, row.gtin, ctx.now, nextSortIndex()],
    );
  }
  return { status: 200, json: counts(rows) };
}

export async function stylesOfLabel(labelId: string): Promise<StyleRowRecord[]> {
  return query<StyleRowRecord>('select * from styles where label_id = $1 order by sort_index', [labelId]);
}

export async function labelOfStyle(style: StyleRowRecord): Promise<LabelRow> {
  const label = await one<LabelRow>('select * from labels where id = $1', [style.label_id]);
  if (!label) throw problem.notFound();
  return label;
}
