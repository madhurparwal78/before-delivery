import { one } from '../db.js';
import { errors } from '../errors.js';
import type { ClusterStatus, ReviewLinkState } from '../../shared/types.js';

export interface ReviewLinkRow {
  id: string;
  cluster_id: string;
  email: string;
  token: string;
  expires_at: Date;
  can_comment: boolean;
  revoked_at: Date | null;
  inactive_at: Date | null;
  created_at: Date;
}

/** The one place that reads a review link's state. Revoked beats inactive, inactive beats expired. */
export function reviewLinkState(link: ReviewLinkRow, now: Date): ReviewLinkState {
  if (link.revoked_at !== null) {
    return 'revoked';
  }
  if (link.inactive_at !== null) {
    return 'inactive';
  }
  if (link.expires_at.getTime() <= now.getTime()) {
    return 'expired';
  }
  return 'live';
}

export function assertLinkUsable(link: ReviewLinkRow, now: Date): void {
  switch (reviewLinkState(link, now)) {
    case 'revoked':
      throw errors.linkRevoked();
    case 'inactive':
      throw errors.linkInactive();
    case 'expired':
      throw errors.linkExpired();
    case 'live':
      return;
  }
}

export interface ReviewLinkWithCluster extends ReviewLinkRow {
  cluster_status: ClusterStatus;
  workspace_id: string;
  workspace_name: string;
  cluster_title: string;
}

export async function reviewLinkByToken(token: string): Promise<ReviewLinkWithCluster | null> {
  return one<ReviewLinkWithCluster>(
    `select l.*, c.status as cluster_status, c.title as cluster_title, c.workspace_id, w.name as workspace_name
       from review_links l
       join clusters c on c.id = l.cluster_id
       join workspaces w on w.id = c.workspace_id
      where l.token = $1`,
    [token],
  );
}

export async function reviewLinkById(id: string): Promise<ReviewLinkWithCluster | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
    return null;
  }
  return one<ReviewLinkWithCluster>(
    `select l.*, c.status as cluster_status, c.title as cluster_title, c.workspace_id, w.name as workspace_name
       from review_links l
       join clusters c on c.id = l.cluster_id
       join workspaces w on w.id = c.workspace_id
      where l.id = $1`,
    [id],
  );
}
