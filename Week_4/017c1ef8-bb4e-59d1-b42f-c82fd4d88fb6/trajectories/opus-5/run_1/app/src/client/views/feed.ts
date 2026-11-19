import { api } from '../api';
import { announce, dialog, h, isPhone, prefersReducedMotion, qs, qsa } from '../dom';
import { currentMember, on } from '../state';
import { S } from '../strings';
import { openComposer } from '../components/composer';
import { entryNode, type EntryData, type PostData } from '../components/post';

type FeedPage = { entries: EntryData[]; next_cursor: string | null; top_cursor: string };

type Cache = {
  entries: EntryData[];
  nextCursor: string | null;
  topCursor: string;
  scrollY: number;
  focusedId: string | null;
};

let cache: Cache | null = null;

export function feedView(): HTMLElement {
  const me = currentMember();
  const column = h('div', { class: 'feed-column' });
  const pillHost = h('div', { class: 'pill-host' });
  const list = h('div', { class: 'feed-list' });
  const moreHost = h('div', { class: 'more-host' });
  const opener = h(
    'button',
    {
      type: 'button',
      class: 'button start-post',
      click: () => openComposer({ opener, onDone: () => void reloadTop() }),
    },
    ['Start a post'],
  );

  let entries: EntryData[] = [];
  let nextCursor: string | null = null;
  let topCursor = '';
  let waiting: EntryData[] = [];
  let focusedId: string | null = null;
  let scrollY = 0;

  column.append(opener, pillHost, list, moreHost);

  const page = h('div', { class: isPhone() ? 'feed-page phone' : 'feed-page' }, [column]);
  if (!isPhone() && window.innerWidth >= 1200 && me) {
    page.append(sidePanel(me.name));
  }

  if (cache) {
    entries = cache.entries;
    nextCursor = cache.nextCursor;
    topCursor = cache.topCursor;
    focusedId = cache.focusedId;
    draw();
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: cache?.scrollY ?? 0 });
      if (focusedId) {
        const node = qs<HTMLElement>(`[data-entry-id="${focusedId}"]`, list);
        node?.focus();
      }
    });
  } else {
    void load();
  }

  const offFeed = on('feed', () => void pullNew());
  const offPost = on('post', () => void refreshEntries());
  const offDeleted = on('post_deleted', (data) => removeEntry(String(data.post_id)));
  const onKey = (event: KeyboardEvent): void => {
    if (!document.contains(page)) return;
    const target = event.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable ||
        target.getAttribute('role') === 'searchbox')
    ) {
      return;
    }
    const nodes = qsa<HTMLElement>('[data-entry-id]', list);
    const current = nodes.findIndex((node) => node === document.activeElement);
    if (event.key === 'j' || event.key === 'J') {
      event.preventDefault();
      focusEntry(nodes[current === -1 ? 0 : Math.min(current + 1, nodes.length - 1)]);
    } else if (event.key === 'k' || event.key === 'K') {
      event.preventDefault();
      if (current > 0) focusEntry(nodes[current - 1]);
    } else if (event.key === 'l' || event.key === 'L') {
      event.preventDefault();
      const node = nodes[current];
      if (node) (qsa<HTMLElement>('button', node).find((b) => b.textContent === 'React'))?.click();
    } else if (event.key === 'c' || event.key === 'C') {
      event.preventDefault();
      const node = nodes[current];
      if (node) (qsa<HTMLElement>('button', node).find((b) => b.textContent === 'Comment'))?.click();
    } else if (event.key === '?') {
      event.preventDefault();
      shortcutsDialog();
    }
  };
  const onScroll = (): void => {
    scrollY = window.scrollY;
  };
  document.addEventListener('keydown', onKey);
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('beforeunload', save);

  const observer = new MutationObserver(() => {
    if (!document.contains(page)) {
      save();
      offFeed();
      offPost();
      offDeleted();
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  return page;

  function save(): void {
    cache = { entries, nextCursor, topCursor, scrollY, focusedId };
  }

  function focusEntry(node: HTMLElement | undefined): void {
    if (!node) return;
    focusedId = node.getAttribute('data-entry-id');
    node.focus();
  }

  async function load(): Promise<void> {
    const result = await api.get<FeedPage>('/api/feed');
    if (!result.ok) return;
    entries = result.body.entries;
    nextCursor = result.body.next_cursor;
    topCursor = result.body.top_cursor;
    draw();
  }

  async function reloadTop(): Promise<void> {
    const result = await api.get<FeedPage>('/api/feed');
    if (!result.ok) return;
    entries = result.body.entries;
    nextCursor = result.body.next_cursor;
    topCursor = result.body.top_cursor;
    waiting = [];
    draw();
  }

  async function refreshEntries(): Promise<void> {
    if (entries.length === 0) return;
    const result = await api.get<FeedPage>('/api/feed');
    if (!result.ok) return;
    const fresh = new Map(result.body.entries.map((entry) => [entry.entry_id, entry]));
    entries = entries.map((entry) => fresh.get(entry.entry_id) ?? entry);
    draw();
  }

  async function pullNew(): Promise<void> {
    if (topCursor === '') {
      await load();
      return;
    }
    const result = await api.get<{ entries: EntryData[]; top_cursor: string }>(
      `/api/feed?newer_than=${encodeURIComponent(topCursor)}`,
    );
    if (!result.ok) return;
    topCursor = result.body.top_cursor;
    const known = new Set([...entries, ...waiting].map((entry) => entry.post.id));
    const mine = currentMember();
    const own: EntryData[] = [];
    for (const entry of result.body.entries) {
      if (known.has(entry.post.id)) continue;
      known.add(entry.post.id);
      const byMe =
        mine !== null &&
        (entry.post.author.id === mine.id || (entry.reposter && entry.reposter.id === mine.id));
      if (byMe) own.push(entry);
      else waiting.push(entry);
    }
    waiting.sort((a, b) => {
      const byTime = Date.parse(b.created_at) - Date.parse(a.created_at);
      if (byTime !== 0) return byTime;
      return a.entry_id < b.entry_id ? 1 : a.entry_id > b.entry_id ? -1 : 0;
    });
    if (own.length > 0) entries = [...own, ...entries];
    if (own.length > 0 || waiting.length > 0) draw();
    if (waiting.length > 0) {
      announce('Feed announcements', S.announce.newPosts(waiting.length));
    }
  }

  function removeEntry(postId: string): void {
    const nodes = qsa<HTMLElement>('[data-entry-id]', list);
    const index = entries.findIndex((entry) => entry.post.id === postId);
    if (index === -1) {
      waiting = waiting.filter((entry) => entry.post.id !== postId);
      draw();
      return;
    }
    const wasFocused = nodes[index] === document.activeElement;
    entries = entries.filter((entry) => entry.post.id !== postId);
    draw();
    if (!wasFocused) return;
    announce('Feed announcements', S.announce.postRemoved);
    const after = qsa<HTMLElement>('[data-entry-id]', list);
    if (after.length === 0) {
      opener.focus();
      return;
    }
    focusEntry(after[Math.min(index, after.length - 1)]);
  }

  function draw(): void {
    pillHost.replaceChildren();
    if (waiting.length > 0) {
      const pill = h(
        'button',
        {
          type: 'button',
          class: 'button pill',
          click: () => {
            const first = waiting[0];
            entries = [...waiting, ...entries];
            waiting = [];
            draw();
            const node = qs<HTMLElement>(`[data-entry-id="${first.entry_id}"]`, list);
            if (node !== null) {
              if (!prefersReducedMotion()) node.classList.add('arriving');
              focusEntry(node);
            }
          },
        },
        [waiting.length === 1 ? 'Show 1 new post' : `Show ${waiting.length} new posts`],
      );
      pillHost.append(pill);
    }

    list.replaceChildren();
    if (entries.length === 0) {
      list.append(
        h('div', { class: 'empty' }, [
          h('p', { class: 'big-sentence', text: S.empty.feed }),
          h('a', { href: '/search?type=people&q=', class: 'link underline' }, ['Find people']),
        ]),
      );
    }
    for (const entry of entries) {
      list.append(entryNode(entry, { reload: () => void refreshEntries() }));
    }

    moreHost.replaceChildren();
    if (nextCursor) {
      const more = h(
        'button',
        {
          type: 'button',
          class: 'button quiet',
          click: async () => {
            more.setAttribute('disabled', '');
            const result = await api.get<FeedPage>(
              `/api/feed?cursor=${encodeURIComponent(nextCursor ?? '')}`,
            );
            if (result.ok) {
              const firstNew = result.body.entries[0];
              entries = [...entries, ...result.body.entries];
              nextCursor = result.body.next_cursor;
              draw();
              if (firstNew) {
                focusEntry(
                  qs<HTMLElement>(`[data-entry-id="${firstNew.entry_id}"]`, list) ?? undefined,
                );
              }
            } else more.removeAttribute('disabled');
          },
        },
        ['Show more posts'],
      );
      moreHost.append(more);
    }
  }
}

function sidePanel(name: string): HTMLElement {
  const panel = h('aside', { 'aria-label': 'Your network', class: 'side-panel' }, [
    h('p', { class: 'person-name', text: name }),
    h('p', { class: 'count tabular', text: '—' }),
    h('a', { href: '/network', class: 'link underline' }, ['Your invitations']),
  ]);
  void api.get<{ connections: unknown[] }>('/api/network').then((result) => {
    if (!result.ok) return;
    const count = result.body.connections.length;
    const node = qs<HTMLElement>('.count', panel);
    if (node) node.textContent = count === 1 ? '1 connection' : `${count} connections`;
  });
  return panel;
}

export function shortcutsDialog(): void {
  dialog(
    'Keyboard shortcuts',
    (close) => [
      h('h2', { text: 'Keyboard shortcuts' }),
      h('ul', { class: 'plain-list' }, [
        h('li', { text: 'J — next post' }),
        h('li', { text: 'K — previous post' }),
        h('li', { text: 'L — react to the focused post' }),
        h('li', { text: 'C — comment on the focused post' }),
        h('li', { text: '? — this list' }),
      ]),
      h('button', { type: 'button', class: 'button', click: () => close() }, ['Close']),
    ],
    null,
  );
}

export function postPageView(postId: string): HTMLElement {
  const host = h('div', { class: 'narrow' });
  void load();
  const off = on('post', (data) => {
    if (String(data.post_id) === postId && document.contains(host)) void load();
  });
  const offDeleted = on('post_deleted', (data) => {
    if (String(data.post_id) === postId && document.contains(host)) void load();
  });
  const observer = new MutationObserver(() => {
    if (!document.contains(host)) {
      off();
      offDeleted();
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return host;

  async function load(): Promise<void> {
    const result = await api.get<PostData>(`/api/posts/${postId}`);
    if (!result.ok) {
      host.replaceChildren(
        h('div', { class: 'empty' }, [
          h('p', { class: 'big-sentence', text: S.empty.postUnavailable }),
          h('a', { href: '/feed', class: 'link underline' }, ['Go to Home']),
        ]),
      );
      return;
    }
    const post = result.body;
    host.replaceChildren(
      entryNode(
        { entry_id: post.id, kind: 'post', created_at: post.created_at, post, reposter: null },
        { withComments: true, reload: () => void load() },
      ),
    );
  }
}

export function hashtagView(tag: string): HTMLElement {
  const host = h('div', { class: 'narrow' });
  void load();
  const off = on('post', () => {
    if (document.contains(host)) void load();
    else off();
  });
  return host;

  async function load(): Promise<void> {
    const result = await api.get<{
      posts: PostData[];
      stats: { posts: number; members: number };
    }>(`/api/hashtags/${encodeURIComponent(tag)}`);
    if (!result.ok) return;
    const stats = result.body.stats;
    host.replaceChildren(
      h('h1', { class: 'page-title', text: `#${tag}` }),
      h('p', {
        'data-hashtag-stats': '',
        class: 'muted tabular',
        text: `${stats.posts === 1 ? '1 post' : `${stats.posts} posts`} · ${
          stats.members === 1 ? '1 member' : `${stats.members} members`
        } this week`,
      }),
    );
    for (const post of result.body.posts) {
      host.append(
        entryNode(
          { entry_id: post.id, kind: 'post', created_at: post.created_at, post, reposter: null },
          { reload: () => void load() },
        ),
      );
    }
  }
}
