import type {
  Board,
  BoardSummary,
  FeedPin,
  Pin,
  ProfileResponse,
  SearchResponse,
} from '../../shared/types.js';
import { copy } from '../../shared/copy.js';
import {
  ApiFailure,
  announce,
  api,
  clear,
  el,
  failureMessage,
  navigate,
  showAlert,
  state,
} from '../core.js';
import { PinGrid } from '../grid.js';
import { openSaveDialog, openCreateBoardDialog } from '../dialogs.js';
import { openPinFromGrid, renderPinView } from '../exhibit.js';
import { lampPrint } from '../prints.js';
import { onLive, unwatch, watch } from '../live.js';
import type { RouteContext, View } from '../view.js';
import { notFoundView } from './auth.js';

function emptyState(message: string): HTMLElement {
  const panel = el('div', { class: 'empty-state' });
  panel.append(lampPrint());
  panel.append(el('p', { class: 'empty-sentence', text: message }));
  return panel;
}

export function feedView({ main }: RouteContext): View {
  main.className = 'page feed-page';
  clear(main);
  const header = el('div', { class: 'feed-header' });
  const holder = el('div', { class: 'grid-holder' });
  main.append(header, holder);

  const waiting = new Set<number>();
  let newButton: HTMLButtonElement | null = null;
  const grid = new PinGrid({
    label: 'Pins',
    grouped: true,
    onOpen: (pin, card) => openPinFromGrid(pin, card),
    onSave: (pin, card) => {
      void openSaveDialog(pin, card);
    },
  });
  holder.append(grid.element);

  const paintButton = (): void => {
    if (newButton) {
      newButton.remove();
      newButton = null;
    }
    if (waiting.size === 0) return;
    const button = el('button', {
      type: 'button',
      class: 'secondary new-pins',
      text: copy.showNewPins(waiting.size),
    });
    button.addEventListener('click', () => {
      const first = [...waiting][0];
      waiting.clear();
      paintButton();
      void load().then(() => {
        const card = grid.cardFor(first);
        if (card) grid.focusPin(first);
      });
    });
    newButton = button;
    header.append(button);
  };

  const load = async (): Promise<void> => {
    const data = await api.get<{ pins: FeedPin[] }>('/api/feed');
    if (data.pins.length === 0) {
      clear(holder);
      holder.append(emptyState(copy.emptyFeed));
      return;
    }
    if (!holder.contains(grid.element)) {
      clear(holder);
      holder.append(grid.element);
    }
    grid.setPins(data.pins);
  };

  void load();
  watch({ feed: true });
  const off = onLive((message) => {
    if (message.type !== 'feed') return;
    let added = 0;
    for (const id of message.pin_ids) {
      if (grid.cardFor(id) || waiting.has(id)) continue;
      waiting.add(id);
      added += 1;
    }
    if (added === 0) return;
    paintButton();
    announce(copy.newPins(waiting.size));
  });

  return {
    dispose: () => {
      off();
      unwatch({ feed: true });
      grid.destroy();
    },
  };
}

export function pinPageView({ main, params }: RouteContext): View {
  main.className = 'page pin-page';
  clear(main);
  const pinId = Number(params.id);
  let dispose: (() => void) | null = null;

  const load = async (): Promise<void> => {
    try {
      const pin = await api.get<Pin>(`/api/pins/${pinId}`);
      clear(main);
      const handle = renderPinView(pin, { dialog: false });
      main.append(handle.element);
      watch({ pin: pinId });
      const off = onLive((message) => {
        if (message.type === 'counts' && message.pin_id === pinId) {
          handle.refreshCounts(message);
        }
        if (message.type === 'pin_changed' && message.pin_id === pinId) {
          void handle.reload();
        }
      });
      dispose = () => {
        off();
        unwatch({ pin: pinId });
      };
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 404) {
        notFoundView({ main, url: new URL(location.href), params }, 'Pin not found');
        return;
      }
      showAlert(failureMessage(error));
    }
  };

  void load();
  return { dispose: () => dispose?.() };
}

export function searchView({ main, url }: RouteContext): View {
  main.className = 'page search-page';
  clear(main);
  const filters = el('div', { class: 'filters' });
  const holder = el('div', { class: 'grid-holder' });
  main.append(el('h1', { class: 'page-title', text: 'Search' }), filters, holder);

  const grid = new PinGrid({
    label: 'Pins',
    onOpen: (pin, card) => openPinFromGrid(pin, card),
    onSave: (pin, card) => {
      void openSaveDialog(pin, card);
    },
  });

  const query = (url.searchParams.get('q') ?? '').trim();
  const tag = url.searchParams.get('tag') ?? '';
  const board = url.searchParams.get('board') ?? '';

  const go = (next: { tag?: string; board?: string }): void => {
    const target = new URL(location.href);
    if (next.tag !== undefined) {
      if (next.tag === '') target.searchParams.delete('tag');
      else target.searchParams.set('tag', next.tag);
    }
    if (next.board !== undefined) {
      if (next.board === '') target.searchParams.delete('board');
      else target.searchParams.set('board', next.board);
    }
    navigate(`${target.pathname}${target.search}`);
  };

  const load = async (): Promise<void> => {
    const params = new URLSearchParams();
    params.set('q', query);
    if (tag) params.set('tag', tag);
    if (board) params.set('board', board);
    const data = await api.get<SearchResponse>(`/api/search?${params.toString()}`);

    clear(filters);
    const tagSelect = el('select', { 'aria-label': 'Tag' });
    tagSelect.append(el('option', { value: '', text: 'All tags' }));
    for (const entry of data.tags) {
      tagSelect.append(
        el('option', { value: entry.tag, text: `#${entry.tag} (${entry.count})` }),
      );
    }
    tagSelect.value = tag;
    tagSelect.addEventListener('change', () => go({ tag: tagSelect.value }));
    const boardSelect = el('select', { 'aria-label': 'Board' });
    boardSelect.append(el('option', { value: '', text: 'All boards' }));
    for (const entry of data.boards) {
      boardSelect.append(
        el('option', { value: String(entry.id), text: `${entry.name} (${entry.count})` }),
      );
    }
    boardSelect.value = board;
    boardSelect.addEventListener('change', () => go({ board: boardSelect.value }));
    filters.append(tagSelect, boardSelect);

    clear(holder);
    if (data.pins.length === 0) {
      if (query.length > 0 || tag.length > 0) {
        const shown = query.length > 0 ? query : `#${tag}`;
        holder.append(el('p', { class: 'empty-sentence', text: `No pins match "${shown}".` }));
      }
      return;
    }
    holder.append(grid.element);
    grid.setPins(data.pins);
  };

  void load();
  return { dispose: () => grid.destroy() };
}

export function profileView({ main, params, url }: RouteContext): View {
  main.className = 'page profile-page';
  clear(main);
  const handle = params.handle;
  const sort = url.searchParams.get('sort') ?? 'last_saved';
  const grid = new PinGrid({
    label: 'Pins',
    onOpen: (pin, card) => openPinFromGrid(pin, card),
    onSave: (pin, card) => {
      void openSaveDialog(pin, card);
    },
  });
  let userId = 0;
  let followers = 0;
  let followersNode: HTMLElement | null = null;

  const load = async (): Promise<void> => {
    let profile: ProfileResponse;
    try {
      profile = await api.get<ProfileResponse>(
        `/api/users/${encodeURIComponent(handle)}?sort=${encodeURIComponent(sort)}`,
      );
    } catch {
      notFoundView({ main, url, params }, 'Page not found');
      return;
    }
    userId = profile.user.id;
    followers = profile.followers;
    clear(main);
    const head = el('div', { class: 'profile-head' });
    head.append(el('h1', { text: profile.user.name }));
    head.append(el('p', { class: 'meta', text: `@${profile.user.handle}` }));
    followersNode = el('p', { class: 'meta', text: copy.followers(profile.followers) });
    head.append(followersNode);
    head.append(el('p', { class: 'meta', text: copy.following(profile.following) }));
    head.append(el('p', { class: 'meta', text: copy.pins(profile.pin_total) }));
    head.append(
      el('p', {
        class: 'meta',
        text: `${profile.board_total} ${profile.board_total === 1 ? 'board' : 'boards'}`,
      }),
    );
    if (state.user && state.user.id !== profile.user.id) {
      const follow = el('button', {
        type: 'button',
        class: 'secondary',
        'aria-pressed': profile.following_user ? 'true' : 'false',
        text: profile.following_user ? 'Following' : 'Follow',
      });
      follow.setAttribute('aria-label', 'Follow');
      follow.addEventListener('click', () => {
        void (async () => {
          const pressed = follow.getAttribute('aria-pressed') === 'true';
          try {
            const result = await api[pressed ? 'del' : 'put']<{
              following: boolean;
              followers: number;
            }>(`/api/follows/users/${profile.user.id}`);
            follow.setAttribute('aria-pressed', result.following ? 'true' : 'false');
            follow.textContent = result.following ? 'Following' : 'Follow';
            if (followersNode) followersNode.textContent = copy.followers(result.followers);
          } catch (error) {
            showAlert(failureMessage(error));
          }
        })();
      });
      head.append(follow);
    }
    main.append(head);

    const tablist = el('div', { class: 'tabs', role: 'tablist' });
    const boardsTab = el('button', {
      type: 'button',
      role: 'tab',
      'aria-selected': 'true',
      text: 'Boards',
    });
    const pinsTab = el('button', {
      type: 'button',
      role: 'tab',
      'aria-selected': 'false',
      text: 'Pins',
    });
    tablist.append(boardsTab, pinsTab);
    const sortSelect = el('select', { 'aria-label': 'Sort boards' });
    for (const [value, label] of [
      ['last_saved', 'Last saved to'],
      ['az', 'A to Z'],
      ['newest', 'Newest'],
    ] as const) {
      sortSelect.append(el('option', { value, text: label }));
    }
    sortSelect.value = sort;
    sortSelect.addEventListener('change', () => {
      navigate(`/u/${encodeURIComponent(handle)}?sort=${sortSelect.value}`);
    });
    main.append(tablist, sortSelect);

    const panel = el('div', { class: 'tab-panel', role: 'tabpanel' });
    main.append(panel);

    const showBoards = (): void => {
      clear(panel);
      const list = el('div', { class: 'board-cards' });
      for (const board of profile.boards) {
        const card = el('a', { class: 'board-card', href: `/b/${board.id}` });
        if (board.cover) {
          card.append(el('img', { src: board.cover.url, alt: '' }));
        } else {
          card.append(el('p', { class: 'cover-empty', text: copy.noPinsYet }));
        }
        card.append(el('p', { class: 'board-name', text: board.name }));
        if (board.visibility === 'secret') {
          card.append(el('p', { class: 'meta', text: 'Secret' }));
        }
        card.append(el('p', { class: 'meta', text: copy.pins(board.pin_count) }));
        list.append(card);
      }
      panel.append(list);
    };

    const showPins = async (): Promise<void> => {
      clear(panel);
      panel.append(grid.element);
      const data = await api.get<{ pins: Pin[] }>(
        `/api/users/${encodeURIComponent(handle)}/pins`,
      );
      grid.setPins(data.pins);
    };

    boardsTab.addEventListener('click', () => {
      boardsTab.setAttribute('aria-selected', 'true');
      pinsTab.setAttribute('aria-selected', 'false');
      showBoards();
    });
    pinsTab.addEventListener('click', () => {
      boardsTab.setAttribute('aria-selected', 'false');
      pinsTab.setAttribute('aria-selected', 'true');
      void showPins();
    });
    showBoards();
    watch({ user: profile.user.id });
  };

  void load();
  const off = onLive((message) => {
    if (message.type === 'follow' && message.target === 'user' && message.id === userId) {
      followers = message.followers;
      if (followersNode) followersNode.textContent = copy.followers(followers);
    }
  });

  return {
    dispose: () => {
      off();
      if (userId) unwatch({ user: userId });
      grid.destroy();
    },
  };
}

export function boardsView({ main }: RouteContext): View {
  main.className = 'page boards-page';
  clear(main);
  const list = el('div', { class: 'board-cards' });
  const create = el('button', { type: 'button', class: 'secondary', text: 'Create board' });
  create.addEventListener('click', () => {
    openCreateBoardDialog(create, (board) => {
      navigate(`/b/${board.id}`);
    });
  });
  main.append(el('h1', { class: 'page-title', text: 'Boards' }), create, list);

  const load = async (): Promise<void> => {
    const data = await api.get<{ boards: BoardSummary[] }>('/api/boards/mine');
    clear(list);
    for (const summary of data.boards) {
      const board = await api.get<Board>(`/api/boards/${summary.id}`);
      const card = el('a', { class: 'board-card', href: `/b/${board.id}` });
      if (board.cover === null) {
        card.append(el('p', { class: 'cover-empty', text: copy.noPinsYet }));
      } else {
        card.append(el('img', { src: `/media/${board.cover}/236`, alt: '' }));
      }
      card.append(el('p', { class: 'board-name', text: board.name }));
      if (board.visibility === 'secret') card.append(el('p', { class: 'meta', text: 'Secret' }));
      card.append(el('p', { class: 'meta', text: copy.pins(board.pin_count) }));
      list.append(card);
    }
    if (data.boards.length === 0) {
      list.append(emptyState('Create a board to start collecting.'));
    }
  };

  void load();
  return {};
}
