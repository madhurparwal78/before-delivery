import type { BoardPayload, BoardSummary, Card, CardList, Role } from '../shared/protocol.js';
import type { ApiErrorBody } from '../shared/protocol.js';

export interface Notice {
  id: string;
  text: string;
}

export interface MoverChip {
  userId: string;
  displayName: string;
  initials: string;
  colour: string;
  until: number;
}

export interface BoardState {
  boardId: string | null;
  boardName: string;
  visibility: 'workspace' | 'private';
  workspaceId: string;
  parentName: string;
  role: Role;
  lists: CardList[];
  version: number;
  loaded: boolean;
  notFound: boolean;
}

export interface DraftState {
  cardId: string;
  fields: Record<string, unknown>;
}

let noticeCounter = 0;

/** A per-card draft: fields the person edited but has not saved yet. */
export interface CardDraft {
  cardId: string;
  fields: Record<string, string>;
}

/**
 * One place owns board state: it merges re-reads, keeping drafts, notices, selection and focus.
 * Sign-out clears everything in one step.
 */
export class ClientStore {
  board: BoardState = {
    boardId: null,
    boardName: '',
    visibility: 'workspace',
    workspaceId: '',
    parentName: '',
    role: 'observer',
    lists: [],
    version: 0,
    loaded: false,
    notFound: false,
  };

  boards: BoardSummary[] = [];
  notices: Notice[] = [];
  chips = new Map<string, MoverChip>();
  search: {
    query: string;
    results: { cardId: string; boardId: string; boardName: string; listName: string; title: string }[];
    total: number;
    statusText: string;
  } = { query: '', results: [], total: 0, statusText: '' };
  serviceStatus = { live: 'up', storage: 'up' };
  session: { userId: string; displayName: string; initials: string; colour: string } | null = null;
  drafts = new Map<string, Record<string, string>>();
  workspaces: { id: string; name: string; parentName: string; timeZone: string; role: string }[] = [];
  activeWorkspaceId: string | null = null;

  private listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }

  setBoardFromPayload(payload: BoardPayload): void {
    this.board = {
      boardId: payload.board.id,
      boardName: payload.board.name,
      visibility: payload.board.visibility,
      workspaceId: payload.board.workspaceId,
      parentName: payload.board.parentName,
      role: payload.role,
      lists: payload.lists,
      version: this.board.version + 1,
      loaded: true,
      notFound: false,
    };
    this.activeWorkspaceId = payload.board.workspaceId;
    this.emit();
  }

  setBoardNotFound(): void {
    this.board = { ...this.board, notFound: true, loaded: true, lists: [] };
    this.emit();
  }

  clearBoard(): void {
    this.board = {
      boardId: null,
      boardName: '',
      visibility: 'workspace',
      workspaceId: '',
      parentName: '',
      role: 'observer',
      lists: [],
      version: 0,
      loaded: false,
      notFound: false,
    };
    this.emit();
  }

  setBoards(boards: BoardSummary[]): void {
    this.boards = boards;
    this.emit();
  }

  setBoardRole(role: Role): void {
    this.board.role = role;
    this.emit();
  }

  updateBoardSummary(boardId: string, patch: Partial<BoardSummary>): void {
    this.boards = this.boards.map((b) => (b.id === boardId ? { ...b, ...patch } : b));
    this.emit();
  }

  findCard(cardId: string): { card: Card; list: CardList } | null {
    for (const list of this.board.lists) {
      const card = list.cards.find((c) => c.id === cardId);
      if (card) return { card, list };
    }
    return null;
  }

  applyServerCounts(counts: { listId: string; count: number }[]): void {
    for (const entry of counts) {
      const list = this.board.lists.find((l) => l.id === entry.listId);
      if (list) list.count = entry.count;
    }
    this.emit();
  }

  applyOpenCards(boardId: string, openCards: number): void {
    this.boards = this.boards.map((b) => (b.id === boardId ? { ...b, openCards } : b));
    this.emit();
  }

  replaceCard(card: Card): void {
    const previous = this.findCard(card.id);
    if (previous) {
      if (previous.card.listId !== card.listId) {
        previous.list.cards = previous.list.cards.filter((c) => c.id !== card.id);
        const target = this.board.lists.find((l) => l.id === card.listId);
        if (target) {
          target.cards = target.cards.filter((c) => c.id !== card.id);
          target.cards.push(card);
          target.cards.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
          // keep the other cards' positions dense from the server's reply
          this.renumberFromCards();
        }
      } else {
        const index = previous.list.cards.findIndex((c) => c.id === card.id);
        if (index >= 0) previous.list.cards[index] = card;
        previous.list.cards.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
      }
    } else if (card.status !== 'archived') {
      const target = this.board.lists.find((l) => l.id === card.listId);
      if (target) {
        target.cards.push(card);
        target.cards.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
      }
    }
    this.emit();
  }

  removeCard(cardId: string): void {
    for (const list of this.board.lists) {
      const index = list.cards.findIndex((c) => c.id === cardId);
      if (index >= 0) {
        list.cards.splice(index, 1);
        this.renumberFromCards();
      }
    }
    this.emit();
  }

  private renumberFromCards(): void {
    for (const list of this.board.lists) {
      list.cards.forEach((card, index) => {
        card.position = index + 1;
      });
    }
  }

  addNotice(text: string): void {
    this.notices = [{ id: `notice-${++noticeCounter}`, text }, ...this.notices];
    this.emit();
  }

  dismissNotice(id: string): void {
    this.notices = this.notices.filter((n) => n.id !== id);
    this.emit();
  }

  setChip(cardId: string, chip: Omit<MoverChip, 'until'>): void {
    this.chips.set(cardId, { ...chip, until: Date.now() + 2500 });
    this.emit();
  }

  pruneChips(): void {
    let changed = false;
    for (const [cardId, chip] of this.chips) {
      if (Date.now() > chip.until) {
        this.chips.delete(cardId);
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  setServiceStatus(live: string, storage: string): void {
    const changed = this.serviceStatus.live !== live || this.serviceStatus.storage !== storage;
    this.serviceStatus = { live, storage };
    if (changed) this.emit();
  }

  setSearch(query: string, results: { cardId: string; boardId: string; boardName: string; listName: string; title: string }[], total: number, statusText: string): void {
    this.search = { query, results, total, statusText };
    this.emit();
  }

  clearSearch(): void {
    this.search = { query: '', results: [], total: 0, statusText: '' };
    this.emit();
  }

  /** Record a field the person edited; a re-read keeps it (DP-48). */
  saveDraftField(cardId: string, field: string, value: string): void {
    const draft = this.drafts.get(cardId) ?? {};
    draft[field] = value;
    this.drafts.set(cardId, draft);
  }

  /** The draft for one card, if any. */
  draftFor(cardId: string): Record<string, string> | null {
    return this.drafts.get(cardId) ?? null;
  }

  clearDraft(cardId: string): void {
    this.drafts.delete(cardId);
  }

  /** Sign-out: discard all in-page state in one step. */
  discardAll(): void {
    this.board = {
      boardId: null,
      boardName: '',
      visibility: 'workspace',
      workspaceId: '',
      parentName: '',
      role: 'observer',
      lists: [],
      version: 0,
      loaded: false,
      notFound: false,
    };
    this.boards = [];
    this.notices = [];
    this.chips.clear();
    this.search = { query: '', results: [], total: 0, statusText: '' };
    this.serviceStatus = { live: 'up', storage: 'up' };
    this.session = null;
    this.workspaces = [];
    this.activeWorkspaceId = null;
    this.drafts.clear();
    this.emit();
  }
}

export function errorText(body: ApiErrorBody | unknown, fallback: string): string {
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const err = body as ApiErrorBody;
    if (err.error === 'internal') return fallback;
  }
  return fallback;
}
