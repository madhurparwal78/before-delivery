import type { PoolClient } from "pg";
import type {
  FeatureStatus,
  FeatureSummary,
  Importance,
  Insight,
  Objective,
  ScoreVersion,
  SubfeatureRef,
} from "../shared/types.js";
import {
  computeObjectiveFit,
  computePriority,
  rankFeatures,
  round2,
  type ObjectiveWeight,
} from "../shared/ranking.js";

const IMPORTANCE_POINTS: Record<Importance, number> = {
  nice_to_have: 1,
  important: 3,
  critical: 5,
};

export function importancePoints(importance: Importance): number {
  return IMPORTANCE_POINTS[importance];
}

export interface FeatureRow {
  id: string;
  component_id: string;
  parent_feature_id: string | null;
  name: string;
  public_description: string;
  status: FeatureStatus;
  release_id: string | null;
  effort: number;
  confidence: number;
  fits: Record<string, number>;
  version: number;
  insight_count: number;
  company_count: number;
  impact: number;
}

const FEATURE_SELECT = `
  SELECT f.id, f.component_id, f.parent_feature_id, f.name, f.public_description,
         f.status, f.release_id, f.effort, f.confidence, f.fits, f.version,
         (SELECT count(*)::int FROM insights i WHERE i.feature_id = f.id) AS insight_count,
         (SELECT count(DISTINCT ct.company_id)::int
            FROM insights i
            JOIN notes n ON n.id = i.note_id
            LEFT JOIN contacts ct ON ct.id = n.contact_id
           WHERE i.feature_id = f.id AND ct.company_id IS NOT NULL) AS company_count,
         (SELECT coalesce(sum(CASE i.importance
              WHEN 'critical' THEN 5 WHEN 'important' THEN 3 ELSE 1 END), 0)::int
            FROM insights i WHERE i.feature_id = f.id) AS impact
  FROM features f
  WHERE f.workspace_id = $1 AND f.status <> 'archived'
`;

export async function loadFeatureRows(
  client: PoolClient,
  workspaceId: string,
): Promise<FeatureRow[]> {
  const result = await client.query<FeatureRow>(FEATURE_SELECT, [workspaceId]);
  return result.rows;
}

export async function loadObjectives(
  client: PoolClient,
  workspaceId: string,
): Promise<Objective[]> {
  const result = await client.query<Objective>(
    "SELECT id, name, weight FROM objectives WHERE workspace_id = $1 ORDER BY position, id",
    [workspaceId],
  );
  return result.rows;
}

export function objectiveWeights(objectives: Objective[]): ObjectiveWeight[] {
  return objectives.map((o) => ({ id: o.id, weight: o.weight }));
}

/**
 * Build every top-level feature summary in the workspace with derived
 * counters, priority and rank (DP-08, DP-18). Ranking covers the
 * workspace's non-archived top-level features only, decided here.
 */
export function buildFeatureSummaries(
  rows: FeatureRow[],
  objectives: Objective[],
): FeatureSummary[] {
  const weights = objectiveWeights(objectives);
  const topRows = rows.filter((row) => row.parent_feature_id === null);
  const withPriority = topRows.map((row) => {
    const fit = computeObjectiveFit(row.fits, weights);
    const priority = round2(computePriority(fit, row.impact, row.confidence, row.effort));
    return { row, objectiveFit: round2(fit), priority };
  });
  const ranked = rankFeatures(
    withPriority.map((w) => ({
      id: w.row.id,
      name: w.row.name,
      priority: w.priority,
      impact: w.row.impact,
    })),
  );
  const rankById = new Map(ranked.map((r) => [r.feature.id, r.rank]));
  const rankTotal = ranked.length;
  return withPriority.map(({ row, objectiveFit, priority }) => ({
    id: row.id,
    name: row.name,
    publicDescription: row.public_description,
    componentId: row.component_id,
    status: row.status,
    releaseId: row.release_id,
    insightCount: row.insight_count,
    companyCount: row.company_count,
    impact: row.impact,
    effort: row.effort,
    confidence: row.confidence,
    fits: row.fits,
    objectiveFit,
    priority,
    rank: rankById.get(row.id) ?? rankTotal,
    rankTotal,
    version: row.version,
  }));
}

/** The summary of one feature within a set of summaries. */
export function findSummary(summaries: FeatureSummary[], id: string): FeatureSummary | null {
  return summaries.find((s) => s.id === id) ?? null;
}

export interface InsightRow {
  id: string;
  note_id: string;
  feature_id: string;
  start_offset: number;
  end_offset: number;
  quote: string;
  importance: Importance;
  feature_name: string;
  company_id: string | null;
}

export async function loadInsightsForNote(
  client: PoolClient,
  noteId: string,
): Promise<InsightRow[]> {
  const result = await client.query<InsightRow>(
    `SELECT i.id, i.note_id, i.feature_id, i.start_offset, i.end_offset, i.quote, i.importance,
            f.name AS feature_name, ct.company_id
     FROM insights i
     JOIN features f ON f.id = i.feature_id
     LEFT JOIN notes n ON n.id = i.note_id
     LEFT JOIN contacts ct ON ct.id = n.contact_id
     WHERE i.note_id = $1`,
    [noteId],
  );
  return result.rows;
}

export function insightToJson(row: InsightRow): Insight {
  return {
    id: row.id,
    noteId: row.note_id,
    featureId: row.feature_id,
    featureName: row.feature_name,
    start: row.start_offset,
    end: row.end_offset,
    quote: row.quote,
    importance: row.importance,
    companyId: row.company_id,
  };
}

export interface ScoreVersionRow {
  version: number;
  effort: number;
  confidence: number;
  fits: Record<string, number>;
  priority: number;
  saved_at: Date;
  saved_by: string | null;
}

export async function loadScoreVersions(
  client: PoolClient,
  featureId: string,
): Promise<ScoreVersion[]> {
  const result = await client.query<ScoreVersionRow>(
    `SELECT version, effort, confidence, fits, priority, saved_at, saved_by
     FROM score_versions WHERE feature_id = $1 ORDER BY version DESC`,
    [featureId],
  );
  return result.rows.map((r) => ({
    version: r.version,
    effort: r.effort,
    confidence: r.confidence,
    fits: r.fits,
    priority: Number(r.priority),
    savedAt: r.saved_at.toISOString().replace(/\.\d{3}Z$/, "Z"),
    savedBy: r.saved_by,
  }));
}

export async function loadSubfeatures(
  client: PoolClient,
  featureId: string,
): Promise<SubfeatureRef[]> {
  const result = await client.query<{ id: string; name: string; status: FeatureStatus }>(
    `SELECT id, name, status FROM features
     WHERE parent_feature_id = $1 AND status <> 'archived' ORDER BY created_at, id`,
    [featureId],
  );
  return result.rows;
}
