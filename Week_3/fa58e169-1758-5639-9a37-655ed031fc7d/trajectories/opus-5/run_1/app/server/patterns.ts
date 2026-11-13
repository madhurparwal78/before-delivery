import { analyseChart } from '../src/domain/rows';
import { NO_STITCH } from '../src/domain/symbols';
import type { Cell, Chart, ChartAnalysis, ColourDef, Craft, Mode, RepeatBox, Terms } from '../src/domain/types';
import { colourLimits } from './config';
import { one, query } from './db';
import { notFound } from './http';
import type { User } from './auth';

export interface PatternRow {
  id: string;
  owner_id: string;
  name: string;
  craft: Craft;
  mode: Mode;
  terms: Terms;
  cast_on: number;
  width: number;
  height: number;
  state: 'draft' | 'published';
  published_version: number | null;
}

export interface ChartKind {
  label: string;
  craft: Craft;
  mode: Mode;
  terms: Terms;
  colours: ColourDef[];
}

const MAIN: ColourDef = { letter: 'A', name: 'Main', hex: '#f1f4fa' };
const CONTRAST: ColourDef = { letter: 'B', name: 'Contrast', hex: '#aebfd8' };

export const CHART_KINDS: ChartKind[] = [
  { label: 'Flat knitting', craft: 'knit', mode: 'flat', terms: null, colours: [MAIN] },
  { label: 'Knitting in the round', craft: 'knit', mode: 'round', terms: null, colours: [MAIN] },
  { label: 'Stranded in the round', craft: 'knit', mode: 'round', terms: null, colours: [MAIN, CONTRAST] },
  { label: 'Crochet rows in US terms', craft: 'crochet', mode: 'flat', terms: 'us', colours: [MAIN] },
  { label: 'Crochet rows in UK terms', craft: 'crochet', mode: 'flat', terms: 'uk', colours: [MAIN] },
  { label: 'Tapestry crochet', craft: 'crochet', mode: 'flat', terms: 'us', colours: [MAIN, CONTRAST] },
];

export async function getPattern(id: string): Promise<PatternRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return one<PatternRow>('select * from patterns where id = $1', [id]);
}

export type Role = 'owner' | 'co-designer' | 'tester';

export async function roleOf(user: User, pattern: PatternRow): Promise<Role | null> {
  if (pattern.owner_id === user.id) return 'owner';
  const co = await one('select 1 from pattern_co_designers where pattern_id = $1 and user_id = $2', [
    pattern.id,
    user.id,
  ]);
  if (co) return 'co-designer';
  const tester = await one(
    `select 1 from testers where pattern_id = $1 and user_id = $2 and status = 'accepted'`,
    [pattern.id, user.id],
  );
  if (tester) return 'tester';
  return null;
}

/** The pattern with the caller's designer role, or not found. */
export async function designerPattern(user: User, id: string): Promise<{ pattern: PatternRow; role: Role }> {
  const pattern = await getPattern(id);
  if (!pattern) throw notFound();
  const role = await roleOf(user, pattern);
  if (role !== 'owner' && role !== 'co-designer') throw notFound();
  return { pattern, role };
}

export async function ownerPattern(user: User, id: string): Promise<PatternRow> {
  const { pattern, role } = await designerPattern(user, id);
  if (role !== 'owner') throw notFound();
  return pattern;
}

export interface TesterRow {
  id: string;
  pattern_id: string;
  email: string;
  user_id: string | null;
  status: string;
  token: string;
  version: number | null;
  row: number;
  sent_at: Date;
}

export async function testerPattern(
  user: User,
  id: string,
): Promise<{ pattern: PatternRow; tester: TesterRow }> {
  const pattern = await getPattern(id);
  if (!pattern) throw notFound();
  const tester = await one<TesterRow>(
    `select * from testers where pattern_id = $1 and user_id = $2 and status = 'accepted'`,
    [pattern.id, user.id],
  );
  if (!tester) throw notFound();
  return { pattern, tester };
}

interface CellRecord {
  row: number;
  col: number;
  stitch: string;
  colour: string;
  repeat_id: string | null;
  rev: number;
}

export async function chartOf(pattern: PatternRow): Promise<Chart> {
  const [cellRows, repeatRows, colourRows] = await Promise.all([
    query<CellRecord>('select row, col, stitch, colour, repeat_id, rev from cells where pattern_id = $1', [
      pattern.id,
    ]),
    query<{ id: string; from_col: number; to_col: number; from_row: number; to_row: number; times: number }>(
      'select id, from_col, to_col, from_row, to_row, times from repeats where pattern_id = $1 order by id',
      [pattern.id],
    ),
    query<ColourDef>('select letter, name, hex from colours where pattern_id = $1 order by letter', [
      pattern.id,
    ]),
  ]);
  const cells: Cell[] = cellRows.map((cell) => ({
    row: cell.row,
    col: cell.col,
    stitch: cell.stitch,
    colour: cell.colour,
    repeat: cell.repeat_id,
    rev: cell.rev,
  }));
  const repeats: RepeatBox[] = repeatRows.map((box) => ({
    id: box.id,
    fromCol: box.from_col,
    toCol: box.to_col,
    fromRow: box.from_row,
    toRow: box.to_row,
    times: box.times,
  }));
  return {
    craft: pattern.craft,
    mode: pattern.mode,
    terms: pattern.terms,
    castOn: pattern.cast_on,
    width: pattern.width,
    height: pattern.height,
    colours: colourRows,
    repeats,
    cells,
  };
}

export function analyse(chart: Chart): ChartAnalysis {
  return analyseChart(chart, colourLimits);
}

export interface RowPayload {
  row: number;
  side: string;
  used: number;
  made: number;
  state: string;
  errors: string[];
  text: string;
  notes?: number;
}

export function rowsPayload(analysis: ChartAnalysis, notes: Map<number, number> | null): RowPayload[] {
  return analysis.rows.map((row) => {
    const payload: RowPayload = {
      row: row.row,
      side: row.side,
      used: row.used,
      made: row.made,
      state: row.state,
      errors: row.errors,
      text: row.text,
    };
    if (notes) payload.notes = notes.get(row.row) ?? 0;
    return payload;
  });
}

export function cellsPayload(chart: Chart): Cell[] {
  return [...chart.cells].sort((a, b) => a.row - b.row || a.col - b.col);
}

export async function noteCounts(patternId: string, userId?: string): Promise<Map<number, number>> {
  const rows = userId
    ? await query<{ row: number; count: string }>(
        'select row, count(*)::text as count from notes where pattern_id = $1 and user_id = $2 group by row',
        [patternId, userId],
      )
    : await query<{ row: number; count: string }>(
        'select row, count(*)::text as count from notes where pattern_id = $1 group by row',
        [patternId],
      );
  const counts = new Map<number, number>();
  for (const row of rows) counts.set(row.row, Number(row.count));
  return counts;
}

export interface VersionSnapshot {
  castOn: number;
  width: number;
  height: number;
  colours: ColourDef[];
  repeats: RepeatBox[];
  cells: { row: number; col: number; stitch: string; colour: string; repeat: string | null }[];
}

function snapshotChart(pattern: PatternRow, snapshot: VersionSnapshot): Chart {
  return {
    craft: pattern.craft,
    mode: pattern.mode,
    terms: pattern.terms,
    castOn: snapshot.castOn,
    width: snapshot.width,
    height: snapshot.height,
    colours: snapshot.colours,
    repeats: snapshot.repeats,
    cells: snapshot.cells.map((cell) => ({ ...cell, rev: 0 })),
  };
}

export function chartSnapshot(chart: Chart): VersionSnapshot {
  return {
    castOn: chart.castOn,
    width: chart.width,
    height: chart.height,
    colours: chart.colours,
    repeats: chart.repeats,
    cells: chart.cells.map((cell) => ({
      row: cell.row,
      col: cell.col,
      stitch: cell.stitch,
      colour: cell.colour,
      repeat: cell.repeat,
    })),
  };
}

export async function latestVersion(patternId: string): Promise<number> {
  const row = await one<{ version: number | null }>(
    'select max(version) as version from versions where pattern_id = $1',
    [patternId],
  );
  return row?.version ?? 0;
}

export async function loadVersionChart(
  pattern: PatternRow,
  version: number,
): Promise<{ chart: Chart; note: string; savedOn: string } | null> {
  const row = await one<{ snapshot: VersionSnapshot; note: string; saved_on: string }>(
    'select snapshot, note, saved_on from versions where pattern_id = $1 and version = $2',
    [pattern.id, version],
  );
  if (!row) return null;
  return { chart: snapshotChart(pattern, row.snapshot), note: row.note, savedOn: row.saved_on };
}

export async function writeBlankCells(patternId: string, width: number, height: number): Promise<void> {
  const values: unknown[] = [];
  const tuples: string[] = [];
  let index = 1;
  for (let row = 1; row <= height; row += 1) {
    for (let col = 1; col <= width; col += 1) {
      tuples.push(`($${index}, $${index + 1}, $${index + 2}, $${index + 3}, $${index + 4})`);
      values.push(patternId, row, col, NO_STITCH, 'A');
      index += 5;
    }
  }
  if (tuples.length === 0) return;
  for (let start = 0; start < tuples.length; start += 2000) {
    const slice = tuples.slice(start, start + 2000);
    const sliceValues = values.slice(start * 5, (start + slice.length) * 5);
    const renumbered = slice.map((_, position) => {
      const base = position * 5 + 1;
      return `($${base}, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
    });
    await query(
      `insert into cells (pattern_id, row, col, stitch, colour) values ${renumbered.join(', ')}
       on conflict (pattern_id, row, col) do update set stitch = excluded.stitch, colour = excluded.colour`,
      sliceValues,
    );
  }
}

/** Replaces every cell of a pattern, raising each cell's revision. */
export async function replaceCells(
  patternId: string,
  cells: { row: number; col: number; stitch: string; colour: string; repeat: string | null }[],
  width: number,
  editor: string,
): Promise<void> {
  const existing = await query<{ row: number; col: number; rev: number }>(
    'select row, col, rev from cells where pattern_id = $1',
    [patternId],
  );
  const revisions = new Map<string, number>();
  for (const cell of existing) revisions.set(`${cell.row}:${cell.col}`, cell.rev);

  await query('delete from cells where pattern_id = $1', [patternId]);
  await query('update patterns set width = $2 where id = $1', [patternId, width]);
  const chunk = 1000;
  for (let start = 0; start < cells.length; start += chunk) {
    const slice = cells.slice(start, start + chunk);
    const values: unknown[] = [];
    const tuples = slice.map((cell, position) => {
      const base = position * 8 + 1;
      const rev = (revisions.get(`${cell.row}:${cell.col}`) ?? -1) + 1;
      values.push(patternId, cell.row, cell.col, cell.stitch, cell.colour, cell.repeat, rev, editor);
      return `($${base}, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`;
    });
    await query(
      `insert into cells (pattern_id, row, col, stitch, colour, repeat_id, rev, last_editor)
       values ${tuples.join(', ')}`,
      values,
    );
  }
}

const locks = new Map<string, Promise<unknown>>();

/** Edits of one pattern run in arrival order. */
export function withPatternLock<T>(patternId: string, work: () => Promise<T>): Promise<T> {
  const previous = locks.get(patternId) ?? Promise.resolve();
  const next = previous.then(work, work);
  locks.set(
    patternId,
    next.catch(() => undefined),
  );
  return next;
}
