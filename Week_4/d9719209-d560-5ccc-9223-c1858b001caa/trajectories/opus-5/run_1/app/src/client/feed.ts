import { copy } from '../shared/copy.js';
import { feedList, postCard } from '../shared/render.js';
import type { PostView } from '../shared/types.js';
import { request } from './api.js';
import { announce, on, qs, qsa, parseFragment } from './dom.js';
import { page } from './state.js';
import { voteByKey } from './votes.js';

const shown = new Set<string>();

export function registerShown(ids: string[]): void {
  for (const id of ids) shown.add(id);
}

function cards(): HTMLElement[] {
  return qsa<HTMLElement>('[data-post-card]');
}

function inTextField(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable;
}

/** Hot, New and Top use automatic activation and write ?sort= to the URL. */
function initSortTabs(): void {
  const tablist = qs('[data-sort-tabs]');
  if (!tablist) return;
  const tabs = qsa<HTMLElement>('[role="tab"]', tablist);

  const select = (tab: HTMLElement) => {
    for (const candidate of tabs) {
      const selected = candidate === tab;
      candidate.setAttribute('aria-selected', selected ? 'true' : 'false');
      candidate.tabIndex = selected ? 0 : -1;
    }
    tab.focus();
    const sort = tab.dataset.sort ?? 'hot';
    const url = new URL(window.location.href);
    url.searchParams.set('sort', sort);
    window.history.replaceState({}, '', url);
    void loadSort(sort);
  };

  for (const tab of tabs) on(tab, 'click', () => select(tab));

  on(tablist, 'keydown', (event) => {
    const keyboard = event as KeyboardEvent;
    const index = tabs.indexOf(document.activeElement as HTMLElement);
    if (index < 0) return;
    if (keyboard.key === 'ArrowRight' || keyboard.key === 'ArrowLeft') {
      keyboard.preventDefault();
      const next = keyboard.key === 'ArrowRight' ? (index + 1) % tabs.length : (index - 1 + tabs.length) % tabs.length;
      select(tabs[next]);
    } else if (keyboard.key === 'Home') {
      keyboard.preventDefault();
      select(tabs[0]);
    } else if (keyboard.key === 'End') {
      keyboard.preventDefault();
      select(tabs[tabs.length - 1]);
    }
  });
}

interface FeedPayload {
  items: PostView[];
  pinned?: PostView[];
  nextCursor: string | null;
}

function feedPath(sort: string, cursor: string | null): string {
  const community = page.community ? page.community.name : null;
  const search = new URLSearchParams({ sort });
  if (cursor) search.set('cursor', cursor);
  return community ? `/api/communities/${community}/posts?${search}` : `/api/feed?${search}`;
}

async function loadSort(sort: string): Promise<void> {
  const container = qs('[data-feed]');
  const footer = qs('[data-feed-footer]');
  if (!container || !footer) return;
  const result = await request<FeedPayload>(feedPath(sort, null));
  if (!result.ok || !result.data) return;
  shown.clear();
  const pinned = result.data.pinned ?? [];
  registerShown([...pinned, ...result.data.items].map((post) => post.id));
  container.innerHTML = feedList(result.data.items, pinned).value;
  renderFooter(footer, result.data.nextCursor);
}

function renderFooter(footer: Element, cursor: string | null): void {
  footer.innerHTML = cursor
    ? `<button type="button" data-load-more data-cursor="${cursor}">Load more posts</button>`
    : `<p class="end-of-feed">${copy.fixed.endOfFeed}</p>`;
}

/** "Load more posts" appends the next page and moves focus to its first new card. */
async function loadMore(button: HTMLElement): Promise<void> {
  const container = qs('[data-feed]');
  const footer = qs('[data-feed-footer]');
  if (!container || !footer) return;
  const sort = qs<HTMLElement>('[role="tab"][aria-selected="true"]')?.dataset.sort ?? page.sort ?? 'hot';
  const result = await request<FeedPayload>(feedPath(sort, button.dataset.cursor ?? null));
  if (!result.ok || !result.data) return;

  let firstNew: HTMLElement | null = null;
  for (const post of result.data.items) {
    if (shown.has(post.id)) continue;
    shown.add(post.id);
    const fragment = parseFragment(postCard(post).value);
    const element = fragment.firstElementChild as HTMLElement | null;
    container.append(fragment);
    if (!firstNew && element) firstNew = container.querySelector<HTMLElement>(`#${element.id}`);
  }
  renderFooter(footer, result.data.nextCursor);
  firstNew?.focus();
}

/** j and k move focus between cards, Enter on a card opens the post. */
function initCardKeys(): void {
  on(document, 'keydown', (event) => {
    const keyboard = event as KeyboardEvent;
    if (keyboard.metaKey || keyboard.ctrlKey || keyboard.altKey) return;
    if (inTextField(keyboard.target)) return;
    const target = keyboard.target as HTMLElement | null;
    const card = target?.closest<HTMLElement>('[data-post-card]') ?? null;

    if (keyboard.key === 'j' || keyboard.key === 'k') {
      const list = cards();
      if (list.length === 0) return;
      keyboard.preventDefault();
      const index = card ? list.indexOf(card) : -1;
      const next =
        keyboard.key === 'j' ? Math.min(list.length - 1, index + 1) : Math.max(0, index <= 0 ? 0 : index - 1);
      list[next]?.focus();
      return;
    }

    if (!card) return;

    if (keyboard.key === 'a' || keyboard.key === 'z') {
      if (voteByKey(card, keyboard.key)) keyboard.preventDefault();
      return;
    }

    if (keyboard.key === 'Enter' && card === document.activeElement) {
      const link = qs<HTMLAnchorElement>('.card-title a', card);
      if (link) {
        keyboard.preventDefault();
        window.location.assign(link.href);
      }
    }
  });
}

export function removeCard(postId: string): void {
  const card = qs<HTMLElement>(`#post-${postId}`);
  if (!card) return;
  const list = cards();
  const index = list.indexOf(card);
  const hadFocus = card.contains(document.activeElement);
  card.remove();
  shown.delete(postId);
  if (hadFocus) {
    const remaining = cards();
    (remaining[index] ?? remaining[remaining.length - 1])?.focus();
  }
  announce(copy.moderation.postRemovedWatcher);
}

export function initFeed(): void {
  registerShown([...(page.pinned ?? []), ...(page.posts ?? [])].map((post) => post.id));
  initSortTabs();
  initCardKeys();
  on(document, 'click', (event) => {
    const target = event.target as HTMLElement | null;
    const button = target?.closest<HTMLElement>('[data-load-more]');
    if (button) void loadMore(button);
  });
}
