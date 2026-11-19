import type { Credit, PublicCluster, PublicItem } from '../../shared/types.js';
import type { ClusterRow, EntryRow } from '../repository.js';

/**
 * The one place that decides what the public side may see: public fields only, private entries
 * dropped, and positions renumbered from 1 over what is left.
 */
function publicItemsOf(entries: readonly EntryRow[]): PublicItem[] {
  return entries
    .filter((entry) => !entry.is_private)
    .map((entry, index) => ({
      id: entry.entry_id,
      position: index + 1,
      title: entry.title,
      kind: entry.kind,
      mediaUrl: `/media/${entry.id}`,
      timecode: entry.timecode,
      sourceClipTitle: entry.source_clip_title,
    }));
}

/** Credits list the owner first, then every other designer who added a public entry. */
function creditsOf(cluster: ClusterRow, entries: readonly EntryRow[]): Credit[] {
  const credits: Credit[] = [{ displayName: cluster.owner_display_name, handle: cluster.owner_handle }];
  const seen = new Set([cluster.owner_id]);
  const publicEntries = entries.filter((entry) => !entry.is_private);
  for (const entry of [...publicEntries].sort((left, right) => left.added_at.getTime() - right.added_at.getTime())) {
    if (!seen.has(entry.added_by)) {
      seen.add(entry.added_by);
      credits.push({ displayName: entry.adder_display_name, handle: entry.adder_handle });
    }
  }
  return credits;
}

export function toPublicCluster(
  cluster: ClusterRow,
  entries: readonly EntryRow[],
  publishedAt: Date,
): PublicCluster {
  const items = publicItemsOf(entries);
  return {
    id: cluster.id,
    title: cluster.title,
    publicDescription: cluster.public_description,
    curator: { displayName: cluster.owner_display_name, handle: cluster.owner_handle },
    credits: creditsOf(cluster, entries),
    publishedAt: publishedAt.toISOString(),
    publicItemCount: items.length,
    items,
  };
}
