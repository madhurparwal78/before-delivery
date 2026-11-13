import type {
  BoardListEntry,
  BoardReadPayload,
  BoardRole,
  CardPayload,
  CountEntry,
  ListPayload,
  MePayload,
  MoverColour,
  SearchResult,
  ServiceStatusPayload,
  Visibility,
  WorkspacePayload,
  WorkspacePersonPayload,
  BoardMemberPayload,
} from '../shared/types';

export type Screen = 'loading' | 'signin' | 'board' | 'permissionLog' | 'boardNotFound' | 'cardNotFound';

export interface Notice {
  id: string;
  text: string;
}

export interface Lift {
  cardId: string;
  mode: 'keyboard' | 'pointer';
  originListId: string;
  originPosition: number;
  listId: string;
  position: number;
  pointerX: number;
  pointerY: number;
  grabX: number;
  grabY: number;
}

export interface MoverChip {
  displayName: string;
  initials: string;
  colour: MoverColour;
  fading: boolean;
}

export type Dialog =
  | {
      kind: 'card';
      cardId: string;
      drafts: Record<string, string>;
      labelDraft: string[] | null;
      message: string | null;
      pending: boolean;
      fieldErrors: Record<string, string>;
      openedViaPush: boolean;
      uploads: { id: string; filename: string; error: string | null }[];
    }
  | { kind: 'newBoard'; name: string; visibility: Visibility; error: string | null; pending: boolean }
  | { kind: 'move'; cardId: string; listId: string; position: number }
  | { kind: 'settings'; error: string | null; addUserId: string }
  | { kind: 'shortcuts' }
  | {
      kind: 'password';
      currentPassword: string;
      newPassword: string;
      message: string | null;
      errors: Record<string, string>;
      pending: boolean;
    }
  | { kind: 'boardsSheet' }
  | { kind: 'deleteCard'; cardId: string; pending: boolean };

export type Menu =
  | { kind: 'account' }
  | { kind: 'cardActions'; cardId: string }
  | { kind: 'role'; userId: string };

export interface SettingsData {
  members: BoardMemberPayload[];
  candidates: { userId: string; displayName: string }[];
}

export interface State {
  screen: Screen;
  me: MePayload | null;
  workspace: WorkspacePayload | null;
  boards: BoardListEntry[];
  board: BoardReadPayload | null;
  boardId: string | null;
  selectedListId: string | null;
  dialog: Dialog | null;
  menu: Menu | null;
  notices: Notice[];
  announcements: string[];
  status: ServiceStatusPayload;
  lift: Lift | null;
  movers: Map<string, MoverChip>;
  search: { text: string; results: SearchResult[]; status: string };
  signIn: { email: string; password: string; error: string | null; pending: boolean; next: string | null };
  settings: SettingsData | null;
  boardMembers: BoardMemberPayload[];
  workspacePeople: WorkspacePersonPayload[];
  logEntries: unknown[];
  listNameDraft: { open: boolean; value: string; error: string | null } | null;
  cardDraft: { listId: string; value: string; error: string | null } | null;
  pendingFocus: string | null;
}

export const state: State = {
  screen: 'loading',
  me: null,
  workspace: null,
  boards: [],
  board: null,
  boardId: null,
  selectedListId: null,
  dialog: null,
  menu: null,
  notices: [],
  announcements: [],
  status: { live: 'up', storage: 'up' },
  lift: null,
  movers: new Map(),
  search: { text: '', results: [], status: '' },
  signIn: { email: '', password: '', error: null, pending: false, next: null },
  settings: null,
  boardMembers: [],
  workspacePeople: [],
  logEntries: [],
  listNameDraft: null,
  cardDraft: null,
  pendingFocus: null,
};

let renderer: (() => void) | null = null;
let scheduled = false;

export function onRender(callback: () => void): void {
  renderer = callback;
}

export function requestRender(): void {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    renderer?.();
  });
}

export function announce(...sentences: string[]): void {
  state.announcements = sentences;
  requestRender();
}

let noticeCounter = 0;

export function addNotice(text: string): void {
  noticeCounter += 1;
  state.notices = [{ id: `notice-${noticeCounter}`, text }, ...state.notices];
  requestRender();
}

export function focusAfterRender(key: string): void {
  state.pendingFocus = key;
  requestRender();
}

export function dismissNotice(id: string): void {
  state.notices = state.notices.filter((notice) => notice.id !== id);
  requestRender();
}

export function clearAll(): void {
  state.screen = 'signin';
  state.me = null;
  state.workspace = null;
  state.boards = [];
  state.board = null;
  state.boardId = null;
  state.selectedListId = null;
  state.dialog = null;
  state.menu = null;
  state.notices = [];
  state.announcements = [];
  state.status = { live: 'up', storage: 'up' };
  state.lift = null;
  state.movers = new Map();
  state.search = { text: '', results: [], status: '' };
  state.signIn = { email: '', password: '', error: null, pending: false, next: null };
  state.settings = null;
  state.boardMembers = [];
  state.workspacePeople = [];
  state.logEntries = [];
  state.listNameDraft = null;
  state.cardDraft = null;
  state.pendingFocus = null;
}

export function listOf(listId: string): ListPayload | null {
  return state.board?.lists.find((list) => list.id === listId) ?? null;
}

export function cardOf(cardId: string): CardPayload | null {
  for (const list of state.board?.lists ?? []) {
    const card = list.cards.find((item) => item.id === cardId);
    if (card !== undefined) return card;
  }
  return null;
}

export function listOfCard(cardId: string): ListPayload | null {
  for (const list of state.board?.lists ?? []) {
    if (list.cards.some((card) => card.id === cardId)) return list;
  }
  return null;
}

export function role(): BoardRole {
  return state.board?.role ?? 'observer';
}

export function canEdit(): boolean {
  const current = role();
  return current === 'member' || current === 'admin';
}

export function isBoardAdmin(): boolean {
  return role() === 'admin';
}

export function isWorkspaceAdmin(): boolean {
  return state.workspace?.role === 'admin';
}

function renumber(list: ListPayload): void {
  list.cards.forEach((card, index) => {
    card.position = index + 1;
  });
}

export function applyCounts(counts: CountEntry[]): void {
  for (const entry of counts) {
    const list = listOf(entry.listId);
    if (list !== null) list.count = entry.count;
  }
}

export function applyOpenCards(count: number): void {
  const boardId = state.boardId;
  if (boardId === null) return;
  const entry = state.boards.find((board) => board.id === boardId);
  if (entry !== undefined) entry.openCards = count;
}

export function recountOpenCards(): void {
  if (state.board === null) return;
  const open = state.board.lists.reduce(
    (total, list) => total + list.cards.filter((card) => card.status === 'open').length,
    0,
  );
  applyOpenCards(open);
}

/** Puts a card payload into the board, moving it between lists when the server says so. */
export function applyCard(card: CardPayload): void {
  if (state.board === null) return;
  removeCard(card.id);
  const list = listOf(card.listId);
  if (list === null) return;
  const index = card.position === null ? list.cards.length : Math.max(0, card.position - 1);
  list.cards.splice(Math.min(index, list.cards.length), 0, card);
  renumber(list);
}

export function removeCard(cardId: string): void {
  for (const list of state.board?.lists ?? []) {
    const index = list.cards.findIndex((card) => card.id === cardId);
    if (index === -1) continue;
    list.cards.splice(index, 1);
    renumber(list);
  }
}

export function selectedLists(): ListPayload[] {
  const lists = state.board?.lists ?? [];
  if (lists.length === 0) return [];
  const width = window.innerWidth;
  if (width >= 1200) return lists;
  const index = Math.max(
    0,
    lists.findIndex((list) => list.id === state.selectedListId),
  );
  if (width < 768) return [lists[index] as ListPayload];
  if (index === lists.length - 1 && lists.length > 1) {
    return [lists[index - 1] as ListPayload, lists[index] as ListPayload];
  }
  return lists.slice(index, index + 2);
}

export function showsListSwitcher(): boolean {
  return window.innerWidth < 1200;
}

export function isPhone(): boolean {
  return window.innerWidth < 768;
}
