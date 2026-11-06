import {
  type CertificationState,
  type EdgeKind,
  type LineageDirection,
  type Tag,
  type Transform,
  MAX_COLUMNS,
  MAX_HOPS,
  compareIds,
  isPassThrough,
} from '../../shared/domain.ts';
import { nearestDeprecatedUpstream } from './deprecation.ts';
import type { EdgeRecord, Snapshot } from './snapshot.ts';
import {
  type TagSources,
  effectiveTags,
  suppressionActive,
  tagSourcesOf,
  walkReach,
} from './tags.ts';

export interface ReachedColumn {
  column: string;
  asset: string;
  hop: number;
  carried_tags: Tag[];
  sealed_tags: Tag[];
  tag_sources: TagSources;
}

export interface LineageEdge {
  from: string;
  to: string;
  transform: Transform;
  kind: EdgeKind;
}

export interface LineageBody {
  focus: string;
  direction: LineageDirection;
  focus_tags: Tag[];
  focus_tag_sources: TagSources;
  reached: ReachedColumn[];
  edges: LineageEdge[];
  cycles: { from: string; to: string }[];
  assets: Record<string, { state: CertificationState; deprecated_upstream: string | null }>;
  totals: { columns: number; hops: number; cycles: number };
  truncated: boolean;
  limits: { max_hops: number; max_columns: number };
  summary: string;
}

function neighbours(snapshot: Snapshot, columnId: string, direction: LineageDirection): readonly EdgeRecord[] {
  return direction === 'downstream' ? snapshot.out(columnId) : snapshot.in(columnId);
}

function far(edge: EdgeRecord, direction: LineageDirection): string {
  return direction === 'downstream' ? edge.to : edge.from;
}

/** Whether some path, walked in the traversal direction, leads from `start` back to `target`. */
function pathExists(
  snapshot: Snapshot,
  start: string,
  target: string,
  direction: LineageDirection,
): boolean {
  const seen = new Set<string>([start]);
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const edge of neighbours(snapshot, current, direction)) {
      const next = far(edge, direction);
      if (next === target) return true;
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return false;
}

function summaryText(columns: number, hops: number, cycles: number, truncated: boolean): string {
  const base = `Trace complete. Columns reached: ${columns}. Hops: ${hops}. Cycles: ${cycles}.`;
  return truncated ? `${base} Truncated at the 12-hop or 500-column limit.` : base;
}

export function traceLineage(snapshot: Snapshot, focusId: string, direction: LineageDirection): LineageBody {
  const focus = snapshot.columns.get(focusId);
  if (!focus) throw new Error(`Unknown column ${focusId}`);

  const hopOf = new Map<string, number>([[focusId, 0]]);
  const order: string[] = [];
  let truncated = false;
  let frontier = [focusId];

  for (let hop = 1; hop <= MAX_HOPS && frontier.length > 0; hop += 1) {
    const candidates = new Set<string>();
    for (const columnId of frontier) {
      for (const edge of neighbours(snapshot, columnId, direction)) {
        const nextId = far(edge, direction);
        if (!hopOf.has(nextId) && snapshot.columns.has(nextId)) candidates.add(nextId);
      }
    }
    const sorted = [...candidates].sort(compareIds);
    const accepted: string[] = [];
    for (const columnId of sorted) {
      if (order.length >= MAX_COLUMNS) {
        truncated = true;
        break;
      }
      hopOf.set(columnId, hop);
      order.push(columnId);
      accepted.push(columnId);
    }
    if (truncated) break;
    frontier = accepted;
    if (hop === MAX_HOPS) {
      for (const columnId of frontier) {
        for (const edge of neighbours(snapshot, columnId, direction)) {
          if (!hopOf.has(far(edge, direction))) truncated = true;
        }
      }
    }
  }

  const focusEffective = effectiveTags(snapshot, focusId);
  const carriedByTag = new Map<Tag, Set<string>>();
  const sealedByTag = new Map<Tag, Set<string>>();
  for (const tag of focusEffective) {
    if (direction === 'downstream') {
      const walk = walkReach(snapshot, [focusId], tag, 'downstream');
      carriedByTag.set(tag, walk.reached);
      sealedByTag.set(tag, walk.sealed);
    }
  }
  const upstreamHolders = new Map<Tag, Set<string>>();
  if (direction === 'upstream') {
    for (const tag of ['Confidential', 'PII'] as Tag[]) {
      if (focus.suppressedTags.includes(tag)) {
        upstreamHolders.set(tag, new Set());
        continue;
      }
      upstreamHolders.set(tag, walkReach(snapshot, [focusId], tag, 'upstream').reached);
    }
  }

  const reached: ReachedColumn[] = order
    .map((columnId) => {
      const column = snapshot.columns.get(columnId);
      if (!column) throw new Error(`Unknown column ${columnId}`);
      const carried: Tag[] = [];
      const sealed: Tag[] = [];
      if (direction === 'downstream') {
        for (const tag of focusEffective) {
          if (carriedByTag.get(tag)?.has(columnId)) carried.push(tag);
          if (sealedByTag.get(tag)?.has(columnId)) sealed.push(tag);
        }
      } else {
        for (const tag of effectiveTags(snapshot, columnId)) {
          if (upstreamHolders.get(tag)?.has(columnId)) carried.push(tag);
        }
        for (const tag of column.suppressedTags) {
          if (suppressionActive(snapshot, columnId, tag)) sealed.push(tag);
        }
      }
      const allSources = tagSourcesOf(snapshot, columnId);
      const tagSources: TagSources = {};
      for (const tag of carried) {
        const sources = allSources[tag];
        if (sources) tagSources[tag] = sources;
      }
      return {
        column: columnId,
        asset: column.assetId,
        hop: hopOf.get(columnId) as number,
        carried_tags: carried,
        sealed_tags: sealed,
        tag_sources: tagSources,
      };
    })
    .sort((a, b) => (a.hop !== b.hop ? a.hop - b.hop : compareIds(a.column, b.column)));

  const visited = new Set<string>([focusId, ...order]);
  const edges: LineageEdge[] = [];
  const cycles: { from: string; to: string }[] = [];
  const seenEdges = new Set<string>();
  for (const columnId of visited) {
    for (const edge of neighbours(snapshot, columnId, direction)) {
      const nextId = far(edge, direction);
      if (!visited.has(nextId) || seenEdges.has(edge.id)) continue;
      seenEdges.add(edge.id);
      const uHop = hopOf.get(columnId) as number;
      const vHop = hopOf.get(nextId) as number;
      const isCycle =
        (nextId === focusId || vHop <= uHop) && pathExists(snapshot, nextId, columnId, direction);
      const kind: EdgeKind = isCycle ? 'cycle' : isPassThrough(edge.transform) ? 'flow' : 'seal';
      edges.push({ from: edge.from, to: edge.to, transform: edge.transform, kind });
      if (isCycle) cycles.push({ from: edge.from, to: edge.to });
    }
  }
  edges.sort((a, b) => compareIds(a.from, b.from) || compareIds(a.to, b.to));
  cycles.sort((a, b) => compareIds(a.from, b.from) || compareIds(a.to, b.to));

  const assetIds = [...new Set<string>([focus.assetId, ...reached.map((entry) => entry.asset)])].sort(
    compareIds,
  );
  const assets: LineageBody['assets'] = {};
  for (const assetId of assetIds) {
    const asset = snapshot.assets.get(assetId);
    if (!asset) continue;
    assets[assetId] = {
      state: asset.state,
      deprecated_upstream: nearestDeprecatedUpstream(snapshot, assetId),
    };
  }

  const hops = reached.reduce((max, entry) => Math.max(max, entry.hop), 0);
  return {
    focus: focusId,
    direction,
    focus_tags: focusEffective,
    focus_tag_sources: tagSourcesOf(snapshot, focusId),
    reached,
    edges,
    cycles,
    assets,
    totals: { columns: reached.length, hops, cycles: cycles.length },
    truncated,
    limits: { max_hops: MAX_HOPS, max_columns: MAX_COLUMNS },
    summary: summaryText(reached.length, hops, cycles.length, truncated),
  };
}
