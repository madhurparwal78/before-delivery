import type { AppContext } from "./route-context.js";
import { ApiError } from "./errors.js";
import { copy } from "../shared/copy.js";
import { MARKERS, MARKER_BY_ID } from "../shared/markers.js";
import { instantZ } from "../shared/time.js";
import { scaleFor } from "../shared/ranges.js";
import type { Flag } from "../shared/enums.js";
import { dec } from "../shared/money.js";

export type MarkerResultView = {
  marker: string;
  name: string;
  category: string;
  unit: string;
  decimals: number;
  scale: { min: string; max: string };
  draws: {
    drawId: string;
    collectedAt: string;
    resultId: string;
    value: string;
    flag: Flag;
    ageBand: string;
    range: { low: string; high: string; optimalLow: string; optimalHigh: string; effectiveFrom: string };
    note: string | null;
    correctedBy: string | null;
    correctedAt: string | null;
  }[];
};

/** Results grouped by marker in catalog order, released-only for members. */
export async function memberResultsView(
  ctx: AppContext,
  memberId: string,
  releasedOnly: boolean
): Promise<MarkerResultView[]> {
  const rows = await ctx.db.query<{
    id: string;
    draw_id: string;
    marker: string;
    value: string;
    flag: string;
    age_band: string;
    range_low: string;
    range_high: string;
    range_optimal_low: string;
    range_optimal_high: string;
    range_effective_from: string;
    note: string | null;
    corrected_by: string | null;
    corrected_at: Date | null;
    collected_at: Date;
    draw_state: string;
  }>(
    `SELECT r.id, r.draw_id, r.marker, r.value, r.flag, r.age_band, r.range_low, r.range_high,
       r.range_optimal_low, r.range_optimal_high, r.range_effective_from, r.note,
       r.corrected_by, r.corrected_at, d.collected_at, d.state AS draw_state
     FROM results r
     JOIN draws d ON d.id = r.draw_id
     WHERE r.member_id = $1 ${releasedOnly ? "AND d.state = 'released'" : ""}
     ORDER BY d.collected_at ASC`,
    [memberId]
  );
  const byMarker = new Map<string, MarkerResultView["draws"]>();
  for (const row of rows) {
    const list = byMarker.get(row.marker) ?? [];
    list.push({
      drawId: row.draw_id,
      collectedAt: instantZ(row.collected_at),
      resultId: row.id,
      value: row.value,
      flag: row.flag as Flag,
      ageBand: row.age_band,
      range: {
        low: row.range_low,
        high: row.range_high,
        optimalLow: row.range_optimal_low,
        optimalHigh: row.range_optimal_high,
        effectiveFrom: row.range_effective_from,
      },
      note: row.note,
      correctedBy: row.corrected_by,
      correctedAt: row.corrected_at ? instantZ(row.corrected_at) : null,
    });
    byMarker.set(row.marker, list);
  }
  const result: MarkerResultView[] = [];
  for (const marker of MARKERS) {
    const draws = byMarker.get(marker.id);
    if (!draws || draws.length === 0) continue;
    const scale = scaleFor(
      draws.map((d) => d.value),
      draws.map((d) => ({
        sex: "female",
        ageBand: d.ageBand,
        low: d.range.low,
        high: d.range.high,
        optimalLow: d.range.optimalLow,
        optimalHigh: d.range.optimalHigh,
      }))
    );
    result.push({
      marker: marker.id,
      name: marker.name,
      category: marker.categoryId,
      unit: marker.unit,
      decimals: marker.decimals,
      scale: { min: dec(scale.min).toFixed(marker.decimals), max: dec(scale.max).toFixed(marker.decimals) },
      draws,
    });
  }
  return result;
}

export async function requireResultFor(
  ctx: AppContext,
  resultId: string
): Promise<{ id: string; member_id: string; marker: string; draw_id: string }> {
  const row = await ctx.db.one<{ id: string; member_id: string; marker: string; draw_id: string }>(
    `SELECT id, member_id, marker, draw_id FROM results WHERE id = $1`,
    [resultId]
  );
  if (!row) throw new ApiError(404, "not_found", copy("not_found"));
  return row;
}

export { MARKER_BY_ID };
