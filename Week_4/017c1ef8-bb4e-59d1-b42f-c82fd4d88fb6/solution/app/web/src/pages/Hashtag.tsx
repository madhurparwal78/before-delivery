import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import { PostEntry } from '../components/feed/Entry';
import { plural } from '../format';
import { useLive } from '../live';
import type { Post } from '../types';
import { Button } from '../ui';
import '../components/feed/feed.css';

interface HashtagPage {
  posts: Post[];
  next_cursor: string | null;
  stats: { posts: number; members: number };
}

export default function Hashtag() {
  const { tag = '' } = useParams();
  const [page, setPage] = useState<HashtagPage | null>(null);

  const load = useCallback((): void => {
    void api.get<HashtagPage>(`/api/hashtags/${encodeURIComponent(tag)}`).then(setPage);
  }, [tag]);

  useEffect(() => {
    setPage(null);
    load();
  }, [load]);

  useLive('post', (event) => {
    if (event.change === 'created' || event.change === 'deleted') load();
  });
  useLive('reconnected', load);

  const more = async (): Promise<void> => {
    if (!page?.next_cursor) return;
    const next = await api.get<HashtagPage>(`/api/hashtags/${encodeURIComponent(tag)}?cursor=${encodeURIComponent(page.next_cursor)}`);
    setPage({ ...next, posts: [...page.posts, ...next.posts] });
  };

  return (
    <div className="stack">
      <h1 className="page-title">{`#${tag}`}</h1>
      {page ? (
        <p className="muted step-1" data-hashtag-stats>{`${plural(page.stats.posts, 'post')} · ${plural(page.stats.members, 'member')} this week`}</p>
      ) : null}
      <div className="entry-list hashtag-entries step-2">
        {page?.posts.map((post) => <PostEntry key={post.id} post={post} onGone={load} />)}
      </div>
      {page?.next_cursor ? <Button onClick={() => void more()}>Show more posts</Button> : null}
    </div>
  );
}
