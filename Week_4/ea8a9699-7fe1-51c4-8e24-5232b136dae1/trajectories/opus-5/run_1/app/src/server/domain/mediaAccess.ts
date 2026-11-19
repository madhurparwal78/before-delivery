import { one } from '../db.js';
import { isMemberOf, workspaceBySlug, type Viewer } from '../auth.js';
import { publicClusterSql } from './lift.js';
import { reviewLinkByToken, reviewLinkState } from './reviewLinks.js';

export interface MediaSubject {
  id: string;
  workspace_id: string;
  object_key: string;
  content_type: string;
}

async function isWorkspaceMember(workspaceId: string, viewer: Viewer | null): Promise<boolean> {
  if (viewer === null) {
    return false;
  }
  const row = await one<{ slug: string }>('select slug from workspaces where id = $1', [workspaceId]);
  if (row === null) {
    return false;
  }
  const workspace = await workspaceBySlug(row.slug);
  return workspace !== null && isMemberOf(workspace, viewer);
}

async function isEntryOfLinkCluster(referenceId: string, clusterId: string): Promise<boolean> {
  const row = await one(
    'select 1 as present from cluster_entries where cluster_id = $1 and reference_id = $2',
    [clusterId, referenceId],
  );
  return row !== null;
}

async function isPublicMedia(referenceId: string): Promise<boolean> {
  const row = await one(
    `select 1 as present
       from cluster_entries e
       join clusters c on c.id = e.cluster_id
      where e.reference_id = $1 and e.is_private = false and ${publicClusterSql}
      limit 1`,
    [referenceId],
  );
  return row !== null;
}

/** The one place that decides who may read a reference's bytes. */
export async function canReadMedia(
  reference: MediaSubject,
  viewer: Viewer | null,
  reviewToken: string | null,
  now: Date,
): Promise<boolean> {
  if (await isWorkspaceMember(reference.workspace_id, viewer)) {
    return true;
  }
  if (reviewToken !== null) {
    const link = await reviewLinkByToken(reviewToken);
    if (link === null || reviewLinkState(link, now) !== 'live') {
      return false;
    }
    return isEntryOfLinkCluster(reference.id, link.cluster_id);
  }
  return isPublicMedia(reference.id);
}
