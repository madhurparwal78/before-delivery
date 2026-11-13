import type { Database } from "./db.js";
import { markerByUnitLabKey, MARKER_BY_ID, matchMarkerByName } from "../shared/markers.js";
import { convertLabValue, flagFor } from "../shared/ranges.js";
import { checkKitCode } from "../shared/kitcode.js";
import { dec, roundHalfUp } from "../shared/money.js";
import { ageBandFor, ageInWholeYears, localDateIn, zoneFor } from "../shared/time.js";
import type { Flag } from "../shared/enums.js";

export type RangeRowRecord = {
  sex: string;
  age_band: string;
  low: string;
  high: string;
  optimal_low: string;
  optimal_high: string;
};

/** The range row in force on a collected date, from the effective-dated range table. */
export async function rangeInForce(
  db: Database,
  marker: string,
  sex: string,
  collectedAt: Date
): Promise<{
  effectiveFrom: string;
  low: string;
  high: string;
  optimalLow: string;
  optimalHigh: string;
  ageBand: string;
} | null> {
  const rows = await db.query<{ id: string; effective_from: string } & RangeRowRecord>(
    `SELECT v.id, v.effective_from::text AS effective_from, r.sex, r.age_band, r.low, r.high, r.optimal_low, r.optimal_high
     FROM range_versions v
     JOIN range_rows r ON r.version_id = v.id
     WHERE v.marker = $1 AND r.sex = $2 AND v.effective_from::date <= $3::date
     ORDER BY v.effective_from DESC
     LIMIT 1`,
    [marker, sex, localDateIn(collectedAt, "America/Phoenix")]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    effectiveFrom: row.effective_from,
    low: row.low,
    high: row.high,
    optimalLow: row.optimal_low,
    optimalHigh: row.optimal_high,
    ageBand: row.age_band,
  };
}

/** Flag a result from the range table: the one place flags are decided. */
export async function flagResult(
  db: Database,
  marker: string,
  value: string,
  sex: string,
  dateOfBirth: string,
  timeZone: string,
  collectedAt: Date
): Promise<{
  flag: Flag;
  ageBand: string;
  range: { effectiveFrom: string; low: string; high: string; optimalLow: string; optimalHigh: string };
} | null> {
  const markerDef = MARKER_BY_ID.get(marker);
  if (!markerDef) return null;
  const inForce = await rangeInForce(db, marker, sex, collectedAt);
  if (!inForce) return null;
  const memberLocalDate = localDateIn(collectedAt, zoneFor(timeZone));
  const age = ageInWholeYears(dateOfBirth, memberLocalDate);
  const ageBand = ageBandFor(age);
  const flag = flagFor(value, inForce, markerDef.decimals);
  return {
    flag,
    ageBand: inForce.ageBand ?? ageBand,
    range: {
      effectiveFrom: inForce.effectiveFrom,
      low: inForce.low,
      high: inForce.high,
      optimalLow: inForce.optimalLow,
      optimalHigh: inForce.optimalHigh,
    },
  };
}

export type PreviewRow =
  | {
      row: number;
      status: "matched";
      kitCode: string;
      marker: string;
      value: string;
      unit: string;
      source: { marker: string; value: string; unit: string };
    }
  | { row: number; status: "unknown"; reason: string }
  | { row: number; status: "refused"; reason: string };

export type PreviewOutcome =
  | { ok: true; rows: PreviewRow[]; matched: number; unknown: number; refused: number }
  | { ok: false; field: "file"; message: string };

const REQUIRED_HEADER = "kitCode,marker,value,unit";

/** Read the lab partner's results file and produce a preview; nothing is written. */
export function parseResultsFile(
  fileText: string,
  drawKitCodes: string[],
  savedValues: Map<string, string>
): PreviewOutcome {
  // The file must be valid UTF-8 text; a replacement character means it is not.
  if (fileText.includes(String.fromCharCode(0xfffd)) || fileText.includes(String.fromCharCode(0))) {
    return { ok: false, field: "file", message: "The results file must be UTF-8 text." };
  }
  const bom = String.fromCharCode(0xfeff);
  const text = fileText.startsWith(bom) ? fileText.slice(1) : fileText;
  const lines = text.split(/\r\n|\n/);
  let header: string | null = null;
  const rows: PreviewRow[] = [];
  let matched = 0;
  let unknown = 0;
  let refused = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (i === 0) {
      header = line;
      continue;
    }
    if (line.trim().length === 0) continue;
    const fields = line.split(",");
    if (fields.length < 4) {
      rows.push({ row: i + 1, status: "refused", reason: "Row needs kitCode, marker, value and unit." });
      refused += 1;
      continue;
    }
    const kitCodeRaw = fields[0] ?? "";
    const valueRaw = fields[fields.length - 2] ?? "";
    const unitRaw = fields[fields.length - 1] ?? "";
    const markerRaw = fields.slice(1, fields.length - 2).join(",");
    const kit = checkKitCode(kitCodeRaw);
    if (!kit.valid) {
      rows.push({ row: i + 1, status: "refused", reason: kitCodeRefusalReason(kit.reason) });
      refused += 1;
      continue;
    }
    const marker = matchMarkerByName(markerRaw);
    if (!marker) {
      rows.push({ row: i + 1, status: "unknown", reason: `No marker matches "${markerRaw}".` });
      unknown += 1;
      continue;
    }
    if (!drawKitCodes.includes(kit.normalized)) {
      rows.push({ row: i + 1, status: "refused", reason: "Kit code isn't on this draw." });
      refused += 1;
      continue;
    }
    const numberCheck = /^-?\d+(\.\d+)?$/.test(valueRaw.trim());
    if (!numberCheck) {
      rows.push({ row: i + 1, status: "refused", reason: "Value isn't a number." });
      refused += 1;
      continue;
    }
    const labUnit = markerByUnitLabKey(unitRaw, marker);
    if (!labUnit) {
      rows.push({ row: i + 1, status: "refused", reason: `Unit isn't accepted for ${marker.name}.` });
      refused += 1;
      continue;
    }
    const converted = convertLabValue(valueRaw, labUnit.factor, labUnit.divide, marker.decimals);
    const formatted = converted.toFixed(marker.decimals);
    const saved = savedValues.get(marker.id);
    if (saved !== undefined && dec(saved).toFixed(marker.decimals) !== formatted) {
      rows.push({
        row: i + 1,
        status: "refused",
        reason: "Already saved with a different value; correct it on the result instead.",
      });
      refused += 1;
      continue;
    }
    rows.push({
      row: i + 1,
      status: "matched",
      kitCode: kit.normalized,
      marker: marker.id,
      value: formatted,
      unit: marker.unit,
      source: { marker: markerRaw, value: valueRaw, unit: unitRaw },
    });
    matched += 1;
  }
  if (header !== REQUIRED_HEADER) {
    return { ok: false, field: "file", message: "The first row must be kitCode,marker,value,unit." };
  }
  return { ok: true, rows, matched, unknown, refused };
}

function kitCodeRefusalReason(kind: "shape" | "check"): string {
  return kind === "shape"
    ? "Enter a kit code like KT-1000042-7."
    : "That kit code isn't valid. Check the last character.";
}

/** A decimal string is valid when it parses exactly. */
export function validDecimalNumber(value: string): boolean {
  const trimmed = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return false;
  return dec(trimmed).isFinite();
}

/** Format a stored value at the marker's decimals. */
export function formatStoredValue(value: string, marker: string): string {
  const def = MARKER_BY_ID.get(marker);
  const decimals = def?.decimals ?? 2;
  return roundHalfUp(value, decimals).toFixed(decimals);
}
