import type { AppContext } from "./route-context.js";
import { FLAG_LABEL } from "../shared/enums.js";
import { localDateIn, zoneFor } from "../shared/time.js";
import type { TimeZoneKey } from "../shared/enums.js";
import { formatResultValue } from "../shared/money.js";

const CSV_HEADERS = [
  "Collected date",
  "Marker",
  "Value",
  "Unit",
  "Flag",
  "Range in force",
  "Specialist note",
];

const FORMULA_CHARS = ["=", "+", "-", "@", "\t", "\r"];

/** The results history file: quoted CSV, CRLF, formula-cell prefixing. */
export async function resultsHistoryCsv(ctx: AppContext, memberId: string): Promise<string> {
  const rows = await ctx.db.query<{
    collected_at: Date;
    marker: string;
    value: string;
    flag: string;
    range_low: string;
    range_high: string;
    range_optimal_low: string;
    range_optimal_high: string;
    note: string | null;
    time_zone: string;
  }>(
    `SELECT d.collected_at, r.marker, r.value, r.flag, r.range_low, r.range_high,
       r.range_optimal_low, r.range_optimal_high, r.note, m.time_zone
     FROM results r
     JOIN draws d ON d.id = r.draw_id
     JOIN members m ON m.id = r.member_id
     WHERE r.member_id = $1 AND d.state = 'released'`,
    [memberId]
  );
  const { MARKER_BY_ID, MARKERS } = await import("../shared/markers.js");
  const order = new Map(MARKERS.map((marker, index) => [marker.id, index]));
  rows.sort((a, b) => {
    const byDate = a.collected_at.getTime() - b.collected_at.getTime();
    if (byDate !== 0) return byDate;
    return (order.get(a.marker) ?? 0) - (order.get(b.marker) ?? 0);
  });
  const lines: string[] = [csvRow(CSV_HEADERS)];
  for (const row of rows) {
    const marker = MARKER_BY_ID.get(row.marker);
    if (!marker) continue;
    const collected = localDateIn(row.collected_at, zoneFor(row.time_zone as TimeZoneKey));
    const value = formatResultValue(row.value, marker.decimals);
    const range = `${row.range_low}–${row.range_high} (optimal ${row.range_optimal_low}–${row.range_optimal_high})`;
    lines.push(
      csvRow([
        collected,
        marker.name,
        value,
        marker.unit,
        FLAG_LABEL[row.flag as keyof typeof FLAG_LABEL] ?? row.flag,
        range,
        row.note ?? "",
      ])
    );
  }
  return lines.join("\r\n") + "\r\n";
}

function csvRow(cells: string[]): string {
  return cells.map(quoteCell).join(",");
}

function quoteCell(value: string): string {
  const guarded = FORMULA_CHARS.some((ch) => value.startsWith(ch)) ? `'${value}` : value;
  return `"${guarded.replace(/"/g, '""')}"`;
}
