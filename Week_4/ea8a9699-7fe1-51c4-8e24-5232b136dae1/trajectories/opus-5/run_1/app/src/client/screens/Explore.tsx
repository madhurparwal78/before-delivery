import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet } from '../lib/api.js';
import { Link, useQuery, useRouter } from '../lib/router.js';
import { feedCopy } from '../lib/copy.js';
import { TopBar } from '../components/TopBar.js';
import { LiveRegion } from '../components/Bits.js';
import { limits } from '../../shared/limits.js';
import type { FeedCard, FeedResponse } from '../../shared/types.js';

function readPages(value: string | null): number {
  if (value === null || !/^\d+$/.test(value)) {
    return 1;
  }
  const parsed = Number(value);
  if (parsed < 2) {
    return 1;
  }
  return Math.min(limits.explorePagesMax, parsed);
}

export function Explore(): JSX.Element {
  const query = useQuery();
  const { navigate } = useRouter();
  const [cards, setCards] = useState<FeedCard[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [pagesLoaded, setPagesLoaded] = useState(1);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const addressPages = readPages(query.get('pages'));

  const loadPages = useCallback(async (count: number): Promise<void> => {
    setLoading(true);
    setMessage(feedCopy.pending());
    try {
      const collected: FeedCard[] = [];
      let nextCursor: string | null = null;
      let loaded = 0;
      for (let page = 0; page < count; page += 1) {
        const search: string = nextCursor === null ? '' : `?cursor=${encodeURIComponent(nextCursor)}`;
        const response: FeedResponse = await apiGet<FeedResponse>(`/api/feed${search}`);
        collected.push(...response.items);
        nextCursor = response.nextCursor;
        loaded += 1;
        if (nextCursor === null) {
          break;
        }
      }
      setCards(collected);
      setCursor(nextCursor);
      setPagesLoaded(loaded);
      setMessage(nextCursor === null ? feedCopy.end() : feedCopy.showing(collected.length));
    } catch {
      setMessage(feedCopy.failed());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPages(addressPages);
  }, [addressPages, loadPages]);

  const loadMore = useCallback(async (): Promise<void> => {
    if (loading || cursor === null) {
      return;
    }
    setLoading(true);
    setMessage(feedCopy.pending());
    try {
      const response = await apiGet<FeedResponse>(`/api/feed?cursor=${encodeURIComponent(cursor)}`);
      const next = [...cards, ...response.items];
      setCards(next);
      setCursor(response.nextCursor);
      setMessage(response.nextCursor === null ? feedCopy.end() : feedCopy.showing(next.length));
      const pages = pagesLoaded + 1;
      setPagesLoaded(pages);
      const capped = Math.min(limits.explorePagesMax, pages);
      navigate(capped <= 1 ? '/explore' : `/explore?pages=${capped}`, { replace: true });
    } catch {
      setMessage(feedCopy.failed());
    } finally {
      setLoading(false);
    }
  }, [cards, cursor, loading, navigate, pagesLoaded]);

  useEffect(() => {
    const node = sentinel.current;
    if (node === null || cursor === null) {
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        void loadMore();
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [cursor, loadMore]);

  return (
    <>
      <TopBar />
      <div className="page">
        <h1>Explore</h1>
        <LiveRegion name="Feed status" message={message} />
        <div className="masonry explore-masonry" role="feed" aria-label="Discovery feed">
          {cards.map((card) => (
            <article className="card feed-card" aria-label={card.title} key={card.id}>
              {card.coverUrl === null ? null : <img src={card.coverUrl} alt="" />}
              <div className="card-body">
                <h3>
                  <Link to={`/c/${card.id}`}>{card.title}</Link>
                </h3>
                <div className="feed-meta">
                  <Link to={`/@${card.curator.handle}`}>@{card.curator.handle}</Link>
                  <span>
                    <span className="count">{card.publicItemCount}</span> items
                  </span>
                </div>
              </div>
            </article>
          ))}
        </div>
        <div ref={sentinel} />
        {cursor === null ? null : (
          <button type="button" disabled={loading} onClick={() => void loadMore()}>
            Load more
          </button>
        )}
      </div>
    </>
  );
}
