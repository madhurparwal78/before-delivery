import { compareCharts } from '../../src/domain/compare';
import { rowErrorCount, topRowStitches } from '../../src/domain/rows';
import { requireUser } from '../auth';
import { colourLimits, limits, today } from '../config';
import { copy, publishRowErrors } from '../copy';
import { one, query } from '../db';
import { conflict, invalid, notFound, type Router } from '../http';
import { publish } from '../live';
import { buildSheet } from '../pdf';
import {
  analyse,
  cellsPayload,
  chartOf,
  chartSnapshot,
  designerPattern,
  getPattern,
  latestVersion,
  loadVersionChart,
  replaceCells,
  roleOf,
  rowsPayload,
  withPatternLock,
  type PatternRow,
} from '../patterns';
async function versionNumber(pattern: PatternRow, raw: string): Promise<number> {
  const version = Number(raw);
  if (!Number.isInteger(version) || version < 1) throw notFound();
  const row = await one('select 1 from versions where pattern_id = $1 and version = $2', [
    pattern.id,
    version,
  ]);
  if (!row) throw notFound();
  return version;
}

export function registerVersionRoutes(router: Router): void {
  router.get('/api/patterns/:id/versions', async (ctx) => {
    const user = await requireUser(ctx);
    const { pattern } = await designerPattern(user, ctx.params.id);
    const rows = await query<{ version: number; note: string; saved_on: string; stitches: number }>(
      'select version, note, saved_on, stitches from versions where pattern_id = $1 order by version',
      [pattern.id],
    );
    return {
      versions: rows.map((row) => ({
        version: row.version,
        note: row.note,
        savedOn: row.saved_on,
        stitches: row.stitches,
      })),
    };
  });

  router.post('/api/patterns/:id/versions', async (ctx) => {
    const user = await requireUser(ctx);
    const { pattern } = await designerPattern(user, ctx.params.id);
    const note = typeof ctx.body.note === 'string' ? ctx.body.note : '';
    if (note.length > 200) throw invalid('note', copy.versionNoteLong);

    return withPatternLock(pattern.id, async () => {
      const chart = await chartOf(pattern);
      const version = (await latestVersion(pattern.id)) + 1;
      await query(
        `insert into versions (pattern_id, version, note, saved_on, stitches, snapshot)
         values ($1, $2, $3, $4, $5, $6)`,
        [
          pattern.id,
          version,
          note,
          today(),
          topRowStitches(analyse(chart)),
          JSON.stringify(chartSnapshot(chart)),
        ],
      );
      await publish(pattern.id, { kind: 'version', version, by: user.id });
      ctx.res.statusCode = 201;
      return { version };
    });
  });

  router.get('/api/patterns/:id/versions/:version', async (ctx) => {
    const user = await requireUser(ctx);
    const pattern = await getPattern(ctx.params.id);
    if (!pattern) throw notFound();
    const role = await roleOf(user, pattern);
    if (!role) throw notFound();
    const version = await versionNumber(pattern, ctx.params.version);
    if (role === 'tester') {
      const tester = await one<{ version: number | null }>(
        `select version from testers where pattern_id = $1 and user_id = $2 and status = 'accepted'`,
        [pattern.id, user.id],
      );
      if (!tester || tester.version !== version) throw notFound();
    }
    const loaded = await loadVersionChart(pattern, version);
    if (!loaded) throw notFound();
    const analysis = analyse(loaded.chart);
    return {
      version,
      note: loaded.note,
      savedOn: loaded.savedOn,
      castOn: loaded.chart.castOn,
      width: loaded.chart.width,
      height: loaded.chart.height,
      colours: loaded.chart.colours,
      repeats: loaded.chart.repeats,
      cells: cellsPayload(loaded.chart),
      rows: rowsPayload(analysis, null),
    };
  });

  router.post('/api/patterns/:id/versions/:version/restore', async (ctx) => {
    const user = await requireUser(ctx);
    const { pattern } = await designerPattern(user, ctx.params.id);
    const from = await versionNumber(pattern, ctx.params.version);

    return withPatternLock(pattern.id, async () => {
      const loaded = await loadVersionChart(pattern, from);
      if (!loaded) throw notFound();
      const chart = loaded.chart;
      const version = (await latestVersion(pattern.id)) + 1;
      await query(
        `insert into versions (pattern_id, version, note, saved_on, stitches, snapshot)
         values ($1, $2, $3, $4, $5, $6)`,
        [
          pattern.id,
          version,
          `Restored from version ${from}`,
          today(),
          topRowStitches(analyse(chart)),
          JSON.stringify(chartSnapshot(chart)),
        ],
      );
      await query('update patterns set cast_on = $2, height = $3 where id = $1', [
        pattern.id,
        chart.castOn,
        chart.height,
      ]);
      await replaceCells(
        pattern.id,
        chart.cells.map((cell) => ({
          row: cell.row,
          col: cell.col,
          stitch: cell.stitch,
          colour: cell.colour,
          repeat: cell.repeat,
        })),
        chart.width,
        user.id,
      );
      await query('delete from colours where pattern_id = $1', [pattern.id]);
      for (const colour of chart.colours) {
        await query('insert into colours (pattern_id, letter, name, hex) values ($1, $2, $3, $4)', [
          pattern.id,
          colour.letter,
          colour.name,
          colour.hex,
        ]);
      }
      await query('delete from repeats where pattern_id = $1', [pattern.id]);
      for (const box of chart.repeats) {
        await query(
          `insert into repeats (pattern_id, id, from_col, to_col, from_row, to_row, times)
           values ($1, $2, $3, $4, $5, $6, $7)`,
          [pattern.id, box.id, box.fromCol, box.toCol, box.fromRow, box.toRow, box.times],
        );
      }
      await publish(pattern.id, { kind: 'chart', by: user.id, byName: user.name });
      await publish(pattern.id, { kind: 'version', version, by: user.id });
      ctx.res.statusCode = 201;
      return { version, restoredFrom: from };
    });
  });

  router.get('/api/patterns/:id/compare', async (ctx) => {
    const user = await requireUser(ctx);
    const { pattern } = await designerPattern(user, ctx.params.id);
    const a = await versionNumber(pattern, ctx.query.get('a') ?? '');
    const b = await versionNumber(pattern, ctx.query.get('b') ?? '');
    const from = await loadVersionChart(pattern, a);
    const to = await loadVersionChart(pattern, b);
    if (!from || !to) throw notFound();
    const result = compareCharts(from.chart, to.chart, colourLimits);
    return { a, b, ...result };
  });

  router.post('/api/patterns/:id/publish', async (ctx) => {
    const user = await requireUser(ctx);
    const { pattern } = await designerPattern(user, ctx.params.id);
    const version = await latestVersion(pattern.id);
    if (version === 0) throw conflict('no_version', copy.publishNoVersion);
    const working = rowErrorCount(analyse(await chartOf(pattern)));
    if (working > 0) throw conflict('row_errors', publishRowErrors(working));
    const loaded = await loadVersionChart(pattern, version);
    const saved = loaded ? rowErrorCount(analyse(loaded.chart)) : 0;
    if (saved > 0) throw conflict('row_errors', publishRowErrors(saved));
    await query(`update patterns set state = 'published', published_version = $2 where id = $1`, [
      pattern.id,
      version,
    ]);
    await publish(pattern.id, { kind: 'published', version, by: user.id });
    return { state: 'published', version };
  });

  router.get('/api/public/:id', async (ctx) => {
    const pattern = await getPattern(ctx.params.id);
    if (!pattern || pattern.state !== 'published' || !pattern.published_version) throw notFound();
    const loaded = await loadVersionChart(pattern, pattern.published_version);
    if (!loaded) throw notFound();
    const analysis = analyse(loaded.chart);
    return {
      id: pattern.id,
      name: pattern.name,
      craft: pattern.craft,
      mode: pattern.mode,
      terms: pattern.terms,
      version: pattern.published_version,
      castOn: loaded.chart.castOn,
      width: loaded.chart.width,
      height: loaded.chart.height,
      colours: loaded.chart.colours,
      repeats: loaded.chart.repeats,
      cells: cellsPayload(loaded.chart),
      rows: rowsPayload(analysis, null),
    };
  });

  router.get('/api/patterns/:id/sheet.pdf', async (ctx) => {
    const pattern = await getPattern(ctx.params.id);
    if (!pattern || pattern.state !== 'published' || !pattern.published_version) throw notFound();
    const loaded = await loadVersionChart(pattern, pattern.published_version);
    if (!loaded) throw notFound();
    const analysis = analyse(loaded.chart);
    const sheet = buildSheet({
      name: pattern.name,
      version: pattern.published_version,
      castOn: loaded.chart.castOn,
      chart: loaded.chart,
      lines: analysis.rows.filter((row) => row.text !== '').map((row) => row.text),
      linesPerPage: limits.sheetLinesPerPage,
    });
    ctx.res.writeHead(200, {
      'content-type': 'application/pdf',
      'content-length': sheet.length,
      'content-disposition': `inline; filename="sheet.pdf"`,
      'cache-control': 'no-store',
    });
    ctx.res.end(sheet);
    return null;
  });
}
