import { pool } from './db.js';
import { emit } from './valkey.js';
import { loadPost } from './views.js';
import type { StreamPayloads } from '../shared/types.js';

const key = (name: string): string => name.toLowerCase();

const feedTopics = (communityName: string, postId: string): string[] =>
  ['home', `community:${key(communityName)}`, `post:${postId}`];

export const emitScore = (communityName: string, payload: StreamPayloads['score']): Promise<void> =>
  emit(feedTopics(communityName, payload.postId), 'score', payload);

export const emitComments = (communityName: string, payload: StreamPayloads['comments']): Promise<void> =>
  emit(feedTopics(communityName, payload.postId), 'comments', payload);

export const emitComment = (payload: StreamPayloads['comment']): Promise<void> =>
  emit([`post:${payload.postId}`], 'comment', payload);

export const emitMembership = (payload: StreamPayloads['membership']): Promise<void> =>
  emit([`community:${key(payload.communityName)}`, 'home'], 'membership', payload);

export const emitAccount = (userId: string, payload: StreamPayloads['account']): Promise<void> =>
  emit([`user:${userId}`], 'account', payload);

/** Announces the post's current public moderation state to every surface that shows it. */
export async function emitPostState(postId: string): Promise<void> {
  const post = await loadPost(pool, null, postId);
  if (!post) return;
  const payload: StreamPayloads['post-state'] = {
    postId: post.id,
    communityName: post.communityName,
    state: post.state,
    publicReason: post.removal?.publicReason ?? null,
    locked: post.locked,
    lockedUntil: post.lockedUntil,
    pinned: post.pinned,
    version: post.version,
  };
  await emit(feedTopics(post.communityName, post.id), 'post-state', payload);
}
