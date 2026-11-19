import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../app-context.js';
import type { Post } from '../types.js';
import { Entry } from '../components/post.js';

type HashtagResponse = { posts: Post[]; next_cursor: string | null; stats: { posts: number; members: number } };

export const HashtagPage = ({ tag }: { tag: string }): JSX.Element => {
  const { liveEvents } = useApp();
  const [data, setData] = useState<HashtagResponse | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const result = await api.get<HashtagResponse>(`/api/hashtags/${encodeURIComponent(tag.toLowerCase())}`);
    setData(result);
  }, [tag]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    return liveEvents.subscribe((event) => {
      if (event === 'post_update' || event === 'clock' || event === 'connection') void load();
    });
  }, [liveEvents, load]);

  if (!data) return <p aria-live="polite">Loading…</p>;
  return (
    <>
      <h1 className="profile-name">#{tag}</h1>
      <p className="count-line" data-hashtag-stats>
        {data.stats.posts === 1 ? '1 post' : `${data.stats.posts} posts`} · {data.stats.members === 1 ? '1 member' : `${data.stats.members} members`} this week
      </p>
      {data.posts.length === 0 && (
        <div className="big-empty"><p>No results for “{tag}”</p><a href="/feed">Go to Home</a></div>
      )}
      {data.posts.map((post) => (
        <Entry
          key={post.id}
          entry={{ entry_id: post.id, kind: 'post', created_at: post.created_at, post, reposter: null }}
          focused={false}
          onFocus={() => undefined}
          onChanged={() => { void load(); }}
        />
      ))}
    </>
  );
};
