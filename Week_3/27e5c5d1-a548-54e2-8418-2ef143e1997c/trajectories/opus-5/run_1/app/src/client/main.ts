import type { CardPayload } from '../shared/types';
import { cardFocusKey, firstBoardId, loadBoards, loadSession, readBoard } from './actions';
import { cancelLift, dropLift, liftByKeyboard, moveLift } from './dnd';
import { call, failureOf, handleSignedOut } from './lib/api';
import { connectLive, startBackground } from './live';
import { emptyCardDialog, openCard } from './navigation';
import { boardPath, onNavigate, readAddress, replace } from './router';
import { render } from './render/app';
import { closeTopLayer, menuOpenerKey } from './render/dialogs';
import { readSignedOutNotice } from './render/signin';
import { openPermissionLog } from './render/log';
import { goToSignIn } from './session';
import { focusKeyOf } from './lib/dom';
import { onRender, requestRender, state } from './store';

function isTextField(node: Element | null): boolean {
  if (node === null) return false;
  const tag = node.tagName;
  return tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'INPUT';
}

function focusableIn(root: Element): HTMLElement[] {
  return [
    ...root.querySelectorAll<HTMLElement>(
      'button, a[href], select, textarea, input:not([type="hidden"]):not([tabindex="-1"])',
    ),
  ].filter((node) => !node.hasAttribute('disabled') && node.getAttribute('aria-hidden') !== 'true');
}

function handleMenuKeys(event: KeyboardEvent): boolean {
  if (state.menu === null) return false;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeTopLayer();
    return true;
  }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return false;
  const items = [...document.querySelectorAll<HTMLElement>('.menu .menu-item')];
  if (items.length === 0) return false;
  const index = items.findIndex((item) => item === document.activeElement);
  const nextIndex = event.key === 'ArrowDown' ? index + 1 : index - 1;
  items[(nextIndex + items.length) % items.length]?.focus();
  event.preventDefault();
  return true;
}

function handleDialogKeys(event: KeyboardEvent): boolean {
  if (state.dialog === null) return false;
  const dialog = document.querySelector<HTMLElement>('.dialog');
  if (dialog === null) return false;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeTopLayer();
    return true;
  }
  if (event.key !== 'Tab') return false;
  const items = focusableIn(dialog);
  if (items.length === 0) return false;
  const first = items[0] as HTMLElement;
  const last = items[items.length - 1] as HTMLElement;
  const active = document.activeElement;
  if (active === null || !dialog.contains(active)) {
    event.preventDefault();
    first.focus();
    return true;
  }
  if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
    return true;
  }
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
    return true;
  }
  return false;
}

function handleLiftKeys(event: KeyboardEvent): boolean {
  if (state.lift === null) return false;
  switch (event.key) {
    case ' ':
    case 'Spacebar':
    case 'Enter':
      event.preventDefault();
      void dropLift();
      return true;
    case 'ArrowUp':
      event.preventDefault();
      moveLift('up');
      return true;
    case 'ArrowDown':
      event.preventDefault();
      moveLift('down');
      return true;
    case 'ArrowLeft':
      event.preventDefault();
      moveLift('left');
      return true;
    case 'ArrowRight':
      event.preventDefault();
      moveLift('right');
      return true;
    case 'Escape':
      event.preventDefault();
      cancelLift();
      return true;
    case 'Tab':
      cancelLift();
      return false;
    default:
      return false;
  }
}

function onKeyDown(event: KeyboardEvent): void {
  if (handleMenuKeys(event)) return;
  if (handleDialogKeys(event)) return;
  if (handleLiftKeys(event)) return;
  const key = focusKeyOf(document.activeElement);
  if (key !== null && key.startsWith('card:')) {
    const cardId = key.slice('card:'.length);
    if (event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      liftByKeyboard(cardId);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      openCard(cardId);
      return;
    }
  }
  if (event.key === '?' && !isTextField(document.activeElement)) {
    event.preventDefault();
    state.dialog = { kind: 'shortcuts' };
    state.pendingFocus = 'dlg:close';
    requestRender();
  }
}

function onDocumentClick(event: MouseEvent): void {
  const menu = state.menu;
  if (menu === null) return;
  const target = event.target as Element | null;
  if (target !== null && target.closest('.menu') !== null) return;
  if (target !== null && focusKeyOf(target.closest('[data-fk]')) === menuOpenerKey(menu)) return;
  state.menu = null;
  requestRender();
}

function findLocalCard(cardId: string): CardPayload | null {
  for (const list of state.board?.lists ?? []) {
    const card = list.cards.find((entry) => entry.id === cardId);
    if (card !== undefined) return card;
  }
  return null;
}

async function routeToCard(cardId: string): Promise<void> {
  const local = findLocalCard(cardId);
  if (local !== null) {
    state.selectedListId = local.listId;
    emptyCardDialog(cardId, false);
    return;
  }
  try {
    const reply = await call<{ card: CardPayload }>(`/api/cards/${cardId}`);
    const loaded = await readBoard(reply.card.boardId, { select: reply.card.listId });
    if (!loaded) return;
    connectLive(reply.card.boardId);
    emptyCardDialog(cardId, false);
  } catch (error) {
    const failure = failureOf(error);
    if (failure !== null && failure.status === 404) {
      state.screen = 'cardNotFound';
      state.dialog = null;
      requestRender();
      return;
    }
    throw error;
  }
}

async function route(): Promise<void> {
  const address = readAddress();
  if (address.kind === 'signin') {
    state.screen = 'signin';
    state.signIn.next = address.next ?? null;
    readSignedOutNotice();
    requestRender();
    return;
  }
  const me = state.me ?? (await loadSession());
  if (me === null) {
    goToSignIn();
    return;
  }
  await loadBoards();
  startBackground();

  if (address.kind === 'permissionLog') {
    await openPermissionLog(address.workspaceId);
    return;
  }
  if (address.kind === 'card') {
    await routeToCard(address.cardId as string);
    return;
  }
  if (state.dialog?.kind === 'card') {
    const previous = state.dialog.cardId;
    state.dialog = null;
    state.pendingFocus = cardFocusKey(previous);
  }
  const boardId = address.kind === 'board' ? (address.boardId as string) : firstBoardId();
  if (boardId === null) {
    state.screen = 'boardNotFound';
    requestRender();
    return;
  }
  const wanted = address.listId ?? state.selectedListId;
  const loaded = await readBoard(boardId, { select: wanted ?? null });
  if (!loaded) return;
  connectLive(boardId);
  if (window.innerWidth < 1200 && state.selectedListId !== null && address.listId !== state.selectedListId) {
    replace(boardPath(address.kind === 'board' ? boardId : null, state.selectedListId));
  }
}

function boot(): void {
  onRender(render);
  handleSignedOut(() => goToSignIn());
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('click', onDocumentClick);
  window.addEventListener('resize', () => requestRender());
  onNavigate(() => void route());
  window.addEventListener('pageshow', (event) => {
    if (!(event as PageTransitionEvent).persisted) return;
    document.getElementById('app')?.replaceChildren();
    state.screen = 'loading';
    state.me = null;
    void route();
  });
  void route();
}

boot();
