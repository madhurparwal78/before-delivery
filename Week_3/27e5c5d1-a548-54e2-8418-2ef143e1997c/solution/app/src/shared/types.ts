export const COLOURS = ['sage', 'clay', 'plum', 'ochre', 'slate', 'rose'] as const;
export type Colour = (typeof COLOURS)[number];

export const ROLES = ['observer', 'member', 'admin'] as const;
export type Role = (typeof ROLES)[number];

/** The roles that may change a board's cards; observers only read. */
export const WRITER_ROLES: readonly Role[] = ['member', 'admin'];
export const isWriter = (role: Role): boolean => WRITER_ROLES.includes(role);

export const LABELS = ['Medication', 'Appointment', 'Bills', 'Visit', 'Paperwork'] as const;
export type Label = (typeof LABELS)[number];

export type CardStatus = 'open' | 'done' | 'archived';
export type DueState = 'overdue' | 'due_today' | 'upcoming' | null;
export type Visibility = 'workspace' | 'private';

export interface Person {
  displayName: string;
  initials: string;
  colour: Colour;
}

export interface Owner extends Person {
  userId?: string;
}

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface Attachment {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  uploadedAt: string;
  uploadedBy: { displayName: string };
}

export interface Card {
  id: string;
  boardId: string;
  listId: string;
  title: string;
  position: number | null;
  labels: Label[];
  dueDate: string | null;
  dueState: DueState;
  status: CardStatus;
  version: number;
  owner: Owner | null;
  checklist: ChecklistItem[];
  notes?: string;
  isPrivate?: boolean;
  privateMembers?: { userId: string; displayName: string }[];
  attachments?: Attachment[];
}

export interface ListCount {
  listId: string;
  count: number;
}

export interface ListView {
  id: string;
  name: string;
  count: number;
  cards: Card[];
}

export interface BoardSummary {
  id: string;
  name: string;
  visibility: Visibility;
  role: Role;
  openCards: number;
}

export interface BoardView {
  board: { id: string; name: string; visibility: Visibility; workspaceId: string; parentName: string };
  role: Role;
  lists: ListView[];
}

export interface WorkspaceInfo {
  id: string;
  name: string;
  parentName: string;
  timeZone: string;
  role: 'admin' | 'member';
}

export interface Me {
  userId: string;
  displayName: string;
  initials: string;
  colour: Colour;
  email: string;
  workspaces: WorkspaceInfo[];
}

export interface BoardMember extends Person {
  userId?: string;
  role?: Role;
  phone?: string | null;
  email?: string;
}

export interface SearchResponse {
  results: { cardId: string; boardId: string; boardName: string; listName: string; title: string }[];
  total: number;
}

export interface LogEntry {
  id: string;
  at: string;
  actor: { userId: string; displayName: string };
  action: string;
  target: { type: 'user' | 'board' | 'card'; id: string; label: string };
  board: { id: string; name: string } | null;
  before: unknown;
  after: unknown;
}

export interface MoveReply {
  card: Card;
  counts: ListCount[];
  openCards: number;
}

export type StaleReply = {
  error: 'stale';
  card: Card;
  changedBy: { displayName: string };
  change: 'moved' | 'edited';
};

export type LiveEvent =
  | { type: 'card.created'; data: { card: Card; counts: ListCount[] } }
  | { type: 'card.updated'; data: { card: Card } }
  | {
      type: 'card.moved';
      data: {
        card: Card;
        from: { listId: string; position: number };
        to: { listId: string; position: number };
        mover: Person;
        counts: ListCount[];
      };
    }
  | { type: 'card.removed'; data: { cardId: string; counts: ListCount[] } }
  | { type: 'list.created'; data: { list: { id: string; name: string } } }
  | { type: 'list.updated'; data: { list: { id: string; name: string } } }
  | { type: 'board.updated'; data: { board: { id: string; name: string; visibility: Visibility } } }
  | { type: 'access.changed'; data: { role: Role | null } }
  | { type: 'session.ended'; data: Record<string, never> }
  | { type: 'live.paused'; data: Record<string, never> }
  | { type: 'live.resumed'; data: Record<string, never> };

export type LiveEventType = LiveEvent['type'];
