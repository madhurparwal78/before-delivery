import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../app-context.js';
import type { Post } from '../types.js';
import { PostBody } from '../components/post.js';
import { CommentTree } from './feed.js';

export const PostPage = ({ postId }: { postId: string }): JSX.Element => {
  const { liveEvents } = useApp();
  const [post, setPost] = useState<Post | null>(null);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const result = await api.get<Post>(`/api/posts/${postId}`);
      setPost(result);
      setMissing(false);
    } catch (err) {
      const e2 = err as { status?: number };
      if (e2.status === 404) { setPost(null); setMissing(true); }
    }
  }, [postId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    return liveEvents.subscribe((event) => {
      if (event === 'post_update' || event === 'connection' || event === 'clock') void load();
    });
  }, [liveEvents, load]);

  if (missing) {
    return (
      <div className="big-empty">
        <p>This post is no longer available.</p>
        <a href="/">Go to Home</a>
      </div>
    );
  }
  if (!post) return <p aria-live="polite">Loading…</p>;
  return (
    <>
      <article className="entry" data-entry-id={post.id} data-entry-kind="post" data-post-id={post.id}
        data-author-id={post.author.id} data-repost-of="" data-reposter-id="">
        <PostBody post={post} />
      </article>
      <CommentTree postId={post.id} onChanged={() => { void load(); }} />
    </>
  );
};
