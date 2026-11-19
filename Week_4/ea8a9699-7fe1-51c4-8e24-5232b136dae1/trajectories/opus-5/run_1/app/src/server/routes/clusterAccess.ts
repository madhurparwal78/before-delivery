import { hasSeat, isMemberOf, requireViewer, workspaceBySlug, type Viewer, type WorkspaceAccess } from '../auth.js';
import { errors } from '../errors.js';
import { loadCluster, type ClusterRow } from '../repository.js';
import type { RequestContext } from '../http/context.js';

export interface ClusterAccess extends WorkspaceAccess {
  cluster: ClusterRow;
}

export async function requireClusterMembership(context: RequestContext, clusterId: string): Promise<ClusterAccess> {
  const viewer: Viewer = await requireViewer(context);
  const cluster = await loadCluster(clusterId);
  if (cluster === null) {
    throw errors.notFound();
  }
  const workspace = await workspaceBySlug(cluster.slug);
  if (workspace === null || !isMemberOf(workspace, viewer)) {
    throw errors.notFound();
  }
  const isOpsLead = viewer.role === 'ops_lead';
  return {
    cluster,
    workspace,
    viewer,
    isOpsLead,
    isSeated: isOpsLead || (await hasSeat(workspace.id, viewer.id)),
  };
}

export function requireClusterSeat(access: ClusterAccess): ClusterAccess {
  if (!access.isSeated) {
    throw errors.seatRequired();
  }
  return access;
}
