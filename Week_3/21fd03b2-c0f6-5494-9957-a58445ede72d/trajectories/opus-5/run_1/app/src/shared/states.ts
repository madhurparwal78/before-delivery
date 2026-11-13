export type InviteStatus = 'pending' | 'accepted' | 'revoked' | 'expired';
export type InviteRevokeReason = 'owner' | 'superseded' | null;
export type SceneStatus = 'draft' | 'checkpointed' | 'published' | 'unpublished';
export type WorkspaceRole = 'owner' | 'editor' | 'viewer';
export type InviteRole = 'editor' | 'viewer';

export interface InviteState {
  readonly status: InviteStatus;
  readonly reason: InviteRevokeReason;
}

export type InviteBlock =
  | 'invite_used'
  | 'invite_superseded'
  | 'invite_revoked'
  | 'invite_expired';

/** The answer for an invite that cannot be accepted or revoked, or null when it can. */
export function inviteBlock(state: InviteState): InviteBlock | null {
  if (state.status === 'pending') return null;
  if (state.status === 'accepted') return 'invite_used';
  if (state.status === 'expired') return 'invite_expired';
  return state.reason === 'superseded' ? 'invite_superseded' : 'invite_revoked';
}

export function inviteStatusAt(
  stored: InviteStatus,
  expiresAt: Date,
  now: Date,
): InviteStatus {
  if (stored === 'pending' && now.getTime() >= expiresAt.getTime()) return 'expired';
  return stored;
}

/** The legal edges of the scene state machine. */
export function scenePublishEdge(status: SceneStatus): SceneStatus | 'no_checkpoint' {
  if (status === 'draft') return 'no_checkpoint';
  return 'published';
}

export function sceneUnpublishEdge(status: SceneStatus): SceneStatus | 'not_published' {
  return status === 'published' ? 'unpublished' : 'not_published';
}

export function sceneCheckpointEdge(status: SceneStatus): SceneStatus {
  return status === 'draft' ? 'checkpointed' : status;
}

export const ROLE_LABELS: Record<WorkspaceRole, string> = {
  owner: 'Owner',
  editor: 'Editor',
  viewer: 'Viewer',
};

export function canEditScenes(role: WorkspaceRole): boolean {
  return role === 'owner' || role === 'editor';
}

export function canAdminister(role: WorkspaceRole): boolean {
  return role === 'owner';
}
