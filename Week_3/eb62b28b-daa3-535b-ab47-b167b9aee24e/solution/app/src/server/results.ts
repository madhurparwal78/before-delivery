// Results: the file reader and unit conversion, the marker band's data, corrections and the history file.

import { createHash, randomUUID } from "node:crypto";
import type { MarkerResults, PreviewRow, ResultEntry } from "../shared/api";
import { FLAG_LABEL } from "../shared/labels";
import { localDate, wholeSeconds } from "../shared/time";
import { CATEGORIES, MARKERS, markerById, markerMatching, type Marker } from "./catalog";
import { config } from "./config";
import { inTransaction, one, pool, rows, type Db } from "./db";
import { compareDecimals, dividedBy, isDecimal, parseDecimal, roundedText, times } from "./decimal";
import { notReady, requireCollectedOrReady, requireReady } from "./drawStates";
import { loadDraw, type DrawRow } from "./draws";
import { conflict, invalid, notFound, reportStore503 } from "./errors";
import { records, text, type JsonBody } from "./fields";
import { kitCodeRefusal, normalizeKitCode } from "./kitCodes";
import { enqueueMail } from "./mail";
import type { LiveMember } from "./members";
import { ageBandOn, flagOf, rangeFor, rangeTables, tableInForce } from "./ranges";
import { getObject, putObject, StoreUnavailable } from "./store";

const HEADER = "kitCode,marker,value,unit";

const normalizeUnit = (unit: string): string => unit.toLowerCase().replace(/^u/, "µ").replace(/μ/g, "µ");

// The lab value in the practice unit, in exact decimals rounded half up to the marker's decimals.
function converted(marker: Marker, value: string, unit: string): string | null {
  const wanted = normalizeUnit(unit);
  const step = marker.units.find((entry) => normalizeUnit(entry.unit) === wanted);
  if (!step) return null;
  const reading = parseDecimal(value);
  const factor = parseDecimal(step.factor);
  return step.step === "times" ? times(reading, factor, marker.decimals) : dividedBy(reading, factor, marker.decimals);
}

function decodeFile(file: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(file);
  } catch {
    throw invalid({ file: "The results file must be UTF-8 text." });
  }
}

export async function savedValues(db: Db, drawId: string): Promise<Map<string, string>> {
  const saved = await rows<{ marker: string; value: string }>(db, "SELECT marker, value FROM results WHERE draw_id = $1", [drawId]);
  return new Map(saved.map((row) => [row.marker, row.value]));
}

// Reads the file as published. Nothing is written here; preview and save both start from these rows.
export function readResultsFile(file: Buffer, draw: DrawRow, saved: ReadonlyMap<string, string>): PreviewRow[] {
  const lines = decodeFile(file).split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  if (lines[0] !== HEADER) throw invalid({ file: "The first row must be kitCode,marker,value,unit." });
  const held = new Map(saved);
  return lines.slice(1).map((line, index): PreviewRow => {
    const row = index + 2;
    const cells = line.split(",");
    if (cells.length < 4) return { row, status: "refused", reason: "Row needs kitCode, marker, value and unit." };
    const kitCode = cells[0] ?? "";
    const unit = cells.at(-1) ?? "";
    const value = cells.at(-2) ?? "";
    const written = cells.slice(1, -2).join(",");
    const marker = markerMatching(written);
    if (!marker) return { row, status: "unknown", reason: `No marker matches "${written}".` };
    const onDraw = kitCodeRefusal(kitCode) === null && draw.kit_codes.includes(normalizeKitCode(kitCode));
    if (!onDraw) return { row, status: "refused", reason: "Kit code isn't on this draw." };
    if (!isDecimal(value)) return { row, status: "refused", reason: "Value isn't a number." };
    const practiceValue = converted(marker, value, unit);
    if (practiceValue === null) return { row, status: "refused", reason: `Unit isn't accepted for ${marker.name}.` };
    const already = held.get(marker.id);
    if (already !== undefined && compareDecimals(parseDecimal(already), parseDecimal(practiceValue)) !== 0) {
      return { row, status: "refused", reason: "Already saved with a different value; correct it on the result instead." };
    }
    held.set(marker.id, practiceValue);
    return {
      row,
      status: "matched",
      kitCode: normalizeKitCode(kitCode),
      marker: marker.id,
      value: practiceValue,
      unit: marker.unit,
      source: { marker: written, value, unit },
    };
  });
}

function reportKey(memberId: string, drawId: string): string {
  return `members/${memberId}/draws/${drawId}/report.pdf`;
}

function requirePdf(report: Buffer | undefined): Buffer {
  if (!report || report.length === 0) throw invalid({ report: "Attach the lab's report PDF." });
  if (report.subarray(0, 5).toString("latin1") !== "%PDF-") throw invalid({ report: "The report must be a PDF file." });
  return report;
}

const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

// One report per draw: the same bytes change nothing, different bytes are refused, new bytes reach MinIO first.
async function storeReport(db: Db, draw: DrawRow, report: Buffer): Promise<string> {
  const hash = sha256(report);
  // The draw's row lock lets one report through at a time, so two different files can't both pass this check.
  await db.query("SELECT id FROM draws WHERE id = $1 FOR UPDATE", [draw.id]);
  const existing = await one<{ sha256: string }>(db, "SELECT sha256 FROM reports WHERE draw_id = $1", [draw.id]);
  if (existing && existing.sha256 !== hash) throw conflict("report_exists", "This draw already has a different report.");
  if (!existing) {
    try {
      await putObject(reportKey(draw.member_id, draw.id), report);
    } catch (error) {
      if (error instanceof StoreUnavailable) throw reportStore503();
      throw error;
    }
  }
  return hash;
}

// A draw is Ready only with results saved and the report stored.
async function settleReady(db: Db, drawId: string): Promise<void> {
  await db.query(
    `UPDATE draws SET state = 'ready' WHERE id = $1 AND state = 'collected'
     AND EXISTS (SELECT 1 FROM reports WHERE draw_id = $1) AND EXISTS (SELECT 1 FROM results WHERE draw_id = $1)`,
    [drawId],
  );
}

async function writeResult(db: Db, drawId: string, marker: string, value: string, by: string, now: Date): Promise<boolean> {
  const id = randomUUID();
  const inserted = await one(
    db,
    "INSERT INTO results (id, draw_id, marker, value) VALUES ($1, $2, $3, $4) ON CONFLICT (draw_id, marker) DO NOTHING RETURNING id",
    [id, drawId, marker, value],
  );
  if (inserted) {
    await db.query("INSERT INTO result_history (result_id, value, by_name, at) VALUES ($1, $2, $3, $4)", [id, value, by, now]);
    return true;
  }
  return false;
}

export async function saveResultsFile(draw: DrawRow, file: Buffer | undefined, reportPart: Buffer | undefined, by: string): Promise<{ draw: DrawRow; saved: number; unchanged: number }> {
  if (!file) throw invalid({ file: "The first row must be kitCode,marker,value,unit." });
  const parsed = readResultsFile(file, draw, await savedValues(pool, draw.id));
  const report = requirePdf(reportPart);
  requireCollectedOrReady(draw);
  const now = new Date();
  return inTransaction(async (db) => {
    const hash = await storeReport(db, draw, report);
    let saved = 0;
    let unchanged = 0;
    for (const row of parsed) {
      if (row.status !== "matched" || !row.marker || row.value === undefined) continue;
      if (await writeResult(db, draw.id, row.marker, row.value, by, now)) saved += 1;
      else unchanged += 1;
    }
    await db.query("INSERT INTO reports (draw_id, sha256) VALUES ($1, $2) ON CONFLICT DO NOTHING", [draw.id, hash]);
    await settleReady(db, draw.id);
    return { draw: await loadDraw(db, draw.id), saved, unchanged };
  });
}

export async function saveResults(draw: DrawRow, body: JsonBody, by: string): Promise<DrawRow> {
  const fields: Record<string, string> = {};
  const parsed = records(body["results"]).flatMap((row, index) => {
    const marker = markerById(text(row, "marker"));
    const value = text(row, "value");
    if (!marker) fields[`results.${index}.marker`] = "Choose a marker from the catalog.";
    if (!isDecimal(value)) fields[`results.${index}.value`] = "Value isn't a number.";
    return marker && isDecimal(value) ? [{ marker, value: roundedText(parseDecimal(value), marker.decimals) }] : [];
  });
  if (Object.keys(fields).length > 0) throw invalid(fields);
  requireCollectedOrReady(draw);
  const now = new Date();
  return inTransaction(async (db) => {
    for (const { marker, value } of parsed) {
      if (await writeResult(db, draw.id, marker.id, value, by, now)) continue;
      const changed = await one<{ id: string }>(
        db,
        "UPDATE results SET value = $3 WHERE draw_id = $1 AND marker = $2 AND value <> $3 RETURNING id",
        [draw.id, marker.id, value],
      );
      if (changed) {
        await db.query("INSERT INTO result_history (result_id, value, by_name, at) VALUES ($1, $2, $3, $4)", [changed.id, value, by, now]);
      }
    }
    await settleReady(db, draw.id);
    return loadDraw(db, draw.id);
  });
}

export async function saveReport(draw: DrawRow, part: Buffer | undefined): Promise<DrawRow> {
  const report = requirePdf(part);
  requireCollectedOrReady(draw);
  return inTransaction(async (db) => {
    const hash = await storeReport(db, draw, report);
    await db.query("INSERT INTO reports (draw_id, sha256) VALUES ($1, $2) ON CONFLICT DO NOTHING", [draw.id, hash]);
    await settleReady(db, draw.id);
    return loadDraw(db, draw.id);
  });
}

export async function readReport(draw: DrawRow): Promise<Buffer> {
  if (!draw.has_report) throw notFound();
  try {
    return await getObject(reportKey(draw.member_id, draw.id));
  } catch (error) {
    if (error instanceof StoreUnavailable) throw reportStore503();
    throw error;
  }
}

export async function releaseDraw(draw: DrawRow, email: string): Promise<DrawRow> {
  requireReady(draw);
  return inTransaction(async (db) => {
    const released = await one(db, "UPDATE draws SET state = 'released' WHERE id = $1 AND state = 'ready' RETURNING id", [draw.id]);
    if (!released) throw notReady();
    await enqueueMail(
      db,
      draw.member_id,
      email,
      "Your new results are ready",
      `New results are ready for you.\n\nRead them here: ${config.publicUrl}/me/results`,
    );
    return loadDraw(db, draw.id);
  });
}

interface ResultRow {
  id: string;
  draw_id: string;
  marker: string;
  value: string;
  note: string | null;
  corrected_by: string | null;
  corrected_at: Date | null;
  collected_at: Date;
  local_date: string;
  state: string;
}

async function resultRows(memberId: string, releasedOnly: boolean): Promise<ResultRow[]> {
  return rows<ResultRow>(
    pool,
    `SELECT r.id, r.draw_id, r.marker, r.value, r.note, r.corrected_by, r.corrected_at, d.collected_at, d.local_date, d.state
     FROM results r JOIN draws d ON d.id = r.draw_id
     WHERE d.member_id = $1 AND d.collected_at IS NOT NULL ${releasedOnly ? "AND d.state = 'released'" : ""}
     ORDER BY d.collected_at, d.id`,
    [memberId],
  );
}

// The scale fits every zone and value of the marker's draws: from zero, or the lowest reading, to 1.3 × the top.
function scaleOf(marker: Marker, entries: readonly ResultEntry[]): { min: string; max: string } {
  const zero = roundedText(parseDecimal("0"), marker.decimals);
  const pick = (values: string[], keep: (order: number) => boolean, start: string): string =>
    values.reduce((best, value) => (keep(compareDecimals(parseDecimal(value), parseDecimal(best))) ? value : best), start);
  const bounds = entries.flatMap((entry) => [entry.value, entry.range.low, entry.range.high, entry.range.optimalLow, entry.range.optimalHigh]);
  const lowest = pick(bounds, (order) => order < 0, zero);
  const highest = pick(bounds, (order) => order > 0, zero);
  return { min: lowest, max: times(parseDecimal(highest), parseDecimal("1.3"), marker.decimals) };
}

export async function memberResults(member: LiveMember, releasedOnly: boolean): Promise<MarkerResults[]> {
  const found = await resultRows(member.id, releasedOnly);
  const markerIds = [...new Set(found.map((row) => row.marker))];
  const tables = await rangeTables(markerIds);
  const byMarker = new Map<string, ResultEntry[]>();
  for (const row of found) {
    const table = tableInForce(tables, row.marker, localDate(row.collected_at, "phoenix"));
    if (!table) throw new Error(`No ranges for ${row.marker} on the draw ${row.draw_id}`);
    const ageBand = ageBandOn(member.date_of_birth, row.collected_at, member.time_zone);
    const range = rangeFor(table, member.sex, ageBand);
    const entry: ResultEntry = {
      drawId: row.draw_id,
      collectedAt: wholeSeconds(row.collected_at),
      resultId: row.id,
      value: row.value,
      flag: flagOf(row.value, range),
      ageBand,
      range,
      note: row.note,
      correctedBy: row.corrected_by,
      correctedAt: row.corrected_at ? wholeSeconds(row.corrected_at) : null,
    };
    byMarker.set(row.marker, [...(byMarker.get(row.marker) ?? []), entry]);
  }
  const ordered = CATEGORIES.flatMap((category) => MARKERS.filter((marker) => marker.category === category.id));
  return ordered.flatMap((marker) => {
    const entries = byMarker.get(marker.id);
    if (!entries) return [];
    return [{
      marker: marker.id,
      name: marker.name,
      category: marker.category,
      unit: marker.unit,
      decimals: marker.decimals,
      scale: scaleOf(marker, entries),
      draws: entries,
    }];
  });
}

export interface LocatedResult {
  id: string;
  marker: string;
  value: string;
  note: string | null;
  member_id: string;
}

export async function locateResult(id: string): Promise<LocatedResult | undefined> {
  return one<LocatedResult>(
    pool,
    `SELECT r.id, r.marker, r.value, r.note, d.member_id FROM results r JOIN draws d ON d.id = r.draw_id WHERE r.id = $1`,
    [id],
  );
}

export async function correctResult(result: LocatedResult, body: JsonBody, by: string, now: Date): Promise<void> {
  const value = text(body, "value");
  const marker = markerById(result.marker);
  if (!marker || !isDecimal(value)) throw invalid({ value: "Value isn't a number." });
  const note = typeof body["note"] === "string" && body["note"] !== "" ? body["note"] : result.note;
  const corrected = roundedText(parseDecimal(value), marker.decimals);
  await inTransaction(async (db) => {
    await db.query("UPDATE results SET value = $2, note = $3, corrected_by = $4, corrected_at = $5 WHERE id = $1", [result.id, corrected, note, by, now]);
    await db.query("INSERT INTO result_history (result_id, value, note, by_name, at) VALUES ($1, $2, $3, $4, $5)", [result.id, corrected, note, by, now]);
  });
}

export async function resultHistory(resultId: string): Promise<{ value: string; note: string | null; by: string; at: string }[]> {
  const history = await rows<{ value: string; note: string | null; by_name: string; at: Date }>(
    pool,
    "SELECT value, note, by_name, at FROM result_history WHERE result_id = $1 ORDER BY seq",
    [resultId],
  );
  return history.map((row) => ({ value: row.value, note: row.note, by: row.by_name, at: wholeSeconds(row.at) }));
}

const FORMULA_START = /^[=+\-@\t\r]/;

function csvCell(value: string): string {
  const guarded = FORMULA_START.test(value) ? `'${value}` : value;
  return `"${guarded.replace(/"/g, '""')}"`;
}

export async function resultsHistoryFile(member: LiveMember): Promise<string> {
  const markers = await memberResults(member, true);
  const lines = markers
    .flatMap((marker, position) => marker.draws.map((entry) => ({ marker, position, entry })))
    .sort((left, right) => left.entry.collectedAt.localeCompare(right.entry.collectedAt) || left.position - right.position)
    .map(({ marker, entry }) => {
      const { low, high, optimalLow, optimalHigh } = entry.range;
      return [
        localDate(new Date(entry.collectedAt), member.time_zone),
        marker.name,
        entry.value,
        marker.unit,
        FLAG_LABEL[entry.flag],
        `${low}–${high} (optimal ${optimalLow}–${optimalHigh})`,
        entry.note ?? "",
      ].map(csvCell).join(",");
    });
  const header = ["Collected date", "Marker", "Value", "Unit", "Flag", "Range in force", "Specialist note"].map((cell) => `"${cell}"`).join(",");
  return [header, ...lines].map((line) => `${line}\r\n`).join("");
}

