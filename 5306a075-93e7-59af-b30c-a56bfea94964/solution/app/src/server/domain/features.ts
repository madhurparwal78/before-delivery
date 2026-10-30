// FeatureSummary assembly: stored scores and fits, live counters, live weights, then the ranking.
import type { FeatureSummary, SubfeatureRef } from "../../shared/api.js";
import type { FeatureStatus } from "../../shared/lifecycles.js";
import type { Queryable } from "../db.js";
import { notFound } from "../http/errors.js";
import { NO_EVIDENCE, workspaceCounters } from "./evidence.js";
import { asNumber, compareRank, score } from "./priority.js";

export interface FeatureRow {
  id: string; name: string; public_description: string; component_id: string; parent_feature_id: string | null;
  status: FeatureStatus; prior_status: FeatureStatus | null; release_id: string | null; position: number | null;
  effort: number; confidence: number; version: number;
}

export interface WorkspaceFeatures {
  summaries: Map<string, FeatureSummary & { priorityCents: number; objectiveFitCents: number }>;
  rows: Map<string, FeatureRow>;
  /** Ranked features: non-archived and top-level, in rank order. */
  ranked: FeatureSummary[];
  subfeatures(parentId: string): SubfeatureRef[];
  /** The summary of a feature of this workspace; 404 for any other id. */
  summary(id: string): FeatureSummary & { priorityCents: number; objectiveFitCents: number };
}

export const FEATURE_COLUMNS = `id, name, public_description, component_id, parent_feature_id, status, prior_status,
  release_id, position, effort, confidence, version`;

export async function loadFeatures(q: Queryable, workspaceId: string): Promise<WorkspaceFeatures> {
  const [rows, objectives, fits, counters] = await Promise.all([
    q.query<FeatureRow>(`SELECT ${FEATURE_COLUMNS} FROM features WHERE workspace_id = $1 ORDER BY id`, [workspaceId]),
    q.query<{ id: string; weight: number }>("SELECT id, weight FROM objectives WHERE workspace_id = $1 ORDER BY id", [workspaceId]),
    q.query<{ feature_id: string; objective_id: string; level: number }>(
      "SELECT ff.feature_id, ff.objective_id, ff.level FROM feature_fits ff JOIN features f ON f.id = ff.feature_id WHERE f.workspace_id = $1",
      [workspaceId],
    ),
    workspaceCounters(q, workspaceId),
  ]);
  const fitsOf = new Map<string, Record<string, number>>();
  for (const row of rows) fitsOf.set(row.id, Object.fromEntries(objectives.map((o) => [o.id, 0])));
  for (const fit of fits) {
    const map = fitsOf.get(fit.feature_id);
    if (map && fit.objective_id in map) map[fit.objective_id] = fit.level;
  }
  const summaries: WorkspaceFeatures["summaries"] = new Map();
  for (const row of rows) {
    const featureFits = fitsOf.get(row.id) ?? {};
    const evidence = counters.get(row.id) ?? NO_EVIDENCE;
    const scores = score({ weights: objectives, fits: featureFits, impact: evidence.impact, confidence: row.confidence, effort: row.effort });
    summaries.set(row.id, {
      id: row.id, name: row.name, publicDescription: row.public_description, componentId: row.component_id,
      status: row.status, releaseId: row.release_id, ...evidence, effort: row.effort, confidence: row.confidence,
      fits: featureFits, objectiveFit: asNumber(scores.objectiveFitCents), priority: asNumber(scores.priorityCents),
      rank: null, rankTotal: 0, version: row.version, ...scores,
    });
  }
  const rowMap = new Map(rows.map((r) => [r.id, r]));
  const ranked = [...summaries.values()]
    .filter((s) => s.status !== "archived" && rowMap.get(s.id)?.parent_feature_id === null)
    .sort(compareRank);
  ranked.forEach((s, i) => { s.rank = i + 1; });
  for (const s of summaries.values()) s.rankTotal = ranked.length;
  return {
    summaries,
    rows: rowMap,
    ranked,
    subfeatures: (parentId) => rows
      .filter((r) => r.parent_feature_id === parentId && r.status !== "archived")
      .map((r) => ({ id: r.id, name: r.name, status: r.status })),
    summary: (id) => {
      const found = summaries.get(id);
      if (!found) throw notFound();
      return found;
    },
  };
}

/** The public FeatureSummary shape, without the internal hundredths. */
export function publicSummary(s: FeatureSummary & { priorityCents?: number; objectiveFitCents?: number }): FeatureSummary {
  return {
    id: s.id, name: s.name, publicDescription: s.publicDescription, componentId: s.componentId, status: s.status,
    releaseId: s.releaseId, insightCount: s.insightCount, companyCount: s.companyCount, impact: s.impact,
    effort: s.effort, confidence: s.confidence, fits: s.fits, objectiveFit: s.objectiveFit, priority: s.priority,
    rank: s.rank, rankTotal: s.rankTotal, version: s.version,
  };
}
