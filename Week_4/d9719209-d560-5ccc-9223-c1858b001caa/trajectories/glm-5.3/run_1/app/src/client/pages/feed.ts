/* The home feed: Hot, New and Top tabs, pages of 25 behind an opaque cursor,
   j and k navigation, live score and removal updates. */
import { api, announce, copy, el, Live, navigate, type Me } from '../lib.js';
import { postCard, rail, sortTabs, type Post, type Community } from '../ui.js';
import { handleAccountEvent } from './report.js';

type FeedPage = { items: Post[]; nextCursor: string | null };

export async function renderFeedPage(frame: HTMLElement, me: Me | null, live: Live, search: string): Promise<void> {
  const url = new URLSearchParams(search);
  const initialSort = (url.get('sort') === 'new' || url.get('sort') === 'top') ? url.get('sort') as 'new' | 'top' : 'hot';
  const railEl = el('aside', { class: 'rail' });
  const feedCol = el('main', { class: 'feed' });
  const side = el('aside', { class: 'side' });
  frame.append(railEl, feedCol, side);

  if (me !== null) {
    try {
      const mine = await api<{ items: Community[] }>('/api/communities/mine');
      railEl.append(rail(mine.items, false));
    } catch { railEl.append(rail([], false)); }
  } else {
    railEl.append(rail([], false));
  }

  let sort: 'hot' | 'new' | 'top' = initialSort;
  const cards = new Map<number, { root: HTMLElement; update: (p: Post) => void }>();
  const listEl = el('div', { class: 'card-list' });
  const loadWrap = el('div', {});
  feedCol.append(sortTabs(sort, 'Sort posts', pickSort), listEl, loadWrap);

  function pickSort(next: 'hot' | 'new' | 'top'): void {
    const u = new URL(window.location.href);
    u.searchParams.set('sort', next);
    window.history.replaceState(null, '', u.toString());
    sort = next;
    cards.clear();
    feedCol.replaceChildren(sortTabs(sort, 'Sort posts', pickSort), listEl, loadWrap);
    listEl.replaceChildren();
    loadWrap.replaceChildren();
    void loadPage(null);
  }

  async function loadPage(cursor: string | null): Promise<void> {
    const page = await api<FeedPage>(`/api/feed?sort=${sort}${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`);
    for (const post of page.items) {
      if (cards.has(post.id)) continue;
      const card = postCard(post, me);
      cards.set(post.id, card);
      listEl.append(card.root);
      if (cursor !== null && page.items.indexOf(post) === 0) card.root.focus();
    }
    loadWrap.replaceChildren();
    if (page.nextCursor === null) {
      loadWrap.append(el('p', { class: 'end-of-feed' }, copy.endOfFeed));
    } else {
      const more = el('button', { class: 'btn', type: 'button' }, 'Load more posts');
      more.addEventListener('click', () => { void loadPage(page.nextCursor); });
      loadWrap.append(more);
    }
    if (page.items.length === 0 && cursor === null) {
      listEl.append(el('p', { class: 'empty' }, copy.emptyHome));
    }
  }

  await loadPage(null);

  live.subscribe(['home'], (event) => {
    const data = event.data as Record<string, unknown>;
    if (event.event === 'account') {
      handleAccountEvent(data);
      return;
    }
    if (event.event === 'score') {
      const scoreData = data as { targetType: string; targetId: number; score: number };
      if (scoreData.targetType === 'post') {
        const card = cards.get(scoreData.targetId);
        if (card !== undefined) {
          const scoreEl = document.getElementById(`score-post-${scoreData.targetId}`);
          const meta = document.getElementById(`score-meta-post-${scoreData.targetId}`);
          if (scoreEl !== null) scoreEl.textContent = display(scoreData.score);
          if (meta !== null) meta.textContent = display(scoreData.score);
        }
      }
    } else if (event.event === 'post-state') {
      const stateData = data as { postId: number; state: string };
      if (stateData.state === 'removed' || stateData.state === 'deleted') {
        const card = cards.get(stateData.postId);
        if (card !== undefined) {
          const focused = document.activeElement === card.root;
          card.root.remove();
          cards.delete(stateData.postId);
          announce(copy.postRemovedWatchers);
          if (focused) {
            const remaining = listEl.querySelector<HTMLElement>('article[id^="post-"]');
            remaining?.focus();
          }
        }
      }
    }
  });
}

export function display(score: number): string {
  if (Math.abs(score) < 10000) return String(score);
  const thousands = Math.floor(Math.abs(score) / 1000) / 10;
  const oneDecimal = Math.floor(thousands * 10) / 10;
  return `${score < 0 ? '-' : ''}${oneDecimal.toFixed(1)}k`;
}
