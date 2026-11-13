import type { BoardMemberPayload } from '../shared/types';
import { cardFocusKey } from './actions';
import { call } from './lib/api';
import { boardPath, push, replace } from './router';
import { canEdit, cardOf, requestRender, state } from './store';

export function emptyCardDialog(cardId: string, openedViaPush: boolean): void {
  state.dialog = {
    kind: 'card',
    cardId,
    drafts: {},
    labelDraft: null,
    message: null,
    pending: false,
    fieldErrors: {},
    openedViaPush,
    uploads: [],
  };
  state.pendingFocus = canEdit() ? 'dlg:title' : 'dlg:close';
  requestRender();
  void loadBoardMembers();
}

export async function loadBoardMembers(): Promise<void> {
  if (state.boardId === null) return;
  try {
    const reply = await call<{ members: BoardMemberPayload[] }>(`/api/boards/${state.boardId}/members`);
    state.boardMembers = reply.members;
    requestRender();
  } catch {
    state.boardMembers = [];
  }
}

export function openCard(cardId: string): void {
  push(`/cards/${cardId}`);
  emptyCardDialog(cardId, true);
}

export function closeCardDialog(): void {
  const dialog = state.dialog;
  if (dialog?.kind !== 'card') return;
  if (dialog.openedViaPush) {
    window.history.back();
    return;
  }
  const card = cardOf(dialog.cardId);
  replace(boardPath(state.boardId, card?.listId ?? state.selectedListId ?? null));
  state.dialog = null;
  state.pendingFocus = cardFocusKey(dialog.cardId);
  requestRender();
}
