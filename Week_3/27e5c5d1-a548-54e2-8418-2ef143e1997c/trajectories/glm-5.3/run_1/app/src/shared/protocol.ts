// Shared protocol definitions: the exact wire shapes published in the API contract.

export type Role = 'observer' | 'member' | 'admin';
export type WorkspaceRole = 'admin' | 'member';
export type Visibility = 'workspace' | 'private';
export type CardStatus = 'open' | 'done' | 'archived';
export type DueState = 'overdue' | 'due_today' | 'upcoming' | null;
export type Colour = 'sage' | 'clay' | 'plum' | 'ochre' | 'slate' | 'rose';
export type ServiceState = 'up' | 'down' | 'paused';

export const LABELS = ['Medication', 'Appointment', 'Bills', 'Visit', 'Paperwork'] as const;
export type Label = (typeof LABELS)[number];

export interface PersonChip {
  displayName: string;
  initials: string;
  colour: Colour;
}

export interface OwnerChip extends PersonChip {
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

export interface PrivateMemberRef {
  userId: string;
  displayName: string;
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
  owner: OwnerChip | null;
  checklist: ChecklistItem[];
  notes?: string;
  isPrivate?: boolean;
  privateMembers?: PrivateMemberRef[];
  attachments?: Attachment[];
}

export interface CardList {
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

export interface SessionUser {
  userId: string;
  displayName: string;
  initials: string;
  colour: Colour;
}

export interface MeWorkspace {
  id: string;
  name: string;
  parentName: string;
  timeZone: string;
  role: WorkspaceRole;
}

export interface BoardMemberView {
  displayName: string;
  initials: string;
  colour: Colour;
  userId?: string;
  role?: Role;
  phone?: string;
  email?: string;
}

export interface WorkspacePersonView {
  displayName: string;
  initials: string;
  colour: Colour;
  userId?: string;
  role?: WorkspaceRole;
  email?: string;
  phone?: string;
}

export interface ListCount {
  listId: string;
  count: number;
}

export interface CardWriteReply {
  card: Card;
  counts?: ListCount[];
  openCards?: number;
}

export interface BoardPayload {
  board: { id: string; name: string; visibility: Visibility; workspaceId: string; parentName: string };
  role: Role;
  lists: CardList[];
}

export interface PermissionLogEntry {
  id: string;
  at: string;
  actor: { userId: string; displayName: string };
  action: string;
  target: { type: 'user' | 'board' | 'card'; id: string; label: string };
  board: { id: string; name: string } | null;
  before: string | null;
  after: string | null;
}

export interface SearchResult {
  cardId: string;
  boardId: string;
  boardName: string;
  listName: string;
  title: string;
}

export interface SearchReply {
  results: SearchResult[];
  total: number;
}

export type ChangedBy = { displayName: string };

export interface ApiErrorBody {
  error: string;
  fields?: Record<string, string>;
  card?: Card;
  changedBy?: ChangedBy;
  change?: 'moved' | 'edited';
  from?: string;
  to?: string;
}
