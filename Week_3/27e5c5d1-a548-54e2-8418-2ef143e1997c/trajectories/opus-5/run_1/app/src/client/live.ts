import { ANNOUNCE, COPY } from '../shared/copy';
import type { BoardRole, CardMovedData, CardPayload, CountEntry, ServiceStatusPayload } from '../shared/types';
import { announceAccessChange, readBoard, refreshBoardAndBoards } from './actions';
import { cancelLiftForRemote, cancelLiftForRemoval } from './dnd';
import { call } from './lib/api';
import { showMover } from './motion';
import { goToSignIn } from './session';
import {
  announce,
  applyCard,
  applyCounts,
  cardOf,
  listOf,
  recountOpenCards,
  removeCard,
  requestRender,
  state,
} from './store';
import { reloadSettingsIfOpen } from './render/dialogs';

const STATUS_POLL_MS = 3000;
const REREAD_MS = 60_000;

let source: EventSource | null = null;
let pollTimer: number | null = null;
let rereadTimer: number | null = null;

function parse<T>(event: MessageEvent): T {
  return JSON.parse(event.data as string) as T;
}

function onCardCreated(event: MessageEvent): void {
  const data = parse<{ card: CardPayload; counts: CountEntry[] }>(event);
  applyCard(data.card);
  applyCounts(data.counts);
  recountOpenCards();
  requestRender();
}

function onCardUpdated(event: MessageEvent): void {
  const data = parse<{ card: CardPayload }>(event);
  applyCard(data.card);
  recountOpenCards();
  requestRender();
}

function onCardMoved(event: MessageEvent): void {
  const data = parse<CardMovedData>(event);
  const mine = data.mover.displayName === state.me?.displayName;
  applyCard(data.card);
  applyCounts(data.counts);
  recountOpenCards();
  const sentences = cancelLiftForRemote(data.card.id);
  if (!mine) {
    showMover(data.card.id, data.mover);
    const list = listOf(data.card.listId);
    const total = data.counts.find((entry) => entry.listId === data.card.listId)?.count ?? list?.cards.length ?? 1;
    sentences.push(
      ANNOUNCE.remoteMove(
        data.mover.displayName,
        data.card.title,
        list?.name ?? '',
        data.card.position ?? 1,
        total,
      ),
    );
  }
  if (sentences.length > 0) announce(...sentences);
  requestRender();
}

function onCardRemoved(event: MessageEvent): void {
  const data = parse<{ cardId: string; counts: CountEntry[] }>(event);
  const title = cardOf(data.cardId)?.title ?? '';
  const sentences = cancelLiftForRemoval(data.cardId, title);
  removeCard(data.cardId);
  applyCounts(data.counts);
  recountOpenCards();
  if (state.dialog?.kind === 'card' && state.dialog.cardId === data.cardId) state.dialog = null;
  if (sentences.length > 0) announce(...sentences);
  requestRender();
}

function onListCreated(event: MessageEvent): void {
  const data = parse<{ list: { id: string; name: string } }>(event);
  if (state.board === null) return;
  if (state.board.lists.some((list) => list.id === data.list.id)) return;
  state.board.lists.push({ id: data.list.id, name: data.list.name, count: 0, cards: [] });
  if (state.selectedListId === null) state.selectedListId = data.list.id;
  requestRender();
}

function onListUpdated(event: MessageEvent): void {
  const data = parse<{ list: { id: string; name: string } }>(event);
  const list = listOf(data.list.id);
  if (list !== null) list.name = data.list.name;
  requestRender();
}

function onBoardUpdated(event: MessageEvent): void {
  const data = parse<{ board: { id: string; name: string; visibility: 'workspace' | 'private' } }>(event);
  if (state.board !== null) {
    state.board.board.name = data.board.name;
    state.board.board.visibility = data.board.visibility;
  }
  void refreshBoardAndBoards();
  void reloadSettingsIfOpen();
  requestRender();
}

function onAccessChanged(event: MessageEvent): void {
  const data = parse<{ role: BoardRole | null }>(event);
  if (data.role === null) {
    state.board = null;
    state.dialog = null;
    state.screen = 'boardNotFound';
    closeLive();
    requestRender();
    return;
  }
  announceAccessChange(data.role);
  if (data.role === 'observer' && state.dialog?.kind === 'card') {
    state.dialog = { ...state.dialog, drafts: {}, labelDraft: null, fieldErrors: {} };
  }
  const boardId = state.boardId;
  if (boardId !== null) {
    void (async () => {
      await readBoard(boardId);
      connectLive(boardId);
    })();
  }
}

function onSessionEnded(): void {
  closeLive();
  goToSignIn();
}

function onLivePaused(): void {
  state.status.live = 'paused';
  requestRender();
}

function onLiveResumed(): void {
  const wasPaused = state.status.live === 'paused';
  state.status.live = 'up';
  if (wasPaused) {
    announce(COPY.liveBack);
    void refreshBoardAndBoards();
  }
  requestRender();
}

export function connectLive(boardId: string): void {
  closeLive();
  const stream = new EventSource(`/api/boards/${boardId}/events`);
  source = stream;
  stream.addEventListener('card.created', onCardCreated);
  stream.addEventListener('card.updated', onCardUpdated);
  stream.addEventListener('card.moved', onCardMoved);
  stream.addEventListener('card.removed', onCardRemoved);
  stream.addEventListener('list.created', onListCreated);
  stream.addEventListener('list.updated', onListUpdated);
  stream.addEventListener('board.updated', onBoardUpdated);
  stream.addEventListener('access.changed', onAccessChanged);
  stream.addEventListener('session.ended', onSessionEnded);
  stream.addEventListener('live.paused', onLivePaused);
  stream.addEventListener('live.resumed', onLiveResumed);
}

export function closeLive(): void {
  source?.close();
  source = null;
}

async function pollStatus(): Promise<void> {
  try {
    const status = await call<ServiceStatusPayload>('/api/service-status');
    const wasPaused = state.status.live === 'paused';
    state.status.storage = status.storage;
    if (status.live === 'up' && wasPaused) {
      onLiveResumed();
      return;
    }
    state.status.live = status.live;
    requestRender();
  } catch {
    // A failed status read leaves the banner as it is.
  }
}

export function startBackground(): void {
  if (pollTimer === null) pollTimer = window.setInterval(() => void pollStatus(), STATUS_POLL_MS);
  if (rereadTimer === null) {
    rereadTimer = window.setInterval(() => {
      if (state.screen === 'board') void refreshBoardAndBoards();
    }, REREAD_MS);
  }
  void pollStatus();
}
