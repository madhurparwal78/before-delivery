// The published range table: which rows are in force, and the flag a value earns against them.

import { randomUUID } from "node:crypto";
import type { AgeBand, Flag, RangeChange, RangeInForce, RangeRow, Sex } from "../shared/api";
import { formatDate } from "../shared/format";
import { isIsoDate, localDate, wholeSeconds, type TimeZone } from "../shared/time";
import { AGE_BANDS, markerById, SEXES } from "./catalog";
import { isUniqueViolation, pool, rows } from "./db";
import { compareDecimals, isDecimal, parseDecimal, roundedText } from "./decimal";
import { conflict, invalid } from "./errors";
import { isOneOf, isRecord, list, text, type JsonBody } from "./fields";

interface RangeTableRow {
  id: string;
  marker: string;
  effective_from: string;
  rows: RangeRow[];
  created_by: string | null;
  created_at: Date;
}

export async function rangeTables(markers: string[]): Promise<RangeTableRow[]> {
  return rows<RangeTableRow>(
    pool,
    "SELECT id, marker, effective_from, rows, created_by, created_at FROM range_tables WHERE marker = ANY($1) ORDER BY marker, effective_from",
    [markers],
  );
}

// The table for one marker on one Phoenix date.
export function tableInForce(tables: readonly RangeTableRow[], marker: string, phoenixDate: string): RangeTableRow | undefined {
  return tables.filter((table) => table.marker === marker && table.effective_from <= phoenixDate).at(-1);
}

function ageOn(dateOfBirth: string, date: string): number {
  const years = Number(date.slice(0, 4)) - Number(dateOfBirth.slice(0, 4));
  return date.slice(5) < dateOfBirth.slice(5) ? years - 1 : years;
}

// Whole years of age on the member-local collected date.
export function ageBandOn(dateOfBirth: string, collectedAt: Date, zone: TimeZone): AgeBand {
  const age = ageOn(dateOfBirth, localDate(collectedAt, zone));
  if (age < 40) return "age18To39";
  return age < 60 ? "age40To59" : "age60Plus";
}

export function rangeFor(table: RangeTableRow, sex: Sex, band: AgeBand): RangeInForce {
  const row = table.rows.find((entry) => entry.sex === sex && entry.ageBand === band);
  if (!row) throw new Error(`Range table ${table.id} has no row for ${sex} ${band}`);
  return {
    low: row.low,
    high: row.high,
    optimalLow: row.optimalLow,
    optimalHigh: row.optimalHigh,
    effectiveFrom: table.effective_from,
  };
}

export function flagOf(value: string, range: RangeInForce): Flag {
  const reading = parseDecimal(value);
  const atLeast = (bound: string): boolean => compareDecimals(reading, parseDecimal(bound)) >= 0;
  const atMost = (bound: string): boolean => compareDecimals(reading, parseDecimal(bound)) <= 0;
  if (atLeast(range.optimalLow) && atMost(range.optimalHigh)) return "optimal";
  if (atLeast(range.low) && atMost(range.high)) return "inRange";
  return atLeast(range.low) ? "aboveRange" : "belowRange";
}

export function rangesOn(marker: string, phoenixDate: string, tables: readonly RangeTableRow[]): { marker: string; effectiveFrom: string; ranges: RangeRow[] } {
  const table = tableInForce(tables, marker, phoenixDate);
  return { marker, effectiveFrom: table?.effective_from ?? phoenixDate, ranges: table?.rows ?? [] };
}

function changeView(table: RangeTableRow): RangeChange {
  return {
    id: table.id,
    marker: table.marker,
    effectiveFrom: table.effective_from,
    createdBy: table.created_by ?? "",
    createdAt: wholeSeconds(table.created_at),
  };
}

export async function rangeChanges(): Promise<RangeChange[]> {
  const tables = await rows<RangeTableRow>(
    pool,
    "SELECT id, marker, effective_from, rows, created_by, created_at FROM range_tables WHERE created_by IS NOT NULL ORDER BY effective_from DESC, marker",
  );
  return tables.map(changeView);
}

function readRows(value: unknown, decimals: number, fields: Record<string, string>): RangeRow[] {
  const given = list(value);
  const wanted = SEXES.flatMap((sex) => AGE_BANDS.map((ageBand) => `${sex}|${ageBand}`));
  const seen = new Set(given.filter(isRecord).map((row) => `${text(row, "sex")}|${text(row, "ageBand")}`));
  if (given.length !== wanted.length || !wanted.every((key) => seen.has(key))) {
    fields["ranges"] = "Give all six rows.";
    return [];
  }
  return given.filter(isRecord).flatMap((row, index) => {
    const bounds = [text(row, "low"), text(row, "optimalLow"), text(row, "optimalHigh"), text(row, "high")];
    const sex = row["sex"];
    const ageBand = row["ageBand"];
    const ordered = bounds.every(isDecimal) && bounds.every((bound, at) => {
      const previous = bounds[at - 1];
      return previous === undefined || compareDecimals(parseDecimal(previous), parseDecimal(bound)) <= 0;
    });
    if (!ordered || !isOneOf(SEXES, sex) || !isOneOf(AGE_BANDS, ageBand)) {
      fields[`ranges.${index}`] = "Bounds must run low ≤ optimal low ≤ optimal high ≤ high.";
      return [];
    }
    const [low, optimalLow, optimalHigh, high] = bounds.map((bound) => roundedText(parseDecimal(bound), decimals));
    return [{ sex, ageBand, low: low ?? "", high: high ?? "", optimalLow: optimalLow ?? "", optimalHigh: optimalHigh ?? "" }];
  });
}

export async function addRangeChange(body: JsonBody, createdBy: string, now: Date): Promise<RangeChange> {
  const markerId = text(body, "marker");
  const effectiveFrom = text(body, "effectiveFrom");
  const marker = markerById(markerId);
  const fields: Record<string, string> = {};
  if (!marker) fields["marker"] = "Choose a marker from the catalog.";
  if (!isIsoDate(effectiveFrom)) fields["effectiveFrom"] = "Enter the date as YYYY-MM-DD.";
  else if (effectiveFrom < localDate(now, "phoenix")) fields["effectiveFrom"] = "Choose today or a later date.";
  const parsed = readRows(body["ranges"], marker?.decimals ?? 0, fields);
  if (!marker || Object.keys(fields).length > 0) throw invalid(fields);
  const id = randomUUID();
  try {
    await pool.query(
      "INSERT INTO range_tables (id, marker, effective_from, rows, created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
      [id, marker.id, effectiveFrom, JSON.stringify(parsed), createdBy, now],
    );
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    throw conflict("ranges_already_change", `Ranges for ${marker.name} already change on ${formatDate(effectiveFrom)}.`);
  }
  return { id, marker: marker.id, effectiveFrom, createdBy, createdAt: wholeSeconds(now) };
}

