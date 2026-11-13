export const ACTIVITY_ACTIONS = [
  'workspace.created',
  'member.role_changed',
  'invite.created',
  'invite.revoked',
  'invite.accepted',
  'project.created',
  'scene.created',
  'scene.edited',
  'asset.uploaded',
  'checkpoint.created',
  'checkpoint.restored',
  'scene.published',
  'scene.unpublished',
  'lab_link.regenerated',
  'share_link.created',
  'share_link.regenerated',
  'share_link.revoked',
] as const;

export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

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

export const ACTIVITY_PAGE_SIZE = 50;
export const ACTIVITY_MAX_LIMIT = 100;

/** `YYYY-MM-DD HH:MM` in the browser's local time zone. */
export function formatActivityTime(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}
