// Explore: the public discovery feed with pages in the address.

import type { FeedCard } from '../../shared/types.js';
import { FEED_PAGE_SIZE, MAX_EXPLORE_PAGES } from '../../shared/constants.js';
import { api, el, link, session } from '../lib.js';
import { topBar } from '../app.js';

export async function renderExplore(params: URLSearchParams): Promise<HTMLElement> {
  const acc = session()?.account ?? null;
  const page = el('div');
  page.append(topBar({ account: acc }));
  const main = el('main');
  main.append(el('h1', {}, 'Explore'));

  const pagesParam = params.get('pages');
  let targetPages = 1;
  if (pagesParam !== null) {
    const n = Number(pagesParam);
    if (Number.isInteger(n) && n >= 2) targetPages = Math.min(MAX_EXPLORE_PAGES, n);
  }

  const status = el('div', { id: 'feed-status', role: 'status', class: 'visually-hidden' });
  status.setAttribute('aria-live', 'polite');
  const grid = el('div', { class: 'feed-grid' });
  const feed = el('div', { role: 'feed', class: 'feed', 'aria-label': 'Discovery feed' }) as HTMLElement;
  grid.append(feed);
  const loadMore = el('button', { class: 'btn', id: 'load-more' }, 'Load more');
  loadMore.setAttribute('aria-label', 'Load more');
  main.append(grid, status, loadMore);
  page.append(main);

  let cursor: string | null = null;
  let loadedPages = 0;
  let done = false;
  let loading = false;

  async function loadPage(): Promise<void> {
    if (done || loading) return;
    loading = true;
    status.textContent = 'Loading more clusters...';
    const r = await api<{ items: FeedCard[]; nextCursor: string | null }>('GET', `/api/feed?limit=${FEED_PAGE_SIZE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    loading = false;
    if (!r.ok) {
      status.textContent = 'The feed could not load. Try again.';
      return;
    }
    const { items, nextCursor } = r.data!;
    cursor = nextCursor;
    loadedPages += 1;
    for (const item of items) {
      feed.append(feedCard(item));
    }
    if (cursor === null) {
      done = true;
      status.textContent = "You're all caught up.";
      loadMore.hidden = true;
    } else {
      status.textContent = `Showing ${feed.children.length} clusters.`;
    }
    updateAddress();
    observeLast();
  }

  function updateAddress(): void {
    const url = loadedPages <= 1 ? '/explore' : `/explore?pages=${loadedPages}`;
    history.replaceState(null, '', url);
  }

  loadMore.addEventListener('click', () => void loadPage());

  // Load the next page when the last card scrolls near the viewport.
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting && !done && !loading && loadedPages < MAX_EXPLORE_PAGES) {
        void loadPage();
      }
    }
  }, { rootMargin: '100px' });

  function observeLast(): void {
    const last = feed.lastElementChild;
    if (last) observer.observe(last);
  }

  for (let i = 0; i < targetPages; i++) {
    await loadPage();
    if (done) break;
  }

  return page;
}

function feedCard(item: FeedCard): HTMLElement {
  const article = el('article', { class: 'feed-card', role: 'article' });
  article.setAttribute('aria-label', item.title);
  const body = el('div', { class: 'card-body' });
  body.append(el('h2', { class: 'card-title' }, link(`/c/${item.id}`, item.title)));
  const meta = el('div', { class: 'card-meta mono' });
  meta.append(link(`/@${item.curator.handle}`, `@${item.curator.handle}`), el('span', {}, `${item.publicItemCount} items`));
  body.append(meta);
  if (item.coverUrl) {
    const img = el('img', { src: item.coverUrl, alt: '', loading: 'lazy' }) as HTMLImageElement;
    img.addEventListener('error', () => img.remove());
    article.prepend(img);
  }
  article.append(body);
  return article;
}
