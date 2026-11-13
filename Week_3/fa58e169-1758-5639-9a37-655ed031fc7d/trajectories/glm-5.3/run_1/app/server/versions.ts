import { env, sql } from "../common/env";
import { s } from "../common/copy";
import { versionNoteError } from "../common/validate";
import {
  conflict,
  designerAccess,
  invalid,
  notFound,
  parseString,
  readBody,
  requireUser,
  route,
  sendRows,
  type RouteMatch,
  type SessionUser,
} from "./routes";
import { loadColours, loadPattern, computePattern } from "./services/patterns";
import type { LiveHub } from "./live/hub";
import type { StoredChart } from "./db/store";
import { checkChart } from "./chart/check";
import type { IncomingMessage, ServerResponse } from "node:http";

export interface RouteDeps {
  hub: LiveHub;
}

interface StoredVersion {
  version: number;
  note: string;
  saved_on: string;
  stitches: number;
  chart: StoredChart;
}

export { versionChartRows, countStitches, compareCharts };

function versionChartRows(chart: StoredChart, colours: { letter: string; name: string; hex: string }[], noteCounts: Map<number, number>) {
  const check = checkChart({
    craft: chart.craft,
    mode: chart.mode,
    terms: chart.terms,
    castOn: chart.castOn,
    width: chart.width,
    height: chart.height,
    repeats: chart.repeats ?? [],
    cells: chart.cells.map((cell) => ({ row: cell.row, col: cell.col, stitch: cell.stitch, colour: cell.colour })),
  });
  return check.rows.map((row) => ({
    row: row.row,
    side: row.side,
    used: row.used,
    made: row.made,
    state: row.state,
    errors: row.errors,
    text: row.text,
    notes: noteCounts.get(row.row) ?? 0,
  }));
}

export function registerVersionRoutes(deps: RouteDeps): void {
  const hub = deps.hub;

  route("GET", "/api/patterns/<id>/versions", true, async (_req: IncomingMessage, res: ServerResponse, match: RouteMatch, userRaw: SessionUser | null) => {
    const user = requireUser(userRaw);
    const access = await designerAccess(user, match.params['id'], ["owner", "co-designer"]);
    const rows = await sql<StoredVersion>(
      `SELECT version, note, saved_on, stitches, chart FROM versions WHERE pattern_id = $1 ORDER BY version`,
      [access.pattern.id],
    );
    sendRows(res, 200, {
      versions: rows.map((row) => ({ version: row.version, note: row.note, savedOn: row.saved_on, stitches: row.stitches })),
    });
    return true;
  });

  route("POST", "/api/patterns/<id>/versions", true, async (req: IncomingMessage, res: ServerResponse, match: RouteMatch, userRaw: SessionUser | null) => {
    const user = requireUser(userRaw);
    const access = await designerAccess(user, match.params['id'], ["owner", "co-designer"]);
    const body = (await readBody(req, res)).body as Record<string, unknown> | undefined;
    const note = parseString(body?.note);
    const noteError = versionNoteError(note);
    if (noteError) throw invalid(noteError.field, noteError.message);
    const pattern = access.pattern;
    const latest = await sql<{ version: number }>(
      `SELECT version FROM versions WHERE pattern_id = $1 ORDER BY version DESC LIMIT 1`,
      [pattern.id],
    );
    const next = (latest[0]?.version ?? 0) + 1;
    await sql(
      `INSERT INTO versions (pattern_id, version, note, saved_on, stitches, chart)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [pattern.id, next, note, env.today, countStitches(pattern.chart), JSON.stringify(pattern.chart)],
    );
    hub.publish(pattern.id, { type: "version", by: user.id, version: next, savedOn: env.today });
    sendRows(res, 201, { version: next });
    return true;
  });

  route("GET", "/api/patterns/<id>/versions/<n>", true, async (_req: IncomingMessage, res: ServerResponse, match: RouteMatch, userRaw: SessionUser | null) => {
    const user = requireUser(userRaw);
    const patternId = match.params['id'];
    const versionNumber = Number.parseInt(match.params['n'], 10);
    const pattern = await loadPattern(patternId);
    if (!pattern) throw notFound();
    if (pattern.owner_id !== user.id && !(await isCoDesigner(patternId, user.id))) {
      const testerRow = await sql<{ version: number }>(
        `SELECT version FROM testers WHERE pattern_id = $1 AND user_id = $2`,
        [patternId, user.id],
      );
      if (!testerRow[0] || testerRow[0].version !== versionNumber) throw notFound();
    }
    const rows = await sql<StoredVersion>(
      `SELECT version, note, saved_on, stitches, chart FROM versions WHERE pattern_id = $1 AND version = $2`,
      [patternId, versionNumber],
    );
    const version = rows[0];
    if (!version) throw notFound();
    const colours = await loadColours(patternId);
    const emptyCounts = new Map<number, number>();
    sendRows(res, 200, {
      version: version.version,
      note: version.note,
      savedOn: version.saved_on,
      castOn: version.chart.castOn,
      width: version.chart.width,
      height: version.chart.height,
      colours: colours.map((colour) => ({ letter: colour.letter, name: colour.name, hex: colour.hex })),
      repeats: version.chart.repeats ?? [],
      cells: version.chart.cells,
      rows: versionChartRows(version.chart, colours, emptyCounts),
    });
    return true;
  });

  route("POST", "/api/patterns/<id>/versions/<n>/restore", true, async (_req: IncomingMessage, res: ServerResponse, match: RouteMatch, userRaw: SessionUser | null) => {
    const user = requireUser(userRaw);
    const access = await designerAccess(user, match.params['id'], ["owner", "co-designer"]);
    const sourceNumber = Number.parseInt(match.params['n'], 10);
    const pattern = access.pattern;
    const rows = await sql<StoredVersion>(
      `SELECT version, chart FROM versions WHERE pattern_id = $1 AND version = $2`,
      [pattern.id, sourceNumber],
    );
    const source = rows[0];
    if (!source) throw notFound();
    const latest = await sql<{ version: number }>(
      `SELECT version FROM versions WHERE pattern_id = $1 ORDER BY version DESC LIMIT 1`,
      [pattern.id],
    );
    const next = (latest[0]?.version ?? 0) + 1;
    const restored: StoredChart = {
      ...source.chart,
      cells: source.chart.cells.map((cell) => ({ ...cell, rev: cell.rev + 1 })),
    };
    await sql(
      `INSERT INTO versions (pattern_id, version, note, saved_on, stitches, chart)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [pattern.id, next, `Restored from version ${sourceNumber}`, env.today, countStitches(source.chart), JSON.stringify(restored)],
    );
    await sql(`UPDATE patterns SET chart = $1, width = $2, height = $3, cast_on = $4 WHERE id = $5`, [
      JSON.stringify(restored),
      restored.width,
      restored.height,
      restored.castOn,
      pattern.id,
    ]);
    hub.publish(pattern.id, { type: "version", by: user.id, version: next, savedOn: env.today });
    sendRows(res, 201, { version: next, restoredFrom: sourceNumber });
    return true;
  });

  route("GET", "/api/patterns/<id>/compare", true, async (req: IncomingMessage, res: ServerResponse, match: RouteMatch, userRaw: SessionUser | null) => {
    const user = requireUser(userRaw);
    const access = await designerAccess(user, match.params['id'], ["owner", "co-designer"]);
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const a = Number.parseInt(url.searchParams.get("a") ?? "", 10);
    const b = Number.parseInt(url.searchParams.get("b") ?? "", 10);
    if (!Number.isFinite(a) || !Number.isFinite(b)) throw notFound();
    const colours = await loadColours(access.pattern.id);
    const versions = await sql<StoredVersion>(
      `SELECT version, note, saved_on, stitches, chart FROM versions WHERE pattern_id = $1 AND version IN ($2, $3)`,
      [access.pattern.id, a, b],
    );
    const versionA = versions.find((entry) => entry.version === a);
    const versionB = versions.find((entry) => entry.version === b);
    if (!versionA || !versionB) throw notFound();
    const result = compareCharts(versionA.chart, versionB.chart, versionA.stitches, versionB.stitches);
    sendRows(res, 200, {
      a,
      b,
      ...result,
      craft: versionB.chart.craft,
      mode: versionB.chart.mode,
      terms: versionB.chart.terms,
      castOn: versionB.chart.castOn,
      width: versionB.chart.width,
      height: versionB.chart.height,
      colours,
      repeats: versionB.chart.repeats ?? [],
    });
    return true;
  });

  route("POST", "/api/patterns/<id>/publish", true, async (_req: IncomingMessage, res: ServerResponse, match: RouteMatch, userRaw: SessionUser | null) => {
    const user = requireUser(userRaw);
    const access = await designerAccess(user, match.params['id'], ["owner", "co-designer"]);
    const pattern = access.pattern;
    const latest = await sql<{ version: number }>(
      `SELECT version FROM versions WHERE pattern_id = $1 ORDER BY version DESC LIMIT 1`,
      [pattern.id],
    );
    if (!latest[0]) throw conflict("no_version", s.publishNoVersion);
    const colours = await loadColours(pattern.id);
    const computed = computePattern(pattern, colours);
    if (computed.errors.length > 0) {
      throw conflict(
        "row_errors",
        `Fix ${computed.errors.length} ${computed.errors.length === 1 ? "row error" : "row errors"} before publishing.`,
      );
    }
    const savedChart = await sql<{ chart: StoredChart }>(
      `SELECT chart FROM versions WHERE pattern_id = $1 AND version = $2`,
      [pattern.id, latest[0].version],
    );
    const saved = savedChart[0];
    if (saved) {
      const savedCheck = checkChart({
        craft: pattern.craft,
        mode: pattern.mode,
        terms: pattern.terms,
        castOn: saved.chart.castOn,
        width: saved.chart.width,
        height: saved.chart.height,
        repeats: saved.chart.repeats ?? [],
        cells: saved.chart.cells.map((cell) => ({ row: cell.row, col: cell.col, stitch: cell.stitch, colour: cell.colour })),
      });
      if (savedCheck.errors.length > 0) {
        throw conflict(
          "row_errors",
          `Fix ${savedCheck.errors.length} ${savedCheck.errors.length === 1 ? "row error" : "row errors"} before publishing.`,
        );
      }
    }
    await sql(`UPDATE patterns SET state = 'published', published_version = $1 WHERE id = $2`, [
      latest[0].version,
      pattern.id,
    ]);
    sendRows(res, 200, { state: "published", version: latest[0].version });
    return true;
  });
}

function countStitches(chart: StoredChart): number {
  const check = checkChart({
    craft: chart.craft,
    mode: chart.mode,
    terms: chart.terms,
    castOn: chart.castOn,
    width: chart.width,
    height: chart.height,
    repeats: chart.repeats ?? [],
    cells: chart.cells.map((cell) => ({ row: cell.row, col: cell.col, stitch: cell.stitch, colour: cell.colour })),
  });
  let topMade = 0;
  for (let row = chart.height; row >= 1; row--) {
    const entry = check.byRow.get(row);
    if (entry && entry.items.length > 0) {
      topMade = entry.made;
      break;
    }
  }
  return topMade;
}

export interface CompareResult {
  rowsChanged: number;
  rowsAdded: number;
  rowsRemoved: number;
  cellsChanged: number;
  stitchesFrom: number;
  stitchesTo: number;
  summary: string;
  cells: { row: number; col: number; stitch: string; colour: string; diff: string }[];
}

/** The one place the compare rule is decided: pairing by row and column number. */
function compareCharts(a: StoredChart, b: StoredChart, stitchesA: number, stitchesB: number): CompareResult {
  const cellsA = new Map(a.cells.map((cell) => [`${cell.row}:${cell.col}`, cell]));
  const cellsB = new Map(b.cells.map((cell) => [`${cell.row}:${cell.col}`, cell]));
  const changedRows: number[] = [];
  const changedCells: CompareResult["cells"] = [];
  let cellsChanged = 0;
  const sharedHeight = Math.min(a.height, b.height);
  for (let row = 1; row <= sharedHeight; row++) {
    let rowChanged = false;
    const maxWidth = Math.max(a.width, b.width);
    for (let col = 1; col <= maxWidth; col++) {
      const left = cellsA.get(`${row}:${col}`);
      const right = cellsB.get(`${row}:${col}`);
      const inA = col <= a.width;
      const inB = col <= b.width;
      if (!inA && inB) {
        rowChanged = true;
        cellsChanged++;
        changedCells.push({ row, col, stitch: right?.stitch ?? "ns", colour: right?.colour ?? "A", diff: "added" });
        continue;
      }
      if (inA && inB) {
        const same = left?.stitch === right?.stitch && left?.colour === right?.colour;
        if (!same) {
          rowChanged = true;
          cellsChanged++;
          changedCells.push({ row, col, stitch: right?.stitch ?? "ns", colour: right?.colour ?? "A", diff: "changed" });
        } else {
          changedCells.push({ row, col, stitch: right?.stitch ?? "ns", colour: right?.colour ?? "A", diff: "same" });
        }
      }
    }
    if (rowChanged) changedRows.push(row);
  }
  const rowsAdded = Math.max(0, b.height - a.height);
  const rowsRemoved = Math.max(0, a.height - b.height);
  for (let row = sharedHeight + 1; row <= b.height; row++) {
    for (let col = 1; col <= b.width; col++) {
      const right = cellsB.get(`${row}:${col}`);
      changedCells.push({ row, col, stitch: right?.stitch ?? "ns", colour: right?.colour ?? "A", diff: "added" });
    }
  }
  const summary =
    `${changedRows.length === 1 ? "1 row changed" : `${changedRows.length} rows changed`}, ` +
    `${rowsAdded === 1 ? "1 row added" : `${rowsAdded} rows added`}, ` +
    `${rowsRemoved === 1 ? "1 row removed" : `${rowsRemoved} rows removed`}, ` +
    `${cellsChanged === 1 ? "1 cell changed" : `${cellsChanged} cells changed`}. ` +
    `Stitches ${stitchesA} to ${stitchesB}.`;
  return {
    rowsChanged: changedRows.length,
    rowsAdded,
    rowsRemoved,
    cellsChanged,
    stitchesFrom: stitchesA,
    stitchesTo: stitchesB,
    summary,
    cells: changedCells,
  };
}

async function isCoDesigner(patternId: string, userId: string): Promise<boolean> {
  const rows = await sql<{ user_id: string }>(
    `SELECT user_id FROM co_designers WHERE pattern_id = $1 AND user_id = $2`,
    [patternId, userId],
  );
  return rows.length > 0;
}
