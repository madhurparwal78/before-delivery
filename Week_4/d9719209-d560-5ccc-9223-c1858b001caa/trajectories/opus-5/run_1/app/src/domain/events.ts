import { publishEvent } from '../services/valkey.js';

export const topics = {
  home: 'home',
  community: (name: string) => `community:${name}`,
  post: (postId: string) => `post:${postId}`,
  member: (memberId: string) => `member:${memberId}`,
};

function feedTopics(communityName: string, postId: string): string[] {
  return [topics.home, topics.community(communityName), topics.post(postId)];
}

export async function emitScore(
  targetType: 'post' | 'comment',
  targetId: string,
  postId: string,
  score: number,
  communityName: string,
): Promise<void> {
  await publishEvent({
    event: 'score',
    data: { targetType, targetId, postId, score },
    topics: feedTopics(communityName, postId),
  });
}

export async function emitComments(postId: string, commentCount: number, communityName: string): Promise<void> {
  await publishEvent({
    event: 'comments',
    data: { postId, commentCount },
    topics: feedTopics(communityName, postId),
  });
}

export async function emitComment(
  postId: string,
  parentId: string | null,
  comment: Record<string, unknown>,
): Promise<void> {
  await publishEvent({ event: 'comment', data: { postId, parentId, comment }, topics: [topics.post(postId)] });
}

export interface PostStateEvent {
  postId: string;
  communityName: string;
  state: string;
  publicReason: string | null;
  locked: boolean;
  lockedUntil: string | null;
  pinned: boolean;
  version: number;
}

export async function emitPostState(event: PostStateEvent): Promise<void> {
  await publishEvent({
    event: 'post-state',
    data: event,
    topics: feedTopics(event.communityName, event.postId),
  });
}

export async function emitMembership(communityName: string, memberCount: number): Promise<void> {
  await publishEvent({
    event: 'membership',
    data: { communityName, memberCount },
    topics: [topics.community(communityName), topics.home],
  });
}

export type AccountEventKind = 'moderator-removed' | 'approved' | 'unapproved' | 'suspended';

export async function emitAccount(
  memberId: string,
  kind: AccountEventKind,
  communityName: string | null,
): Promise<void> {
  await publishEvent({
    event: 'account',
    data: { kind, communityName },
    topics: [topics.member(memberId)],
  });
}
