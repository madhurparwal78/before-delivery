import { ANNOUNCE, COPY, accessChangedCopy, displayFilename, uploadCopy } from '../shared/copy';
import type {
  AttachmentPayload,
  BoardListEntry,
  BoardMemberPayload,
  BoardReadPayload,
  BoardRole,
  CardPayload,
  CardWriteReply,
  ChecklistItem,
  ListPayload,
  MePayload,
  Visibility,
  WorkspacePayload,
} from '../shared/types';
import { call, failureOf, upload, type ApiFailure } from './lib/api';
import { boardPath, push, replace } from './router';
import {
  addNotice,
  announce,
  applyCard,
  applyCounts,
  applyOpenCards,
  cardOf,
  focusAfterRender,
  listOf,
  listOfCard,
  recountOpenCards,
  removeCard,
  requestRender,
  state,
} from './store';

export const cardFocusKey = (cardId: string): string => `card:${cardId}`;
export const addCardFocusKey = (listId: string): string => `addcard:${listId}`;

function roleLabel(role: BoardRole): 'Admin' | 'Member' | 'Observer' {
  if (role === 'admin') return 'Admin';
  return role === 'member' ? 'Member' : 'Observer';
}

export async function loadSession(): Promise<MePayload | null> {
  try {
    const me = await call<MePayload>('/api/me', { allowSignedOut: true });
    state.me = me;
    state.workspace = (me.workspaces[0] as WorkspacePayload | undefined) ?? null;
    return me;
  } catch {
    return null;
  }
}

export async function loadBoards(): Promise<void> {
  if (state.workspace === null) return;
  const reply = await call<{ boards: BoardListEntry[] }>(`/api/workspaces/${state.workspace.id}/boards`);
  state.boards = reply.boards;
}

export function firstBoardId(): string | null {
  const shared = state.boards.find((board) => board.visibility === 'workspace');
  return (shared ?? state.boards[0])?.id ?? null;
}

/** Reads the board again and merges it, keeping drafts, notices, selection and focus. */
export async function readBoard(boardId: string, options: { select?: string | null } = {}): Promise<boolean> {
  try {
    const reply = await call<BoardReadPayload>(`/api/boards/${boardId}`);
    const previousLift = state.lift;
    const liftTitle = previousLift === null ? null : (cardOf(previousLift.cardId)?.title ?? null);
    state.board = reply;
    state.boardId = boardId;
    state.workspace =
      state.me?.workspaces.find((workspace) => workspace.id === reply.board.workspaceId) ?? state.workspace;
    const wanted = options.select !== undefined ? options.select : state.selectedListId;
    const exists = reply.lists.some((list) => list.id === wanted);
    state.selectedListId = exists ? (wanted as string) : (reply.lists[0]?.id ?? null);
    if (previousLift !== null) {
      const card = cardOf(previousLift.cardId);
      if (card === null) {
        state.lift = null;
        if (liftTitle !== null) announce(ANNOUNCE.cancelledGone(liftTitle));
      } else if (card.listId !== previousLift.originListId || card.position !== previousLift.originPosition) {
        const list = listOf(card.listId);
        state.lift = null;
        announce(ANNOUNCE.cancelled(card.title, list?.name ?? '', card.position ?? 1, list?.count ?? 1));
      }
    }
    state.screen = 'board';
    requestRender();
    return true;
  } catch (error) {
    const failure = failureOf(error);
    if (failure !== null && failure.status === 404) {
      state.board = null;
      state.boardId = boardId;
      state.screen = 'boardNotFound';
      requestRender();
      return false;
    }
    throw error;
  }
}

export async function refreshBoardAndBoards(): Promise<void> {
  if (state.boardId === null) return;
  await Promise.all([readBoard(state.boardId), loadBoards()]);
  requestRender();
}

export function selectList(listId: string): void {
  state.selectedListId = listId;
  replace(boardPath(state.boardId, listId));
  requestRender();
}

function noticeFor(failure: ApiFailure, title: string | null): void {
  if (failure.status === 503) {
    addNotice(COPY.deleteBlockedByStorage);
    return;
  }
  if (failure.status === 403) {
    addNotice(COPY.lockedEdit);
    return;
  }
  if (failure.status === 404 && title !== null) {
    handleHiddenCard(title);
    return;
  }
  addNotice(COPY.genericFailure);
}

/** A write that meets a card the person may no longer see. */
export function handleHiddenCard(title: string, cardId?: string): void {
  if (cardId !== undefined) removeCard(cardId);
  if (state.dialog?.kind === 'card' && (cardId === undefined || state.dialog.cardId === cardId)) {
    state.dialog = null;
  }
  recountOpenCards();
  announce(ANNOUNCE.notShared(title));
  addNotice(ANNOUNCE.notShared(title));
  requestRender();
}

function applyStale(failure: ApiFailure, fallbackTitle: string): void {
  const card = failure.payload['card'] as CardPayload | undefined;
  const changedBy = failure.payload['changedBy'] as { displayName: string } | undefined;
  const change = failure.payload['change'] as 'moved' | 'edited' | undefined;
  if (card === undefined) {
    addNotice(COPY.genericFailure);
    return;
  }
  applyCard(card);
  const list = listOf(card.listId);
  const sentence =
    change === 'moved'
      ? ANNOUNCE.staleMoved(
          changedBy?.displayName ?? '',
          card.title || fallbackTitle,
          list?.name ?? '',
          card.position ?? 1,
          list?.count ?? list?.cards.length ?? 1,
        )
      : ANNOUNCE.staleEdited(
          changedBy?.displayName ?? '',
          card.title || fallbackTitle,
          list?.name ?? '',
          card.position ?? 1,
          list?.count ?? list?.cards.length ?? 1,
        );
  announce(sentence);
  addNotice(sentence);
  requestRender();
}

export async function addCard(listId: string, title: string): Promise<void> {
  const list = listOf(listId);
  if (list === null) return;
  state.cardDraft = { listId, value: title, error: null };
  try {
    const reply = await call<CardWriteReply>(`/api/lists/${listId}/cards`, {
      method: 'POST',
      body: { title },
      headers: { 'Idempotency-Key': `card-${Date.now()}-${Math.random().toString(36).slice(2)}` },
    });
    applyCard(reply.card);
    applyCounts(reply.counts);
    applyOpenCards(reply.openCards);
    state.cardDraft = { listId, value: '', error: null };
    announce(ANNOUNCE.created(reply.card.title, list.name));
    requestRender();
  } catch (error) {
    const failure = failureOf(error);
    if (failure === null) throw error;
    const message = failure.fields?.['title'];
    state.cardDraft = { listId, value: title, error: message ?? COPY.genericFailure };
    requestRender();
  }
}

export async function moveCard(
  cardId: string,
  toListId: string,
  position: number,
  options: { focusCard?: boolean } = {},
): Promise<void> {
  const card = cardOf(cardId);
  if (card === null) return;
  const title = card.title;
  try {
    const reply = await call<CardWriteReply>(`/api/cards/${cardId}/move`, {
      method: 'POST',
      body: { toListId, position, version: card.version },
    });
    applyCard(reply.card);
    applyCounts(reply.counts);
    applyOpenCards(reply.openCards);
    const list = listOf(reply.card.listId);
    const total = reply.counts.find((entry) => entry.listId === reply.card.listId)?.count ?? list?.cards.length ?? 1;
    announce(ANNOUNCE.moved(reply.card.title, list?.name ?? '', reply.card.position ?? 1, total));
    if (options.focusCard === true) focusAfterRender(cardFocusKey(cardId));
    requestRender();
  } catch (error) {
    const failure = failureOf(error);
    if (failure === null) throw error;
    if (failure.code === 'stale') {
      applyStale(failure, title);
      return;
    }
    if (failure.status === 404) {
      handleHiddenCard(title, cardId);
      return;
    }
    noticeFor(failure, title);
  }
}

export async function setStatus(cardId: string, status: 'open' | 'done' | 'archived'): Promise<void> {
  const card = cardOf(cardId);
  const list = listOfCard(cardId);
  if (card === null || list === null) return;
  const title = card.title;
  const index = list.cards.findIndex((item) => item.id === cardId);
  try {
    const reply = await call<CardWriteReply>(`/api/cards/${cardId}/status`, {
      method: 'POST',
      body: { status, version: card.version },
    });
    if (status === 'archived') {
      removeCard(cardId);
    } else {
      applyCard(reply.card);
    }
    applyCounts(reply.counts);
    applyOpenCards(reply.openCards);
    announce(ANNOUNCE.status(title, status));
    if (status === 'archived') {
      const refreshed = listOf(list.id);
      const next = refreshed?.cards[index] ?? refreshed?.cards[index - 1] ?? null;
      focusAfterRender(next === null ? addCardFocusKey(list.id) : cardFocusKey(next.id));
    } else {
      focusAfterRender(cardFocusKey(cardId));
    }
    requestRender();
  } catch (error) {
    const failure = failureOf(error);
    if (failure === null) throw error;
    if (failure.code === 'stale') {
      applyStale(failure, title);
      return;
    }
    if (failure.status === 404) {
      handleHiddenCard(title, cardId);
      return;
    }
    noticeFor(failure, title);
  }
}

export async function saveCard(): Promise<void> {
  const dialog = state.dialog;
  if (dialog?.kind !== 'card') return;
  const card = cardOf(dialog.cardId);
  if (card === null) return;
  const body: Record<string, unknown> = { version: card.version };
  if ('title' in dialog.drafts) body['title'] = dialog.drafts['title'];
  if ('notes' in dialog.drafts) body['notes'] = dialog.drafts['notes'];
  if ('dueDate' in dialog.drafts) body['dueDate'] = dialog.drafts['dueDate'] === '' ? null : dialog.drafts['dueDate'];
  if ('ownerUserId' in dialog.drafts) {
    body['ownerUserId'] = dialog.drafts['ownerUserId'] === '' ? null : dialog.drafts['ownerUserId'];
  }
  if (dialog.labelDraft !== null) body['labels'] = dialog.labelDraft;
  if (Object.keys(body).length === 1) return;
  dialog.pending = true;
  dialog.fieldErrors = {};
  requestRender();
  try {
    const reply = await call<{ card: CardPayload }>(`/api/cards/${dialog.cardId}`, { method: 'PATCH', body });
    applyCard(reply.card);
    recountOpenCards();
    if (state.dialog?.kind === 'card' && state.dialog.cardId === dialog.cardId) {
      state.dialog = { ...state.dialog, drafts: {}, labelDraft: null, pending: false, fieldErrors: {} };
    }
    announce(ANNOUNCE.saved(reply.card.title));
    requestRender();
  } catch (error) {
    const failure = failureOf(error);
    dialog.pending = false;
    if (failure === null) throw error;
    if (failure.code === 'stale') {
      applyStale(failure, card.title);
      requestRender();
      return;
    }
    if (failure.status === 404) {
      handleHiddenCard(card.title, dialog.cardId);
      return;
    }
    if (failure.status === 403) {
      addNotice(COPY.lockedEdit);
      requestRender();
      return;
    }
    if (failure.fields !== undefined) {
      dialog.fieldErrors = failure.fields;
      requestRender();
      return;
    }
    noticeFor(failure, card.title);
  }
}

export async function addChecklistItem(cardId: string, text: string): Promise<void> {
  const card = cardOf(cardId);
  if (card === null) return;
  try {
    const reply = await call<{ item: ChecklistItem }>(`/api/cards/${cardId}/checklist`, {
      method: 'POST',
      body: { text },
    });
    card.checklist = [...card.checklist, reply.item];
    if (state.dialog?.kind === 'card') {
      delete state.dialog.drafts['newItem'];
      state.dialog.fieldErrors = {};
    }
    announce(ANNOUNCE.itemAdded(reply.item.text));
    requestRender();
  } catch (error) {
    const failure = failureOf(error);
    if (failure === null) throw error;
    if (failure.status === 404) {
      handleHiddenCard(card.title, cardId);
      return;
    }
    if (state.dialog?.kind === 'card' && failure.fields?.['text'] !== undefined) {
      state.dialog.fieldErrors = { newItem: failure.fields['text'] };
      requestRender();
      return;
    }
    noticeFor(failure, card.title);
  }
}

export async function toggleChecklistItem(cardId: string, itemId: string, done: boolean): Promise<void> {
  const card = cardOf(cardId);
  const item = card?.checklist.find((entry) => entry.id === itemId);
  if (card === null || item === undefined) return;
  try {
    const reply = await call<{ item: ChecklistItem }>(`/api/checklist-items/${itemId}`, {
      method: 'PATCH',
      body: { done },
    });
    item.done = reply.item.done;
    announce(reply.item.done ? ANNOUNCE.checked(reply.item.text) : ANNOUNCE.unchecked(reply.item.text));
    requestRender();
  } catch (error) {
    const failure = failureOf(error);
    if (failure === null) throw error;
    if (failure.status === 404) {
      handleHiddenCard(card.title, cardId);
      return;
    }
    noticeFor(failure, card.title);
  }
}

export async function renameChecklistItem(cardId: string, itemId: string, text: string): Promise<void> {
  const card = cardOf(cardId);
  const item = card?.checklist.find((entry) => entry.id === itemId);
  if (card === null || item === undefined) return;
  try {
    const reply = await call<{ item: ChecklistItem }>(`/api/checklist-items/${itemId}`, {
      method: 'PATCH',
      body: { text },
    });
    item.text = reply.item.text;
    requestRender();
  } catch (error) {
    const failure = failureOf(error);
    if (failure === null) throw error;
    noticeFor(failure, card.title);
  }
}

export async function deleteChecklistItem(cardId: string, itemId: string): Promise<void> {
  const card = cardOf(cardId);
  if (card === null) return;
  try {
    await call<void>(`/api/checklist-items/${itemId}`, { method: 'DELETE' });
    card.checklist = card.checklist.filter((item) => item.id !== itemId);
    requestRender();
  } catch (error) {
    const failure = failureOf(error);
    if (failure === null) throw error;
    noticeFor(failure, card.title);
  }
}

export async function setPrivateMembers(cardId: string, userIds: string[]): Promise<void> {
  const card = cardOf(cardId);
  if (card === null) return;
  try {
    const reply = await call<{ card: CardPayload }>(`/api/cards/${cardId}/private-members`, {
      method: 'PUT',
      body: { userIds },
    });
    applyCard(reply.card);
    recountOpenCards();
    requestRender();
  } catch (error) {
    const failure = failureOf(error);
    if (failure === null) throw error;
    if (failure.code === 'no_change') return;
    if (failure.status === 404) {
      handleHiddenCard(card.title, cardId);
      return;
    }
    noticeFor(failure, card.title);
  }
}

export async function uploadAttachment(cardId: string, file: File): Promise<void> {
  const dialog = state.dialog;
  if (dialog?.kind !== 'card') return;
  const uploadId = `upload-${Date.now()}`;
  const shown = displayFilename(file.name);
  dialog.uploads = [...dialog.uploads, { id: uploadId, filename: shown, error: null }];
  requestRender();
  const finish = (): void => {
    if (state.dialog?.kind === 'card') {
      state.dialog.uploads = state.dialog.uploads.filter((entry) => entry.id !== uploadId);
    }
  };
  if (file.size > 10_000_000) {
    finish();
    addNotice(uploadCopy.tooLarge(shown));
    requestRender();
    return;
  }
  try {
    const reply = await upload<{ attachment: AttachmentPayload }>(`/api/cards/${cardId}/attachments`, file);
    const card = cardOf(cardId);
    if (card !== null) card.attachments = [...(card.attachments ?? []), reply.attachment];
    finish();
    announce(ANNOUNCE.attached(reply.attachment.filename));
    requestRender();
  } catch (error) {
    const failure = failureOf(error);
    finish();
    if (failure === null) {
      addNotice(uploadCopy.unavailable(shown));
      requestRender();
      return;
    }
    if (failure.status === 413) addNotice(uploadCopy.tooLarge(shown));
    else if (failure.status === 415) addNotice(uploadCopy.badType(shown));
    else if (failure.status === 422) addNotice(uploadCopy.badName(shown));
    else if (failure.status === 404) {
      handleHiddenCard(cardOf(cardId)?.title ?? shown, cardId);
      return;
    } else addNotice(uploadCopy.unavailable(shown));
    requestRender();
  }
}

export async function removeAttachment(cardId: string, attachmentId: string, filename: string): Promise<void> {
  try {
    await call<void>(`/api/attachments/${attachmentId}`, { method: 'DELETE' });
    const card = cardOf(cardId);
    if (card !== null && card.attachments !== undefined) {
      card.attachments = card.attachments.filter((attachment) => attachment.id !== attachmentId);
    }
    requestRender();
  } catch (error) {
    const failure = failureOf(error);
    if (failure === null) throw error;
    if (failure.status === 503) addNotice(COPY.deleteBlockedByStorage);
    else addNotice(uploadCopy.downloadUnavailable(filename));
    requestRender();
  }
}

export async function downloadAttachment(attachmentId: string, filename: string): Promise<void> {
  try {
    const response = await fetch(`/api/attachments/${attachmentId}`, { credentials: 'same-origin' });
    if (!response.ok) throw new Error('unavailable');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  } catch {
    addNotice(uploadCopy.downloadUnavailable(filename));
    requestRender();
  }
}

export async function deleteCard(cardId: string): Promise<void> {
  const card = cardOf(cardId);
  if (card === null) return;
  try {
    await call<void>(`/api/cards/${cardId}`, { method: 'DELETE' });
    removeCard(cardId);
    recountOpenCards();
    state.dialog = null;
    requestRender();
  } catch (error) {
    const failure = failureOf(error);
    if (failure === null) throw error;
    if (failure.status === 503) addNotice(COPY.deleteBlockedByStorage);
    else noticeFor(failure, card.title);
    if (state.dialog?.kind === 'deleteCard') state.dialog = { ...state.dialog, pending: false };
    requestRender();
  }
}

export async function createBoard(name: string, visibility: Visibility): Promise<void> {
  const workspace = state.workspace;
  if (workspace === null || state.dialog?.kind !== 'newBoard') return;
  state.dialog.pending = true;
  requestRender();
  try {
    const reply = await call<{ board: { id: string; name: string; visibility: Visibility } }>(
      `/api/workspaces/${workspace.id}/boards`,
      { method: 'POST', body: { name, visibility } },
    );
    state.dialog = null;
    await loadBoards();
    push(`/boards/${reply.board.id}`);
    state.selectedListId = null;
    const loaded = await readBoard(reply.board.id, { select: null });
    if (loaded) {
      const { connectLive } = await import('./live');
      connectLive(reply.board.id);
    }
    focusAfterRender('addlist');
  } catch (error) {
    const failure = failureOf(error);
    if (state.dialog?.kind === 'newBoard') {
      state.dialog.pending = false;
      state.dialog.error = failure?.fields?.['name'] ?? COPY.genericFailure;
    }
    requestRender();
  }
}

export async function addList(name: string): Promise<void> {
  if (state.boardId === null) return;
  try {
    const reply = await call<{ list: ListPayload }>(`/api/boards/${state.boardId}/lists`, {
      method: 'POST',
      body: { name },
    });
    state.board?.lists.push({ ...reply.list, cards: [] });
    state.listNameDraft = null;
    state.selectedListId = reply.list.id;
    replace(boardPath(state.boardId, reply.list.id));
    focusAfterRender(addCardFocusKey(reply.list.id));
    requestRender();
  } catch (error) {
    const failure = failureOf(error);
    state.listNameDraft = { open: true, value: name, error: failure?.fields?.['name'] ?? COPY.genericFailure };
    requestRender();
  }
}

export async function loadSettings(): Promise<void> {
  if (state.boardId === null) return;
  const [members, candidates] = await Promise.all([
    call<{ members: BoardMemberPayload[] }>(`/api/boards/${state.boardId}/members`),
    call<{ people: { userId: string; displayName: string }[] }>(`/api/boards/${state.boardId}/candidates`),
  ]);
  state.settings = { members: members.members, candidates: candidates.people };
  requestRender();
}

export async function changeBoardVisibility(visibility: Visibility): Promise<void> {
  if (state.boardId === null) return;
  try {
    await call<unknown>(`/api/boards/${state.boardId}`, { method: 'PATCH', body: { visibility } });
    if (state.board !== null) state.board.board.visibility = visibility;
    await loadBoards();
    requestRender();
  } catch (error) {
    const failure = failureOf(error);
    if (failure?.code === 'no_change') return;
    if (state.dialog?.kind === 'settings') state.dialog.error = COPY.genericFailure;
    requestRender();
  }
}

export async function changeMemberRole(userId: string, role: BoardRole): Promise<void> {
  if (state.boardId === null) return;
  try {
    await call<{ member: BoardMemberPayload }>(`/api/boards/${state.boardId}/members/${userId}`, {
      method: 'PATCH',
      body: { role },
    });
    state.menu = null;
    await loadSettings();
  } catch (error) {
    const failure = failureOf(error);
    state.menu = null;
    if (state.dialog?.kind === 'settings') {
      state.dialog.error = failure?.code === 'last_admin' ? COPY.lastAdmin : COPY.genericFailure;
    }
    requestRender();
  }
}

export async function removeMember(userId: string): Promise<void> {
  if (state.boardId === null) return;
  try {
    await call<void>(`/api/boards/${state.boardId}/members/${userId}`, { method: 'DELETE' });
    state.menu = null;
    await loadSettings();
  } catch (error) {
    const failure = failureOf(error);
    state.menu = null;
    if (state.dialog?.kind === 'settings') {
      state.dialog.error = failure?.code === 'last_admin' ? COPY.lastAdmin : COPY.genericFailure;
    }
    requestRender();
  }
}

export async function addMember(userId: string): Promise<void> {
  if (state.boardId === null || userId === '') return;
  try {
    await call<{ member: BoardMemberPayload }>(`/api/boards/${state.boardId}/members`, {
      method: 'POST',
      body: { userId, role: 'member' },
    });
    if (state.dialog?.kind === 'settings') state.dialog.addUserId = '';
    await loadSettings();
  } catch (error) {
    const failure = failureOf(error);
    if (state.dialog?.kind === 'settings') {
      state.dialog.error = failure?.code === 'last_admin' ? COPY.lastAdmin : COPY.genericFailure;
    }
    requestRender();
  }
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  if (state.dialog?.kind !== 'password') return;
  state.dialog.pending = true;
  state.dialog.errors = {};
  state.dialog.message = null;
  requestRender();
  try {
    await call<{ signedOutSessions: number }>('/api/account/password', {
      method: 'POST',
      body: { currentPassword, newPassword },
    });
    if (state.dialog?.kind === 'password') {
      state.dialog.pending = false;
      state.dialog.message = COPY.passwordChanged;
      state.dialog.currentPassword = '';
      state.dialog.newPassword = '';
    }
    requestRender();
  } catch (error) {
    const failure = failureOf(error);
    if (state.dialog?.kind === 'password') {
      state.dialog.pending = false;
      state.dialog.errors = failure?.fields ?? {};
    }
    requestRender();
  }
}

export function announceAccessChange(role: BoardRole): void {
  addNotice(accessChangedCopy(roleLabel(role)));
}
