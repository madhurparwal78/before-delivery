// Row shapes from Postgres and the projections into the API's shapes.

import type { Reference, Cluster, Entry, ClusterStatus, Account, Person, PublicCluster, FeedCard, ClusterSummary } from '../shared/types.js';

export interface AccountRow {
  id: string;
  email: string;
  display_name: string;
  handle: string;
  role: 'ops_lead' | 'designer' | 'follower';
  group_id: string | null;
  workspace_id: string | null;
  has_seat: boolean;
}

export interface WorkspaceRow {
  id: string;
  group_id: string;
  slug: string;
  name: string;
  time_zone: string;
  position: number;
}

export interface ReferenceRow {
  id: string;
  workspace_id: string;
  kind: 'image' | 'clip' | 'still';
  title: string;
  ext: string;
  content_type: string;
  frame_rate: number | null;
  duration_ms: number | null;
  total_frames: number | null;
  source_clip_id: string | null;
  source_clip_title: string | null;
  frame_index: number | null;
  timecode: string | null;
  created_by: string;
  created_at: Date;
}

export interface ClusterRow {
  id: string;
  workspace_id: string;
  title: string;
  public_description: string;
  internal_note: string;
  status: ClusterStatus;
  owner_id: string;
  version: number;
  lifts_at: Date | null;
  lifts_local: string | null;
  published_at: Date | null;
}

export interface EntryRow {
  id: string;
  cluster_id: string;
  reference_id: string;
  position: number;
  is_private: boolean;
  added_by: string;
}

export interface PersonRow {
  display_name: string;
  handle: string;
}

export function person(displayName: string, handle: string): Person {
  return { displayName, handle };
}

export function referenceView(row: ReferenceRow, creator: Person, wsSlug: string): Reference {
  const isClip = row.kind === 'clip';
  const isStill = row.kind === 'still';
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    mediaUrl: `/media/${row.id}`,
    createdAt: toIso(row.created_at),
    createdBy: creator,
    frameRate: isClip ? row.frame_rate : null,
    durationMs: isClip ? row.duration_ms : null,
    totalFrames: isClip ? row.total_frames : null,
    sourceClipId: isStill ? row.source_clip_id : null,
    sourceClipTitle: isStill ? row.source_clip_title : null,
    frameIndex: isStill ? row.frame_index : null,
    timecode: isStill ? row.timecode : null,
  };
}

export function clusterView(
  row: ClusterRow,
  entries: EntryRow[],
  refs: Map<string, ReferenceRow>,
  people: Map<string, PersonRow>,
  wsSlug: string,
  timeZone: string,
  owner: PersonRow,
  effective: ClusterStatus,
): Cluster {
  return {
    id: row.id,
    workspace: wsSlug,
    title: row.title,
    publicDescription: row.public_description,
    internalNote: row.internal_note,
    status: effective,
    owner: { displayName: owner.display_name, handle: owner.handle },
    itemCount: entries.length,
    version: row.version,
    timeZone,
    liftLocal: row.lifts_local,
    liftsAt: row.lifts_at ? toIso(row.lifts_at) : null,
    publishedAt: row.published_at ? toIso(row.published_at) : null,
    entries: entries.map((e) => entryView(e, refs, people, wsSlug)).sort((a, b) => a.position - b.position),
  };
}

export function entryView(e: EntryRow, refs: Map<string, ReferenceRow>, people: Map<string, PersonRow>, wsSlug: string): Entry {
  const ref = refs.get(e.reference_id)!;
  const creator = people.get(ref.created_by)!;
  return {
    id: e.id,
    position: e.position,
    isPrivate: e.is_private,
    reference: referenceView(ref, { displayName: creator.display_name, handle: creator.handle }, wsSlug),
  };
}

export function summaryView(c: ClusterRow, itemCount: number): ClusterSummary {
  return { id: c.id, title: c.title, status: c.status, itemCount };
}

export function publicProjection(
  row: ClusterRow,
  owner: PersonRow,
  entries: EntryRow[],
  refs: Map<string, ReferenceRow>,
  credits: PersonRow[],
): PublicCluster {
  const publicEntries = entries.filter((e) => !e.is_private).sort((a, b) => a.position - b.position);
  const items = publicEntries.map((e, i) => {
    const ref = refs.get(e.reference_id)!;
    const isStill = ref.kind === 'still';
    return {
      id: e.id,
      position: i + 1,
      title: ref.title,
      kind: ref.kind,
      mediaUrl: `/media/${ref.id}`,
      timecode: isStill ? ref.timecode : null,
      sourceClipTitle: isStill ? ref.source_clip_title : null,
    };
  });
  return {
    id: row.id,
    title: row.title,
    publicDescription: row.public_description,
    curator: { displayName: owner.display_name, handle: owner.handle },
    credits: credits.map((c) => ({ displayName: c.display_name, handle: c.handle })),
    publishedAt: row.published_at ? toIso(row.published_at) : '',
    publicItemCount: publicEntries.length,
    items,
  };
}

export function feedCardOf(row: ClusterRow, owner: PersonRow, publicEntries: EntryRow[], refs: Map<string, ReferenceRow>): FeedCard {
  const firstPublic = publicEntries.filter((e) => !e.is_private).sort((a, b) => a.position - b.position)[0];
  const cover = firstPublic ? `/media/${firstPublic.reference_id}` : null;
  return {
    id: row.id,
    title: row.title,
    publicDescription: row.public_description,
    curator: { displayName: owner.display_name, handle: owner.handle },
    publicItemCount: publicEntries.filter((e) => !e.is_private).length,
    publishedAt: row.published_at ? toIso(row.published_at) : '',
    coverUrl: cover,
  };
}

export function accountView(account: AccountRow, workspaces: { slug: string; name: string; timeZone: string; hasSeat: boolean }[]): Account {
  return {
    id: account.id,
    email: account.email,
    displayName: account.display_name,
    handle: account.handle,
    role: account.role,
    workspaces,
  };
}

export function toIso(d: Date): string {
  return `${d.toISOString().slice(0, 23)}Z`;
}
