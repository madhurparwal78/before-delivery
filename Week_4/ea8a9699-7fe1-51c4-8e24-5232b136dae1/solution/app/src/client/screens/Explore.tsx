// Explore: the public discovery feed (brief: Screens > Explore; Interactions > Explore pages in the address).
import { useEffect, useRef, useState } from "react";
import type { FeedCard, FeedPage } from "../../shared/api.js";
import { api, type Result } from "../lib/api.js";
import { LiveRegion, useLive } from "../lib/live.js";
import { linkClick, navigate, useLocation } from "../lib/router.js";
import { Empty, Pending, Thumb } from "../components/bits.js";
import { EXPLORE_COLUMNS, Masonry, type MasonryItem } from "../components/Masonry.js";

const MAX_PAGES = 10;

/** `?pages=k`: a missing, non-whole or below-2 value means 1; above 10 means 10. */
function pagesFrom(raw: string | null): number {
  if (!raw || !/^\d+$/.test(raw)) return 1;
  const value = Number(raw);
  return value < 2 ? 1 : Math.min(MAX_PAGES, value);
}

export function Explore() {
  const live = useLive();
  const { query } = useLocation();
  const wanted = pagesFrom(query.get("pages"));
  const [cards, setCards] = useState<FeedCard[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(0);
  const [loading, setLoading] = useState(false);
  const last = useRef<HTMLElement | null>(null);
  const run = useRef(0);
  const written = useRef<number | null>(null);

  const report = (shown: number, more: boolean): void => live.say(more ? `Showing ${shown} clusters.` : "You're all caught up.");

  // Load the first k pages afresh, in order.
  useEffect(() => {
    if (written.current === wanted) return;
    const id = (run.current += 1);
    void (async () => {
      setLoading(true);
      live.say("Loading more clusters...");
      let next: string | null = null;
      const all: FeedCard[] = [];
      let pages = 0;
      do {
        const answer: Result<FeedPage> = await api<FeedPage>("GET", `/api/feed${next ? `?cursor=${encodeURIComponent(next)}` : ""}`);
        if (run.current !== id) return;
        if (!answer.ok) {
          setLoading(false);
          live.say("The feed could not load. Try again.", true);
          return;
        }
        all.push(...answer.data.items);
        next = answer.data.nextCursor;
        pages += 1;
      } while (next && pages < wanted);
      setCards(all);
      setCursor(next);
      setLoaded(pages);
      setLoading(false);
      report(all.length, next !== null);
    })();
    // A page count this screen wrote itself (Load more) is already on screen.
  }, [wanted]);

  const loadMore = async (): Promise<void> => {
    if (loading || !cursor || !cards) return;
    setLoading(true);
    live.say("Loading more clusters...");
    const answer = await api<FeedPage>("GET", `/api/feed?cursor=${encodeURIComponent(cursor)}`);
    setLoading(false);
    if (!answer.ok) return live.say("The feed could not load. Try again.", true);
    const all = [...cards, ...answer.data.items];
    const pages = loaded + 1;
    setCards(all);
    setCursor(answer.data.nextCursor);
    setLoaded(pages);
    written.current = pages;
    navigate(`/explore?pages=${pages}`, { replace: true });
    report(all.length, answer.data.nextCursor !== null);
  };

  // The next page loads when the last card scrolls into view.
  useEffect(() => {
    const el = last.current;
    if (!el || !cursor) return;
    const observer = new IntersectionObserver((records) => {
      if (records.some((r) => r.isIntersecting)) void loadMore();
    });
    observer.observe(el);
    return () => observer.disconnect();
  });

  const items: MasonryItem[] = (cards ?? []).map((card, index) => ({
    key: card.id,
    render: (style, ref) => (
      <article
        key={card.id}
        className="feed-card"
        style={style}
        aria-labelledby={`card-${card.id}`}
        ref={(el) => {
          if (typeof ref === "function") ref(el);
          if (index === (cards?.length ?? 0) - 1) last.current = el;
        }}
      >
        {card.coverUrl ? <Thumb src={card.coverUrl} kind="image" alt="" className="feed-card__cover" cover /> : <div className="thumb thumb--missing feed-card__cover" />}
        <div className="feed-card__body">
          <h2 className="feed-card__title" id={`card-${card.id}`}>
            <a href={`/c/${card.id}`} onClick={(e) => linkClick(e, `/c/${card.id}`)}>
              {card.title}
            </a>
          </h2>
          <p className="feed-card__meta">
            <a href={`/@${card.curator.handle}`} onClick={(e) => linkClick(e, `/@${card.curator.handle}`)}>
              @{card.curator.handle}
            </a>
            <span className="mono">{card.publicItemCount} items</span>
          </p>
        </div>
      </article>
    ),
  }));

  return (
    <main className="explore" id="main">
      <h1 className="page-title">Explore</h1>
      <p className="lede">Public clusters from curators across Rushes, newest first.</p>
      <div className="explore__content">
        {cards === null ? (
          <div className="skeleton-wall" aria-hidden="true">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <span key={i} />)}
          </div>
        ) : cards.length ? (
          <Masonry className="feed" label="Discovery feed" role="feed" columns={EXPLORE_COLUMNS} items={items} />
        ) : (
          <Empty>No public clusters yet.</Empty>
        )}
      </div>
      <div className="explore__more">
        {cards !== null && cards.length > 0 && (
          <button type="button" className="btn" onClick={() => void loadMore()} disabled={loading || !cursor}>
            Load more
            {loading && <Pending />}
          </button>
        )}
        <LiveRegion live={live} name="Feed status" />
      </div>
    </main>
  );
}
