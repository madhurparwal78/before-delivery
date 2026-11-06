export type Role = 'owner' | 'editor' | 'commenter' | 'viewer';
export type Mode = 'editing' | 'suggesting' | 'viewing';
export type EditMode = 'editing' | 'suggesting';
export type ShareStatus = 'active' | 'expired';
export type SuggestionKind = 'insert' | 'delete' | 'replace';
export type SuggestionStatus = 'open' | 'accepted' | 'rejected';
export type CommentStatus = 'open' | 'resolved' | 'reopened';
export type SaveState = 'saved' | 'saving' | 'failed';
export type BlockStyle = 'title' | 'heading1' | 'heading2' | 'heading3' | 'paragraph' | 'bullet' | 'numbered';
export type MarkType = 'bold' | 'italic' | 'underline' | 'link';
export type Decision = 'accept' | 'reject';
export type NoticeKind = 'mention' | 'shared' | 'role_changed';
export type PresenceState = 'active' | 'idle' | 'left';
export type AccessEndedReason = 'expired' | 'removed' | 'deleted';

export interface Person {
  personId: string;
  displayName: string;
  colour: string;
  role?: Role;
}

export interface Span {
  at: number;
  length: number;
}

export interface Block {
  style: BlockStyle;
  at: number;
  length: number;
}

export interface Mark {
  type: MarkType;
  at: number;
  length: number;
  href?: string;
}

export interface Suggestion {
  id: string;
  kind: SuggestionKind;
  author: Person;
  inserted: Span | null;
  deleted: Span | null;
  contentDeleted: boolean;
  status: SuggestionStatus;
  createdAt: string;
}

export interface CommentReply {
  id: string;
  author: Person;
  body: string;
  createdAt: string;
}

export interface Comment {
  id: string;
  author: Person;
  body: string;
  mentions: Person[];
  anchor: Span | null;
  contentDeleted: boolean;
  status: CommentStatus;
  replies: CommentReply[];
  createdAt: string;
}

export type Card = Suggestion | Comment;

export interface DocumentSummary {
  id: string;
  title: string;
  client: string;
  role: Role;
  updatedAt: string;
  owner: Person;
}

export interface Snapshot {
  id: string;
  title: string;
  client: string;
  revision: number;
  savedRevision: number;
  saveState: SaveState;
  myAccess: { role: Role; mode: Mode; accessEndsAt: string | null };
  text: string;
  blocks: Block[];
  marks: Mark[];
  suggestions: Suggestion[];
  comments: Comment[];
  people: Person[];
}

export interface ShareEntry {
  shareId?: string;
  person: Person;
  email?: string;
  role?: Role;
  endsAt?: string | null;
  status?: ShareStatus;
}

export interface Notice {
  id: string;
  kind: NoticeKind;
  documentId: string;
  documentTitle: string;
  actor: Person;
  role?: Role;
  commentId?: string;
  text: string;
  read: boolean;
  createdAt: string;
}

export type OpEntry =
  | { insert: string; at: number }
  | { delete: number; at: number }
  | { mark: 'bold' | 'italic' | 'underline'; value: boolean; at: number; length: number }
  | { mark: 'link'; value: string | null; at: number; length: number }
  | { style: BlockStyle; at: number };

export type TextEdit = { kind: 'insert'; at: number; length: number } | { kind: 'delete'; at: number; length: number };

export interface PresenceEntry {
  person: Person;
  state: 'active' | 'idle';
}

export type ClientFrame =
  | { type: 'join'; ref: string; documentId: string; revision?: number }
  | { type: 'op'; ref: string; baseRevision: number; mode: EditMode; ops: OpEntry[] }
  | { type: 'mode'; ref: string; mode: Mode }
  | { type: 'caret'; ref: string; at: number; length: number }
  | { type: 'heartbeat'; ref: string }
  | { type: 'replace_all'; ref: string; baseRevision: number; mode: EditMode; find: string; replace: string; matchCase: boolean }
  | { type: 'decide'; ref: string; suggestionId: string; decision: Decision }
  | { type: 'decide_all'; ref: string; decision: Decision }
  | { type: 'share'; ref: string; shareId: string; role?: Role; endsAt?: string | null };

export type ServerFrame =
  | { type: 'joined'; ref: string; documentId: string; revision: number; role: Role; mode: Mode; accessEndsAt: string | null; people: PresenceEntry[] }
  | { type: 'ack'; ref: string; revision?: number; count?: number; applied?: boolean; status?: SuggestionStatus }
  | { type: 'error'; ref: string; code: string; fields?: Record<string, string> }
  | { type: 'op'; revision: number; authorId: string; mode: EditMode; ops: OpEntry[] }
  | { type: 'card_added'; card: Card }
  | { type: 'card_changed'; card: Card }
  | { type: 'card_closed'; cardId: string; status: string; decidedBy: Person }
  | { type: 'caret'; person: Person; at: number; length: number }
  | { type: 'presence'; person: Person; state: PresenceState }
  | { type: 'saved'; revision: number }
  | { type: 'save_failed'; revision: number }
  | { type: 'role_changed'; role: Role; mode: Mode }
  | { type: 'title_changed'; title: string; client: string }
  | { type: 'access_ended'; reason: AccessEndedReason }
  | { type: 'notice'; notice: Notice }
  | { type: 'lists_changed' };

export const AUTHOR_COLOURS = {
  spruce: '#1f4d3f',
  plum: '#6b2d5c',
  slate: '#3a4f78',
  ochre: '#8a5a12',
  rust: '#8c3a1d',
  indigo: '#3b3a8f',
  magenta: '#9c2060',
} as const;

export const MAX_DOCUMENT_CHARACTERS = 200_000;
export const MAX_BODY_BYTES = 65_536;
