import { useCallback, useEffect, useRef, useState } from 'react';
import type { PostView } from '../shared/types.js';
import { countLabel, utcLabel } from '../shared/format.js';
import { announce } from './announce.js';
import { Gallery } from './gallery.js';
import { useLive } from './live.js';
import { Link, navigate } from './router.js';
import { Button, Empty, Skeleton } from './ui.js';
import { VoteControl, voteKeys } from './votes.js';

export interface FeedPage { items: PostView[]; nextCursor: string | null; pinned?: PostView[] }

export const commentsLabel = (count: number): string => countLabel(count, 'comment', 'comments');

export function Byline({ post, showCommunity = true }: { post: PostView; showCommunity?: boolean }): React.JSX.Element {
  return (
    <p className="byline">
      {showCommunity && <><Link to={`/c/${post.communityName}`}>{`c/${post.communityName}`}</Link>{' · '}</>}
      {post.author ? <Link to={`/u/${post.author.username}`}>{`u/${post.author.username}`}</Link> : <span>[removed]</span>}
      {' · '}
      <span className="num">{utcLabel(post.createdAt)}</span>
    </p>
  );
}

function PostCard({ post, community }: { post: PostView; community: boolean }): React.JSX.Element {
  const [count, setCount] = useState(post.commentCount);
  useEffect(() => setCount(post.commentCount), [post.commentCount]);
  useLive([], (event, data) => {
    if (event === 'comments' && (data as { postId: string }).postId === post.id) setCount((data as { commentCount: number }).commentCount);
  });
  const titleId = `post-title-${post.id}`;

  const keys = (event: React.KeyboardEvent<HTMLElement>): void => {
    const own = event.target === event.currentTarget;
    const field = (event.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]');
    if (!field && !event.ctrlKey && !event.metaKey && !event.altKey && (event.key === 'j' || event.key === 'k')) {
      const cards = [...document.querySelectorAll<HTMLElement>('article.post-card')];
      const at = cards.indexOf(event.currentTarget);
      cards[at + (event.key === 'j' ? 1 : -1)]?.focus();
      event.preventDefault();
      return;
    }
    if (own && event.key === 'Enter') {
      event.preventDefault();
      navigate(post.url);
      return;
    }
    voteKeys(event);
  };

  return (
    <article id={`post-${post.id}`} className="post-card" tabIndex={0} aria-labelledby={titleId} onKeyDown={keys}>
      <VoteControl kind="post" id={post.id} score={post.score} myVote={post.myVote} />
      <div className="post-main">
        <h2 className="post-title" id={titleId}>
          {post.pinned && <><span className="tag">Pinned</span>{' '}</>}
          <Link to={post.url}>{post.title}</Link>
        </h2>
        <Byline post={post} showCommunity={!community} />
        {post.images.length > 0 && <Gallery post={post} compact />}
        <div className="post-meta">
          <Link to={post.url} id={`comments-post-${post.id}`} className="num">{commentsLabel(count)}</Link>
          {post.locked && <span>Locked</span>}
        </div>
      </div>
    </article>
  );
}

interface FeedListProps {
  load: (cursor: string | null) => Promise<FeedPage>;
  /** Changing this starts the feed over (a new sort, a new community). */
  resetKey: string;
  topics: string[];
  inCommunity?: boolean;
  empty: React.ReactNode;
}

/** Cards with hairline rules, paged behind an opaque cursor, kept current by live events. */
export function FeedList({ load, resetKey, topics, inCommunity = false, empty }: FeedListProps): React.JSX.Element {
  const [pinned, setPinned] = useState<PostView[]>([]);
  const [items, setItems] = useState<PostView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [more, setMore] = useState(false);
  const loader = useRef(load);
  loader.current = load;
  const generation = useRef(0);
  const focusAfter = useRef<string | null>(null);

  const start = useCallback(async () => {
    const mine = ++generation.current;
    try {
      const page = await loader.current(null);
      if (mine !== generation.current) return;
      setPinned(page.pinned ?? []);
      setItems(page.items);
      setCursor(page.nextCursor);
      setFailed(false);
    } catch {
      if (mine === generation.current) setFailed(true);
    } finally {
      if (mine === generation.current) setReady(true);
    }
  }, []);

  useEffect(() => {
    setReady(false);
    setItems([]);
    setPinned([]);
    setCursor(null);
    void start();
    return () => { generation.current++; };
  }, [resetKey, start]);

  const more_ = async (): Promise<void> => {
    if (cursor === null) return;
    setMore(true);
    try {
      const page = await loader.current(cursor);
      const shown = new Set([...pinned, ...items].map((p) => p.id));
      const fresh = page.items.filter((p) => !shown.has(p.id));
      focusAfter.current = fresh[0]?.id ?? null;
      setItems((all) => [...all, ...fresh]);
      setCursor(page.nextCursor);
    } catch {
      announce("Couldn't load more posts", true);
    } finally {
      setMore(false);
    }
  };

  useEffect(() => {
    if (focusAfter.current) {
      document.getElementById(`post-${focusAfter.current}`)?.focus();
      focusAfter.current = null;
    }
  }, [items]);

  useLive(topics, (event, data) => {
    if (event === 'resync') {
      void start();
    } else if (event === 'post-state') {
      const s = data as { postId: string; state: string; locked: boolean; lockedUntil: string | null; pinned: boolean };
      const known = [...pinned, ...items].find((p) => p.id === s.postId);
      if (!known) return;
      if (s.state !== 'published') {
        const card = document.getElementById(`post-${s.postId}`);
        const hadFocus = card !== null && card.contains(document.activeElement);
        const cards = [...document.querySelectorAll<HTMLElement>('article.post-card')];
        const next = cards[cards.indexOf(card as HTMLElement) + 1] ?? cards[cards.indexOf(card as HTMLElement) - 1];
        if (hadFocus) next?.focus();
        setItems((all) => all.filter((p) => p.id !== s.postId));
        setPinned((all) => all.filter((p) => p.id !== s.postId));
        if (s.state === 'removed') announce('Post removed by moderators');
      } else if (known.pinned !== s.pinned) {
        void start();
      } else {
        const patch = (p: PostView): PostView => (p.id === s.postId ? { ...p, locked: s.locked, lockedUntil: s.lockedUntil } : p);
        setItems((all) => all.map(patch));
        setPinned((all) => all.map(patch));
      }
    }
  });

  if (!ready) return <Skeleton rows={4} />;
  if (failed) return <Empty title="The feed could not load"><Button onClick={() => void start()}>Try again</Button></Empty>;
  if (pinned.length + items.length === 0) return <>{empty}</>;
  return (
    <div className="feed">
      {[...pinned, ...items].map((post) => <PostCard key={post.id} post={post} community={inCommunity} />)}
      {cursor !== null
        ? <div className="load-more"><Button disabled={more} aria-busy={more || undefined} onClick={() => void more_()}>Load more posts</Button></div>
        : <p className="end-of-feed">You've reached the end</p>}
    </div>
  );
}
