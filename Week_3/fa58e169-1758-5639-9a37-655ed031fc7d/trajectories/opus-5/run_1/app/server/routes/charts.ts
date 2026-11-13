import { randomUUID } from 'node:crypto';
import { parseAndApplyRowText, repeatBoxTextError } from '../../src/domain/grammar';
import { mirrorSelection, selectionTouchesRepeat } from '../../src/domain/mirror';
import { boxesOverlap, expandBox, expandedWidth, nextRepeatId, undoExpandBox } from '../../src/domain/repeats';
import { symbolsFor } from '../../src/domain/symbols';
import type { Chart, ChartAnalysis, RepeatBox } from '../../src/domain/types';
import { requireUser, type User } from '../auth';
import { limits } from '../config';
import { copy } from '../copy';
import { one, query } from '../db';
import { checkEditRate, rememberOp, replayedOp } from '../edits';
import { conflict, invalid, notFound, type Router } from '../http';
import { publish } from '../live';
import {
  CHART_KINDS,
  analyse,
  cellsPayload,
  chartOf,
  designerPattern,
  getPattern,
  latestVersion,
  noteCounts,
  ownerPattern,
  replaceCells,
  rowsPayload,
  type PatternRow,
  withPatternLock,
  writeBlankCells,
} from '../patterns';

const SAMPLE_ROWS: Record<number, string> = {
  1: 'k k k k k k k k k k k k',
  2: 'k k k k k k k k k k k k',
  3: 'ns k k2tog k k k k k k ssk k ns',
  4: 'ns k ssk k k k k k2tog k ns ns ns',
  5: 'ns k k k k k k k k ns ns ns',
  6: 'ns k k k k k k k k ns ns ns',
  7: 'ns k m1r k k k k k k m1l k ns',
};

export interface EditedCell {
  row: number;
  col: number;
  stitch: string;
  colour: string;
  rev: number;
}

async function loadState(pattern: PatternRow): Promise<{ chart: Chart; analysis: ChartAnalysis }> {
  const chart = await chartOf(pattern);
  return { chart, analysis: analyse(chart) };
}

async function designerRows(pattern: PatternRow, analysis: ChartAnalysis) {
  return rowsPayload(analysis, await noteCounts(pattern.id));
}

async function testerList(patternId: string) {
  const rows = await query<{
    user_id: string;
    name: string;
    email: string;
    version: number | null;
    row: number;
    notes: string;
  }>(
    `select t.user_id, u.name, t.email, t.version, t.row,
       (select count(*) from notes n where n.pattern_id = t.pattern_id and n.user_id = t.user_id)::text as notes
     from testers t join users u on u.id = t.user_id
     where t.pattern_id = $1 and t.status = 'accepted'
     order by u.name`,
    [patternId],
  );
  return rows.map((row) => ({
    id: row.user_id,
    name: row.name,
    version: row.version ?? 0,
    row: row.row,
    notes: Number(row.notes),
  }));
}

async function publishCells(
  pattern: PatternRow,
  user: User,
  cells: EditedCell[],
  analysis: ChartAnalysis,
  flash: boolean,
): Promise<void> {
  await publish(pattern.id, {
    kind: 'cells',
    by: user.id,
    byName: user.name,
    flash,
    cells,
    rows: await designerRows(pattern, analysis),
  });
}

async function publishChart(pattern: PatternRow, user: User): Promise<void> {
  await publish(pattern.id, { kind: 'chart', by: user.id, byName: user.name });
}

function readCellEdits(body: Record<string, unknown>, chart: Chart): EditedCell[] {
  const given = body.cells;
  if (!Array.isArray(given)) throw invalid('cells', 'Send a list of cells.');
  const keys = new Set(symbolsFor(chart.craft).map((symbol) => symbol.key));
  const colours = new Set(chart.colours.map((colour) => colour.letter));
  return given.map((raw) => {
    const cell = raw as Record<string, unknown>;
    const row = Number(cell.row);
    const col = Number(cell.col);
    const stitch = String(cell.stitch);
    const colour = String(cell.colour);
    const rev = Number(cell.rev);
    if (!Number.isInteger(row) || !Number.isInteger(col) || row < 1 || col < 1 || row > chart.height || col > chart.width) {
      throw invalid('cells', 'That cell is not on the chart.');
    }
    if (!keys.has(stitch)) throw invalid('cells', 'That stitch is not in this craft.');
    if (!colours.has(colour)) throw invalid('cells', 'That colour is not in the key.');
    if (!Number.isInteger(rev)) throw invalid('cells', 'Send each cell revision.');
    return { row, col, stitch, colour, rev };
  });
}

async function writeCell(
  patternId: string,
  editor: string,
  cell: { row: number; col: number; stitch: string; colour: string },
): Promise<number> {
  const updated = await one<{ rev: number }>(
    `update cells set stitch = $4, colour = $5, rev = rev + 1, last_editor = $6
     where pattern_id = $1 and row = $2 and col = $3 returning rev`,
    [patternId, cell.row, cell.col, cell.stitch, cell.colour, editor],
  );
  return updated!.rev;
}

export function registerChartRoutes(router: Router): void {
  router.get('/api/patterns', async (ctx) => {
    const user = await requireUser(ctx);
    const rows = await query<{ id: string; name: string; state: string; role: string }>(
      `select p.id, p.name, p.state, 'owner' as role from patterns p where p.owner_id = $1
       union all
       select p.id, p.name, p.state, 'co-designer' as role from patterns p
         join pattern_co_designers c on c.pattern_id = p.id where c.user_id = $1
       union all
       select p.id, p.name, p.state, 'tester' as role from patterns p
         join testers t on t.pattern_id = p.id
         where t.user_id = $1 and t.status = 'accepted'`,
      [user.id],
    );
    return { patterns: rows };
  });

  router.post('/api/patterns', async (ctx) => {
    const user = await requireUser(ctx);
    const sample = ctx.body.sample === true;
    let name: string;
    let kind = CHART_KINDS[0];
    let rows: number;
    let columns: number;
    let castOn: number;

    if (sample) {
      name = 'Sample swatch';
      rows = 7;
      columns = 12;
      castOn = 12;
    } else {
      name = typeof ctx.body.name === 'string' ? ctx.body.name.trim() : '';
      if (name === '') throw invalid('name', copy.patternName);
      if (name.length > 120) throw invalid('name', copy.patternNameLong);
      const label = typeof ctx.body.kind === 'string' ? ctx.body.kind : '';
      const found = CHART_KINDS.find((entry) => entry.label === label);
      if (!found) throw invalid('kind', copy.patternKind);
      kind = found;
      rows = Number(ctx.body.rows);
      if (!Number.isInteger(rows) || rows < 1 || rows > limits.maxChartRows) {
        throw invalid('rows', copy.patternRows);
      }
      columns = Number(ctx.body.columns);
      if (!Number.isInteger(columns) || columns < 1 || columns > limits.maxChartCols) {
        throw invalid('columns', copy.patternColumns);
      }
      castOn = Number(ctx.body.castOn);
      if (!Number.isInteger(castOn) || castOn < 1) throw invalid('castOn', copy.patternCastOn);
    }

    const id = randomUUID();
    await query(
      `insert into patterns (id, owner_id, name, craft, mode, terms, cast_on, width, height)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, user.id, name, kind.craft, kind.mode, kind.terms, castOn, columns, rows],
    );
    for (const colour of kind.colours) {
      await query('insert into colours (pattern_id, letter, name, hex) values ($1, $2, $3, $4)', [
        id,
        colour.letter,
        colour.name,
        colour.hex,
      ]);
    }
    await writeBlankCells(id, columns, rows);
    if (sample) {
      for (const [row, line] of Object.entries(SAMPLE_ROWS)) {
        const stitches = line.split(' ');
        for (let col = 1; col <= stitches.length; col += 1) {
          await query(
            'update cells set stitch = $4 where pattern_id = $1 and row = $2 and col = $3',
            [id, Number(row), col, stitches[col - 1]],
          );
        }
      }
    }
    ctx.res.statusCode = 201;
    return { id };
  });

  router.get('/api/patterns/:id', async (ctx) => {
    const user = await requireUser(ctx);
    const { pattern, role } = await designerPattern(user, ctx.params.id);
    const { chart, analysis } = await loadState(pattern);
    return {
      role,
      id: pattern.id,
      name: pattern.name,
      craft: pattern.craft,
      mode: pattern.mode,
      terms: pattern.terms,
      castOn: pattern.cast_on,
      width: pattern.width,
      height: pattern.height,
      colours: chart.colours,
      repeats: chart.repeats,
      cells: cellsPayload(chart),
      rows: await designerRows(pattern, analysis),
      colourWarnings: analysis.colourWarnings,
      version: await latestVersion(pattern.id),
      state: pattern.state,
      testers: await testerList(pattern.id),
    };
  });

  router.post('/api/patterns/:id/cells', async (ctx) => {
    const user = await requireUser(ctx);
    const { pattern } = await designerPattern(user, ctx.params.id);
    checkEditRate(user.id);
    const opId = typeof ctx.body.opId === 'string' ? ctx.body.opId : '';
    const earlier = opId ? await replayedOp(pattern.id, opId) : null;
    if (earlier) return earlier;
    if (opId === '') throw invalid('opId', 'Send an opId for each edit.');

    return withPatternLock(pattern.id, async () => {
      const repeated = await replayedOp(pattern.id, opId);
      if (repeated) return repeated;
      const chart = await chartOf(pattern);
      const edits = readCellEdits(ctx.body, chart);
      const applied: { row: number; col: number; rev: number }[] = [];
      const conflicts: {
        row: number;
        col: number;
        by: string;
        stitch: string;
        colour: string;
        rev: number;
      }[] = [];
      const changed: EditedCell[] = [];

      for (const edit of edits) {
        const current = await one<{
          rev: number;
          stitch: string;
          colour: string;
          editor: string | null;
        }>(
          `select c.rev, c.stitch, c.colour, u.name as editor
           from cells c left join users u on u.id = c.last_editor
           where c.pattern_id = $1 and c.row = $2 and c.col = $3`,
          [pattern.id, edit.row, edit.col],
        );
        if (!current) throw invalid('cells', 'That cell is not on the chart.');
        if (current.rev !== edit.rev) {
          conflicts.push({
            row: edit.row,
            col: edit.col,
            by: current.editor ?? '',
            stitch: current.stitch,
            colour: current.colour,
            rev: current.rev,
          });
          continue;
        }
        const rev = await writeCell(pattern.id, user.id, edit);
        applied.push({ row: edit.row, col: edit.col, rev });
        changed.push({ ...edit, rev });
      }

      const analysis = analyse(await chartOf(pattern));
      const response = { applied, conflicts, rows: await designerRows(pattern, analysis) };
      await rememberOp(pattern.id, opId, response);
      if (changed.length > 0) await publishCells(pattern, user, changed, analysis, true);
      return response;
    });
  });

  router.post('/api/patterns/:id/mirror', async (ctx) => {
    const user = await requireUser(ctx);
    const { pattern } = await designerPattern(user, ctx.params.id);
    checkEditRate(user.id);
    const opId = typeof ctx.body.opId === 'string' ? ctx.body.opId : '';
    const earlier = opId ? await replayedOp(pattern.id, opId) : null;
    if (earlier) return earlier;
    if (opId === '') throw invalid('opId', 'Send an opId for each edit.');

    return withPatternLock(pattern.id, async () => {
      const chart = await chartOf(pattern);
      const fromRow = readRange(ctx.body, 'fromRow', 1, chart.height);
      const toRow = readRange(ctx.body, 'toRow', fromRow, chart.height);
      const fromCol = readRange(ctx.body, 'fromCol', 1, chart.width);
      const toCol = readRange(ctx.body, 'toCol', fromCol, chart.width);
      if (selectionTouchesRepeat(chart, fromRow, toRow, fromCol, toCol)) {
        throw conflict('crosses_repeat', copy.mirrorCrossesRepeat);
      }
      const mirrored = mirrorSelection(chart, fromRow, toRow, fromCol, toCol);
      const applied: EditedCell[] = [];
      for (const cell of mirrored) {
        const rev = await writeCell(pattern.id, user.id, cell);
        applied.push({ ...cell, rev });
      }
      const analysis = analyse(await chartOf(pattern));
      const response = { applied, conflicts: [], rows: await designerRows(pattern, analysis) };
      await rememberOp(pattern.id, opId, response);
      await publishCells(pattern, user, applied, analysis, true);
      return response;
    });
  });

  router.post('/api/patterns/:id/text', async (ctx) => {
    const user = await requireUser(ctx);
    const { pattern } = await designerPattern(user, ctx.params.id);
    checkEditRate(user.id);

    return withPatternLock(pattern.id, async () => {
      const chart = await chartOf(pattern);
      const analysis = analyse(chart);
      const row = Number(ctx.body.row);
      if (!Number.isInteger(row) || row < 1 || row > chart.height) {
        throw invalid('row', 'That row is not on the chart.');
      }
      const text = typeof ctx.body.text === 'string' ? ctx.body.text : '';
      const boxError = repeatBoxTextError(chart, row);
      if (boxError) {
        ctx.res.statusCode = 422;
        return { error: 'invalid', field: 'text', message: boxError, position: null };
      }
      const result = parseAndApplyRowText(chart, row, text, analysis.rows[row - 1].needed);
      if (!result.ok) {
        ctx.res.statusCode = 422;
        return { error: 'invalid', field: 'text', message: result.message, position: result.position };
      }
      const changed: EditedCell[] = [];
      for (const value of result.cells) {
        const current = chart.cells.find((cell) => cell.row === row && cell.col === value.col)!;
        if (current.stitch === value.stitch && current.colour === value.colour) continue;
        const rev = await writeCell(pattern.id, user.id, { row, ...value });
        changed.push({ row, col: value.col, stitch: value.stitch, colour: value.colour, rev });
      }
      const after = await chartOf(pattern);
      const afterAnalysis = analyse(after);
      if (changed.length > 0) await publishCells(pattern, user, changed, afterAnalysis, true);
      return {
        changed: changed.length,
        cells: after.cells.filter((cell) => cell.row === row).sort((a, b) => a.col - b.col),
        rows: await designerRows(pattern, afterAnalysis),
      };
    });
  });

  router.post('/api/patterns/:id/repeats', async (ctx) => {
    const user = await requireUser(ctx);
    const { pattern } = await designerPattern(user, ctx.params.id);
    checkEditRate(user.id);

    return withPatternLock(pattern.id, async () => {
      const chart = await chartOf(pattern);
      const fromCol = readRange(ctx.body, 'fromCol', 1, chart.width);
      const toCol = readRange(ctx.body, 'toCol', fromCol, chart.width);
      const fromRow = readRange(ctx.body, 'fromRow', 1, chart.height);
      const toRow = readRange(ctx.body, 'toRow', fromRow, chart.height);
      let times = 2;
      if (ctx.body.times !== undefined) {
        times = Number(ctx.body.times);
        if (!Number.isInteger(times) || times < 2 || times > 20) {
          throw invalid('times', copy.repeatTimes);
        }
      }
      const wanted = { fromCol, toCol, fromRow, toRow };
      if (chart.repeats.some((box) => boxesOverlap(box, wanted))) {
        throw conflict('overlap', copy.repeatOverlap);
      }
      const asked = typeof ctx.body.id === 'string' ? ctx.body.id : '';
      const id =
        asked !== '' && !chart.repeats.some((box) => box.id === asked)
          ? asked
          : nextRepeatId(chart.repeats);
      await query(
        `insert into repeats (pattern_id, id, from_col, to_col, from_row, to_row, times)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [pattern.id, id, fromCol, toCol, fromRow, toRow, times],
      );
      await query(
        `update cells set repeat_id = $2 where pattern_id = $1
         and row between $3 and $4 and col between $5 and $6`,
        [pattern.id, id, fromRow, toRow, fromCol, toCol],
      );
      const after = await chartOf(pattern);
      const analysis = analyse(after);
      await publishChart(pattern, user);
      ctx.res.statusCode = 201;
      return {
        id,
        times,
        cells: cellsPayload(after),
        rows: await designerRows(pattern, analysis),
      };
    });
  });

  router.patch('/api/patterns/:id/repeats/:repeatId', async (ctx) => {
    const user = await requireUser(ctx);
    const { pattern } = await designerPattern(user, ctx.params.id);
    const box = await repeatBox(pattern, ctx.params.repeatId);
    const times = Number(ctx.body.times);
    if (!Number.isInteger(times) || times < 2 || times > 20) throw invalid('times', copy.repeatTimes);
    await query('update repeats set times = $3 where pattern_id = $1 and id = $2', [
      pattern.id,
      box.id,
      times,
    ]);
    const analysis = analyse(await chartOf(pattern));
    await publishChart(pattern, user);
    return { rows: await designerRows(pattern, analysis) };
  });

  router.delete('/api/patterns/:id/repeats/:repeatId', async (ctx) => {
    const user = await requireUser(ctx);
    const { pattern } = await designerPattern(user, ctx.params.id);
    const box = await repeatBox(pattern, ctx.params.repeatId);
    await query('update cells set repeat_id = null where pattern_id = $1 and repeat_id = $2', [
      pattern.id,
      box.id,
    ]);
    await query('delete from repeats where pattern_id = $1 and id = $2', [pattern.id, box.id]);
    const after = await chartOf(pattern);
    const analysis = analyse(after);
    await publishChart(pattern, user);
    return { cells: cellsPayload(after), rows: await designerRows(pattern, analysis) };
  });

  router.post('/api/patterns/:id/repeats/undo-expand', async (ctx) => {
    const user = await requireUser(ctx);
    const { pattern } = await designerPattern(user, ctx.params.id);
    checkEditRate(user.id);

    return withPatternLock(pattern.id, async () => {
      const chart = await chartOf(pattern);
      const id = typeof ctx.body.id === 'string' ? ctx.body.id : '';
      const fromCol = readRange(ctx.body, 'fromCol', 1, chart.width);
      const toCol = readRange(ctx.body, 'toCol', fromCol, chart.width);
      const fromRow = readRange(ctx.body, 'fromRow', 1, chart.height);
      const toRow = readRange(ctx.body, 'toRow', fromRow, chart.height);
      const times = Number(ctx.body.times);
      if (!Number.isInteger(times) || times < 2 || times > 20) throw invalid('times', copy.repeatTimes);
      const box: RepeatBox = { id, fromCol, toCol, fromRow, toRow, times };
      const shaped = undoExpandBox(chart, box);
      await replaceCells(pattern.id, shaped.cells, shaped.width, user.id);
      await query('delete from repeats where pattern_id = $1', [pattern.id]);
      for (const other of shaped.repeats) {
        await query(
          `insert into repeats (pattern_id, id, from_col, to_col, from_row, to_row, times)
           values ($1, $2, $3, $4, $5, $6, $7)`,
          [pattern.id, other.id, other.fromCol, other.toCol, other.fromRow, other.toRow, other.times],
        );
      }
      const after = await chartOf((await getPattern(pattern.id))!);
      const analysis = analyse(after);
      await publishChart(pattern, user);
      return {
        width: shaped.width,
        cells: cellsPayload(after),
        rows: await designerRows(pattern, analysis),
      };
    });
  });

  router.post('/api/patterns/:id/repeats/:repeatId/expand', async (ctx) => {
    const user = await requireUser(ctx);
    const { pattern } = await designerPattern(user, ctx.params.id);
    checkEditRate(user.id);
    const box = await repeatBox(pattern, ctx.params.repeatId);

    return withPatternLock(pattern.id, async () => {
      const chart = await chartOf(pattern);
      if (expandedWidth(chart, box) > limits.maxChartCols) {
        throw conflict('too_wide', copy.repeatTooWide);
      }
      const shaped = expandBox(chart, box);
      await replaceCells(pattern.id, shaped.cells, shaped.width, user.id);
      await query('delete from repeats where pattern_id = $1', [pattern.id]);
      for (const other of shaped.repeats) {
        await query(
          `insert into repeats (pattern_id, id, from_col, to_col, from_row, to_row, times)
           values ($1, $2, $3, $4, $5, $6, $7)`,
          [pattern.id, other.id, other.fromCol, other.toCol, other.fromRow, other.toRow, other.times],
        );
      }
      const after = await chartOf((await getPattern(pattern.id))!);
      const analysis = analyse(after);
      await publishChart(pattern, user);
      return {
        added: shaped.added,
        width: shaped.width,
        cells: cellsPayload(after),
        rows: await designerRows(pattern, analysis),
      };
    });
  });

  router.post('/api/patterns/:id/colours', async (ctx) => {
    const user = await requireUser(ctx);
    const { pattern } = await designerPattern(user, ctx.params.id);
    const name = typeof ctx.body.name === 'string' ? ctx.body.name.trim() : '';
    if (name === '') throw invalid('name', copy.colourName);
    const hex = typeof ctx.body.hex === 'string' ? ctx.body.hex.trim() : '';
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) throw invalid('hex', copy.colourHex);
    const chart = await chartOf(pattern);
    if (chart.colours.length >= limits.maxColours) {
      throw conflict('too_many_colours', copy.colourLimit);
    }
    const letter = String.fromCharCode(65 + chart.colours.length);
    await query('insert into colours (pattern_id, letter, name, hex) values ($1, $2, $3, $4)', [
      pattern.id,
      letter,
      name,
      hex,
    ]);
    await publishChart(pattern, user);
    ctx.res.statusCode = 201;
    return { letter };
  });

  router.post('/api/patterns/:id/co-designers', async (ctx) => {
    const user = await requireUser(ctx);
    const pattern = await ownerPattern(user, ctx.params.id);
    const email = typeof ctx.body.email === 'string' ? ctx.body.email.trim() : '';
    const mate = await one<{ id: string; name: string }>(
      'select id, name from users where lower(email) = lower($1)',
      [email],
    );
    if (!mate) throw invalid('email', copy.coDesignerUnknown);
    await query(
      `insert into pattern_co_designers (pattern_id, user_id) values ($1, $2)
       on conflict do nothing`,
      [pattern.id, mate.id],
    );
    return { id: mate.id, name: mate.name };
  });
}

function readRange(body: Record<string, unknown>, field: string, low: number, high: number): number {
  const value = Number(body[field]);
  if (!Number.isInteger(value) || value < low || value > high) {
    throw invalid(field, 'That is not a place on the chart.');
  }
  return value;
}

async function repeatBox(pattern: PatternRow, id: string): Promise<RepeatBox> {
  const row = await one<{
    id: string;
    from_col: number;
    to_col: number;
    from_row: number;
    to_row: number;
    times: number;
  }>('select * from repeats where pattern_id = $1 and id = $2', [pattern.id, id]);
  if (!row) throw notFound();
  return {
    id: row.id,
    fromCol: row.from_col,
    toCol: row.to_col,
    fromRow: row.from_row,
    toRow: row.to_row,
    times: row.times,
  };
}

export { designerRows, testerList };
