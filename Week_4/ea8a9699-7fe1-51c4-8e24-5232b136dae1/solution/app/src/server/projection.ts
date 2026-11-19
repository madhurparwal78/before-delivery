// The public projection (brief: Business rules > Public projection). Public pages, endpoints, the feed and
// digests carry only these shapes: never notes, private entries, comments, emails, seats, roles or workspaces.
import { isoOrNull, many, type Db } from "./db.js";
import { entriesOf, mediaUrl, type ClusterRow, type EntryRow } from "./records.js";

interface Person {
  displayName: string;
  handle: string;
}

function publicItems(entries: EntryRow[]) {
  return entries
    .filter((e) => !e.is_private)
    .map((e, index) => ({
      id: e.entry_id,
      position: index + 1,
      title: e.title,
      kind: e.kind,
      mediaUrl: mediaUrl(e.id),
      timecode: e.timecode,
      sourceClipTitle: e.source_clip_title,
    }));
}

/** Owner first, then every other designer who added a non-private entry, by first such addition. */
function credits(cluster: ClusterRow, entries: EntryRow[]): Person[] {
  const people: Person[] = [{ displayName: cluster.owner_name, handle: cluster.owner_handle }];
  const seen = new Set([cluster.owner_id]);
  const additions = entries.filter((e) => !e.is_private && e.added_by_role === "designer").sort((a, b) => a.added_at.getTime() - b.added_at.getTime());
  for (const e of additions) {
    if (seen.has(e.added_by)) continue;
    seen.add(e.added_by);
    people.push({ displayName: e.added_by_name, handle: e.added_by_handle });
  }
  return people;
}

export async function publicCluster(db: Db, cluster: ClusterRow) {
  const entries = await entriesOf(db, cluster.id);
  const items = publicItems(entries);
  return {
    id: cluster.id,
    title: cluster.title,
    publicDescription: cluster.public_description,
    curator: { displayName: cluster.owner_name, handle: cluster.owner_handle },
    credits: credits(cluster, entries),
    publishedAt: isoOrNull(cluster.published_at),
    publicItemCount: cluster.public_item_count,
    items,
  };
}

/** The media URL of each cluster's first public item, for feed cards and profile grids. */
export async function covers(db: Db, clusterIds: string[]): Promise<Map<string, string>> {
  if (!clusterIds.length) return new Map();
  const rows = await many<{ cluster_id: string; reference_id: string }>(
    db,
    `SELECT DISTINCT ON (cluster_id) cluster_id, reference_id FROM entries
      WHERE cluster_id = ANY($1::uuid[]) AND NOT is_private ORDER BY cluster_id, position`,
    [clusterIds],
  );
  return new Map(rows.map((r) => [r.cluster_id, mediaUrl(r.reference_id)]));
}

export const feedCard = (c: ClusterRow, cover: string | undefined) => ({
  id: c.id,
  title: c.title,
  publicDescription: c.public_description,
  curator: { displayName: c.owner_name, handle: c.owner_handle },
  publicItemCount: c.public_item_count,
  publishedAt: isoOrNull(c.published_at),
  coverUrl: cover ?? null,
});

export const curatorCluster = (c: ClusterRow, cover: string | undefined) => ({
  id: c.id,
  title: c.title,
  publishedAt: isoOrNull(c.published_at),
  publicItemCount: c.public_item_count,
  coverUrl: cover ?? null,
});

/** The review link's view of its one cluster (brief: API > GET /api/review/<token>). */
export async function reviewCluster(db: Db, cluster: ClusterRow, token: string) {
  const entries = await entriesOf(db, cluster.id);
  return {
    title: cluster.title,
    publicDescription: cluster.public_description,
    itemCount: entries.length,
    entries: entries.map((e) => ({
      id: e.entry_id,
      position: e.position,
      title: e.title,
      kind: e.kind,
      mediaUrl: `${mediaUrl(e.id)}?review=${encodeURIComponent(token)}`,
      timecode: e.timecode,
      sourceClipTitle: e.source_clip_title,
      isPrivate: e.is_private,
    })),
  };
}
