import { COPY, countCopy, openCountCopy } from '../../shared/copy';
import type { CardPayload, ListPayload } from '../../shared/types';
import {
  addCard,
  addCardFocusKey,
  addList,
  cardFocusKey,
  loadSettings,
  readBoard,
  selectList,
  setStatus,
} from '../actions';
import { startPointerDrag, takeSuppressedClick } from '../dnd';
import { el } from '../lib/dom';
import {
  canEdit,
  dismissNotice,
  isBoardAdmin,
  isPhone,
  isWorkspaceAdmin,
  requestRender,
  selectedLists,
  showsListSwitcher,
  state,
} from '../store';
import { openCard } from '../navigation';
import { renderSearch } from './search';
import { dotsIcon, lockIcon, personChip } from './parts';

const regionId = (listId: string): string => `list-region-${listId}`;

function dueLabel(card: CardPayload): HTMLElement | null {
  if (card.dueState === 'due_today') return el('span', { class: 'due due-today', text: 'Due today' });
  if (card.dueState === 'overdue') return el('span', { class: 'due due-overdue', text: 'Overdue' });
  return null;
}

function cardFace(card: CardPayload): HTMLElement {
  const mover = state.movers.get(card.id);
  const lifted = state.lift?.cardId === card.id;
  const classes = ['card'];
  if (lifted) classes.push('lifted');
  if (mover !== undefined) classes.push('moved', `tint-${mover.colour}`);
  if (mover?.fading === true) classes.push('fading');
  if (card.status === 'done') classes.push('done');

  const item = el('li', { class: classes.join(' '), attrs: { 'data-card-id': card.id } });
  const titleButton = el('button', {
    class: 'card-title',
    text: card.title,
    focusKey: cardFocusKey(card.id),
    attrs: { type: 'button' },
    on: {
      pointerdown: (event: PointerEvent) => {
        if (canEdit()) startPointerDrag(card.id, event);
      },
      click: () => {
        if (takeSuppressedClick()) return;
        openCard(card.id);
      },
    },
  });
  const head = el('div', { class: 'card-head' }, [titleButton]);
  if (canEdit()) {
    head.append(
      el(
        'button',
        {
          class: 'card-actions',
          focusKey: `actions:${card.id}`,
          attrs: {
            type: 'button',
            'aria-label': `Actions for ${card.title}`,
            'aria-haspopup': 'menu',
            'aria-expanded': state.menu?.kind === 'cardActions' && state.menu.cardId === card.id ? 'true' : 'false',
          },
          on: {
            click: () => {
              state.menu = { kind: 'cardActions', cardId: card.id };
              state.pendingFocus = 'menu:first';
              requestRender();
            },
          },
        },
        [dotsIcon()],
      ),
    );
  }
  item.append(head);

  const meta = el('div', { class: 'card-meta' });
  for (const label of card.labels) meta.append(el('span', { class: 'tag', text: label }));
  const due = dueLabel(card);
  if (due !== null) meta.append(due);
  if (card.owner !== null) {
    meta.append(personChip(`Owner ${card.owner.displayName}`, card.owner.initials, card.owner.colour, 'owner'));
  }
  if (card.isPrivate === true) meta.append(lockIcon());
  if (card.checklist.length > 0) {
    const done = card.checklist.filter((checklistItem) => checklistItem.done).length;
    meta.append(el('span', { class: 'progress', text: `${done}/${card.checklist.length}` }));
  }
  if (card.status === 'done') meta.append(el('span', { class: 'done-mark', text: 'Done' }));
  if (mover !== undefined) {
    meta.append(personChip(`Moved by ${mover.displayName}`, mover.initials, mover.colour, 'mover'));
  }
  if (meta.childElementCount > 0) item.append(meta);
  return item;
}

function placeholder(): HTMLElement {
  return el('li', { class: 'placeholder', attrs: { 'aria-hidden': 'true' } });
}

interface Slot {
  kind: 'card' | 'placeholder';
  card?: CardPayload;
}

function slotsFor(list: ListPayload): Slot[] {
  const lift = state.lift;
  const slots: Slot[] = list.cards
    .filter((card) => lift === null || card.id !== lift.cardId)
    .map((card) => ({ kind: 'card' as const, card }));
  if (lift === null) return slots;
  if (list.id === lift.originListId) {
    const index = Math.min(Math.max(lift.originPosition - 1, 0), slots.length);
    slots.splice(index, 0, { kind: 'placeholder' });
  }
  if (list.id === lift.listId) {
    const card = list.cards.find((entry) => entry.id === lift.cardId) ?? findCard(lift.cardId);
    if (card !== null) {
      const index = Math.min(Math.max(lift.position - 1, 0), slots.length);
      slots.splice(index, 0, { kind: 'card', card });
    }
  }
  return slots;
}

function findCard(cardId: string): CardPayload | null {
  for (const list of state.board?.lists ?? []) {
    const card = list.cards.find((entry) => entry.id === cardId);
    if (card !== undefined) return card;
  }
  return null;
}

function listColumn(list: ListPayload): HTMLElement {
  const section = el('section', {
    class: 'list',
    attrs: { role: 'region', 'aria-label': list.name, id: regionId(list.id), 'data-list-id': list.id },
  });
  section.append(el('h3', { class: 'list-name', text: list.name }));
  section.append(el('div', { class: 'rule' }));
  section.append(el('p', { class: 'count', text: countCopy(list.count) }));

  const cards = el('ul', { class: 'cards', attrs: { 'aria-label': `${list.name} cards` } });
  const slots = slotsFor(list);
  for (const slot of slots) {
    cards.append(slot.kind === 'placeholder' || slot.card === undefined ? placeholder() : cardFace(slot.card));
  }
  section.append(cards);
  if (list.cards.length === 0) section.append(el('p', { class: 'empty', text: COPY.emptyList }));

  if (canEdit()) {
    const draft = state.cardDraft;
    if (draft !== null && draft.listId === list.id) {
      const field = el('input', {
        class: 'field',
        focusKey: `newcard:${list.id}`,
        attrs: { type: 'text', 'aria-label': 'New card title', value: draft.value },
        on: {
          input: (event: Event) => {
            const input = event.target as HTMLInputElement;
            if (state.cardDraft !== null) state.cardDraft.value = input.value;
          },
          keydown: (event: KeyboardEvent) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              const value = (event.target as HTMLInputElement).value;
              void addCard(list.id, value);
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              state.cardDraft = null;
              state.pendingFocus = addCardFocusKey(list.id);
              requestRender();
            }
          },
        },
      });
      section.append(field);
      if (draft.error !== null) section.append(el('p', { class: 'field-error', text: draft.error }));
    } else {
      section.append(
        el('button', {
          class: 'add-card',
          text: `Add a card to ${list.name}`,
          focusKey: addCardFocusKey(list.id),
          attrs: { type: 'button' },
          on: {
            click: () => {
              state.cardDraft = { listId: list.id, value: '', error: null };
              state.pendingFocus = `newcard:${list.id}`;
              requestRender();
            },
          },
        }),
      );
    }
  }
  return section;
}

function listSwitcher(): HTMLElement {
  const tablist = el('div', { class: 'tabs', attrs: { role: 'tablist', 'aria-label': 'Lists' } });
  for (const list of state.board?.lists ?? []) {
    const selected = list.id === state.selectedListId;
    tablist.append(
      el('button', {
        class: `tab${selected ? ' selected' : ''}`,
        text: list.name,
        focusKey: `tab:${list.id}`,
        attrs: {
          type: 'button',
          role: 'tab',
          'aria-selected': selected ? 'true' : 'false',
          'aria-controls': regionId(list.id),
          tabindex: selected ? '0' : '-1',
        },
        on: { click: () => selectList(list.id) },
      }),
    );
  }
  return tablist;
}

function addListControl(): HTMLElement {
  const draft = state.listNameDraft;
  const wrap = el('div', { class: 'add-list' });
  if (draft !== null && draft.open) {
    wrap.append(
      el('input', {
        class: 'field',
        focusKey: 'newlist',
        attrs: { type: 'text', 'aria-label': 'New list name', value: draft.value },
        on: {
          input: (event: Event) => {
            if (state.listNameDraft !== null) state.listNameDraft.value = (event.target as HTMLInputElement).value;
          },
          keydown: (event: KeyboardEvent) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void addList((event.target as HTMLInputElement).value);
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              state.listNameDraft = null;
              state.pendingFocus = 'addlist';
              requestRender();
            }
          },
        },
      }),
    );
    if (draft.error !== null) wrap.append(el('p', { class: 'field-error', text: draft.error }));
    return wrap;
  }
  wrap.append(
    el('button', {
      class: 'add-list-button',
      text: 'Add a list',
      focusKey: 'addlist',
      attrs: { type: 'button' },
      on: {
        click: () => {
          state.listNameDraft = { open: true, value: '', error: null };
          state.pendingFocus = 'newlist';
          requestRender();
        },
      },
    }),
  );
  return wrap;
}

export function renderDrawer(): HTMLElement {
  const nav = el('nav', { class: 'drawer', attrs: { 'aria-label': 'Boards' } });
  const list = el('ul', { class: 'board-links' });
  for (const board of state.boards) {
    const link = el('a', {
      text: board.name,
      focusKey: `boardlink:${board.id}`,
      attrs: {
        href: `/boards/${board.id}`,
        ...(board.id === state.boardId ? { 'aria-current': 'page' } : {}),
      },
      on: {
        click: (event: MouseEvent) => {
          event.preventDefault();
          state.dialog = null;
          void openBoard(board.id);
        },
      },
    });
    list.append(
      el('li', {}, [link, el('span', { class: 'open-count', text: openCountCopy(board.openCards) })]),
    );
  }
  nav.append(list);
  if (isWorkspaceAdmin()) {
    nav.append(
      el('button', {
        class: 'new-board',
        text: 'New board',
        focusKey: 'newboard',
        attrs: { type: 'button' },
        on: {
          click: () => {
            state.dialog = { kind: 'newBoard', name: '', visibility: 'private', error: null, pending: false };
            state.pendingFocus = 'dlg:boardName';
            requestRender();
          },
        },
      }),
    );
  }
  return nav;
}

async function openBoard(boardId: string): Promise<void> {
  const [{ push, boardPath }, { connectLive }] = await Promise.all([import('../router'), import('../live')]);
  state.selectedListId = null;
  push(boardPath(boardId, null));
  const loaded = await readBoard(boardId, { select: null });
  if (loaded) connectLive(boardId);
}

function serviceBanner(): HTMLElement {
  const banner = el('div', { class: 'banner', attrs: { role: 'status', 'aria-label': 'Service status' } });
  if (state.status.live === 'paused') banner.append(el('p', { text: COPY.livePaused }));
  if (state.status.storage === 'down') banner.append(el('p', { text: COPY.storageDown }));
  return banner;
}

function noticesRegion(): HTMLElement {
  const region = el('div', { class: 'notices', attrs: { role: 'region', 'aria-label': 'Notices' } });
  for (const notice of state.notices) {
    region.append(
      el('div', { class: 'notice' }, [
        el('p', { text: notice.text }),
        el('button', {
          class: 'dismiss',
          text: 'Dismiss notice',
          focusKey: `dismiss:${notice.id}`,
          attrs: { type: 'button' },
          on: { click: () => dismissNotice(notice.id) },
        }),
      ]),
    );
  }
  return region;
}

function announcements(): HTMLElement {
  const region = el('div', {
    class: 'visually-hidden',
    attrs: { role: 'status', 'aria-live': 'polite', 'aria-label': 'Board announcements' },
  });
  for (const sentence of state.announcements) region.append(el('p', { text: sentence }));
  return region;
}

export function renderTopBar(): HTMLElement {
  const bar = el('header', { class: 'topbar' });
  const parentName = state.board?.board.parentName ?? state.workspace?.parentName ?? '';
  bar.append(el('h1', { class: 'masthead', text: parentName }));
  if (isPhone()) {
    bar.append(
      el('button', {
        class: 'boards-button',
        text: 'Boards',
        focusKey: 'boards',
        attrs: {
          type: 'button',
          'aria-expanded': state.dialog?.kind === 'boardsSheet' ? 'true' : 'false',
        },
        on: {
          click: () => {
            state.dialog = state.dialog?.kind === 'boardsSheet' ? null : { kind: 'boardsSheet' };
            state.pendingFocus = state.dialog === null ? 'boards' : 'sheet:first';
            requestRender();
          },
        },
      }),
    );
  }
  bar.append(renderSearch());
  bar.append(
    el('button', {
      class: 'account',
      text: 'Account',
      focusKey: 'account',
      attrs: {
        type: 'button',
        'aria-haspopup': 'menu',
        'aria-expanded': state.menu?.kind === 'account' ? 'true' : 'false',
      },
      on: {
        click: () => {
          state.menu = state.menu?.kind === 'account' ? null : { kind: 'account' };
          state.pendingFocus = state.menu === null ? 'account' : 'menu:first';
          requestRender();
        },
      },
    }),
  );
  return bar;
}

function boardHeader(): HTMLElement {
  const header = el('div', { class: 'board-header' });
  header.append(el('h2', { class: 'board-name', text: state.board?.board.name ?? '' }));
  if (isBoardAdmin()) {
    header.append(
      el('button', {
        class: 'board-settings',
        text: 'Board settings',
        focusKey: 'settings',
        attrs: { type: 'button' },
        on: {
          click: () => {
            state.dialog = { kind: 'settings', error: null, addUserId: '' };
            state.settings = null;
            state.pendingFocus = 'dlg:visibility';
            requestRender();
            void loadSettings();
          },
        },
      }),
    );
  }
  header.append(
    el('button', {
      class: 'shortcuts',
      text: 'Keyboard shortcuts',
      focusKey: 'shortcuts',
      attrs: { type: 'button' },
      on: {
        click: () => {
          state.dialog = { kind: 'shortcuts' };
          state.pendingFocus = 'dlg:close';
          requestRender();
        },
      },
    }),
  );
  return header;
}

export function renderBoardScreen(): DocumentFragment {
  const fragment = document.createDocumentFragment();
  fragment.append(renderTopBar());
  fragment.append(serviceBanner());
  const shell = el('div', { class: 'shell' });
  shell.append(renderDrawer());
  const main = el('main', { class: 'board' });
  main.append(boardHeader());
  main.append(noticesRegion());
  if (state.board !== null) {
    const lists = state.board.lists;
    if (showsListSwitcher() && lists.length > 0) main.append(listSwitcher());
    if (lists.length === 0) {
      main.append(el('p', { class: 'empty-board', text: COPY.noLists }));
      if (isBoardAdmin()) main.append(addListControl());
    } else {
      const row = el('div', { class: 'lists' });
      for (const list of selectedLists()) row.append(listColumn(list));
      if (isBoardAdmin() && window.innerWidth >= 1200) row.append(addListControl());
      main.append(row);
      if (isBoardAdmin() && window.innerWidth < 1200) main.append(addListControl());
    }
  }
  shell.append(main);
  fragment.append(shell);
  fragment.append(announcements());
  return fragment;
}

export function renderNotFound(kind: 'board' | 'card'): DocumentFragment {
  const fragment = document.createDocumentFragment();
  fragment.append(renderTopBar());
  fragment.append(serviceBanner());
  const shell = el('div', { class: 'shell' });
  shell.append(renderDrawer());
  const main = el('main', { class: 'board' });
  main.append(
    el('h1', {
      class: 'not-found-heading',
      text: kind === 'board' ? COPY.boardNotFoundHeading : COPY.cardNotFoundHeading,
    }),
  );
  main.append(el('p', { text: kind === 'board' ? COPY.boardNotFoundBody : COPY.cardNotFoundBody }));
  shell.append(main);
  fragment.append(shell);
  fragment.append(announcements());
  return fragment;
}

export function statusMenuAction(cardId: string, status: 'open' | 'done' | 'archived'): void {
  state.menu = null;
  void setStatus(cardId, status);
}
