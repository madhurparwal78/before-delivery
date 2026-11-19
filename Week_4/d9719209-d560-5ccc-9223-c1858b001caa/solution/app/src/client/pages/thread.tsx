import { useEffect, useState } from 'react';
import type { PostView } from '../../shared/types.js';
import { utcLabel } from '../../shared/format.js';
import { get } from '../api.js';
import { CommentTree, useCommentTree } from '../comment-tree.js';
import { useCommunity } from '../community.js';
import { useLoad } from '../data.js';
import { useLive } from '../live.js';
import { Link, navigate } from '../router.js';
import { Empty, Skeleton, pageTitle } from '../ui.js';
import { commentsLabel } from '../feed.js';
import { Score } from '../votes.js';

/** The continue page: the subtree under one comment, shown from level 1. */
export function ThreadPage({ name, postId, commentId }: { name: string; postId: string; commentId: string }): React.JSX.Element {
  const [count, setCount] = useState<number | null>(null);
  const model = useCommentTree({ postId, rootId: commentId, sort: 'top', onCommentCount: setCount });
  const realPostId = model.postId;
  const community = useCommunity(name);
  const post = useLoad(() => (realPostId ? get<PostView>(`/api/posts/${realPostId}`) : Promise.reject(new Error('waiting'))), realPostId ?? 'none');
  const { setData: setPost, reload: reloadPost } = post;

  useEffect(() => {
    if (realPostId && realPostId !== postId) navigate(`/c/${name}/post/${realPostId}/comment/${commentId}${location.search}`, true);
  }, [realPostId, postId, name, commentId]);

  useLive(realPostId ? [`post:${realPostId}`] : [], (event, data) => {
    if (event === 'post-state') {
      const s = data as { postId: string; locked: boolean; lockedUntil: string | null; state: PostView['state']; version: number };
      if (s.postId === realPostId) setPost((p) => (p ? { ...p, locked: s.locked, lockedUntil: s.lockedUntil, state: s.state, version: s.version } : p));
    } else if (event === 'resync') {
      void reloadPost();
    }
  });
  pageTitle(post.data?.title ?? '');

  if (model.error?.status === 404) return <Empty title="Comment not found">This comment does not exist.</Empty>;
  if (!model.tree || !post.data || !community.data) return <Skeleton rows={3} />;
  const p = post.data;
  const shownCount = count ?? p.commentCount;
  return (
    <div className="page-solo thread-page">
      <header className="thread-head">
        <h1 className="thread-title"><Link to={p.url}>{p.title ?? '[deleted by author]'}</Link></h1>
        <p className="byline">
          <Link to={`/c/${p.communityName}`}>{`c/${p.communityName}`}</Link>
          {p.author && <>{' · '}<Link to={`/u/${p.author.username}`}>{`u/${p.author.username}`}</Link></>}
          {' · '}<span className="num">{utcLabel(p.createdAt)}</span>
        </p>
        <p className="post-meta">
          <Score id={`score-post-${p.id}`} score={p.score} />
          <span id={`comments-post-${p.id}`} className="num">{commentsLabel(shownCount)}</span>
        </p>
        <p><Link to={p.url}>Back to full thread</Link></p>
      </header>
      {p.locked && <div className="banner banner-warn"><p>Locked by moderators</p></div>}
      <CommentTree model={model} post={p} community={community.data} onCommentCount={setCount} />
    </div>
  );
}
