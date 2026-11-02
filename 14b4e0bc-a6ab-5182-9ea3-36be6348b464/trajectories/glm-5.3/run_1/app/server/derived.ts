import type { CatalogData } from './catalog';
import { MASKED, type CertState, type Tag } from '../shared/domain';
import { maskDecision } from '../shared/permissions';
import { buildGraph, EffectiveIndex, traverse, reachesAlong, type TColumn, type TGraph } from '../shared/lineage';
import type {
  AssetDetail,
  AssetSummary,
  ColumnBody,
  FacetEntry,
  LineageBody,
  TermBody,
  UserRef,
} from '../shared/api';

export interface Derived {
  graph: TGraph;
  eff: EffectiveIndex;
  counts: Map<string, { tagged: number; pii: number; confidential: number }>;
  /** Nearest deprecated upstream per asset (fewest asset-level hops, ties to lower id). */
  deprecatedUpstream: Map<string, string | null>;
  downstreamAssets: Map<string, Set<string>>;
  upstreamAssets: Map<string, Set<string>>;
}

export function derive(data: CatalogData): Derived {
  const cols: TColumn[] = [];
  for (const c of data.columns.values()) {
    cols.push({
      id: c.id,
      asset: c.asset,
      direct: data.directTags.get(c.id) ?? new Set<Tag>(),
      suppressed: new Set<Tag>((data.suppressions.get(c.id) ?? new Map()).keys()),
    });
  }
  const graph = buildGraph(cols, data.edges);
  const eff = new EffectiveIndex(graph);
  const counts = new Map<string, { tagged: number; pii: number; confidential: number }>();
  const byAsset = new Map<string, TColumn[]>();
  for (const c of cols) {
    const list = byAsset.get(c.asset) ?? [];
    list.push(c);
    byAsset.set(c.asset, list);
  }
  for (const [asset, list] of byAsset) {
    let tagged = 0;
    let pii = 0;
    let confidential = 0;
    for (const c of list) {
      const tags = eff.effectiveOf(c.id);
      if (tags.length > 0) tagged += 1;
      if (tags.includes('PII')) pii += 1;
      if (tags.includes('Confidential')) confidential += 1;
    }
    counts.set(asset, { tagged, pii, confidential });
  }
  const downstreamAssets = new Map<string, Set<string>>();
  const upstreamAssets = new Map<string, Set<string>>();
  for (const a of data.assets.keys()) {
    downstreamAssets.set(a, new Set());
    upstreamAssets.set(a, new Set());
  }
  for (const e of data.edges) {
    const fromAsset = data.columns.get(e.from)?.asset;
    const toAsset = data.columns.get(e.to)?.asset;
    if (!fromAsset || !toAsset || fromAsset === toAsset) continue;
    downstreamAssets.get(fromAsset)?.add(toAsset);
    upstreamAssets.get(toAsset)?.add(fromAsset);
  }
  const deprecatedUpstream = computeDeprecatedUpstream(data, downstreamAssets, upstreamAssets);
  return { graph, eff, counts, deprecatedUpstream, downstreamAssets, upstreamAssets };
}

function computeDeprecatedUpstream(
  data: CatalogData,
  downstream: Map<string, Set<string>>,
  upstream: Map<string, Set<string>>
): Map<string, string | null> {
  // BFS over asset-level upstream edges from each deprecated asset gives every
  // transitive downstream asset with its nearest deprecated upstream.
  const nearest = new Map<string, string | null>();
  for (const a of data.assets.keys()) nearest.set(a, null);
  const deprecated = [...data.assets.values()].filter((a) => a.state === 'deprecated').map((a) => a.id).sort();
  for (const dep of deprecated) {
    const seen = new Set<string>([dep]);
    let frontier = [dep];
    let hops = 0;
    while (frontier.length > 0) {
      const next: string[] = [];
      for (const a of frontier) {
        for (const d of downstream.get(a) ?? []) {
          if (seen.has(d)) continue;
          seen.add(d);
          next.push(d);
          const existing = nearest.get(d);
          if (existing === null || existing === undefined || dep < existing) {
            nearest.set(d, dep);
          }
        }
      }
      hops += 1;
      void hops;
      frontier = next;
    }
  }
  return nearest;
}

export function userRef(data: CatalogData, id: string): UserRef {
  const u = data.users.get(id);
  return { id, name: u?.name ?? id };
}

export function assetSummary(data: CatalogData, d: Derived, id: string): AssetSummary | null {
  const a = data.assets.get(id);
  if (!a) return null;
  const termIds = [...(data.assetTerms.get(id) ?? new Set<string>())];
  const terms = termIds
    .map((tid) => data.terms.get(tid))
    .filter((t): t is NonNullable<typeof t> => t !== undefined)
    .sort((x, y) => compareFolded(x.name, y.name))
    .map((t) => ({ id: t.id, name: t.name }));
  const c = d.counts.get(id) ?? { tagged: 0, pii: 0, confidential: 0 };
  return {
    id,
    kind: a.kind as AssetSummary['kind'],
    description: a.description,
    owner: userRef(data, a.owner_id),
    state: a.state as CertState,
    terms,
    tagged_column_count: c.tagged,
    pii_column_count: c.pii,
    confidential_column_count: c.confidential,
    deprecated_upstream: d.deprecatedUpstream.get(id) ?? null,
  };
}

export function columnBody(
  data: CatalogData,
  d: Derived,
  columnId: string,
  role: RoleForMasking
): ColumnBody | null {
  const c = data.columns.get(columnId);
  if (!c) return null;
  const direct = [...(data.directTags.get(columnId) ?? new Set<Tag>())].sort();
  const effective = d.eff.effectiveOf(columnId);
  const suppressed = [...(data.suppressions.get(columnId)?.keys() ?? [])].sort();
  const sources = d.eff.sourcesOf(columnId) as Record<Tag, string[]>;
  const rawSamples = data.samples.get(columnId) ?? [];
  const decision = maskDecision(role, effective);
  const samples = decision === 'masked' ? rawSamples.map(() => MASKED) : [...rawSamples];
  return {
    id: columnId,
    name: c.name,
    data_type: c.data_type,
    direct_tags: direct,
    effective_tags: effective,
    suppressed_tags: suppressed,
    tag_sources: sources,
    samples,
    masked: decision === 'masked' && rawSamples.length > 0,
  };
}

type RoleForMasking = Parameters<typeof maskDecision>[0];

export function assetDetail(data: CatalogData, d: Derived, id: string, role: RoleForMasking): AssetDetail | null {
  const summary = assetSummary(data, d, id);
  if (!summary) return null;
  const a = data.assets.get(id)!;
  const cols = [...data.columns.values()].filter((c) => c.asset === id).sort((x, y) => x.position - y.position);
  const evidence = data.evidence.get(id);
  const dep = data.deprecations.get(id);
  return {
    ...summary,
    verified_at: a.verified_at,
    evidence: evidence
      ? {
          filename: evidence.filename,
          content_type: evidence.content_type,
          size_bytes: evidence.size_bytes,
          sha256: evidence.sha256,
          uploaded_at: evidence.uploaded_at,
          uploaded_by: userRef(data, evidence.uploaded_by),
        }
      : null,
    deprecation: dep ? { reason: dep.reason, at: dep.at, by: userRef(data, dep.by) } : null,
    columns: cols.map((c) => columnBody(data, d, c.id, role)!).filter((c) => c !== null),
  };
}

export interface SearchParams {
  q: string;
  tag: string | null;
  ownerId: string | null;
  state: string | null;
  termId: string | null;
}

export function matchAsset(data: CatalogData, id: string, q: string): boolean {
  if (q === '') return true;
  const a = data.assets.get(id);
  if (!a) return false;
  const needle = q.toLowerCase();
  if (a.id.toLowerCase().includes(needle)) return true;
  if (a.description.toLowerCase().includes(needle)) return true;
  for (const c of data.columns.values()) {
    if (c.asset !== id) continue;
    if (c.name.toLowerCase().includes(needle)) return true;
  }
  for (const tid of data.assetTerms.get(id) ?? new Set<string>()) {
    const t = data.terms.get(tid);
    if (t && t.name.toLowerCase().includes(needle)) return true;
  }
  return false;
}

export function assetHasTag(d: Derived, assetId: string, tag: Tag): boolean {
  return ((d.counts.get(assetId)?.tagged ?? 0) > 0) && tagCountFor(d, assetId, tag) > 0;
}

function tagCountFor(d: Derived, assetId: string, tag: Tag): number {
  const c = d.counts.get(assetId);
  if (!c) return 0;
  return tag === 'PII' ? c.pii : c.confidential;
}

export function assetHasState(data: CatalogData, id: string, state: string): boolean {
  return data.assets.get(id)?.state === state;
}

export function assetHasTerm(data: CatalogData, id: string, termId: string): boolean {
  return (data.assetTerms.get(id) ?? new Set<string>()).has(termId);
}

/** Facet counts: each group applies the query and the other groups' selections (DP-16). */
export function facetsFor(
  data: CatalogData,
  d: Derived,
  params: SearchParams,
  selected: { tag: string | null; owner: string | null; state: string | null; term: string | null }
): { tag: FacetEntry[]; owner: FacetEntry[]; state: FacetEntry[]; term: FacetEntry[] } {
  const base = (over: { tag: string | null; owner: string | null; state: string | null; term: string | null }): string[] => {
    const out: string[] = [];
    for (const id of data.assets.keys()) {
      if (!matchAsset(data, id, params.q)) continue;
      if (over.tag && !assetHasTag(d, id, over.tag as Tag)) continue;
      if (over.owner && data.assets.get(id)?.owner_id !== over.owner) continue;
      if (over.state && !assetHasState(data, id, over.state)) continue;
      if (over.term && !assetHasTerm(data, id, over.term)) continue;
      out.push(id);
    }
    return out;
  };
  const countTag = (tag: string) => base({ ...selected, tag }).filter((id) => assetHasTag(d, id, tag as Tag)).length;
  const tagFacet: FacetEntry[] = [
    { value: 'PII', label: 'PII', count: countTag('PII') },
    { value: 'Confidential', label: 'Confidential', count: countTag('Confidential') },
  ];
  const stateValues = ['draft', 'verified', 'deprecated'];
  const stateFacetFixed: FacetEntry[] = stateValues.map((s) => ({
    value: s,
    label: s,
    count: base({ ...selected, state: null }).filter((id) => assetHasState(data, id, s)).length,
  }));
  const owners = [...data.users.values()].sort((a, b) => compareFolded(a.name, b.name) || (a.id < b.id ? -1 : 1));
  const ownerFacet: FacetEntry[] = owners
    .map((u) => ({
      value: u.id,
      label: u.name,
      count: base({ ...selected, owner: null }).filter((id) => data.assets.get(id)?.owner_id === u.id).length,
    }))
    .filter((f) => f.count > 0 || (selected.owner !== null && f.value === selected.owner));
  const terms = [...data.terms.values()].sort((a, b) => compareFolded(a.name, b.name) || (a.id < b.id ? -1 : 1));
  const termFacet: FacetEntry[] = terms
    .map((t) => ({
      value: t.id,
      label: t.name,
      count: base({ ...selected, term: null }).filter((id) => assetHasTerm(data, id, t.id)).length,
    }))
    .filter((f) => f.count > 0 || (selected.term !== null && f.value === selected.term));
  return { tag: tagFacet, owner: ownerFacet, state: stateFacetFixed, term: termFacet };
}

export function compareFolded(a: string, b: string): number {
  const fa = foldName(a);
  const fb = foldName(b);
  if (fa === fb) return 0;
  return fa < fb ? -1 : 1;
}

export function foldName(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function termBody(data: CatalogData, termId: string): TermBody | null {
  const t = data.terms.get(termId);
  if (!t) return null;
  const assets = [...data.assetTerms.entries()]
    .filter(([, terms]) => terms.has(termId))
    .map(([asset]) => ({ id: asset }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { id: t.id, name: t.name, definition: t.definition, revision: t.revision, assets };
}

/** The lineage response for one focus column and direction (DP-39). */
export function lineageBody(
  data: CatalogData,
  d: Derived,
  focus: string,
  direction: 'downstream' | 'upstream',
  asOfSeq: number | null
): LineageBody | null {
  if (!data.columns.has(focus)) return null;
  const downstream = direction === 'downstream';
  const focusTags = d.eff.effectiveOf(focus);
  const focusSources = d.eff.sourcesOf(focus) as Record<Tag, string[]>;

  const describe = (col: string): { carried: Tag[]; sealed: Tag[]; sources: Partial<Record<Tag, string[]>> } => {
    const info = data.suppressions.get(col);
    const suppressed = info ? [...info.keys()] : [];
    let carried: Tag[] = [];
    let sealed: Tag[] = [];
    if (downstream) {
      for (const tag of focusTags) {
        if (suppressed.includes(tag)) {
          if (reachesAlong(d.graph, tag, focus, col, 'downstream')) {
            // The tag reaches the column except for its suppression.
            sealed.push(tag);
          }
          continue;
        }
        let reached = false;
        for (const holder of focusSources[tag] ?? []) {
          if (d.eff.holderReaches(tag, holder, col)) {
            reached = true;
            break;
          }
        }
        if (reached) carried.push(tag);
      }
    } else {
      const colTags = d.eff.effectiveOf(col);
      for (const tag of colTags) {
        if (suppressed.includes(tag)) {
          sealed.push(tag);
          continue;
        }
        const holders = d.eff.sourcesOf(col)?.[tag] ?? [];
        for (const holder of holders) {
          if (reachesAlong(d.graph, tag, holder, focus, 'upstream')) {
            carried.push(tag);
            break;
          }
        }
      }
    }
    carried = carried.sort();
    sealed = sealed.sort();
    const sources: Partial<Record<Tag, string[]>> = {};
    for (const tag of carried) {
      sources[tag] = (d.eff.sourcesOf(col)?.[tag] ?? []).slice();
    }
    return { carried, sealed, sources };
  };

  const result = traverse({ graph: d.graph, focusTags, focusSources, describe }, focus, direction);
  const assetsMap: LineageBody['assets'] = {};
  const assetIds = new Set<string>([data.columns.get(focus)!.asset]);
  for (const r of result.reached) assetIds.add(r.asset);
  for (const id of [...assetIds].sort()) {
    const a = data.assets.get(id);
    assetsMap[id] = {
      state: (a?.state ?? 'draft') as CertState,
      deprecated_upstream: d.deprecatedUpstream.get(id) ?? null,
    };
  }
  const hops = result.reached.length > 0 ? Math.max(...result.reached.map((r) => r.hop)) : 0;
  const summary = `Trace complete. Columns reached: ${result.reached.length}. Hops: ${hops}. Cycles: ${result.cycles.length}.`
    + (result.truncated ? ' Truncated at the 12-hop or 500-column limit.' : '');
  const body: LineageBody = {
    focus,
    direction,
    focus_tags: focusTags,
    focus_tag_sources: focusSources,
    reached: result.reached,
    edges: result.edges,
    cycles: result.cycles,
    assets: assetsMap,
    totals: { columns: result.reached.length, hops, cycles: result.cycles.length },
    truncated: result.truncated,
    limits: { max_hops: 12, max_columns: 500 },
    summary,
  };
  void asOfSeq;
  return body;
}

/** Columns whose effective tags, suppressed tags or sources a change affected. */
export interface LightColumn {
  effective: Tag[];
  suppressed: Tag[];
  sources: Record<string, string[]>;
}

export function changedColumns(before: Map<string, LightColumn>, after: Map<string, LightColumn>): string[] {
  const changed: string[] = [];
  for (const [id, a] of after) {
    const b = before.get(id);
    if (!b) continue;
    if (!sameTags(b.effective, a.effective) || !sameTags(b.suppressed, a.suppressed) || !sameSources(b.sources, a.sources)) {
      changed.push(id);
    }
  }
  return changed.sort();
}

function sameTags(a: Tag[], b: Tag[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function sameSources(a: Record<string, string[]>, b: Record<string, string[]>): boolean {
  const ak = Object.keys(a).sort();
  const bk = Object.keys(b).sort();
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    const av = a[k] ?? [];
    const bv = b[k] ?? [];
    if (av.length !== bv.length || av.some((v, i) => v !== bv[i])) return false;
  }
  return true;
}
