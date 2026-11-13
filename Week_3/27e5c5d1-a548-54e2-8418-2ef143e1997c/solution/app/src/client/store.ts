import { useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { SEARCH_MAX, SEARCH_MIN } from '../shared/search.ts';
import {
  isWriter,
  type Attachment, type BoardSummary, type BoardView, type Card, type ChecklistItem, type ListView, type LiveEvent, type LiveEventType, type Me,
  type MoveReply, type Person, type Role, type SearchResponse, type StaleReply, type WorkspaceInfo,
} from '../shared/types.ts';
import { ApiFailure, call, setSignedOutHandler } from './api.ts';
import {
  applyEvent, listById, locate, mapCard, placeCard, removeCard, replaceCard, sameOrder, toBoardData, visibleListIds, withCounts,
  type BoardData, type ViewMode,
} from './board-state.ts';
import { COPY, roleName, sentences } from './copy.ts';
import { captureRects, playGlide, prefersReducedMotion, resetGlide } from './glide.ts';
import { historyMark, navigate, parseRoute } from './router.ts';

interface Notice {
  id: number;
  text: string;
}

interface Spoken {
  id: number;
  text: string;
}

export interface Lift {
  cardId: string;
  mode: 'keyboard' | 'pointer';
  origin: { listId: string; index: number; version: number };
  target: { listId: string; index: number };
  pointer: { x: number; y: number } | null;
}

export interface Chip {
  mover: Person;
  fading: boolean;
}

export interface CardDraft {
  title?: string;
  notes?: string;
  /** The text typed in the field: empty means no due date. */
  dueDate?: string | null;
  labels?: Card['labels'];
  ownerUserId?: string | null;
}

interface CardRoute {
  cardId: string;
  phase: 'loading' | 'ready' | 'missing';
  /** The card as fetched, for a card that is not on the board (archived). */
  card: Card | null;
}

interface SearchState {
  text: string;
  results: SearchResponse['results'];
  status: string;
}

interface State {
  session: 'booting' | 'out' | 'in';
  signedOutNotice: boolean;
  me: Me | null;
  workspace: WorkspaceInfo | null;
  drawer: BoardSummary[];
  board: BoardData | null;
  boardPhase: 'none' | 'loading' | 'ready' | 'missing';
  cardRoute: CardRoute | null;
  selectedListId: string | null;
  viewMode: ViewMode;
  notices: Notice[];
  spoken: Spoken[];
  service: { live: 'up' | 'paused'; storage: 'up' | 'down' };
  lift: Lift | null;
  chips: Record<string, Chip>;
  drafts: Record<string, CardDraft>;
  /** Cards whose edit was refused with 403 since the dialog opened. */
  locked: Record<string, true>;
  search: SearchState;
  toast: string | null;
  /** The card whose button should regain focus once the card dialog is gone. */
  returnFocusTo: string | null;
  /** A control to focus once the board it lives on has loaded (the new board's Add a list). */
  focusOnReady: { boardId: string; selector: string } | null;
}

export const currentViewMode = (): ViewMode =>
  window.matchMedia('(min-width: 1200px)').matches ? 'desktop' : window.matchMedia('(min-width: 768px)').matches ? 'tablet' : 'phone';

const blank = (): State => ({
  session: 'booting',
  signedOutNotice: false,
  me: null,
  workspace: null,
  drawer: [],
  board: null,
  boardPhase: 'none',
  cardRoute: null,
  selectedListId: null,
  viewMode: currentViewMode(),
  notices: [],
  spoken: [],
  service: { live: 'up', storage: 'up' },
  lift: null,
  chips: {},
  drafts: {},
  locked: {},
  search: { text: '', results: [], status: '' },
  toast: null,
  returnFocusTo: null,
  focusOnReady: null,
});

let state: State = blank();
const listeners = new Set<() => void>();

function set(patch: Partial<State> | ((s: State) => Partial<State>)): void {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  for (const listener of listeners) listener();
}

export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => select(state),
  );
}

/** Applies a change to the DOM-visible state at once, so what follows can measure or focus it. */
const now = (patch: Parameters<typeof set>[0]): void => flushSync(() => set(patch));

let counter = 0;
const nextId = (): number => ++counter;

// ---------------------------------------------------------------------------------------------
// Timers and connections owned by the store. resetAll() ends all of them.

let boardSeq = 0;
let stream: EventSource | null = null;
let streamHadError = false;
let rereadTimer: number | undefined;
let statusTimer: number | undefined;
let searchTimer: number | undefined;
let searchAbort: AbortController | null = null;
let searchSeq = 0;
let toastTimer: number | undefined;
const chipTimers = new Map<string, number[]>();
/** Cards whose own write is in flight or just answered: the echo of those events is not a remote change. */
const ownWrites = new Map<string, number>();
let pendingEvents: LiveEvent[] | null = null;
let batching = false;

function stopEverything(): void {
  boardSeq++;
  closeStream();
  window.clearInterval(rereadTimer);
  window.clearInterval(statusTimer);
  window.clearTimeout(searchTimer);
  window.clearTimeout(toastTimer);
  searchAbort?.abort();
  searchAbort = null;
  searchSeq++;
  for (const timers of chipTimers.values()) timers.forEach((t) => window.clearTimeout(t));
  chipTimers.clear();
  ownWrites.clear();
  pendingEvents = null;
  resetGlide();
}

/** Sign-out and every 401 end here: all state the page holds is discarded in this one step. */
function resetAll(): void {
  stopEverything();
  state = blank();
  state.session = 'out';
  for (const listener of listeners) listener();
}

// ---------------------------------------------------------------------------------------------
// Announcements, notices, toast

function announce(text: string): void {
  const entry = { id: nextId(), text };
  if (batching) set((s) => ({ spoken: [...s.spoken, entry] }));
  else {
    batching = true;
    queueMicrotask(() => {
      batching = false;
    });
    set({ spoken: [entry] });
  }
}

export function addNotice(text: string): void {
  set((s) => ({ notices: [{ id: nextId(), text }, ...s.notices] }));
}

export const dismissNotice = (id: number): void => set((s) => ({ notices: s.notices.filter((n) => n.id !== id) }));

function notify(text: string): void {
  announce(text);
  addNotice(text);
}

function showToast(text: string): void {
  window.clearTimeout(toastTimer);
  set({ toast: text });
  toastTimer = window.setTimeout(() => set({ toast: null }), 4000);
}

// ---------------------------------------------------------------------------------------------
// Session

const SIGNED_OUT_FLAG = 'kinfold.signed-out';

function signedOutRedirect(): void {
  const deliberate = sessionStorage.getItem(SIGNED_OUT_FLAG) !== null;
  const path = location.pathname + location.search;
  resetAll();
  if (parseRoute(location.pathname, location.search).kind === 'signin') {
    set({ signedOutNotice: !deliberate });
    return;
  }
  const target = deliberate || path === '/' ? '/signin' : `/signin?next=${encodeURIComponent(path)}`;
  set({ signedOutNotice: !deliberate });
  navigate(target, { replace: true });
}

setSignedOutHandler(signedOutRedirect);

export function enterSignIn(): void {
  if (state.session !== 'out') resetAll();
}

export async function signOut(): Promise<void> {
  sessionStorage.setItem(SIGNED_OUT_FLAG, '1');
  try {
    await call('/api/session', { method: 'DELETE', quiet401: true });
  } catch {
    // the session is gone either way
  }
  resetAll();
  location.assign('/signin');
}

export function signedIn(redirectTo: string): void {
  sessionStorage.removeItem(SIGNED_OUT_FLAG);
  location.assign(redirectTo);
}

/** Learns who the person is; a 401 sends the browser to sign-in. */
export async function boot(): Promise<void> {
  if (state.session === 'in') return;
  try {
    const me = await call<Me>('/api/me');
    set({ session: 'in', me, workspace: me.workspaces[0] ?? null });
  } catch {
    // signedOutRedirect has already run for a 401
  }
}

// ---------------------------------------------------------------------------------------------
// Boards: opening, re-reading, live events

export const setViewMode = (viewMode: ViewMode): void => {
  if (viewMode !== state.viewMode) set({ viewMode });
};

export async function refreshDrawer(workspaceId: string | undefined = state.board?.workspaceId ?? state.workspace?.id): Promise<void> {
  if (!workspaceId) return;
  try {
    const { boards } = await call<{ boards: BoardSummary[] }>(`/api/workspaces/${workspaceId}/boards`);
    set({ drawer: boards });
  } catch {
    // the drawer keeps what it had
  }
}

/** The home route: the first board by name that the whole workspace can see, else the first board there is. */
export async function goHome(workspaceId: string): Promise<void> {
  await refreshDrawer(workspaceId);
  const first = state.drawer.find((b) => b.visibility === 'workspace') ?? state.drawer[0];
  if (first) navigate(`/boards/${first.id}`, { replace: true });
}

/** The storage banner follows the status endpoint; the live banner follows this board's own stream, which knows its worker's relay. */
async function pollStatus(): Promise<void> {
  try {
    const { storage } = await call<State['service']>('/api/service-status');
    if (storage !== state.service.storage) set((s) => ({ service: { ...s.service, storage } }));
  } catch {
    // the banner keeps what it had
  }
}

function closeStream(): void {
  stream?.close();
  stream = null;
  streamHadError = false;
}

/** A board's stream opens as soon as the board is read: a later start would miss events the catch-up read cannot replay. */
function openStream(boardId: string, catchUp = false): void {
  closeStream();
  connectStream(boardId, catchUp);
}

function connectStream(boardId: string, catchUp: boolean): void {
  let catchUpPending = catchUp;
  const source = new EventSource(`/api/boards/${boardId}/events`);
  stream = source;
  const types: LiveEventType[] = [
    'card.created', 'card.updated', 'card.moved', 'card.removed', 'list.created', 'list.updated', 'board.updated',
    'access.changed', 'session.ended', 'live.paused', 'live.resumed',
  ];
  for (const type of types) {
    source.addEventListener(type, (message) => {
      if (message instanceof MessageEvent) receive({ type, data: JSON.parse(message.data) });
    });
  }
  source.onerror = () => {
    streamHadError = true;
    // A refused stream (an ended session) is closed for good and never reaches onopen: read again so the 401 is seen.
    if (source.readyState === EventSource.CLOSED && stream === source) void reread();
  };
  source.onopen = () => {
    if (streamHadError || catchUpPending) void reread();
    streamHadError = false;
    catchUpPending = false;
  };
}

function receive(event: LiveEvent): void {
  if (pendingEvents) pendingEvents.push(event);
  else handleEvent(event);
}

function startTimers(): void {
  window.clearInterval(rereadTimer);
  window.clearInterval(statusTimer);
  rereadTimer = window.setInterval(() => void reread(), 60_000);
  statusTimer = window.setInterval(() => void pollStatus(), 2000);
}

/** Opens a board: stream first, then the first read, so nothing that happens in between is lost. */
export async function openBoard(boardId: string, listParam: string | null): Promise<void> {
  if (state.board?.id === boardId && state.boardPhase === 'ready') {
    selectFromAddress(listParam);
    return;
  }
  stopEverything();
  const seq = boardSeq;
  set({ board: null, boardPhase: 'loading', lift: null, chips: {}, drafts: {}, locked: {}, selectedListId: null });
  pendingEvents = [];
  startTimers();
  void pollStatus();
  try {
    const view = await call<BoardView>(`/api/boards/${boardId}`);
    if (seq !== boardSeq) return;
    const board = toBoardData(view);
    const requested = board.lists.some((l) => l.id === listParam) ? listParam : null;
    set({ board, boardPhase: 'ready', selectedListId: requested ?? board.lists[0]?.id ?? null });
    if (listParam !== null && requested === null) navigate(`/boards/${boardId}`, { replace: true });
    const queued = pendingEvents ?? [];
    pendingEvents = null;
    for (const event of queued) handleEvent(event);
    void refreshDrawer(board.workspaceId);
    openStream(boardId, true);
  } catch (error) {
    if (seq !== boardSeq) return;
    pendingEvents = null;
    if (error instanceof ApiFailure && error.status !== 404) openStream(boardId, true);
    if (error instanceof ApiFailure && error.status === 404) {
      closeStream();
      set({ boardPhase: 'missing' });
      void refreshDrawer(state.workspace?.id);
    } else if (!(error instanceof ApiFailure)) set({ boardPhase: 'missing' });
  }
}

function selectFromAddress(listParam: string | null): void {
  const board = state.board;
  if (!board) return;
  if (listParam !== null && board.lists.some((l) => l.id === listParam)) set({ selectedListId: listParam });
  else if (listParam !== null) navigate(`/boards/${board.id}`, { replace: true });
}

export function selectList(listId: string): void {
  const board = state.board;
  if (!board) return;
  set({ selectedListId: listId });
  navigate(`/boards/${board.id}?list=${listId}`, { replace: true });
}

export async function showCard(cardId: string): Promise<void> {
  if (state.cardRoute?.cardId === cardId && state.cardRoute.phase !== 'missing' && state.board) return;
  const known = state.board ? locate(state.board, cardId) : null;
  if (known && state.board) {
    set({ cardRoute: { cardId, phase: 'ready', card: null }, selectedListId: known.card.listId });
    return;
  }
  set({ cardRoute: { cardId, phase: 'loading', card: null } });
  try {
    const { card } = await call<{ card: Card }>(`/api/cards/${cardId}`);
    if (state.cardRoute?.cardId !== cardId) return;
    await openBoard(card.boardId, null);
    if (state.cardRoute?.cardId !== cardId) return;
    set({ cardRoute: { cardId, phase: 'ready', card }, selectedListId: card.listId });
  } catch (error) {
    if (error instanceof ApiFailure && state.cardRoute?.cardId === cardId) set({ cardRoute: { cardId, phase: 'missing', card: null }, boardPhase: 'none' });
  }
}

export function leaveCard(): void {
  set({ cardRoute: null });
}

/** Closes the card dialog: Back when the entry was pushed from the board, otherwise replace with the board address. */
export function closeCard(): void {
  const cardId = state.cardRoute?.cardId;
  const board = state.board;
  if (cardId) set({ returnFocusTo: cardId });
  if (historyMark()?.fromBoard) history.back();
  else if (board) {
    const listId = (cardId ? locate(board, cardId)?.card.listId : null) ?? state.cardRoute?.card?.listId ?? board.lists[0]?.id;
    navigate(`/boards/${board.id}${listId ? `?list=${listId}` : ''}`, { replace: true });
  }
}

export function openCard(cardId: string): void {
  const board = state.board;
  if (!board) return;
  navigate(`/cards/${cardId}`, { mark: { fromBoard: location.pathname + location.search } });
}

export function clearReturnFocus(): void {
  set({ returnFocusTo: null });
}

export async function reread(): Promise<void> {
  const board = state.board;
  if (!board || state.boardPhase !== 'ready') return;
  const seq = boardSeq;
  try {
    const view = await call<BoardView>(`/api/boards/${board.id}`);
    if (seq !== boardSeq) return;
    mergeBoard(toBoardData(view));
    void refreshDrawer(view.board.workspaceId);
  } catch (error) {
    if (error instanceof ApiFailure && error.status === 404 && seq === boardSeq) boardGone();
  }
}

/** Merges a fresh read into the open board; drafts, notices, the selected list and chips are not touched. */
function mergeBoard(next: BoardData): void {
  const lift = state.lift;
  const held = lift && state.board ? locate(state.board, lift.cardId) : null;
  const fresh = lift ? locate(next, lift.cardId) : null;
  let cancel: string | null = null;
  if (lift && held) {
    if (!fresh) cancel = sentences.cancelRemoved(held.card.title);
    else if (fresh.list.id !== lift.origin.listId || (fresh.card.version !== lift.origin.version && fresh.index !== lift.origin.index)) {
      const list = fresh.list;
      cancel = sentences.cancel(fresh.card.title, list.name, fresh.index + 1, list.cards.length);
    }
  }
  const selected = state.selectedListId && next.lists.some((l) => l.id === state.selectedListId) ? state.selectedListId : next.lists[0]?.id ?? null;
  set({ board: next, selectedListId: selected, ...(cancel ? { lift: null } : {}) });
  if (cancel) announce(cancel);
}

function boardGone(): void {
  closeStream();
  set({ board: null, boardPhase: 'missing', lift: null, cardRoute: state.cardRoute ? { ...state.cardRoute, phase: 'ready' } : null });
}

function handleEvent(event: LiveEvent): void {
  switch (event.type) {
    case 'live.paused':
      set((s) => ({ service: { ...s.service, live: 'paused' } }));
      return;
    case 'live.resumed':
      set((s) => ({ service: { ...s.service, live: 'up' } }));
      announce(COPY.liveBack);
      void pollStatus();
      void reread();
      return;
    case 'session.ended':
      // The stream is closed; the next request answers 401 and sends the browser to sign-in.
      closeStream();
      return;
    case 'access.changed':
      void accessChanged(event.data.role);
      return;
    case 'card.created':
    case 'card.removed':
    case 'card.moved':
      if (isOwnEcho(event)) return;
      break;
    default:
      break;
  }
  applyLiveCard(event);
}

function isOwnEcho(event: Extract<LiveEvent, { type: 'card.created' | 'card.removed' | 'card.moved' }>): boolean {
  const id = event.type === 'card.removed' ? event.data.cardId : event.data.card.id;
  const own = ownWrites.get(id);
  if (own === undefined) return false;
  if (event.type === 'card.removed') return true;
  if (event.data.card.version <= own) return true;
  ownWrites.delete(id);
  return false;
}

async function accessChanged(role: Role | null): Promise<void> {
  closeStream();
  const board = state.board;
  if (!board) return;
  if (role === null) {
    boardGone();
    void refreshDrawer(board.workspaceId);
    return;
  }
  const demoted = !isWriter(role) && isWriter(board.role);
  set((s) => ({ drafts: demoted ? {} : s.drafts, locked: demoted ? {} : s.locked }));
  openStream(board.id);
  await reread();
  addNotice(sentences.access(roleName(role)));
}

function applyLiveCard(event: LiveEvent): void {
  const board = state.board;
  if (!board) return;
  if (event.type === 'card.moved') {
    const lift = state.lift;
    const title = event.data.card.title;
    const list = listById(board, event.data.to.listId);
    const total = event.data.counts.find((c) => c.listId === event.data.to.listId)?.count ?? 0;
    if (lift && lift.cardId === event.data.card.id) {
      set({ lift: null });
      announce(sentences.cancel(title, list?.name ?? '', event.data.to.position, total));
    }
    const before = captureRects();
    const active = document.activeElement;
    flushSync(() => set({ board: applyEvent(board, event) }));
    restoreFocus(active);
    playGlide(before);
    startChip(event.data.card.id, event.data.mover);
    announce(sentences.remote(event.data.mover.displayName, title, list?.name ?? '', event.data.to.position, total));
    void refreshDrawer(board.workspaceId);
    return;
  }
  if (event.type === 'card.removed') {
    const gone = locate(board, event.data.cardId);
    if (state.lift?.cardId === event.data.cardId && gone) {
      set({ lift: null });
      announce(sentences.cancelRemoved(gone.card.title));
    }
  }
  set({ board: applyEvent(board, event) });
  if (event.type.startsWith('card.') || event.type === 'board.updated') void refreshDrawer(board.workspaceId);
}

/** React moves a card's element when its list changes; a card that held focus keeps it. */
function restoreFocus(active: Element | null): void {
  const id = (active as HTMLElement | null)?.dataset['cardButton'];
  if (id && document.activeElement !== active) document.querySelector<HTMLElement>(`[data-card-button="${id}"]`)?.focus();
}

// ---------------------------------------------------------------------------------------------
// Mover chips: each card's chip owns its own timers

function startChip(cardId: string, mover: Person): void {
  for (const timer of chipTimers.get(cardId) ?? []) window.clearTimeout(timer);
  set((s) => ({ chips: { ...s.chips, [cardId]: { mover, fading: false } } }));
  const reduced = prefersReducedMotion();
  const end = (): void => {
    chipTimers.delete(cardId);
    set((s) => {
      const { [cardId]: _gone, ...rest } = s.chips;
      return { chips: rest };
    });
  };
  const timers = reduced
    ? [window.setTimeout(end, 2000)]
    : [
        window.setTimeout(() => set((s) => (s.chips[cardId] ? { chips: { ...s.chips, [cardId]: { mover, fading: true } } } : {})), 2000),
        window.setTimeout(end, 2500),
      ];
  chipTimers.set(cardId, timers);
}

// ---------------------------------------------------------------------------------------------
// Lifting and moving cards

function others(board: BoardData, listId: string, cardId: string): Card[] {
  return (listById(board, listId)?.cards ?? []).filter((c) => c.id !== cardId);
}

function startLift(cardId: string, mode: Lift['mode'], pointer: Lift['pointer']): boolean {
  const board = state.board;
  if (!board || state.lift || !isWriter(board.role)) return false;
  const found = locate(board, cardId);
  if (!found) return false;
  const list = found.list;
  const place = { listId: list.id, index: found.index };
  set({ lift: { cardId, mode, origin: { ...place, version: found.card.version }, target: place, pointer } });
  announce(mode === 'keyboard' ? sentences.lift(found.card.title, list.name, found.index + 1, list.cards.length) : sentences.pointerLift(found.card.title));
  return true;
}

/** True while a card is being dragged by pointer or touch; the page must not scroll under the finger then. */
export const isPointerLifted = (): boolean => state.lift?.mode === 'pointer';

export const liftKeyboard = (cardId: string): boolean => startLift(cardId, 'keyboard', null);
export const liftPointer = (cardId: string, x: number, y: number): boolean => startLift(cardId, 'pointer', { x, y });

function moveTarget(listId: string, index: number): void {
  const { lift, board } = state;
  if (!lift || !board) return;
  const list = listById(board, listId);
  const card = locate(board, lift.cardId)?.card;
  if (!list || !card) return;
  const count = others(board, listId, lift.cardId).length;
  const clamped = Math.max(0, Math.min(index, count));
  let selectedListId = state.selectedListId;
  if (!visibleListIds(board, selectedListId, state.viewMode).includes(listId)) selectedListId = listId;
  set({ lift: { ...lift, target: { listId, index: clamped } }, selectedListId });
  if (lift.mode === 'keyboard') announce(sentences.over(card.title, list.name, clamped + 1, count + 1));
}

export function liftArrow(direction: 'up' | 'down' | 'left' | 'right'): void {
  const { lift, board } = state;
  if (!lift || !board) return;
  const { listId, index } = lift.target;
  if (direction === 'up' || direction === 'down') {
    const length = others(board, listId, lift.cardId).length;
    const next = Math.max(0, Math.min(length, index + (direction === 'up' ? -1 : 1)));
    if (next !== index) moveTarget(listId, next);
    return;
  }
  const at = board.lists.findIndex((l) => l.id === listId) + (direction === 'left' ? -1 : 1);
  const list = board.lists[at];
  if (list) moveTarget(list.id, Math.min(index, others(board, list.id, lift.cardId).length));
}

export const liftPointerTo = (listId: string, index: number, x: number, y: number): void => {
  const lift = state.lift;
  if (!lift || lift.mode !== 'pointer') return;
  if (lift.target.listId !== listId || lift.target.index !== index) moveTarget(listId, index);
  set((s) => (s.lift ? { lift: { ...s.lift, pointer: { x, y } } } : {}));
};

export function cancelLift(): void {
  const { lift, board } = state;
  if (!lift || !board) return;
  const found = locate(board, lift.cardId);
  set({ lift: null });
  if (!found) return;
  const list = found.list;
  announce(sentences.cancel(found.card.title, list.name, lift.origin.index + 1, list.cards.length));
  requestFocus(`[data-card-button="${lift.cardId}"]`);
}

export function drop(): void {
  const { lift, board } = state;
  if (!lift || !board) return;
  const { target, origin } = lift;
  if (target.listId === origin.listId && target.index === origin.index) {
    cancelLift();
    return;
  }
  const card = locate(board, lift.cardId)?.card;
  if (!card) return;
  const before = lift.mode === 'pointer' ? captureRects() : null;
  flushSync(() => set({ lift: null, board: placeCard(board, card, target.listId, target.index) }));
  if (before) playGlide(before);
  requestFocus(`[data-card-button="${card.id}"]`);
  void sendMove(card, target.listId, target.index + 1);
}

/** The Move card dialog: the same request as a drop. */
export function moveFromDialog(cardId: string, listId: string, position: number): void {
  const board = state.board;
  const card = board ? locate(board, cardId)?.card : null;
  if (!board || !card) return;
  set({ board: placeCard(board, card, listId, position - 1) });
  void sendMove(card, listId, position);
}

async function sendMove(card: Card, toListId: string, position: number): Promise<void> {
  ownWrites.set(card.id, Number.POSITIVE_INFINITY);
  try {
    const reply = await call<MoveReply>(`/api/cards/${card.id}/move`, { method: 'POST', body: { toListId, position, version: card.version } });
    ownWrites.set(card.id, reply.card.version);
    acceptReply(reply, sentences.moved);
    requestFocus(`[data-card-button="${card.id}"]`);
  } catch (error) {
    await refuse(error, card);
  }
}

function listNameOf(listId: string): string {
  return state.board ? (listById(state.board, listId)?.name ?? '') : '';
}

/** A write's reply settles the card, the list counts, the drawer's open count and the spoken sentence. */
function acceptReply(reply: MoveReply, spoken: (title: string, list: string, n: number, total: number) => string): void {
  const board = state.board;
  if (!board) return;
  const placed = reply.card.status === 'archived' ? removeCard(board, reply.card.id) : placeCard(board, reply.card, reply.card.listId, (reply.card.position ?? 1) - 1);
  const before = sameOrder(board, placed) ? null : captureRects();
  flushSync(() =>
    set((s) => ({
      board: withCounts(placed, reply.counts),
      drawer: s.drawer.map((b) => (b.id === board.id ? { ...b, openCards: reply.openCards } : b)),
    })),
  );
  if (before) playGlide(before);
  const total = reply.counts.find((c) => c.listId === reply.card.listId)?.count ?? 0;
  announce(spoken(reply.card.title, listNameOf(reply.card.listId), reply.card.position ?? 0, total));
}

/** A refused own write: stale snaps back, 404 removes the card, anything else is the generic notice. */
async function refuse(error: unknown, card: Card): Promise<void> {
  ownWrites.delete(card.id);
  const stale = error instanceof ApiFailure ? error.stale : null;
  if (stale) {
    adoptStale(stale);
    void reread();
    return;
  }
  if (error instanceof ApiFailure && error.status === 404) {
    cardGone(card);
    return;
  }
  addNotice(COPY.wentWrong);
  await reread();
}

function adoptStale(reply: StaleReply): void {
  const board = state.board;
  if (!board) return;
  const before = captureRects();
  const placed = placeCard(board, reply.card, reply.card.listId, (reply.card.position ?? 1) - 1);
  flushSync(() => set({ board: placed }));
  playGlide(before);
  const list = listById(placed, reply.card.listId);
  notify(sentences.stale(reply.changedBy.displayName, reply.change, reply.card.title, list?.name ?? '', reply.card.position ?? 0, list?.cards.length ?? 0));
}

/** Own write answered 404: the card leaves the board, any open dialog closes, and the person is told. */
function cardGone(card: Card): void {
  const board = state.board;
  if (!board) return;
  set({ board: removeCard(board, card.id), lift: null });
  notify(sentences.notShared(card.title));
  if (state.cardRoute?.cardId === card.id) closeCard();
  void reread();
}

// ---------------------------------------------------------------------------------------------
// Focus

function requestFocus(selector: string): void {
  queueMicrotask(() => document.querySelector<HTMLElement>(selector)?.focus());
}

/** Focus a control that exists right now. */
export const focusNow = (selector: string): void => document.querySelector<HTMLElement>(selector)?.focus();

// ---------------------------------------------------------------------------------------------
// Card actions

export async function createCard(listId: string, title: string): Promise<Record<string, string> | null> {
  const board = state.board;
  if (!board) return null;
  try {
    const reply = await call<MoveReply>(`/api/lists/${listId}/cards`, { method: 'POST', body: { title }, headers: { 'Idempotency-Key': crypto.randomUUID() } });
    ownWrites.set(reply.card.id, reply.card.version);
    acceptReply(reply, (t, list) => sentences.created(t, list));
    return null;
  } catch (error) {
    if (error instanceof ApiFailure && error.status === 422) return error.fields;
    addNotice(COPY.wentWrong);
    return {};
  }
}

export async function changeStatus(card: Card, status: Card['status']): Promise<void> {
  const board = state.board;
  if (!board) return;
  const found = locate(board, card.id);
  const list = found?.list;
  ownWrites.set(card.id, Number.POSITIVE_INFINITY);
  try {
    const reply = await call<MoveReply>(`/api/cards/${card.id}/status`, { method: 'POST', body: { status, version: card.version } });
    ownWrites.set(card.id, reply.card.version);
    const spoken = status === 'done' ? sentences.done : status === 'open' ? sentences.reopened : sentences.archived;
    acceptReply(reply, (title) => spoken(title));
    if (status === 'archived' && found && list) {
      const left = state.board ? others(state.board, list.id, card.id) : [];
      const focus = left[found.index] ?? left[found.index - 1];
      requestFocus(focus ? `[data-card-button="${focus.id}"]` : `[data-add-card="${list.id}"]`);
      showToast(sentences.archived(reply.card.title));
    } else requestFocus(`[data-card-button="${card.id}"]`);
  } catch (error) {
    await refuse(error, card);
  }
}

export const setDraft = (cardId: string, patch: CardDraft): void => set((s) => ({ drafts: { ...s.drafts, [cardId]: { ...s.drafts[cardId], ...patch } } }));

interface SaveOutcome {
  fields: Record<string, string>;
}

export async function saveCard(card: Card, draft: CardDraft): Promise<SaveOutcome> {
  const body: Record<string, unknown> = { version: card.version, ...draft };
  try {
    const { card: saved } = await call<{ card: Card }>(`/api/cards/${card.id}`, { method: 'PATCH', body });
    set((s) => {
      const { [card.id]: _drop, ...drafts } = s.drafts;
      return { board: s.board ? replaceCard(s.board, saved) : s.board, drafts, cardRoute: s.cardRoute?.cardId === card.id && s.cardRoute.card ? { ...s.cardRoute, card: saved } : s.cardRoute };
    });
    announce(sentences.saved(saved.title));
    showToast(sentences.saved(saved.title));
    return { fields: {} };
  } catch (error) {
    if (error instanceof ApiFailure && error.status === 422) return { fields: error.fields };
    const stale = error instanceof ApiFailure ? error.stale : null;
    if (stale) {
      adoptStale(stale);
      void reread();
    } else answerRefusal(card, error);
    return { fields: {} };
  }
}

/** An own write on a card that the server refused: 403 locks the dialog, 404 removes the card, the rest is a notice. */
function answerRefusal(card: Card, error: unknown): void {
  if (error instanceof ApiFailure && error.status === 403) {
    set((s) => ({ locked: { ...s.locked, [card.id]: true } }));
    addNotice(COPY.lockedEdit);
    void reread();
  } else if (error instanceof ApiFailure && error.status === 404) cardGone(card);
  else if (error instanceof ApiFailure && error.status === 409) void reread();
  else addNotice(COPY.wentWrong);
}

/** Own checklist and privacy writes; field problems come back, everything else is answered here. */
async function cardWrite<T>(card: Card, request: () => Promise<T>, done: (result: T) => void): Promise<Record<string, string> | null> {
  try {
    done(await request());
    return null;
  } catch (error) {
    if (error instanceof ApiFailure && error.status === 422) return error.fields;
    answerRefusal(card, error);
    return {};
  }
}

const withCard = (cardId: string, change: (c: Card) => Card): void =>
  set((s) => ({
    board: s.board ? mapCard(s.board, cardId, change) : s.board,
    cardRoute: s.cardRoute?.cardId === cardId && s.cardRoute.card ? { ...s.cardRoute, card: change(s.cardRoute.card) } : s.cardRoute,
  }));

export const addChecklistItem = (card: Card, text: string): Promise<Record<string, string> | null> =>
  cardWrite(card, () => call<{ item: ChecklistItem }>(`/api/cards/${card.id}/checklist`, { method: 'POST', body: { text } }), ({ item }) => {
    withCard(card.id, (c) => ({ ...c, checklist: [...c.checklist.filter((i) => i.id !== item.id), item] }));
    announce(sentences.itemAdded(item.text));
  });

export const tickChecklistItem = (card: Card, itemId: string, done: boolean): Promise<Record<string, string> | null> =>
  cardWrite(card, () => call<{ item: ChecklistItem }>(`/api/checklist-items/${itemId}`, { method: 'PATCH', body: { done } }), ({ item }) => {
    withCard(card.id, (c) => ({ ...c, checklist: c.checklist.map((i) => (i.id === item.id ? item : i)) }));
    announce(item.done ? sentences.checked(item.text) : sentences.unchecked(item.text));
  });

export const deleteChecklistItem = (card: Card, itemId: string): Promise<Record<string, string> | null> =>
  cardWrite(card, () => call(`/api/checklist-items/${itemId}`, { method: 'DELETE' }), () =>
    withCard(card.id, (c) => ({ ...c, checklist: c.checklist.filter((i) => i.id !== itemId) })),
  );

export const setPrivateMembers = (card: Card, userIds: string[]): Promise<Record<string, string> | null> =>
  cardWrite(card, () => call<{ card: Card }>(`/api/cards/${card.id}/private-members`, { method: 'PUT', body: { userIds } }), ({ card: next }) =>
    withCard(card.id, () => next),
  );

/** Uploads a file; null means it was attached, otherwise the HTTP status that refused it (0 when nothing answered). */
export async function attachFile(card: Card, file: File): Promise<number | null> {
  const form = new FormData();
  form.append('file', file, file.name);
  try {
    const { attachment } = await call<{ attachment: Attachment }>(`/api/cards/${card.id}/attachments`, { method: 'POST', form });
    withCard(card.id, (c) => ({ ...c, attachments: [...(c.attachments ?? []).filter((a) => a.id !== attachment.id), attachment] }));
    announce(sentences.attached(attachment.filename));
    return null;
  } catch (error) {
    if (!(error instanceof ApiFailure)) return 0;
    if (error.status === 403 || error.status === 404) answerRefusal(card, error);
    return error.status;
  }
}

export const removeAttachment = (card: Card, attachmentId: string): Promise<Record<string, string> | null> =>
  cardWrite(card, () => call(`/api/attachments/${attachmentId}`, { method: 'DELETE' }), () =>
    withCard(card.id, (c) => ({ ...c, attachments: (c.attachments ?? []).filter((a) => a.id !== attachmentId) })),
  );

export async function deleteCard(card: Card): Promise<boolean> {
  try {
    await call(`/api/cards/${card.id}`, { method: 'DELETE' });
    ownWrites.set(card.id, Number.POSITIVE_INFINITY);
    set((s) => ({ board: s.board ? removeCard(s.board, card.id) : s.board }));
    closeCard();
    void reread();
    return true;
  } catch (error) {
    if (error instanceof ApiFailure && error.status === 404) cardGone(card);
    else addNotice(error instanceof ApiFailure && error.status === 503 ? COPY.deleteBlocked : COPY.wentWrong);
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// Lists and boards

export async function addList(boardId: string, name: string): Promise<Record<string, string> | null> {
  try {
    const { list } = await call<{ list: ListView }>(`/api/boards/${boardId}/lists`, { method: 'POST', body: { name } });
    now((s) => ({ board: s.board && !s.board.lists.some((l) => l.id === list.id) ? { ...s.board, lists: [...s.board.lists, list] } : s.board, selectedListId: list.id }));
    navigate(`/boards/${boardId}?list=${list.id}`, { replace: true });
    requestFocus(`[data-add-card="${list.id}"]`);
    return null;
  } catch (error) {
    if (error instanceof ApiFailure && error.status === 422) return error.fields;
    addNotice(COPY.wentWrong);
    return {};
  }
}

export function afterBoardCreated(boardId: string): void {
  set({ focusOnReady: { boardId, selector: '[data-add-list]' } });
  navigate(`/boards/${boardId}`);
}

/** The control to focus now that `boardId` is on screen, if one was asked for. */
export function takeFocusOnReady(boardId: string): string | null {
  const wanted = state.focusOnReady;
  if (wanted?.boardId !== boardId) return null;
  set({ focusOnReady: null });
  return wanted.selector;
}

// ---------------------------------------------------------------------------------------------
// Search: the results always belong to the text in the box

export function setSearchText(text: string): void {
  window.clearTimeout(searchTimer);
  searchAbort?.abort();
  searchAbort = null;
  const mine = ++searchSeq;
  const length = [...text].length;
  if (length < SEARCH_MIN || length > SEARCH_MAX) {
    flushSync(() => set({ search: { text, results: [], status: '' } }));
    if (length > SEARCH_MAX) {
      searchTimer = window.setTimeout(() => {
        if (mine === searchSeq) settle(text, [], COPY.searchLimit);
      }, 250);
    }
    return;
  }
  set((s) => ({ search: { ...s.search, text } }));
  searchTimer = window.setTimeout(() => void runSearch(text, mine), 250);
}

function settle(text: string, results: SearchResponse['results'], status: string): void {
  flushSync(() => set({ search: { text, results, status: '' } }));
  flushSync(() => set({ search: { text, results, status } }));
}

async function runSearch(text: string, mine: number): Promise<void> {
  const workspace = state.board?.workspaceId ?? state.workspace?.id;
  if (!workspace) return;
  const abort = new AbortController();
  searchAbort = abort;
  try {
    const reply = await call<SearchResponse>(`/api/workspaces/${workspace}/search?q=${encodeURIComponent(text)}`, { signal: abort.signal });
    if (mine !== searchSeq) return;
    settle(text, reply.results, sentences.search(reply.results.length, reply.total, text));
  } catch {
    // an abandoned or failed search paints nothing
  }
}

export function clearSearch(): void {
  setSearchText('');
}

