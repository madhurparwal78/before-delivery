export type ActivityAction =
  | 'workspace.created'
  | 'member.role_changed'
  | 'invite.created'
  | 'invite.revoked'
  | 'invite.accepted'
  | 'project.created'
  | 'scene.created'
  | 'scene.edited'
  | 'asset.uploaded'
  | 'checkpoint.created'
  | 'checkpoint.restored'
  | 'scene.published'
  | 'scene.unpublished'
  | 'lab_link.regenerated'
  | 'share_link.created'
  | 'share_link.regenerated'
  | 'share_link.revoked';

export const ACTIVITY_PHRASES: Record<ActivityAction, string> = {
  'workspace.created': 'created workspace',
  'member.role_changed': 'changed the role of',
  'invite.created': 'invited',
  'invite.revoked': 'withdrew the invite to',
  'invite.accepted': 'accepted the invite for',
  'project.created': 'created project',
  'scene.created': 'created scene',
  'scene.edited': 'edited scene',
  'asset.uploaded': 'uploaded',
  'checkpoint.created': 'saved checkpoint',
  'checkpoint.restored': 'restored checkpoint',
  'scene.published': 'published the lab for',
  'scene.unpublished': 'unpublished the lab for',
  'lab_link.regenerated': 'replaced the lab link for',
  'share_link.created': 'created a read-only link to',
  'share_link.regenerated': 'replaced a read-only link to',
  'share_link.revoked': 'revoked a read-only link to',
};

export function activitySentence(actor: string, action: ActivityAction, targetName: string): string {
  return `${actor} ${ACTIVITY_PHRASES[action]} ${targetName}`;
}
