import type { FeatureStatus, FeatureSummary, Importance, Objective } from '../../shared/types';
import type { Queryable } from '../db';
import { IMPORTANCE_POINTS, objectiveFit, priorityScore, rankFeatures } from '../domain/priority';

export interface FeatureRecord extends FeatureSummary {
  parentFeatureId: string | null;
  boardPosition: number;
}

interface FeatureRow {
  id: string;
  name: string;
  public_description: string;
  component_id: string;
  parent_feature_id: string | null;
  status: FeatureStatus;
  prior_status: FeatureStatus | null;
  release_id: string | null;
  board_position: number;
  effort: number;
  confidence: number;
  version: number;
}

export async function loadObjectives(db: Queryable, workspaceId: string): Promise<Objective[]> {
  const { rows } = await db.query<{ id: string; name: string; weight: number }>(
    'SELECT id, name, weight FROM objectives WHERE workspace_id = $1 ORDER BY created_at, id',
    [workspaceId],
  );
  return rows;
}

interface Counters {
  insightCount: number;
  companyCount: number;
  impact: number;
}

async function loadCounters(db: Queryable, workspaceId: string): Promise<Map<string, Counters>> {
  const { rows } = await db.query<{ feature_id: string; importance: Importance; company_id: string | null }>(
    `SELECT insights.feature_id, insights.importance, contacts.company_id
       FROM insights
       JOIN notes ON notes.id = insights.note_id
       LEFT JOIN contacts ON contacts.id = notes.contact_id
      WHERE insights.workspace_id = $1`,
    [workspaceId],
  );
  const companies = new Map<string, Set<string>>();
  const counters = new Map<string, Counters>();
  for (const row of rows) {
    const current = counters.get(row.feature_id) ?? { insightCount: 0, companyCount: 0, impact: 0 };
    current.insightCount += 1;
    current.impact += IMPORTANCE_POINTS[row.importance];
    counters.set(row.feature_id, current);
    if (row.company_id !== null) {
      const set = companies.get(row.feature_id) ?? new Set<string>();
      set.add(row.company_id);
      companies.set(row.feature_id, set);
    }
  }
  for (const [featureId, set] of companies) {
    const current = counters.get(featureId);
    if (current) current.companyCount = set.size;
  }
  return counters;
}

async function loadFits(
  db: Queryable,
  workspaceId: string,
  blankFits: Record<string, number>,
): Promise<Map<string, Record<string, number>>> {
  const { rows } = await db.query<{ feature_id: string; objective_id: string; level: number }>(
    `SELECT feature_fits.feature_id, feature_fits.objective_id, feature_fits.level
       FROM feature_fits
       JOIN features ON features.id = feature_fits.feature_id
      WHERE features.workspace_id = $1`,
    [workspaceId],
  );
  const byFeature = new Map<string, Record<string, number>>();
  for (const row of rows) {
    const fits = byFeature.get(row.feature_id) ?? { ...blankFits };
    if (row.objective_id in fits) fits[row.objective_id] = row.level;
    byFeature.set(row.feature_id, fits);
  }
  return byFeature;
}

export interface FeatureWorld {
  objectives: Objective[];
  features: Map<string, FeatureRecord>;
  priorStatus: Map<string, FeatureStatus | null>;
  rankTotal: number;
}

/**
 * Loads every feature of a workspace with counters, objective fit, priority and
 * rank recomputed from its insights and the current objective weights.
 */
export async function loadFeatureWorld(db: Queryable, workspaceId: string): Promise<FeatureWorld> {
  const objectives = await loadObjectives(db, workspaceId);
  const blankFits: Record<string, number> = {};
  for (const objective of objectives) blankFits[objective.id] = 0;

  const counters = await loadCounters(db, workspaceId);
  const fitsByFeature = await loadFits(db, workspaceId, blankFits);
  const { rows } = await db.query<FeatureRow>(
    `SELECT id, name, public_description, component_id, parent_feature_id, status, prior_status,
            release_id, board_position, effort, confidence, version
       FROM features WHERE workspace_id = $1 ORDER BY created_at, id`,
    [workspaceId],
  );

  const features = new Map<string, FeatureRecord>();
  const priorStatus = new Map<string, FeatureStatus | null>();
  for (const row of rows) {
    const counts = counters.get(row.id) ?? { insightCount: 0, companyCount: 0, impact: 0 };
    const fits = fitsByFeature.get(row.id) ?? { ...blankFits };
    features.set(row.id, {
      id: row.id,
      name: row.name,
      publicDescription: row.public_description,
      componentId: row.component_id,
      parentFeatureId: row.parent_feature_id,
      status: row.status,
      releaseId: row.release_id,
      boardPosition: row.board_position,
      insightCount: counts.insightCount,
      companyCount: counts.companyCount,
      impact: counts.impact,
      effort: row.effort,
      confidence: row.confidence,
      fits,
      objectiveFit: objectiveFit(objectives, fits),
      priority: priorityScore(objectives, {
        fits,
        impact: counts.impact,
        confidence: row.confidence,
        effort: row.effort,
      }),
      rank: null,
      rankTotal: 0,
      version: row.version,
    });
    priorStatus.set(row.id, row.prior_status);
  }

  const ranks = rankFeatures([...features.values()].filter(isRankable));
  for (const feature of features.values()) {
    feature.rank = ranks.get(feature.id) ?? null;
    feature.rankTotal = ranks.size;
  }
  return { objectives, features, priorStatus, rankTotal: ranks.size };
}

export function isRankable(feature: FeatureRecord): boolean {
  return feature.parentFeatureId === null && feature.status !== 'archived';
}

export function rankedFeatures(world: FeatureWorld): FeatureRecord[] {
  return [...world.features.values()].filter(isRankable).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
}

export function toSummary(feature: FeatureRecord): FeatureSummary {
  return {
    id: feature.id,
    name: feature.name,
    publicDescription: feature.publicDescription,
    componentId: feature.componentId,
    status: feature.status,
    releaseId: feature.releaseId,
    insightCount: feature.insightCount,
    companyCount: feature.companyCount,
    impact: feature.impact,
    effort: feature.effort,
    confidence: feature.confidence,
    fits: feature.fits,
    objectiveFit: feature.objectiveFit,
    priority: feature.priority,
    rank: feature.rank,
    rankTotal: feature.rankTotal,
    version: feature.version,
  };
}
