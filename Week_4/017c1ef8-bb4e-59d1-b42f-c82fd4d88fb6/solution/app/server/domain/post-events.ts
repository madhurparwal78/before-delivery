import { publishAfterCommit, type Tx } from '../db.js';

type PostChange = 'created' | 'updated' | 'deleted' | 'reactions' | 'comments' | 'reposts';

/** Tells every open page that a post changed, and its author's pages that their notifications may have. */
export function announcePost(tx: Tx, change: PostChange, post: { id: string; author_id: string }): void {
  publishAfterCommit(tx, 'all', { type: 'post', post_id: post.id, change, author_id: post.author_id });
  if (change === 'reactions' || change === 'comments' || change === 'reposts') {
    publishAfterCommit(tx, [post.author_id], { type: 'notification' });
  }
}
