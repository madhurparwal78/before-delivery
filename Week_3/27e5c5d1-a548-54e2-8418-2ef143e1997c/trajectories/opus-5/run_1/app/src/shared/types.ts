export type BoardRole = 'observer' | 'member' | 'admin';
export type MembershipState = BoardRole | 'removed' | 'none';
export type WorkspaceRole = 'admin' | 'member';
export type Visibility = 'workspace' | 'private';
export type CardStatus = 'open' | 'done' | 'archived';
export type DueState = 'overdue' | 'due_today' | 'upcoming';
export type MoverColour = 'sage' | 'clay' | 'plum' | 'ochre' | 'slate' | 'rose';

export const LABELS = ['Medication', 'Appointment', 'Bills', 'Visit', 'Paperwork'] as const;
export type Label = (typeof LABELS)[number];

export interface PersonChip {
  displayName: string;
  initials: string;
  colour: MoverColour;
  userId?: string;
}

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface AttachmentPayload {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  uploadedAt: string;
  uploadedBy: { displayName: string };
}

export interface CardPayload {
  id: string;
  boardId: string;
  listId: string;
  title: string;
  position: number | null;
  labels: Label[];
  dueDate: string | null;
  dueState: DueState | null;
  status: CardStatus;
  version: number;
  owner: PersonChip | null;
  checklist: ChecklistItem[];
  notes?: string;
  isPrivate?: boolean;
  privateMembers?: { userId: string; displayName: string }[];
  attachments?: AttachmentPayload[];
}

export interface ListPayload {
  id: string;
  name: string;
  count: number;
  cards: CardPayload[];
}

export interface BoardPayload {
  id: string;
  name: string;
  visibility: Visibility;
  workspaceId: string;
  parentName: string;
}

export interface BoardReadPayload {
  board: BoardPayload;
  role: BoardRole;
  lists: ListPayload[];
}

export interface BoardListEntry {
  id: string;
  name: string;
  visibility: Visibility;
  role: BoardRole;
  openCards: number;
}

export interface CountEntry {
  listId: string;
  count: number;
}

export interface CardWriteReply {
  card: CardPayload;
  counts: CountEntry[];
  openCards: number;
}

export interface BoardMemberPayload {
  displayName: string;
  initials: string;
  colour: MoverColour;
  userId?: string;
  role?: BoardRole;
  phone?: string;
  email?: string;
}

export interface WorkspacePersonPayload {
  displayName: string;
  initials: string;
  colour: MoverColour;
  userId?: string;
  role?: WorkspaceRole;
  email?: string;
  phone?: string;
}

export interface WorkspacePayload {
  id: string;
  name: string;
  parentName: string;
  timeZone: string;
  role: WorkspaceRole;
}

export interface MePayload {
  userId: string;
  displayName: string;
  initials: string;
  colour: MoverColour;
  email: string;
  workspaces: WorkspacePayload[];
}

export interface SearchResult {
  cardId: string;
  boardId: string;
  boardName: string;
  listName: string;
  title: string;
}

export interface PermissionLogEntry {
  id: string;
  at: string;
  actor: { userId: string; displayName: string };
  action: string;
  target: { type: 'user' | 'board' | 'card'; id: string; label: string };
  board: { id: string; name: string } | null;
  before: string | string[] | null;
  after: string | string[] | null;
}

export interface ServiceStatusPayload {
  live: 'up' | 'paused';
  storage: 'up' | 'down';
}

export interface MoveEndpoint {
  listId: string;
  position: number | null;
}

export interface CardMovedData {
  card: CardPayload;
  from: MoveEndpoint;
  to: MoveEndpoint;
  mover: PersonChip;
  counts: CountEntry[];
}
