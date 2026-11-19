export const VISIBILITIES = ['public', 'friends', 'community', 'invite'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export function isVisibility(value: unknown): value is Visibility {
  return typeof value === 'string' && (VISIBILITIES as readonly string[]).includes(value);
}

export interface ViewerFacts {
  sameWorld: boolean;
  inside: boolean;
  bannedByVote: boolean;
  friendOfHost: boolean;
  communityMember: boolean;
  invited: boolean;
  blockedWithHost: boolean;
}

export function maySeeSession(visibility: Visibility, facts: ViewerFacts): boolean {
  if (!facts.sameWorld) return false;
  if (facts.bannedByVote) return false;
  if (facts.inside) return true;
  if (visibility === 'public') return true;
  if (facts.blockedWithHost) return false;
  if (visibility === 'friends') return facts.friendOfHost;
  if (visibility === 'community') return facts.communityMember;
  return facts.invited;
}
