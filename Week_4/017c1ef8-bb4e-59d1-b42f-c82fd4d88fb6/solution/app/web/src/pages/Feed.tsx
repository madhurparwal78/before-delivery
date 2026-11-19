import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigationType } from 'react-router-dom';
import { announce } from '../announce';
import { api } from '../api';
import { ENTRY_COMMENT, ENTRY_REACT, PostEntry } from '../components/feed/Entry';
import { Composer } from '../components/feed/Composer';
import { ShortcutsDialog } from '../components/feed/Shortcuts';
import { saveFeed, savedFeed, wasDeletedHere } from '../components/feed/store';
import { plural } from '../format';
import { useManagedFocus } from '../Layout';
import { useLive } from '../live';
import { useMember } from '../session';
import type { FeedEntry, Network } from '../types';
import { Button, EmptyState, useMediaLayout } from '../ui';
import '../components/feed/feed.css';

interface FeedPage {
  entries: FeedEntry[];
  next_cursor: string | null;
  top_cursor: string;
}

interface NewerEntries {
  entries: FeedEntry[];
  top_cursor: string;
}

type FocusTarget = { entryId: string } | 'opener';

const isReducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Fades inserted entries in while the entries below move down in the same time. */
function animateInsertion(list: HTMLElement | null, insertedIds: string[], below: string[]): void {
  if (!list || isReducedMotion()) return;
  const select = (id: string): HTMLElement | null => list.querySelector<HTMLElement>(`[data-entry-id="${id}"]`);
  const timing = { duration: 320, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' };
  const added = insertedIds.map(select).filter((element): element is HTMLElement => element !== null);
  const shift = added.reduce((total, element) => total + element.getBoundingClientRect().height + 24, 0);
  for (const element of added) element.animate([{ opacity: 0 }, { opacity: 1 }], timing);
  for (const id of below) select(id)?.animate([{ transform: `translateY(${-shift}px)` }, { transform: 'translateY(0)' }], timing);
}

export default function Feed() {
  useManagedFocus();
  const member = useMember();
  const layout = useMediaLayout();
  const location = useLocation();
  const navigationType = useNavigationType();
  const [restored] = useState(() => (navigationType === 'POP' ? savedFeed() : null));
  const [entries, setEntries] = useState<FeedEntry[] | null>(restored?.entries ?? null);
  const [nextCursor, setNextCursor] = useState<string | null>(restored?.nextCursor ?? null);
  const [waiting, setWaiting] = useState<FeedEntry[]>([]);
  const [composing, setComposing] = useState(false);
  const [showingShortcuts, setShowingShortcuts] = useState(false);
  const [network, setNetwork] = useState<Network | null>(null);
  const [focusTick, setFocusTick] = useState(0);

  const list = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const entriesRef = useRef<FeedEntry[]>(entries ?? []);
  const nextRef = useRef(nextCursor);
  const topRef = useRef<string | null>(restored?.topCursor ?? null);
  const waitingTopRef = useRef<string | null>(null);
  const waitingRef = useRef<FeedEntry[]>([]);
  const scrollRef = useRef(restored?.scrollY ?? 0);
  const focusEntryRef = useRef<string | null>(restored?.focusEntryId ?? null);
  const focusTarget = useRef<FocusTarget | null>(null);
  const inserted = useRef<{ ids: string[]; below: string[] } | null>(null);
  const syncing = useRef(false);
  const syncAgain = useRef(false);

  entriesRef.current = entries ?? [];
  nextRef.current = nextCursor;
  waitingRef.current = waiting;

  const requestFocus = (target: FocusTarget): void => {
    focusTarget.current = target;
    setFocusTick((tick) => tick + 1);
  };

  const insertAtTop = useCallback((incoming: FeedEntry[]): void => {
    if (incoming.length === 0) return;
    const current = entriesRef.current;
    const posts = new Set(incoming.map((entry) => entry.post.id));
    const kept = current.filter((entry) => !posts.has(entry.post.id));
    inserted.current = { ids: incoming.map((entry) => entry.entry_id), below: kept.map((entry) => entry.entry_id) };
    setEntries([...incoming, ...kept]);
  }, []);

  /** Entries newer than the top: the viewer's own go to the top at once, everyone else's wait behind the pill. */
  const sync = useCallback(async (): Promise<void> => {
    if (syncing.current) {
      syncAgain.current = true;
      return;
    }
    syncing.current = true;
    try {
      const top = topRef.current;
      if (!top) return;
      const found = await api.get<NewerEntries>(`/api/feed?newer_than=${encodeURIComponent(top)}`);
      const known = new Set(entriesRef.current.map((entry) => entry.entry_id));
      const fresh = found.entries.filter((entry) => !known.has(entry.entry_id));
      const mine = (entry: FeedEntry): boolean => (entry.kind === 'post' ? entry.post.author.id : entry.reposter?.id) === member.id;
      insertAtTop(fresh.filter(mine));
      const others = fresh.filter((entry) => !mine(entry));
      waitingTopRef.current = found.top_cursor;
      if (others.length === 0) topRef.current = found.top_cursor;
      if (others.length > waitingRef.current.length) announce('Feed announcements', `${plural(others.length, 'new post')} available`);
      setWaiting(others);
    } finally {
      syncing.current = false;
      if (syncAgain.current) {
        syncAgain.current = false;
        void sync();
      }
    }
  }, [insertAtTop, member.id]);

  useEffect(() => {
    if (restored) {
      void sync();
      return;
    }
    void api.get<FeedPage>('/api/feed').then((page) => {
      topRef.current = page.top_cursor;
      setEntries(page.entries);
      setNextCursor(page.next_cursor);
    });
  }, [restored, sync]);

  const loadNetwork = useCallback((): void => {
    void api.get<Network>('/api/network').then(setNetwork);
  }, []);
  useEffect(() => {
    if (layout === 'desktop') loadNetwork();
  }, [layout, loadNetwork]);
  useLive(['network', 'graph'], () => layout === 'desktop' && loadNetwork());

  useLive('post', (event) => {
    if (event.change === 'created' || event.change === 'reposts') void sync();
  });
  useLive('reconnected', () => void sync());

  const showWaiting = (): void => {
    const arrivals = waitingRef.current;
    if (arrivals.length === 0) return;
    topRef.current = waitingTopRef.current ?? topRef.current;
    insertAtTop(arrivals);
    setWaiting([]);
    const first = arrivals[0];
    if (first) requestFocus({ entryId: first.entry_id });
  };

  const showMore = async (): Promise<void> => {
    const cursor = nextRef.current;
    if (!cursor) return;
    const page = await api.get<FeedPage>(`/api/feed?cursor=${encodeURIComponent(cursor)}`);
    const known = new Set(entriesRef.current.map((entry) => entry.entry_id));
    const added = page.entries.filter((entry) => !known.has(entry.entry_id));
    setEntries([...entriesRef.current, ...added]);
    setNextCursor(page.next_cursor);
    const first = added[0];
    if (first) requestFocus({ entryId: first.entry_id });
  };

  const handleGone = useCallback((postId: string): void => {
    setWaiting((current) => current.filter((entry) => entry.post.id !== postId));
    const current = entriesRef.current;
    const firstIndex = current.findIndex((entry) => entry.post.id === postId);
    if (firstIndex < 0) return;
    const focusedHere = document.activeElement?.closest(`article[data-post-id="${postId}"]`) != null;
    const own = wasDeletedHere(postId);
    const remaining = current.filter((entry) => entry.post.id !== postId);
    setEntries(remaining);
    if (focusedHere || own) {
      const next = remaining[firstIndex] ?? remaining[firstIndex - 1];
      focusTarget.current = next ? { entryId: next.entry_id } : 'opener';
      setFocusTick((tick) => tick + 1);
      if (!own) announce('Feed announcements', 'Post removed.');
    }
  }, []);

  useLayoutEffect(() => {
    const added = inserted.current;
    inserted.current = null;
    if (added) animateInsertion(list.current, added.ids, added.below);
  }, [entries]);

  useEffect(() => {
    const target = focusTarget.current;
    focusTarget.current = null;
    if (!target) return;
    if (target === 'opener') opener.current?.focus();
    else list.current?.querySelector<HTMLElement>(`[data-entry-id="${target.entryId}"]`)?.focus();
  }, [focusTick]);

  useLayoutEffect(() => {
    if (!restored) return;
    window.scrollTo(0, restored.scrollY);
    if (restored.focusEntryId) list.current?.querySelector<HTMLElement>(`[data-entry-id="${restored.focusEntryId}"]`)?.focus({ preventScroll: true });
  }, [restored]);

  useEffect(() => {
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    const onScroll = (): void => {
      scrollRef.current = window.scrollY;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.history.scrollRestoration = previous;
      if (topRef.current) {
        saveFeed({ entries: entriesRef.current, nextCursor: nextRef.current, topCursor: topRef.current, scrollY: scrollRef.current, focusEntryId: focusEntryRef.current });
      }
    };
  }, []);

  useEffect(() => {
    if (location.hash === '#compose') setComposing(true);
  }, [location.key, location.hash]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="menu"], [role="toolbar"]')) return;
      if (document.querySelector('[role="dialog"]')) return;
      const articles = [...(list.current?.querySelectorAll<HTMLElement>('article[data-entry-id]') ?? [])];
      const current = target?.closest<HTMLElement>('article[data-entry-id]') ?? null;
      const index = current ? articles.indexOf(current) : -1;
      switch (event.key) {
        case 'j':
          articles[index + 1]?.focus();
          break;
        case 'k':
          if (index > 0) articles[index - 1]?.focus();
          break;
        case 'l':
          current?.dispatchEvent(new CustomEvent(ENTRY_REACT));
          break;
        case 'c':
          current?.dispatchEvent(new CustomEvent(ENTRY_COMMENT));
          break;
        case '?':
          event.preventDefault();
          setShowingShortcuts(true);
          break;
        default:
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const noteLeaving = (event: React.MouseEvent): void => {
    const link = (event.target as HTMLElement).closest('a');
    const article = link?.closest<HTMLElement>('article[data-entry-id]');
    if (article) {
      focusEntryRef.current = article.dataset.entryId ?? null;
      scrollRef.current = window.scrollY;
    }
  };

  const loaded = entries !== null;
  const entryProps = (entry: FeedEntry) => ({ post: entry.post, entryId: entry.entry_id, kind: entry.kind, reposter: entry.reposter, onGone: handleGone, onPublished: () => void sync() });

  return (
    <div className="feed-layout" data-layout={layout}>
      <h1 className="sr-only">Home</h1>
      <div className="feed-column">
        <Button ref={opener} className="feed-opener" onClick={() => setComposing(true)}>
          Start a post
        </Button>
        {waiting.length > 0 ? (
          <Button className="pill" onClick={showWaiting}>
            {waiting.length === 1 ? 'Show 1 new post' : `Show ${waiting.length} new posts`}
          </Button>
        ) : null}
        {loaded && entries.length === 0 && waiting.length === 0 ? (
          <EmptyState sentence="Your feed is empty." action={{ label: 'Find people', to: '/search?type=people&q=' }} />
        ) : null}
        <div ref={list} className="entry-list" onClickCapture={noteLeaving}>
          {entries?.map((entry) => <PostEntry key={entry.entry_id} {...entryProps(entry)} />)}
        </div>
        {nextCursor ? <Button onClick={() => void showMore()}>Show more posts</Button> : null}
      </div>
      {layout === 'desktop' ? (
        <aside aria-label="Your network" className="feed-panel">
          <p className="t-heading">{member.name}</p>
          <p>{network ? plural(network.connections.length, 'connection') : ''}</p>
          <p>
            <Link to="/network">Your invitations</Link>
          </p>
        </aside>
      ) : null}
      <Composer open={composing} onClose={() => setComposing(false)} returnFocus={() => opener.current} onPublished={() => void sync()} />
      <ShortcutsDialog open={showingShortcuts} onClose={() => setShowingShortcuts(false)} />
    </div>
  );
}
