import { api } from '../../api';
import { announce } from '../../announce';
import type { Post, ReactionSummary, ReactionType } from '../../types';

export const REACTION_TYPES: ReactionType[] = ['like', 'celebrate', 'support', 'insightful', 'funny'];

export const reactionName = (type: ReactionType): string => type.charAt(0).toUpperCase() + type.slice(1);

/**
 * Sets, replaces or removes the viewer's reaction: choosing the type already held removes it. Returns the new summary and
 * announces the result.
 */
export async function applyReaction(post: Post, type: ReactionType): Promise<ReactionSummary> {
  if (post.reactions.mine === type) return removeReaction(post);
  const { reactions } = await api.put<{ reactions: ReactionSummary }>(`/api/posts/${post.id}/reaction`, { type });
  announce('Feed announcements', `Reaction: ${reactionName(type)}`);
  return reactions;
}

async function removeReaction(post: Post): Promise<ReactionSummary> {
  const { reactions } = await api.delete<{ reactions: ReactionSummary }>(`/api/posts/${post.id}/reaction`);
  announce('Feed announcements', 'Reaction removed');
  return reactions;
}

/** The React button: Like, or remove whatever the viewer holds. */
export const toggleReact = (post: Post): Promise<ReactionSummary> => (post.reactions.mine ? removeReaction(post) : applyReaction(post, 'like'));
