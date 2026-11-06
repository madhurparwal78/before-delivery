import { compareIds, sortIds } from '../../shared/domain.ts';
import type { Snapshot } from './snapshot.ts';

interface AssetGraph {
  down: Map<string, Set<string>>;
  up: Map<string, Set<string>>;
}

/** Asset B is downstream of asset A when any column edge runs from a column of A to a column of B. */
function assetGraph(snapshot: Snapshot): AssetGraph {
  return snapshot.memo('assetGraph', (source) => {
    const down = new Map<string, Set<string>>();
    const up = new Map<string, Set<string>>();
    for (const edge of source.edges.values()) {
      const from = source.columns.get(edge.from)?.assetId;
      const to = source.columns.get(edge.to)?.assetId;
      if (!from || !to || from === to) continue;
      const downSet = down.get(from) ?? new Set<string>();
      downSet.add(to);
      down.set(from, downSet);
      const upSet = up.get(to) ?? new Set<string>();
      upSet.add(from);
      up.set(to, upSet);
    }
    return { down, up };
  });
}

/** Asset-level hops from one asset, never counting the asset itself even through a cycle. */
function assetHops(snapshot: Snapshot, startAssetId: string, direction: 'down' | 'up'): Map<string, number> {
  const neighbours = direction === 'down' ? assetGraph(snapshot).down : assetGraph(snapshot).up;
  const distance = new Map<string, number>();
  const seen = new Set<string>([startAssetId]);
  let frontier = [startAssetId];
  let hop = 0;
  while (frontier.length > 0) {
    hop += 1;
    const next: string[] = [];
    for (const assetId of frontier) {
      for (const neighbour of neighbours.get(assetId) ?? []) {
        if (seen.has(neighbour)) continue;
        seen.add(neighbour);
        distance.set(neighbour, hop);
        next.push(neighbour);
      }
    }
    frontier = next;
  }
  distance.delete(startAssetId);
  return distance;
}

export function transitiveDownstreamAssets(snapshot: Snapshot, assetId: string): string[] {
  return sortIds(assetHops(snapshot, assetId, 'down').keys());
}

function deprecatedUpstreamMap(snapshot: Snapshot): Map<string, string> {
  return snapshot.memo('deprecatedUpstream', (source) => {
    const nearest = new Map<string, { id: string; hop: number }>();
    for (const asset of source.assets.values()) {
      if (asset.state !== 'deprecated') continue;
      for (const [downstreamId, hop] of assetHops(source, asset.id, 'down')) {
        const best = nearest.get(downstreamId);
        if (!best || hop < best.hop || (hop === best.hop && compareIds(asset.id, best.id) < 0)) {
          nearest.set(downstreamId, { id: asset.id, hop });
        }
      }
    }
    return new Map([...nearest].map(([assetId, best]) => [assetId, best.id]));
  });
}

/**
 * The deprecated transitive upstream asset with the fewest asset-level hops;
 * ties go to the lower asset id.
 */
export function nearestDeprecatedUpstream(snapshot: Snapshot, assetId: string): string | null {
  return deprecatedUpstreamMap(snapshot).get(assetId) ?? null;
}

/** Column-level downstream reachability over every edge kind. */
export function columnsDownstreamOfAsset(snapshot: Snapshot, assetId: string): Set<string> {
  const reached = new Set<string>();
  const queue: string[] = snapshot.assetColumns(assetId).map((column) => column.id);
  const seen = new Set<string>(queue);
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const edge of snapshot.out(current)) {
      if (seen.has(edge.to)) continue;
      seen.add(edge.to);
      reached.add(edge.to);
      queue.push(edge.to);
    }
  }
  return reached;
}
