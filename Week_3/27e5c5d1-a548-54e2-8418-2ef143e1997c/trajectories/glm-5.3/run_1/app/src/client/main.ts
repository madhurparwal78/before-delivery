// Kinfold front end entry: routing, live stream, search, lift/drop, and the render loop.
import { api, isApiError } from './api.js';
import { copy } from './copy.js';
import { ClientStore } from './state.js';
import { buttonEl, codePoints, el } from './dom.js';
import type { ViewContext } from './views.js';
import {
  renderBoardArea,
  renderBoardHeader,
  renderDrawer,
  renderMasthead,
  renderNotices,
  renderPermissionLogPage,
  renderSearchResults,
  renderServiceStatus,
  renderSignIn,
} from './views.js';
import {
  renderBoardSettingsDialog,
  renderBoardsSheetDialog,
  renderCardDialog,
  renderChangePasswordDialog,
  renderMoveCardDialog,
  renderNewBoardDialog,
  renderShortcutsDialog,
} from './dialogs.js';
import type { ApiErrorBody, Card, CardList } from '../shared/protocol.js';

const store = new ClientStore();
const appRoot = document.getElementById('app') as HTMLElement;

type Route =
  | { kind: 'signin'; next?: string }
  | { kind: 'root' }
  | { kind: 'board'; boardId: string; listId?: string }
  | { kind: 'card'; cardId: string }
  | { kind: 'permission-log'; workspaceId: string };

let currentRoute: Route = { kind: 'root' };
let dialogState: { kind: string; data?: unknown } | null = null;
let selectedListId: string | null = null;
let searchBoxText = '';
let permissionEntries: unknown[] | null = null;
let addListFieldOpen = false;
let addCardFieldOpenFor: string | null = null;
let menuAnchor: HTMLElement | null = null;
let menuElement: HTMLElement | null = null;
let lastFocusTarget: HTMLElement | null = null;
let liveSource: EventSource | null = null;
let minuteTimer: number | null = null;
let statusTimer: number | null = null;
let chipTimer: number | null = null;

function getSearchBoxText(): string { return searchBoxText; }

function parseRoute(): Route {
  const path = location.pathname;
  const params = new URLSearchParams(location.search);
  const segments = path.split('/').filter((s) => s.length > 0);
  if (segments[0] === 'signin') return { kind: 'signin', next: params.get('next') ?? undefined };
  if (segments[0] === 'boards' && segments[1]) return { kind: 'board', boardId: segments[1], listId: params.get('list') ?? undefined };
  if (segments[0] === 'cards' && segments[1]) return { kind: 'card', cardId: segments[1] };
  if (segments[0] === 'workspaces' && segments[2] === 'permission-log') return { kind: 'permission-log', workspaceId: segments[1]! };
  return { kind: 'root' };
}

function navigate(path: string, replace = false): void {
  if (replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  boot();
}

function rerender(): void {
  render();
}

const ctx: ViewContext = {
  store,
  navigate,
  announce,
  refreshBoard,
  refreshBoards,
  signOut,
  openDialog,
  closeDialog,
  dialogState,
  setDialogState,
  openMenu,
  setSelectedListId: (id: string | null) => { selectedListId = id; },
  setSearchBoxText: (text: string) => { searchBoxText = text; },
  get selectedListId() { return selectedListId; },
  searchBoxText: getSearchBoxText(),
  onSearchInput,
  boardRoute: () => currentRoute,
  closeCardDialog,
  setLiftForRemoteCancel: cancelLiftForRemote,
  rerender,
  dialogStateIs: (kind: string) => dialogState?.kind === kind,
  dialogStateIsCard: (cardId: string) => dialogState?.kind === 'card' && (dialogState.data as Card | undefined)?.id === cardId,
  noteOwnMove: (cardId: string) => { recentOwnMoves.add(cardId); },
};

let announcementRegion: HTMLElement | null = null;

function announce(text: string): void {
  const region = ensureAnnouncementRegion();
  region.textContent = '';
  region.append(el('span', { class: 'visually-hidden', text }));
}

function render(): void {
  // A re-read never steals focus: the focused card button is re-focused after paint.
  const active = document.activeElement as HTMLElement | null;
  const activeCard = active?.getAttribute('data-card-button');
  const activeInDialog = Boolean(active?.closest('[data-dialog]'));
  appRoot.textContent = '';
  if (currentRoute.kind === 'signin') {
    appRoot.append(renderSignIn((currentRoute as { next?: string }).next));
    return;
  }
  const shell = el('div', {});
  shell.append(renderMasthead(ctx));
  const frame = el('div', { class: 'app-frame' });
  if (window.innerWidth >= 768) {
    frame.append(renderDrawer(ctx));
  }
  const main = el('main', { class: 'board-main' });
  main.append(
    currentRoute.kind === 'permission-log'
      ? el('div')
      : renderBoardHeader(ctx),
    renderServiceStatus(store),
    renderNotices(store),
  );
  const searchRegion = renderSearchResults(ctx);
  if (searchRegion) main.append(searchRegion);
  if (currentRoute.kind === 'permission-log') {
    permissionEntries = permissionEntries ?? [];
    main.append(renderPermissionLogPage(permissionEntries));
  } else {
    main.append(renderBoardArea(ctx, {
      renderListColumn,
      renderListSwitcher,
      renderAddListField,
      addListFieldOpen,
      createList,
      openAddList,
    }));
  }
  frame.append(main);
  shell.append(frame);
  ensureAnnouncementRegion();
  const dialog = renderDialog();
  if (dialog) shell.append(dialog);
  const menu = menuElement;
  if (menu) shell.append(menu);
  appRoot.append(shell);
  if (activeCard && !activeInDialog) {
    const restore = document.querySelector(`[data-card-button="${activeCard}"]`) as HTMLElement | null;
    restore?.focus();
  }
}

/** The announcement region lives outside render() so re-reads never wipe a live message. */
function ensureAnnouncementRegion(): HTMLElement {
  if (!announcementRegion) {
    announcementRegion = el('div', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite', 'aria-label': 'Board announcements' });
    document.body.append(announcementRegion);
  }
  return announcementRegion;
}

function renderDialog(): HTMLElement | null {
  if (!dialogState) return null;
  switch (dialogState.kind) {
    case 'new-board': return renderNewBoardDialog(ctx);
    case 'keyboard-shortcuts': return renderShortcutsDialog(ctx);
    case 'board-settings': return renderBoardSettingsDialog(ctx);
    case 'boards-sheet': return renderBoardsSheetDialog(ctx);
    case 'change-password': return renderChangePasswordDialog(ctx);
    case 'move-card': return renderMoveCardDialog(ctx, dialogState.data as Card);
    case 'card': return renderCardDialog(ctx, dialogState.data as Card);
    case 'delete-card-confirm': return renderDeleteConfirm(ctx, dialogState.data as Card);
    default: return null;
  }
}

function renderDeleteConfirm(localCtx: ViewContext, card: Card): HTMLElement {
  const deleteButton = buttonEl({ class: 'primary-button', text: copy.deleteButton, 'data-autofocus': 'true' });
  const keep = buttonEl({ class: 'secondary-button', text: copy.keepCard });
  keep.addEventListener('click', () => openDialog('card', card));
  deleteButton.addEventListener('click', () => {
    void (async () => {
      deleteButton.textContent = copy.deleting;
      deleteButton.disabled = true;
      const reply = await api.deleteCard(card.id);
      deleteButton.disabled = false;
      if (reply.status === 503) {
        localCtx.store.addNotice(copy.deleteFailed);
        deleteButton.textContent = copy.deleteButton;
        return;
      }
      setDialogState(null);
      localCtx.store.removeCard(card.id);
      if (currentRoute.kind === 'card') {
        const listId = selectedListId;
        const query = window.innerWidth < 1200 && listId ? `?list=${listId}` : '';
        setDialogState(null);
        history.replaceState(null, '', `/boards/${store.board.boardId}${query}`);
        currentRoute = { kind: 'board', boardId: store.board.boardId ?? '' };
      }
      navigate(location.pathname, true);
      void refreshBoards();
    })();
  });
  const panel = el('div', { class: 'dialog-panel', role: 'alertdialog', 'aria-label': copy.deleteConfirmTitle },
    el('h2', { class: 'dialog-title', text: copy.deleteConfirmTitle }),
    el('p', { text: card.title }),
    el('div', { class: 'dialog-actions' }, keep, deleteButton));
  const dialog = el('div', { class: 'dialog-backdrop', 'data-dialog': 'delete-confirm' }, panel);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) openDialog('card', card);
  });
  return dialog;
}

// ---- Menus ---------------------------------------------------------------------------

interface MenuItemSpec {
  label: string;
  action: () => void;
  /** A radio item is used only in role pickers; every other menu uses menuitem. */
  checked?: boolean;
  radio?: boolean;
}

function openMenu(anchor: HTMLElement, items: MenuItemSpec[]): void {
  closeMenu();
  menuAnchor = anchor;
  const menu = el('div', { class: 'menu', role: 'menu' });
  for (const item of items) {
    const menuItem = el('button', {
      role: item.radio ? 'menuitemradio' : 'menuitem',
      ...(item.radio ? { 'aria-checked': String(item.checked ?? false) } : {}),
      text: item.label,
    }) as HTMLButtonElement;
    menuItem.addEventListener('click', () => {
      closeMenu();
      item.action();
    });
    menu.append(menuItem);
  }
  menuElement = menu;
  document.addEventListener('click', onMenuOutside, { capture: true });
  document.addEventListener('keydown', onMenuKey, { capture: true });
  render();
  positionMenu(anchor);
  const first = menu.querySelector('button') as HTMLElement | null;
  first?.focus();
}

function positionMenu(anchor: HTMLElement): void {
  if (!menuElement) return;
  const rect = anchor.getBoundingClientRect();
  const menu = menuElement;
  menu.style.position = 'fixed';
  menu.style.visibility = 'hidden';
  menu.style.display = 'block';
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  let left = rect.left;
  let top = rect.bottom + 4;
  if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8);
  if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 4);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.style.visibility = 'visible';
}

function closeMenu(): void {
  menuElement?.remove();
  menuElement = null;
  document.removeEventListener('click', onMenuOutside, { capture: true });
  document.removeEventListener('keydown', onMenuKey, { capture: true });
  if (menuAnchor) {
    menuAnchor.focus();
    menuAnchor = null;
  }
}

function onMenuOutside(event: MouseEvent): void {
  if (menuElement && !menuElement.contains(event.target as Node)) {
    closeMenu();
    rerender();
  }
}

function onMenuKey(event: KeyboardEvent): void {
  // Only while a menu is open: the document-level Escape handler owns the closed state.
  if (!menuElement) return;
  const buttons = [...menuElement.querySelectorAll('button')] as HTMLButtonElement[];
  if (event.key === 'Escape') {
    event.preventDefault();
    closeMenu();
    rerender();
    return;
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'ArrowDown' ? (index + 1) % buttons.length : (index - 1 + buttons.length) % buttons.length;
    buttons[next]?.focus();
    return;
  }
  if (event.key === 'Tab') {
    event.preventDefault();
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.shiftKey ? (index - 1 + buttons.length) % buttons.length : (index + 1) % buttons.length;
    buttons[next]?.focus();
  }
}

// ---- Dialogs -------------------------------------------------------------------------

function openDialog(kind: string, data?: unknown): void {
  dialogState = { kind, data };
  render();
  setTimeout(() => {
    const first = document.querySelector('[data-dialog] [data-autofocus]') as HTMLElement | null;
    first?.focus();
  }, 10);
}

function closeDialog(): void {
  dialogState = null;
  render();
  lastFocusTarget?.focus();
}

function setDialogState(state: { kind: string; data?: unknown } | null): void {
  dialogState = state;
}

function closeCardDialog(card: Card | null): void {
  setDialogState(null);
  if (currentRoute.kind === 'card' && card) {
    const listId = store.board.lists.find((l) => l.cards.some((c) => c.id === card.id))?.id;
    const query = window.innerWidth < 1200 && listId ? `?list=${listId}` : '';
    history.replaceState(null, '', `/boards/${store.board.boardId}${query}`);
    currentRoute = { kind: 'board', boardId: store.board.boardId ?? '', listId: listId ?? undefined };
    selectedListId = listId ?? selectedListId;
  }
  render();
  if (card) {
    const button = document.querySelector(`[data-card-button="${card.id}"]`) as HTMLElement | null;
    button?.focus();
  }
}

// ---- List and card creation ----------------------------------------------------------

function openAddList(): void {
  addListFieldOpen = true;
  render();
  setTimeout(() => {
    const field = document.querySelector('[data-new-list]') as HTMLInputElement | null;
    field?.focus();
  }, 10);
}

function renderAddListField(): HTMLElement {
  const input = el('input', { class: 'text-input', 'aria-label': copy.newListName, placeholder: copy.newListName, 'data-new-list': 'true' }) as HTMLInputElement;
  const errorArea = el('div');
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void createList(input.value, input, errorArea);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      addListFieldOpen = false;
      render();
      const addList = document.querySelector('[data-add-list]') as HTMLElement | null;
      addList?.focus();
    }
  });
  const wrap = el('div', { class: 'dialog-row' }, input, errorArea);
  setTimeout(() => input.focus(), 10);
  return wrap;
}

async function createList(name: string, input: HTMLInputElement, errorArea: HTMLElement): Promise<void> {
  input.disabled = true;
  const reply = await api.createList(store.board.boardId ?? '', name);
  input.disabled = false;
  if (isApiError(reply.body)) {
    const fields = (reply.body as ApiErrorBody).fields ?? {};
    errorArea.textContent = '';
    errorArea.append(el('div', { class: 'field-error', text: fields['name'] ?? copy.listNameRequired }));
    return;
  }
  addListFieldOpen = false;
  const listId = (reply.body as { list: { id: string } }).list.id;
  selectedListId = listId;
  await refreshBoard();
  if (window.innerWidth < 1200) {
    history.replaceState(null, '', `/boards/${store.board.boardId}?list=${listId}`);
  }
  setTimeout(() => {
    const button = document.querySelector(`[data-add-card="${listId}"]`) as HTMLElement | null;
    button?.focus();
    lastFocusTarget = button;
  }, 30);
}

function renderListSwitcher(lists: CardList[]): HTMLElement {
  const tablist = el('div', { class: 'list-switcher', role: 'tablist', 'aria-label': 'Lists' });
  for (const list of lists) {
    const tab = el('button', {
      role: 'tab',
      'aria-selected': String(list.id === selectedListId),
      'aria-controls': list.id,
      id: `tab-${list.id}`,
      text: list.name,
    }) as HTMLButtonElement;
    tab.addEventListener('click', () => {
      selectedListId = list.id;
      if (window.innerWidth < 1200) {
        history.replaceState(null, '', `/boards/${store.board.boardId}?list=${list.id}`);
      }
      render();
    });
    tablist.append(tab);
  }
  return tablist;
}

function renderListColumn(list: CardList): HTMLElement {
  const column = el('section', { class: 'list-column', role: 'region', 'aria-label': list.name, id: list.id });
  column.append(el('h3', { class: 'list-heading', text: list.name }));
  column.append(el('span', { class: 'list-count', text: `${list.count} ${list.count === 1 ? 'card' : 'cards'}` }));
  const cards = el('ul', { class: 'list-cards', 'aria-label': `${list.name} cards` });
  if (list.cards.length === 0) {
    cards.append(el('li', { class: 'empty-list-copy', text: copy.emptyList }));
  }
  for (const card of list.cards) {
    cards.append(renderCardItem(card, list));
  }
  column.append(cards);
  if (store.board.role !== 'observer') {
    const addCard = buttonEl({ class: 'add-card-button', 'aria-label': copy.addCardTo(list.name), 'data-add-card': list.id, text: copy.addCardTo(list.name) });
    addCard.addEventListener('click', () => {
      addCardFieldOpenFor = list.id;
      render();
      setTimeout(() => {
        const field = document.querySelector(`[data-new-card="${list.id}"]`) as HTMLInputElement | null;
        field?.focus();
      }, 10);
    });
    column.append(addCard);
    if (addCardFieldOpenFor === list.id) {
      const input = el('input', { class: 'text-input', 'aria-label': copy.newCardTitle, placeholder: copy.newCardTitle, 'data-new-card': list.id }) as HTMLInputElement;
      const errorArea = el('div');
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          void createCard(list.id, input.value, input, errorArea);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          addCardFieldOpenFor = null;
          render();
          addCard.focus();
        }
      });
      column.append(el('div', { class: 'dialog-row' }, input, errorArea));
    }
  }
  return column;
}

async function createCard(listId: string, title: string, input: HTMLInputElement, errorArea: HTMLElement): Promise<void> {
  if (!title.trim()) {
    errorArea.textContent = '';
    errorArea.append(el('div', { class: 'field-error', text: copy.cardTitleRequired }));
    return;
  }
  input.disabled = true;
  const key = crypto.randomUUID();
  const reply = await api.createCard(listId, title, key);
  input.disabled = false;
  if (isApiError(reply.body)) {
    const fields = (reply.body as ApiErrorBody).fields ?? {};
    errorArea.textContent = '';
    errorArea.append(el('div', { class: 'field-error', text: fields['title'] ?? copy.cardTitleRequired }));
    return;
  }
  const payload = reply.body as { card: Card; counts: { listId: string; count: number }[]; openCards: number };
  store.applyServerCounts(payload.counts);
  store.applyOpenCards(store.board.boardId ?? '', payload.openCards);
  store.replaceCard(payload.card);
  const listName = store.board.lists.find((l) => l.id === listId)?.name ?? '';
  announce(copy.addedCard(payload.card.title, listName));
  input.value = '';
  input.focus();
  void refreshBoards();
  render();
}

function renderCardItem(card: Card, list: CardList): HTMLElement {
  const item = el('li', { 'data-card': card.id });
  const cardBox = el('div', { class: `card${store.chips.has(card.id) ? ' moved-tint' : ''}` });
  const titleButton = buttonEl({ class: 'card-title-button', 'data-card-button': card.id, text: card.title });
  titleButton.addEventListener('click', () => {
    if (liftState && liftState.cardId === card.id) return;
    if (window.innerWidth < 768 && liftState) {
      cancelLiftSilent();
    }
    openCard(card);
  });
  titleButton.addEventListener('keydown', (event) => {
    handleCardKeyDown(event, card, list);
  });
  attachPointerDrag(titleButton, card, list);
  cardBox.append(titleButton);
  const meta = el('div', { class: 'card-meta' });
  for (const label of card.labels) {
    meta.append(el('span', { class: 'label-pill', text: label }));
  }
  if (card.dueState === 'due_today') meta.append(el('span', { class: 'due-label', text: copy.dueToday }));
  if (card.dueState === 'overdue') meta.append(el('span', { class: 'due-label overdue', text: copy.overdue }));
  if (card.status === 'done') meta.append(el('span', { class: 'done-mark', text: 'Done' }));
  if (card.checklist.length > 0) {
    const done = card.checklist.filter((entry) => entry.done).length;
    meta.append(el('span', { class: 'checklist-progress', text: `${done}/${card.checklist.length}` }));
  }
  if (card.isPrivate) {
    meta.append(el('span', { role: 'img', 'aria-label': copy.privateCard, class: 'lock-icon', text: '🔒' }));
  }
  if (card.owner) {
    meta.append(el('span', { class: `chip ${card.owner.colour}`, role: 'img', 'aria-label': copy.ownerChip(card.owner.displayName), text: card.owner.initials }));
  }
  cardBox.append(meta);
  const chipData = store.chips.get(card.id);
  if (chipData) {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      cardBox.classList.add('mover-outline');
    }
    cardBox.style.setProperty('--mover-colour', chipData.colour);
    cardBox.append(el('span', {
      class: `chip ${chipData.colour} mover-chip-holder`,
      role: 'img',
      'aria-label': copy.movedBy(chipData.displayName),
      text: chipData.initials,
    }));
  }
  if (store.board.role !== 'observer') {
    const actions = buttonEl({ class: 'secondary-button', 'aria-label': copy.actionsFor(card.title), 'aria-haspopup': 'menu', text: '⋯' });
    actions.addEventListener('click', () => {
      openMenu(actions, [
        { label: copy.moveTo, action: () => openDialog('move-card', card) },
        ...(card.status === 'done'
          ? [{ label: copy.reopen, action: () => void setCardStatus(card, 'open') }]
          : [{ label: copy.markDone, action: () => void setCardStatus(card, 'done') }]),
        { label: copy.archive, action: () => void setCardStatus(card, 'archived') },
      ]);
    });
    cardBox.append(actions);
  }
  item.append(cardBox);
  return item;
}

function openCard(card: Card): void {
  lastFocusTarget = document.querySelector(`[data-card-button="${card.id}"]`);
  if (currentRoute.kind === 'board') {
    history.pushState(null, '', `/cards/${card.id}`);
    currentRoute = { kind: 'card', cardId: card.id };
  }
  openDialog('card', card);
}

async function setCardStatus(card: Card, status: 'open' | 'done' | 'archived'): Promise<void> {
  if (status === 'archived') recentOwnRemoves.add(card.id);
  const reply = await api.setCardStatus(card.id, status, card.version);
  if (reply.status !== 200 && reply.status !== 409) recentOwnRemoves.delete(card.id);
  if (reply.status === 404) {
    store.removeCard(card.id);
    const sentence = copy.noLongerShared(card.title);
    announce(sentence);
    store.addNotice(sentence);
    render();
    return;
  }
  if (reply.status === 409 && (reply.body as ApiErrorBody).error === 'stale') {
    const body = reply.body as ApiErrorBody & { card: Card; changedBy: { displayName: string }; change: 'moved' | 'edited' };
    store.replaceCard(body.card);
    const list = store.board.lists.find((l) => l.id === body.card.listId);
    const sentence = body.change === 'moved'
      ? copy.staleMoved(body.changedBy.displayName, body.card.title, list?.name ?? '', body.card.position ?? 1, list?.count ?? 1)
      : copy.staleEdited(body.changedBy.displayName, body.card.title, list?.name ?? '', body.card.position ?? 1, list?.count ?? 1);
    announce(sentence);
    store.addNotice(sentence);
    render();
    return;
  }
  if (isApiError(reply.body)) return;
  const payload = reply.body as { card: Card; counts: { listId: string; count: number }[]; openCards: number };
  store.applyServerCounts(payload.counts);
  store.applyOpenCards(store.board.boardId ?? '', payload.openCards);
  if (status === 'archived') {
    store.removeCard(card.id);
  } else {
    store.replaceCard(payload.card);
  }
  announce(status === 'archived' ? copy.archivedCard(card.title) : status === 'done' ? copy.markedDone(card.title) : copy.reopened(card.title));
  render();
  if (status === 'archived') {
    // Focus the card that took the archived card's place, or the one before it, or the add button.
    const list = store.board.lists.find((l) => l.id === card.listId);
    const position = card.position ?? 1;
    const replacement = list?.cards[position - 1] ?? list?.cards[position - 2];
    const focusTarget = replacement
      ? document.querySelector(`[data-card-button="${replacement.id}"]`)
      : list
        ? document.querySelector(`[data-add-card="${list.id}"]`)
        : null;
    (focusTarget as HTMLElement | null)?.focus();
  } else {
    const focusTarget = document.querySelector(`[data-card-button="${card.id}"]`) as HTMLElement | null;
    focusTarget?.focus();
  }
  void refreshBoards();
}

// ---- Keyboard lift ------------------------------------------------------------------

interface LiftState {
  cardId: string;
  listId: string;
  position: number;
  startListId: string;
  startPosition: number;
}

let liftState: LiftState | null = null;
/** Card ids this viewer moved just now, so their own event echo stays quiet. */
const recentOwnMoves = new Set<string>();
/** Card ids this viewer just archived or deleted, so their own event echo stays quiet. */
const recentOwnRemoves = new Set<string>();

function handleCardKeyDown(event: KeyboardEvent, card: Card, list: CardList): void {
  if (liftState && liftState.cardId === card.id) {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const direction: -1 | 1 = event.key === 'ArrowUp' ? -1 : 1;
      const next = Math.min(Math.max(liftState.position + direction, 1), Math.max(list.count, 1));
      liftState.position = next;
      announce(copy.overPosition(card.title, list.name, next, list.count));
      reorderLocally(card);
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const direction: -1 | 1 = event.key === 'ArrowLeft' ? -1 : 1;
      const index = store.board.lists.findIndex((l) => l.id === liftState!.listId);
      const target = store.board.lists[index + direction];
      if (!target) return;
      const position = Math.min(liftState.position, Math.max(target.count, 1));
      liftState.listId = target.id;
      liftState.position = position;
      announce(copy.overPosition(card.title, target.name, position, target.count));
      if (window.innerWidth < 1200) {
        selectedListId = target.id;
        history.replaceState(null, '', `/boards/${store.board.boardId}?list=${target.id}`);
      }
      reorderLocally(card);
      return;
    }
    if (event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      void dropLifted(card);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelLift();
      return;
    }
    if (event.key === 'Tab') {
      cancelLiftSilent();
      return;
    }
  }
  if (event.key === ' ' || event.key === 'Spacebar') {
    event.preventDefault();
    if (store.board.role === 'observer') return;
    startLift(card, list, 'keyboard');
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    openCard(card);
    return;
  }
  if (event.key === '?') {
    const target = event.target as HTMLElement;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
    event.preventDefault();
    openDialog('keyboard-shortcuts');
  }
}

function startLift(card: Card, list: CardList, mode: 'keyboard' | 'pointer'): void {
  liftState = {
    cardId: card.id,
    listId: list.id,
    position: card.position ?? 1,
    startListId: list.id,
    startPosition: card.position ?? 1,
  };
  if (mode === 'keyboard') {
    announce(copy.liftKeyboard(card.title, list.name, card.position ?? 1, list.count));
  } else {
    announce(copy.liftPointer(card.title));
  }
  render();
  const button = document.querySelector(`[data-card-button="${card.id}"]`) as HTMLElement | null;
  button?.focus();
}

function reorderLocally(card: Card): void {
  if (!liftState) return;
  const fromList = store.board.lists.find((l) => l.id === card.listId);
  if (!fromList) return;
  if (fromList.id !== liftState.listId) {
    fromList.cards = fromList.cards.filter((c) => c.id !== card.id);
    const target = store.board.lists.find((l) => l.id === liftState!.listId);
    target?.cards.splice(Math.min(liftState.position - 1, target.cards.length), 0, card);
    card.listId = liftState.listId;
  } else {
    const current = fromList.cards.findIndex((c) => c.id === card.id);
    const target = liftState.position - 1;
    if (current !== target && current >= 0) {
      fromList.cards.splice(current, 1);
      fromList.cards.splice(Math.min(target, fromList.cards.length), 0, card);
    }
  }
  for (const list of store.board.lists) {
    list.cards.forEach((entry, index) => {
      entry.position = index + 1;
    });
  }
  render();
  const button = document.querySelector(`[data-card-button="${card.id}"]`) as HTMLElement | null;
  button?.focus();
}

async function dropLifted(card: Card): Promise<void> {
  if (!liftState) return;
  const started = liftState.listId === liftState.startListId && liftState.position === liftState.startPosition;
  const listId = liftState.listId;
  const position = liftState.position;
  const version = card.version;
  liftState = null;
  if (started) {
    const startList = store.board.lists.find((l) => l.id === card.listId);
    // return the card to where it started
    const target = store.board.lists.find((l) => l.id === listId);
    if (target && startList) {
      startList.cards = startList.cards.filter((c) => c.id !== card.id);
      target.cards.splice(Math.min(position - 1, target.cards.length), 0, card);
      for (const list of store.board.lists) {
        list.cards.forEach((entry, index) => {
          entry.position = index + 1;
        });
      }
    }
    announce(copy.moveCancelled(card.title, target?.name ?? '', position, target?.count ?? 1));
    render();
    const button = document.querySelector(`[data-card-button="${card.id}"]`) as HTMLElement | null;
    button?.focus();
    return;
  }
  recentOwnMoves.add(card.id);
  const reply = await api.moveCard(card.id, listId, position, version);
  if (reply.status !== 200) recentOwnMoves.delete(card.id);
  if (reply.status === 409 && (reply.body as ApiErrorBody).error === 'stale') {
    const body = reply.body as ApiErrorBody & { card: Card; changedBy: { displayName: string }; change: 'moved' | 'edited' };
    store.replaceCard(body.card);
    const list = store.board.lists.find((l) => l.id === body.card.listId);
    const sentence = body.change === 'moved'
      ? copy.staleMoved(body.changedBy.displayName, body.card.title, list?.name ?? '', body.card.position ?? 1, list?.count ?? 1)
      : copy.staleEdited(body.changedBy.displayName, body.card.title, list?.name ?? '', body.card.position ?? 1, list?.count ?? 1);
    announce(sentence);
    store.addNotice(sentence);
    render();
    const button = document.querySelector(`[data-card-button="${card.id}"]`) as HTMLElement | null;
    button?.focus();
    return;
  }
  if (reply.status === 404) {
    store.removeCard(card.id);
    const sentence = copy.noLongerShared(card.title);
    announce(sentence);
    store.addNotice(sentence);
    render();
    return;
  }
  if (isApiError(reply.body)) {
    render();
    return;
  }
  const payload = reply.body as { card: Card; counts: { listId: string; count: number }[]; openCards: number };
  store.applyServerCounts(payload.counts);
  store.applyOpenCards(store.board.boardId ?? '', payload.openCards);
  store.replaceCard(payload.card);
  const list = store.board.lists.find((l) => l.id === payload.card.listId);
  announce(copy.movedTo(payload.card.title, list?.name ?? '', payload.card.position ?? 1, list?.count ?? 1));
  void refreshBoards();
  render();
  const button = document.querySelector(`[data-card-button="${card.id}"]`) as HTMLElement | null;
  button?.focus();
}

function cancelLift(): void {
  if (!liftState) return;
  const card = findCardById(liftState.cardId);
  const startListId = liftState.startListId;
  const startPosition = liftState.startPosition;
  liftState = null;
  if (card) {
    const source = store.board.lists.find((l) => l.id === card.listId);
    const target = store.board.lists.find((l) => l.id === startListId);
    if (source && target) {
      source.cards = source.cards.filter((c) => c.id !== card.id);
      target.cards.splice(Math.min(startPosition - 1, target.cards.length), 0, card);
      card.listId = target.id;
    }
    for (const list of store.board.lists) {
      list.cards.forEach((entry, index) => {
        entry.position = index + 1;
      });
    }
    announce(copy.moveCancelled(card.title, target?.name ?? '', startPosition, target?.count ?? 1));
  }
  render();
  const button = card ? (document.querySelector(`[data-card-button="${card.id}"]`) as HTMLElement | null) : null;
  button?.focus();
}

function cancelLiftSilent(): void {
  liftState = null;
}

function cancelLiftForRemote(cardId: string): void {
  if (liftState && liftState.cardId === cardId) {
    liftState = null;
  }
}

function findCardById(cardId: string): Card | null {
  return store.findCard(cardId)?.card ?? null;
}

// ---- Pointer and touch drag ----------------------------------------------------------

function attachPointerDrag(button: HTMLElement, card: Card, list: CardList): void {
  let startX = 0;
  let startY = 0;
  let dragging = false;
  let touchTimer: number | null = null;
  let pointerDown = false;

  const isTouch = (event: PointerEvent): boolean => event.pointerType === 'touch';

  button.addEventListener('pointerdown', (event) => {
    if (store.board.role === 'observer') return;
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    pointerDown = true;
    startX = event.clientX;
    startY = event.clientY;
    if (isTouch(event)) {
      touchTimer = window.setTimeout(() => {
        if (!pointerDown) return;
        dragging = true;
        startLift(card, list, 'pointer');
      }, 500);
    }
    button.setPointerCapture(event.pointerId);
  });

  button.addEventListener('pointermove', (event) => {
    if (!pointerDown || isTouch(event)) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (!dragging && Math.hypot(dx, dy) > 4) {
      dragging = true;
      startLift(card, list, 'pointer');
    }
  });

  button.addEventListener('pointerup', (event) => {
    if (isTouch(event) && touchTimer !== null) {
      clearTimeout(touchTimer);
      touchTimer = null;
    }
    pointerDown = false;
    if (dragging) {
      dragging = false;
      if (liftState && liftState.cardId === card.id) {
        const target = listFromPoint(event.clientX, event.clientY);
        if (target) {
          liftState.listId = target.list.id;
          liftState.position = target.position;
        }
        void dropLifted(card);
      }
      return;
    }
    if (!isTouch(event)) {
      openCard(card);
    }
  });

  button.addEventListener('pointercancel', () => {
    pointerDown = false;
    if (touchTimer !== null) {
      clearTimeout(touchTimer);
      touchTimer = null;
    }
    if (dragging) {
      dragging = false;
      cancelLift();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && dragging) {
      dragging = false;
      cancelLift();
    }
  });
}

function listFromPoint(x: number, y: number): { list: CardList; position: number } | null {
  const element = document.elementFromPoint(x, y);
  if (!element) return null;
  const column = element.closest('.list-column') as HTMLElement | null;
  if (!column) return null;
  const list = store.board.lists.find((l) => l.id === column.id);
  if (!list) return null;
  const cardTargets = list.cards.map((c) => ({
    card: c,
    node: document.querySelector(`[data-card="${c.id}"]`) as HTMLElement | null,
  }));
  let position = list.cards.length + 1;
  for (const target of cardTargets) {
    if (!target.node) continue;
    const rect = target.node.getBoundingClientRect();
    if (y < rect.top + rect.height / 2) {
      position = target.card.position ?? 1;
      break;
    }
  }
  return { list, position };
}

// ---- Search --------------------------------------------------------------------------

let searchSequence = 0;
let searchAbort: AbortController | null = null;

async function onSearchInput(text: string): Promise<void> {
  const length = codePoints(text);
  searchBoxText = text;
  if (length < 2) {
    store.clearSearch();
    rerender();
    return;
  }
  if (length > 100) {
    store.setSearch(text, [], 0, copy.searchLimit);
    rerender();
    return;
  }
  const sequence = ++searchSequence;
  if (searchAbort) searchAbort.abort();
  await new Promise((resolve) => setTimeout(resolve, 200));
  if (sequence !== searchSequence) return;
  const workspaceId = store.activeWorkspaceId ?? '';
  if (!workspaceId) return;
  const reply = await api.search(workspaceId, text);
  if (sequence !== searchSequence) return;
  if (reply.status !== 200) return;
  const payload = reply.body as { results: { cardId: string; boardId: string; boardName: string; listName: string; title: string }[]; total: number };
  const statusText =
    payload.total > 50
      ? copy.searchOverFifty(payload.total, text)
      : payload.total === 1
        ? copy.searchOne(text)
        : payload.total === 0
          ? copy.searchNone(text)
          : copy.searchCount(payload.total, text);
  store.setSearch(text, payload.results, payload.total, statusText);
  announce(statusText);
  rerender();
}

// ---- Board refresh and live stream ---------------------------------------------------

async function refreshBoard(): Promise<void> {
  const boardId = store.board.boardId ?? (currentRoute.kind === 'board' ? currentRoute.boardId : currentRoute.kind === 'card' ? store.board.boardId : null);
  if (!boardId) return;
  const reply = await api.board(boardId);
  if (reply.status === 404) {
    store.setBoardNotFound();
    render();
    return;
  }
  if (isApiError(reply.body)) return;
  store.setBoardFromPayload(reply.body as typeof store.board extends never ? never : import('../shared/protocol.js').BoardPayload);
  if (!selectedListId && store.board.lists.length > 0) {
    selectedListId = store.board.lists[0]!.id;
  }
  if (currentRoute.kind === 'card' && dialogState?.kind === 'card') {
    const cardId = currentRoute.cardId;
    const fresh = findCardById(cardId);
    if (fresh) {
      dialogState = { kind: 'card', data: fresh };
    }
  }
  render();
}

/** Refresh the drawer's board list. */
async function refreshBoards(): Promise<void> {
  const workspaceId = store.activeWorkspaceId;
  if (!workspaceId) return;
  const reply = await api.workspaceBoards(workspaceId);
  if (isApiError(reply.body)) return;
  store.setBoards((reply.body as { boards: import('../shared/protocol.js').BoardSummary[] }).boards);
  render();
}

function openLiveStream(): void {
  const boardId = store.board.boardId;
  if (!boardId) return;
  liveSource?.close();
  liveSource = new EventSource(`/api/boards/${boardId}/events`);
  liveSource.addEventListener('card.created', (event) => {
    const data = JSON.parse((event as MessageEvent).data) as { card: Card; counts: { listId: string; count: number }[] };
    store.applyServerCounts(data.counts);
    store.replaceCard(data.card);
    render();
  });
  liveSource.addEventListener('card.updated', (event) => {
    const data = JSON.parse((event as MessageEvent).data) as { card: Card };
    store.replaceCard(data.card);
    if (dialogState?.kind === 'card' && (dialogState.data as Card).id === data.card.id) {
      dialogState = { kind: 'card', data: data.card };
    }
    render();
  });
  liveSource.addEventListener('card.moved', (event) => {
    const data = JSON.parse((event as MessageEvent).data) as {
      card: Card;
      from: { listId: string; position: number };
      to: { listId: string; position: number };
      mover: { displayName: string; initials: string; colour: string };
      counts: { listId: string; count: number }[];
    };
    const isOwnEcho = recentOwnMoves.has(data.card.id);
    if (isOwnEcho) recentOwnMoves.delete(data.card.id);
    if (liftState && liftState.cardId === data.card.id) {
      const list = store.board.lists.find((l) => l.id === data.card.listId);
      announce(copy.moveCancelled(data.card.title, list?.name ?? '', data.card.position ?? 1, list?.count ?? 1));
    }
    store.applyServerCounts(data.counts);
    store.replaceCard(data.card);
    if (!isOwnEcho) {
      // Only another member's move glides with their chip and sentence.
      store.setChip(data.card.id, {
        userId: '',
        displayName: data.mover.displayName,
        initials: data.mover.initials,
        colour: data.mover.colour,
      });
      const list = store.board.lists.find((l) => l.id === data.card.listId);
      announce(copy.remoteMove(data.mover.displayName, data.card.title, list?.name ?? '', data.card.position ?? 1, list?.count ?? 1));
    }
    void refreshBoards();
    render();
  });
  liveSource.addEventListener('card.removed', (event) => {
    const data = JSON.parse((event as MessageEvent).data) as { cardId: string; counts: { listId: string; count: number }[] };
    if (liftState && liftState.cardId === data.cardId) {
      announce(copy.moveCancelledGone(findCardById(data.cardId)?.title ?? ''));
      liftState = null;
    }
    if (dialogState?.kind === 'card' && (dialogState.data as Card).id === data.cardId) {
      setDialogState(null);
      if (currentRoute.kind === 'card') {
        currentRoute = { kind: 'board', boardId: store.board.boardId ?? '' };
        history.replaceState(null, '', `/boards/${store.board.boardId}`);
      }
    }
    const ownEcho = recentOwnRemoves.has(data.cardId);
    if (ownEcho) recentOwnRemoves.delete(data.cardId);
    store.removeCard(data.cardId);
    store.applyServerCounts(data.counts);
    if (!ownEcho) {
      void refreshBoards();
      render();
    }
  });
  liveSource.addEventListener('list.created', () => {
    void refreshBoard();
  });
  liveSource.addEventListener('list.updated', () => {
    void refreshBoard();
  });
  liveSource.addEventListener('board.updated', () => {
    void refreshBoard();
  });
  liveSource.addEventListener('access.changed', (event) => {
    const data = JSON.parse((event as MessageEvent).data) as { role: string | null };
    if (data.role === null) {
      store.setBoardNotFound();
      render();
      return;
    }
    store.board.role = data.role as Card['status'] extends string ? import('../shared/protocol.js').Role : never;
    store.addNotice(copy.accessChangedRole(data.role));
    void refreshBoard();
    liveSource?.close();
    setTimeout(() => openLiveStream(), 100);
  });
  liveSource.addEventListener('session.ended', () => {
    liveSource?.close();
    liveSource = null;
    const current = location.pathname + location.search;
    location.href = `/signin?next=${encodeURIComponent(current)}`;
  });
  liveSource.addEventListener('live.paused', () => {
    store.setServiceStatus('paused', store.serviceStatus.storage);
    render();
  });
  liveSource.addEventListener('live.resumed', () => {
    store.setServiceStatus('up', store.serviceStatus.storage);
    announce(copy.liveBack);
    void refreshBoard();
    void refreshBoards();
    render();
  });
}

function startTimers(): void {
  if (minuteTimer !== null) return;
  minuteTimer = window.setInterval(() => {
    void refreshBoard();
    void refreshBoards();
  }, 50_000);
  void statusTimer;
  statusTimer = window.setInterval(() => {
    void (async () => {
      const reply = await api.serviceStatus();
      if (isApiError(reply.body)) return;
      const payload = reply.body as { live: string; storage: string };
      const wasPaused = store.serviceStatus.live === 'paused';
      const wasDown = store.serviceStatus.storage === 'down';
      store.setServiceStatus(payload.live, payload.storage);
      if (wasPaused && payload.live === 'up') {
        announce(copy.liveBack);
      }
      if (wasDown !== (payload.storage === 'down')) {
        render();
      }
    })();
  }, 4_000);
  void chipTimer;
  chipTimer = window.setInterval(() => {
    const before = store.chips.size;
    store.pruneChips();
    if (before !== store.chips.size) render();
  }, 500);
}

// ---- Session and boot ---------------------------------------------------------------

async function signOut(): Promise<void> {
  await api.signOut();
  store.discardAll();
  liveSource?.close();
  liveSource = null;
  if (minuteTimer !== null) {
    clearInterval(minuteTimer);
    minuteTimer = null;
  }
  searchBoxText = '';
  selectedListId = null;
  dialogState = null;
  currentRoute = { kind: 'signin' };
  history.replaceState(null, '', '/signin');
  render();
}

async function boot(): Promise<void> {
  currentRoute = parseRoute();
  if (currentRoute.kind === 'signin') {
    render();
    return;
  }
  const meReply = await api.me();
  if (meReply.status === 401) {
    const current = location.pathname + location.search;
    const next = current === '/' ? '' : `?next=${encodeURIComponent(current)}`;
    location.href = `/signin${next}`;
    return;
  }
  const me = meReply.body as {
    userId: string; displayName: string; initials: string; colour: string; email: string;
    workspaces: { id: string; name: string; parentName: string; timeZone: string; role: string }[];
  };
  store.session = { userId: me.userId, displayName: me.displayName, initials: me.initials, colour: me.colour };
  store.workspaces = me.workspaces;
  if (!store.activeWorkspaceId && me.workspaces.length > 0) {
    store.activeWorkspaceId = me.workspaces[0]!.id;
  }
  if (currentRoute.kind === 'root') {
    const boardsReply = await api.workspaceBoards(store.activeWorkspaceId ?? '');
    if (!isApiError(boardsReply.body)) {
      const boards = (boardsReply.body as { boards: import('../shared/protocol.js').BoardSummary[] }).boards;
      store.setBoards(boards);
      const firstVisible = boards.find((b) => b.visibility === 'workspace') ?? boards[0];
      if (firstVisible) {
        history.replaceState(null, '', `/boards/${firstVisible.id}`);
        currentRoute = { kind: 'board', boardId: firstVisible.id };
      }
    }
  }
  if (currentRoute.kind === 'permission-log') {
    const reply = await api.permissionLog(currentRoute.workspaceId);
    if (reply.status === 403) {
      history.replaceState(null, '', '/signin');
      currentRoute = { kind: 'signin' };
      render();
      return;
    }
    if (isApiError(reply.body)) {
      permissionEntries = [];
    } else {
      permissionEntries = (reply.body as { entries: unknown[] }).entries;
    }
    render();
    return;
  }
  if (currentRoute.kind === 'card') {
    const cardReply = await api.getCard(currentRoute.cardId);
    if (cardReply.status === 404) {
      await refreshBoards();
      render();
      const area = appRoot.querySelector('.board-area');
      area?.append(el('div', { class: 'not-found' },
        el('h1', { text: copy.cardNotFoundTitle }),
        el('p', { text: copy.cardNotFoundBody })));
      return;
    }
    const card = (cardReply.body as { card: Card }).card;
    const boardReply = await api.board(card.boardId, card.listId);
    if (boardReply.status === 404) {
      store.setBoardNotFound();
      render();
      return;
    }
    if (!isApiError(boardReply.body)) {
      store.setBoardFromPayload(boardReply.body as import('../shared/protocol.js').BoardPayload);
      selectedListId = card.listId;
    }
    await refreshBoards();
    openDialog('card', card);
    render();
    openLiveStream();
    startTimers();
    return;
  }
  if (currentRoute.kind === 'board') {
    const boardReply = await api.board(currentRoute.boardId);
    if (boardReply.status === 404) {
      store.setBoardNotFound();
      await refreshBoards();
      render();
      return;
    }
    if (isApiError(boardReply.body)) {
      render();
      return;
    }
    store.setBoardFromPayload(boardReply.body as import('../shared/protocol.js').BoardPayload);
    const listParam = currentRoute.listId;
    if (listParam) {
      const known = store.board.lists.some((l) => l.id === listParam);
      if (known) {
        selectedListId = listParam;
      } else {
        history.replaceState(null, '', `/boards/${currentRoute.boardId}`);
      }
    }
    if (!selectedListId && store.board.lists.length > 0) {
      selectedListId = store.board.lists[0]!.id;
    }
    await refreshBoards();
    render();
    openLiveStream();
    startTimers();
    return;
  }
  render();
}

window.addEventListener('popstate', () => {
  void boot();
});

/** A resize moves between the published breakpoints, so the board re-renders. */
let resizeTimer: number | null = null;
window.addEventListener('resize', () => {
  if (resizeTimer !== null) clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    resizeTimer = null;
    render();
  }, 120);
});

/** Escape on any open dialog closes it and returns focus to the control that opened it. */
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (menuElement) {
    event.preventDefault();
    closeMenu();
    rerender();
    return;
  }
  if (!dialogState) return;
  if (event.defaultPrevented) return;
  event.preventDefault();
  const openCard = dialogState.kind === 'card' ? (dialogState.data as Card) : null;
  if (dialogState.kind === 'delete-card-confirm') {
    openDialog('card', dialogState.data as Card);
    return;
  }
  closeCardDialog(openCard);
});

boot();
