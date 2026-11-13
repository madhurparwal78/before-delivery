import { ANNOUNCE } from '../shared/copy';
import { cardFocusKey, moveCard } from './actions';
import {
  announce,
  applyCard,
  cardOf,
  focusAfterRender,
  listOf,
  listOfCard,
  requestRender,
  state,
  type Lift,
} from './store';

const DRAG_THRESHOLD = 4;
const TOUCH_HOLD_MS = 500;

function totalFor(listId: string, originListId: string): number {
  const list = listOf(listId);
  if (list === null) return 1;
  const count = list.cards.length;
  return listId === originListId ? Math.max(count, 1) : count + 1;
}

function overAnnouncement(lift: Lift): void {
  const card = cardOf(lift.cardId);
  const list = listOf(lift.listId);
  if (card === null || list === null) return;
  announce(ANNOUNCE.over(card.title, list.name, lift.position, totalFor(lift.listId, lift.originListId)));
}

export function liftByKeyboard(cardId: string): void {
  const card = cardOf(cardId);
  const list = listOfCard(cardId);
  if (card === null || list === null) return;
  const position = card.position ?? 1;
  state.lift = {
    cardId,
    mode: 'keyboard',
    originListId: list.id,
    originPosition: position,
    listId: list.id,
    position,
    pointerX: 0,
    pointerY: 0,
    grabX: 0,
    grabY: 0,
  };
  announce(ANNOUNCE.keyboardLift(card.title, list.name, position, totalFor(list.id, list.id)));
  focusAfterRender(cardFocusKey(cardId));
  requestRender();
}

export function moveLift(direction: 'up' | 'down' | 'left' | 'right'): void {
  const lift = state.lift;
  const lists = state.board?.lists ?? [];
  if (lift === null || lists.length === 0) return;
  if (direction === 'up' || direction === 'down') {
    const total = totalFor(lift.listId, lift.originListId);
    const next = direction === 'up' ? lift.position - 1 : lift.position + 1;
    lift.position = Math.min(Math.max(next, 1), total);
  } else {
    const index = lists.findIndex((list) => list.id === lift.listId);
    const nextIndex = direction === 'left' ? index - 1 : index + 1;
    const target = lists[nextIndex];
    if (target === undefined) return;
    lift.listId = target.id;
    const total = totalFor(target.id, lift.originListId);
    lift.position = Math.min(lift.position, total);
    state.selectedListId = target.id;
  }
  overAnnouncement(lift);
  requestRender();
}

export function cancelLift(): void {
  const lift = state.lift;
  if (lift === null) return;
  state.lift = null;
  const card = cardOf(lift.cardId);
  const list = listOf(lift.originListId);
  if (card !== null && list !== null) {
    announce(ANNOUNCE.cancelled(card.title, list.name, lift.originPosition, totalFor(list.id, list.id)));
  }
  requestRender();
}

export async function dropLift(): Promise<void> {
  const lift = state.lift;
  if (lift === null) return;
  if (lift.listId === lift.originListId && lift.position === lift.originPosition) {
    cancelLift();
    focusAfterRender(cardFocusKey(lift.cardId));
    return;
  }
  state.lift = null;
  const card = cardOf(lift.cardId);
  if (card !== null) applyCard({ ...card, listId: lift.listId, position: lift.position });
  requestRender();
  await moveCard(lift.cardId, lift.listId, lift.position, { focusCard: true });
}

/** A remote change to the lifted card cancels the lift before the remote sentence is announced. */
export function cancelLiftForRemote(cardId: string): string[] {
  const lift = state.lift;
  if (lift === null || lift.cardId !== cardId) return [];
  state.lift = null;
  const card = cardOf(cardId);
  if (card === null) return [];
  const list = listOf(card.listId);
  if (list === null) return [];
  return [ANNOUNCE.cancelled(card.title, list.name, card.position ?? 1, list.cards.length)];
}

export function cancelLiftForRemoval(cardId: string, title: string): string[] {
  const lift = state.lift;
  if (lift === null || lift.cardId !== cardId) return [];
  state.lift = null;
  return [ANNOUNCE.cancelledGone(title)];
}

interface PointerTracking {
  cardId: string;
  pointerId: number;
  startX: number;
  startY: number;
  lifted: boolean;
  touch: boolean;
  holdTimer: number | null;
}

let tracking: PointerTracking | null = null;

function targetFromPoint(x: number, y: number): { listId: string; position: number } | null {
  const lift = state.lift;
  if (lift === null) return null;
  const columns = document.querySelectorAll<HTMLElement>('[data-list-id]');
  for (const column of columns) {
    const rect = column.getBoundingClientRect();
    const listId = column.dataset['listId'];
    if (listId === undefined) continue;
    if (x < rect.left || x > rect.right) continue;
    const cards = [...column.querySelectorAll<HTMLElement>('[data-card-id]')].filter(
      (node) => node.dataset['cardId'] !== lift.cardId,
    );
    let position = cards.length + 1;
    for (let index = 0; index < cards.length; index += 1) {
      const cardRect = (cards[index] as HTMLElement).getBoundingClientRect();
      if (y < cardRect.top + cardRect.height / 2) {
        position = index + 1;
        break;
      }
    }
    const total = totalFor(listId, lift.originListId);
    return { listId, position: Math.min(position, total) };
  }
  return null;
}

function beginPointerLift(cardId: string, x: number, y: number): void {
  const card = cardOf(cardId);
  const list = listOfCard(cardId);
  if (card === null || list === null) return;
  state.lift = {
    cardId,
    mode: 'pointer',
    originListId: list.id,
    originPosition: card.position ?? 1,
    listId: list.id,
    position: card.position ?? 1,
    pointerX: x,
    pointerY: y,
    grabX: x,
    grabY: y,
  };
  announce(ANNOUNCE.pointerLift(card.title));
  requestRender();
}

let suppressClickUntil = 0;

/** The click that follows a drag must not open the card. */
export function takeSuppressedClick(): boolean {
  return Date.now() < suppressClickUntil;
}

export function startPointerDrag(cardId: string, event: PointerEvent): void {
  if (event.button !== 0 && event.pointerType === 'mouse') return;
  const touch = event.pointerType === 'touch';
  tracking = {
    cardId,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    lifted: false,
    touch,
    holdTimer: null,
  };
  if (touch) {
    const current = tracking;
    current.holdTimer = window.setTimeout(() => {
      if (tracking !== current) return;
      current.lifted = true;
      beginPointerLift(cardId, current.startX, current.startY);
    }, TOUCH_HOLD_MS);
  }

  const onMove = (move: PointerEvent): void => {
    if (tracking === null || move.pointerId !== tracking.pointerId) return;
    const distance = Math.hypot(move.clientX - tracking.startX, move.clientY - tracking.startY);
    if (!tracking.lifted) {
      if (tracking.touch || distance <= DRAG_THRESHOLD) return;
      tracking.lifted = true;
      beginPointerLift(tracking.cardId, move.clientX, move.clientY);
    }
    const lift = state.lift;
    if (lift === null) return;
    lift.pointerX = move.clientX;
    lift.pointerY = move.clientY;
    const target = targetFromPoint(move.clientX, move.clientY);
    if (target !== null && (target.listId !== lift.listId || target.position !== lift.position)) {
      lift.listId = target.listId;
      lift.position = target.position;
      overAnnouncement(lift);
    }
    requestRender();
  };

  const finish = (): void => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    const current = tracking;
    tracking = null;
    if (current === null) return;
    if (current.holdTimer !== null) window.clearTimeout(current.holdTimer);
    if (!current.lifted) return;
    suppressClickUntil = Date.now() + 300;
    void dropLift();
  };

  const onUp = (up: PointerEvent): void => {
    if (tracking !== null && up.pointerId !== tracking.pointerId) return;
    finish();
  };
  const onCancel = (): void => {
    cancelLift();
    suppressClickUntil = Date.now() + 300;
    finish();
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
}
