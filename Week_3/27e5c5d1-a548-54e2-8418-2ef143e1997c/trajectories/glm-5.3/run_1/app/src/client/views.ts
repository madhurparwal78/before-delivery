// Screen rendering: sign-in, board screen, dialogs, search, permission log.
import { api } from './api.js';
import { copy } from './copy.js';
import type { ClientStore } from './state.js';
import type { Card, CardList } from '../shared/protocol.js';
import { buttonEl, drawerCountText, el } from './dom.js';

export interface ViewContext {
  store: ClientStore;
  navigate: (path: string, replace?: boolean) => void;
  announce: (text: string) => void;
  refreshBoard: (keepFocus?: boolean) => Promise<void>;
  refreshBoards: () => Promise<void>;
  signOut: () => Promise<void>;
  openDialog: (kind: string, data?: unknown) => void;
  closeDialog: () => void;
  dialogState: { kind: string; data?: unknown } | null;
  setDialogState: (state: { kind: string; data?: unknown } | null) => void;
  openMenu: (anchor: HTMLElement, items: { label: string; action: () => void; checked?: boolean; radio?: boolean }[]) => void;
  selectedListId: string | null;
  setSelectedListId: (id: string | null) => void;
  searchBoxText: string;
  setSearchBoxText: (text: string) => void;
  onSearchInput: (text: string) => void;
  boardRoute: () => { kind: string; boardId?: string; cardId?: string; listId?: string; workspaceId?: string };
  closeCardDialog: (card: Card | null) => void;
  setLiftForRemoteCancel: (cardId: string) => void;
  rerender: () => void;
  dialogStateIs: (kind: string) => boolean;
  dialogStateIsCard: (cardId: string) => boolean;
  noteOwnMove: (cardId: string) => void;
}

export function renderSignIn(nextValue: string | undefined): HTMLElement {
  const title = el('h1', { class: 'signin-title', text: copy.signInTitle });
  const email = el('input', { class: 'text-input', type: 'email', id: 'signin-email', autocomplete: 'username' }) as HTMLInputElement;
  const emailLabel = el('label', { for: 'signin-email', text: 'Email' });
  const password = el('input', { class: 'text-input', type: 'password', id: 'signin-password', autocomplete: 'current-password' }) as HTMLInputElement;
  const passwordLabel = el('label', { for: 'signin-password', text: 'Password' });
  const errorArea = el('div');
  const noticeArea = el('div', { role: 'status' });
  const params = new URLSearchParams(location.search);
  if (params.get('signedOut') === '1') {
    noticeArea.textContent = copy.signedOutNotice;
  }
  const submit = buttonEl({ class: 'primary-button', type: 'submit', text: copy.signInButton });
  const form = el(
    'form',
    { class: 'signin-card' },
    title,
    noticeArea,
    el('div', { class: 'dialog-row' }, emailLabel, email),
    el('div', { class: 'dialog-row' }, passwordLabel, password),
    errorArea,
    submit,
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void (async () => {
      submit.textContent = copy.signInBusy;
      submit.disabled = true;
      const reply = await api.signIn(email.value, password.value, nextValue);
      submit.disabled = false;
      submit.textContent = copy.signInButton;
      if (reply.status === 401 || reply.status === 422) {
        errorArea.textContent = '';
        errorArea.append(el('div', { role: 'alert', class: 'field-error', text: copy.signInError }));
        return;
      }
      const body = reply.body as { redirectTo: string };
      location.href = body.redirectTo;
    })();
  });
  return el('div', { class: 'signin-shell' }, form);
}

export function renderMasthead(ctx: ViewContext): HTMLElement {
  const store = ctx.store;
  const masthead = el('header', { class: 'masthead' });
  const parentName = store.board.parentName || store.workspaces[0]?.parentName || 'Kinfold';
  const title = el('h1', { class: 'masthead-title', text: parentName });
  const tools = el('div', { class: 'masthead-tools' });
  const searchBox = el('input', {
    type: 'search',
    role: 'searchbox',
    class: 'text-input search-box',
    'aria-label': copy.searchBox,
    placeholder: copy.searchPlaceholder,
    value: ctx.searchBoxText,
  }) as HTMLInputElement;
  searchBox.addEventListener('input', () => {
    ctx.setSearchBoxText(searchBox.value);
    ctx.onSearchInput(searchBox.value);
  });
  searchBox.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      searchBox.value = '';
      ctx.setSearchBoxText('');
      ctx.onSearchInput('');
      event.preventDefault();
    }
  });
  tools.append(searchBox);
  const accountButton = buttonEl({ class: 'secondary-button', 'aria-haspopup': 'menu', text: copy.accountButton });
  accountButton.addEventListener('click', () => {
    const items: { label: string; action: () => void }[] = [];
    const isWorkspaceAdmin = store.workspaces.some((w) => w.id === store.activeWorkspaceId && w.role === 'admin');
    if (isWorkspaceAdmin) {
      items.push({ label: copy.accountMenuPermissionLog, action: () => ctx.navigate(`/workspaces/${store.activeWorkspaceId}/permission-log`) });
    }
    items.push({ label: copy.accountMenuChangePassword, action: () => ctx.openDialog('change-password') });
    items.push({ label: copy.accountMenuSignOut, action: () => void ctx.signOut() });
    ctx.openMenu(accountButton, items);
  });
  tools.append(accountButton);
  if (window.innerWidth < 768) {
    const boardsButton = buttonEl({ class: 'secondary-button', 'aria-expanded': 'false', 'aria-haspopup': 'dialog', text: copy.boardsButton });
    boardsButton.addEventListener('click', () => {
      ctx.openDialog('boards-sheet');
      boardsButton.setAttribute('aria-expanded', 'true');
    });
    tools.append(boardsButton);
  }
  masthead.append(title, tools);
  return masthead;
}

export function renderDrawer(ctx: ViewContext): HTMLElement {
  const store = ctx.store;
  const list = el('ul');
  for (const board of store.boards) {
    const link = el('a', {
      class: 'drawer-link',
      href: `/boards/${board.id}`,
      text: board.name,
      ...(board.id === store.board.boardId ? { 'aria-current': 'page' } : {}),
    });
    const count = el('span', { class: 'drawer-count', text: drawerCountText(board.openCards) });
    link.addEventListener('click', (event) => {
      event.preventDefault();
      ctx.navigate(`/boards/${board.id}`);
    });
    list.append(el('li', { class: 'drawer-link-row' }, link, count));
  }
  const nav = el('nav', { 'aria-label': copy.boardsButton }, list);
  const isWorkspaceAdmin = store.workspaces.some((w) => w.id === store.activeWorkspaceId && w.role === 'admin');
  const drawer = el('aside', { class: 'board-drawer' }, nav);
  if (isWorkspaceAdmin) {
    const newBoard = buttonEl({ class: 'secondary-button', text: copy.newBoardButton });
    newBoard.addEventListener('click', () => ctx.openDialog('new-board'));
    drawer.append(newBoard);
  }
  return drawer;
}

export function renderBoardHeader(ctx: ViewContext): HTMLElement {
  const header = el('header', { class: 'board-header' });
  const title = el('h2', { class: 'board-title', text: ctx.store.board.boardName });
  const tools = el('div', { class: 'masthead-tools' });
  if (ctx.store.board.role === 'admin') {
    const settings = buttonEl({ class: 'secondary-button', text: copy.boardSettingsButton });
    settings.addEventListener('click', () => ctx.openDialog('board-settings'));
    tools.append(settings);
  }
  const shortcuts = buttonEl({ class: 'secondary-button', text: copy.keyboardShortcutsButton });
  shortcuts.addEventListener('click', () => ctx.openDialog('keyboard-shortcuts'));
  tools.append(shortcuts);
  header.append(title, tools);
  return header;
}

export function renderServiceStatus(store: ClientStore): HTMLElement {
  const status = el('div', { class: 'service-status', role: 'status', 'aria-label': 'Service status' });
  if (store.serviceStatus.live === 'paused') {
    status.append(el('div', { class: 'service-status-banner', text: copy.livePaused }));
  }
  if (store.serviceStatus.storage === 'down') {
    status.append(el('div', { class: 'service-status-banner', text: copy.storageDown }));
  }
  return status;
}

export function renderNotices(store: ClientStore): HTMLElement {
  const region = el('div', { class: 'notices', role: 'region', 'aria-label': 'Notices' });
  for (const notice of store.notices) {
    const dismiss = buttonEl({ class: 'secondary-button', 'aria-label': 'Dismiss notice', text: 'Dismiss notice' });
    dismiss.addEventListener('click', () => store.dismissNotice(notice.id));
    region.append(el('div', { class: 'notice' }, el('span', { text: notice.text }), dismiss));
  }
  return region;
}

export function renderSearchResults(ctx: ViewContext): HTMLElement | null {
  const store = ctx.store;
  if (store.search.query.length < 2 && store.search.statusText !== copy.searchLimit) return null;
  const region = el('div', { class: 'search-region', role: 'region', 'aria-label': copy.searchResults });
  const list = el('ul');
  for (const result of store.search.results) {
    const link = el('a', { href: `/cards/${result.cardId}`, text: result.title });
    link.addEventListener('click', (event) => {
      event.preventDefault();
      ctx.navigate(`/cards/${result.cardId}`);
    });
    list.append(el('li', {}, el('span', { class: 'visually-hidden', text: `${result.boardName} ${result.listName}: ` }), link));
  }
  region.append(list);
  region.append(el('div', {
    class: 'visually-hidden',
    role: 'status',
    'aria-live': 'polite',
    'aria-label': copy.searchStatus,
    text: store.search.statusText,
  }));
  return region;
}

export function renderBoardArea(ctx: ViewContext, helpers: {
  renderListColumn: (list: CardList) => HTMLElement;
  renderListSwitcher: (lists: CardList[]) => HTMLElement;
  renderAddListField: () => HTMLElement;
  addListFieldOpen: boolean;
  createList: (name: string, input: HTMLInputElement, errorArea: HTMLElement) => Promise<void>;
  openAddList: () => void;
}): HTMLElement {
  const store = ctx.store;
  const area = el('div', { class: 'board-area' });
  if (store.board.notFound) {
    area.append(el('div', { class: 'not-found' },
      el('h1', { text: copy.boardNotFoundTitle }),
      el('p', { text: copy.boardNotFoundBody })));
    return area;
  }
  if (!store.board.loaded) return area;
  if (store.board.lists.length === 0) {
    area.append(el('div', { class: 'empty-board-copy', text: copy.noLists }));
    if (store.board.role === 'admin') {
      const addList = buttonEl({ class: 'secondary-button', text: copy.addAList, 'data-add-list': 'true' });
      addList.addEventListener('click', () => helpers.openAddList());
      area.append(addList);
      if (helpers.addListFieldOpen) area.append(helpers.renderAddListField());
    }
    return area;
  }
  const width = window.innerWidth;
  let visibleLists: CardList[];
  if (width < 768) {
    visibleLists = [store.board.lists.find((l) => l.id === ctx.selectedListId) ?? store.board.lists[0]!];
  } else if (width < 1200) {
    const index = store.board.lists.findIndex((l) => l.id === ctx.selectedListId);
    const chosen = index >= 0 ? index : 0;
    if (store.board.lists.length === 1) {
      visibleLists = [store.board.lists[0]!];
    } else if (chosen === store.board.lists.length - 1) {
      visibleLists = [store.board.lists[chosen - 1]!, store.board.lists[chosen]!];
    } else {
      visibleLists = [store.board.lists[chosen]!, store.board.lists[chosen + 1]!];
    }
  } else {
    visibleLists = store.board.lists;
  }
  if (width < 1200) {
    area.append(helpers.renderListSwitcher(store.board.lists));
  }
  for (const list of visibleLists) {
    area.append(helpers.renderListColumn(list));
  }
  if (store.board.role === 'admin') {
    const addList = buttonEl({ class: 'secondary-button', text: copy.addAList, 'data-add-list': 'true' });
    addList.addEventListener('click', () => helpers.openAddList());
    area.append(addList);
    if (helpers.addListFieldOpen) area.append(helpers.renderAddListField());
  }
  return area;
}

export function renderPermissionLogPage(entries: unknown[] | null): HTMLElement {
  const wrap = el('div', { class: 'permission-wrap' });
  const heading = el('h1', { text: copy.permissionLogTitle });
  if (entries === null) {
    wrap.append(heading, el('p', { text: copy.somethingWrong }));
    return wrap;
  }
  const table = el('table', { class: 'permission-table', 'aria-label': copy.permissionLogTitle });
  const head = el('thead', {}, el('tr', {},
    el('th', { text: 'When' }), el('th', { text: 'Who' }), el('th', { text: 'What' }),
    el('th', { text: 'Target' }), el('th', { text: 'Before' }), el('th', { text: 'After' })));
  const body = el('tbody');
  for (const entry of entries) {
    const row = entry as {
      at: string; actor: { displayName: string }; action: string;
      target: { label: string }; board: { name: string } | null;
      before: string | null; after: string | null;
    };
    const date = new Date(row.at);
    body.append(el('tr', {},
      el('td', { text: date.toISOString().slice(0, 10) + ' ' + date.toISOString().slice(11, 16) }),
      el('td', { text: row.actor.displayName }),
      el('td', { text: row.action }),
      el('td', { text: row.target.label }),
      el('td', { text: row.before ?? '—' }),
      el('td', { text: row.after ?? '—' })));
  }
  table.append(head, body);
  wrap.append(heading, table);
  return wrap;
}
