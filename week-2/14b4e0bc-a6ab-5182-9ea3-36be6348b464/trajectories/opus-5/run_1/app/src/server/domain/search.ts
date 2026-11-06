import {
  type CertificationState,
  type Tag,
  CERTIFICATION_STATES,
  compareByName,
  compareIds,
} from '../../shared/domain.ts';
import type { AssetRecord, Snapshot } from './snapshot.ts';
import { assetCarriesTag } from './tags.ts';
import { type AssetSummary, assetSummary } from './views.ts';

export interface SearchFilters {
  q: string;
  tag: Tag | null;
  owner: string | null;
  state: CertificationState | null;
  term: string | null;
}

export interface FacetEntry {
  value: string;
  label: string;
  count: number;
}

export interface SearchBody {
  results: AssetSummary[];
  total: number;
  facets: { tag: FacetEntry[]; owner: FacetEntry[]; state: FacetEntry[]; term: FacetEntry[] };
}

type FacetGroup = 'tag' | 'owner' | 'state' | 'term';

const MAX_RESULTS = 100;

function matchesQuery(snapshot: Snapshot, asset: AssetRecord, q: string): boolean {
  if (q === '') return true;
  const needle = q.toLowerCase();
  if (asset.id.toLowerCase().includes(needle)) return true;
  if (asset.description.toLowerCase().includes(needle)) return true;
  for (const column of snapshot.assetColumns(asset.id)) {
    if (column.name.toLowerCase().includes(needle)) return true;
  }
  for (const termId of asset.termIds) {
    const term = snapshot.terms.get(termId);
    if (term && term.name.toLowerCase().includes(needle)) return true;
  }
  return false;
}

/** Filters combine with AND; `skip` leaves one facet group's own selection out. */
function matchesFilters(
  snapshot: Snapshot,
  asset: AssetRecord,
  filters: SearchFilters,
  skip: FacetGroup | null,
): boolean {
  if (!matchesQuery(snapshot, asset, filters.q)) return false;
  if (skip !== 'tag' && filters.tag !== null && !assetCarriesTag(snapshot, asset.id, filters.tag)) {
    return false;
  }
  if (skip !== 'owner' && filters.owner !== null && asset.ownerId !== filters.owner) return false;
  if (skip !== 'state' && filters.state !== null && asset.state !== filters.state) return false;
  if (skip !== 'term' && filters.term !== null && !asset.termIds.includes(filters.term)) return false;
  return true;
}

export function runSearch(snapshot: Snapshot, filters: SearchFilters): SearchBody {
  const assets = [...snapshot.assets.values()].sort((a, b) => compareIds(a.id, b.id));
  const matched = assets.filter((asset) => matchesFilters(snapshot, asset, filters, null));
  const base = (group: FacetGroup): AssetRecord[] =>
    assets.filter((asset) => matchesFilters(snapshot, asset, filters, group));

  const tagBase = base('tag');
  const stateBase = base('state');
  const ownerBase = base('owner');
  const termBase = base('term');

  const tagFacets: FacetEntry[] = (['PII', 'Confidential'] as Tag[]).map((tag) => ({
    value: tag,
    label: tag,
    count: tagBase.filter((asset) => assetCarriesTag(snapshot, asset.id, tag)).length,
  }));

  const stateFacets: FacetEntry[] = CERTIFICATION_STATES.map((state) => ({
    value: state,
    label: state,
    count: stateBase.filter((asset) => asset.state === state).length,
  }));

  const ownerFacets: FacetEntry[] = [...snapshot.users.values()]
    .sort(compareByName)
    .map((user) => ({
      value: user.id,
      label: user.name,
      count: ownerBase.filter((asset) => asset.ownerId === user.id).length,
    }))
    .filter((entry) => entry.count > 0 || entry.value === filters.owner);

  const termFacets: FacetEntry[] = [...snapshot.terms.values()]
    .sort(compareByName)
    .map((term) => ({
      value: term.id,
      label: term.name,
      count: termBase.filter((asset) => asset.termIds.includes(term.id)).length,
    }))
    .filter((entry) => entry.count > 0 || entry.value === filters.term);

  return {
    results: matched.slice(0, MAX_RESULTS).map((asset) => assetSummary(snapshot, asset)),
    total: matched.length,
    facets: { tag: tagFacets, owner: ownerFacets, state: stateFacets, term: termFacets },
  };
}
