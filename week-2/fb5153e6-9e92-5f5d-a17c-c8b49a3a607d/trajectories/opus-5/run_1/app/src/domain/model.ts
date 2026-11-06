import type { ModelState } from './states.js';
import type { PlanName } from './plans.js';
import { plan } from './plans.js';

export type Visibility = 'public' | 'unlisted' | 'private' | 'password';
export type Category = 'hard-surface' | 'miniature' | 'scan';
export type Format = 'glb' | 'stl';
export type SourceUnit = 'mm' | 'cm' | 'm' | 'in';

export const VISIBILITIES: readonly Visibility[] = ['public', 'unlisted', 'private', 'password'];
export const CATEGORIES: readonly Category[] = ['hard-surface', 'miniature', 'scan'];
export const FORMATS: readonly Format[] = ['glb', 'stl'];
export const SOURCE_UNITS: readonly SourceUnit[] = ['mm', 'cm', 'm', 'in'];

export function isVisibility(v: unknown): v is Visibility {
  return VISIBILITIES.includes(v as Visibility);
}

export function isCategory(v: unknown): v is Category {
  return CATEGORIES.includes(v as Category);
}

export function isSourceUnit(v: unknown): v is SourceUnit {
  return SOURCE_UNITS.includes(v as SourceUnit);
}

/** The factor from a source unit to metres. */
const UNIT_TO_METRES: Readonly<Record<SourceUnit, number>> = {
  mm: 0.001,
  cm: 0.01,
  m: 1,
  in: 0.0254,
};

export function sourceUnitFactor(unit: SourceUnit): number {
  return UNIT_TO_METRES[unit];
}

/**
 * The one visibility rule every derived surface uses: search index, results,
 * facet counts, recommendations, the catalogue export and the read API.
 */
export function belongsInSearchIndex(model: {
  readonly state: ModelState;
  readonly visibility: Visibility;
  readonly withinPlan: boolean;
}): boolean {
  return model.state === 'published' && model.visibility === 'public' && model.withinPlan;
}

/** Published models are ranked by first publication, earliest first. */
export interface RankableModel {
  readonly id: number;
  readonly state: ModelState;
  readonly firstPublishedAt: Date | null;
}

/**
 * Returns the ids of published models that are within the plan's limit. A plan
 * with no limit holds every published model.
 */
export function withinPlanIds(
  models: readonly RankableModel[],
  planName: PlanName,
): ReadonlySet<number> {
  const limit = plan(planName).publishedWithinPlan;
  const published = models
    .filter((m) => m.state === 'published')
    .sort((a, b) => {
      const at = a.firstPublishedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const bt = b.firstPublishedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return at === bt ? a.id - b.id : at - bt;
    });
  const kept = limit === null ? published : published.slice(0, limit);
  return new Set(kept.map((m) => m.id));
}

/** A model over the plan's limit is read-only; only withdrawing is still allowed. */
export function isReadOnly(model: {
  readonly state: ModelState;
  readonly withinPlan: boolean;
}): boolean {
  return model.state === 'published' && !model.withinPlan;
}
