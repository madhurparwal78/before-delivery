export type Role = "owner" | "editor" | "commenter" | "viewer";
export type ShareRole = Exclude<Role, "owner">;
export type Mode = "editing" | "suggesting" | "viewing";
export type EditMode = Exclude<Mode, "viewing">;
export type BlockStyle = "title" | "heading1" | "heading2" | "heading3" | "paragraph" | "bullet" | "numbered";
export type ToggleMark = "bold" | "italic" | "underline";
type MarkType = ToggleMark | "link";
export type SuggestionKind = "insert" | "delete" | "replace";
export type SuggestionStatus = "open" | "accepted" | "rejected";
export type CommentStatus = "open" | "resolved" | "reopened";
export type SaveState = "saved" | "saving" | "failed";
export type ShareStatus = "active" | "expired";
export type Decision = "accept" | "reject";
export type PresenceState = "active" | "idle" | "left";
export type NoticeKind = "mention" | "shared" | "role_changed";
export type EndReason = "expired" | "removed" | "deleted";
export type ErrorCode = "not_found" | "forbidden" | "conflict" | "invalid" | "too_large" | "not_joined";

export const SHARE_ROLES: readonly ShareRole[] = ["editor", "commenter", "viewer"];
export const MODES: readonly Mode[] = ["editing", "suggesting", "viewing"];
export const BLOCK_STYLES: readonly BlockStyle[] = ["title", "heading1", "heading2", "heading3", "paragraph", "bullet", "numbered"];
export const TOGGLE_MARKS: readonly ToggleMark[] = ["bold", "italic", "underline"];

export interface Range { at: number; length: number }

export interface Person { personId: string; displayName: string; colour: string; role?: Role }
export interface SessionPerson { personId: string; displayName: string; email: string; colour: string; isConsultant: boolean }

export type Op =
  | { insert: string; at: number }
  | { delete: number; at: number }
  | { mark: ToggleMark; value: boolean; at: number; length: number }
  | { mark: "link"; value: string | null; at: number; length: number }
  | { style: BlockStyle; at: number };

export interface Block { style: BlockStyle; at: number; length: number }
export interface Mark { type: MarkType; at: number; length: number; href?: string }

export interface Suggestion {
  id: string;
  kind: SuggestionKind;
  author: Person;
  inserted: Range | null;
  deleted: Range | null;
  contentDeleted: boolean;
  status: SuggestionStatus;
  createdAt: string;
}

interface Reply { id: string; author: Person; body: string; createdAt: string }

export interface Comment {
  id: string;
  author: Person;
  body: string;
  mentions: Person[];
  anchor: Range | null;
  contentDeleted: boolean;
  status: CommentStatus;
  replies: Reply[];
  createdAt: string;
}

interface MyAccess { role: Role; mode: Mode; accessEndsAt: string | null }

export interface Snapshot {
  id: string;
  title: string;
  client: string;
  revision: number;
  savedRevision: number;
  saveState: SaveState;
  myAccess: MyAccess;
  text: string;
  blocks: Block[];
  marks: Mark[];
  suggestions: Suggestion[];
  comments: Comment[];
  people: Person[];
}

export interface ProposalSummary { id: string; title: string; client: string; role: Role; updatedAt: string; owner: Person }

export interface OwnerShare { shareId: string; person: Person; email: string; role: ShareRole; endsAt: string | null; status: ShareStatus }
export type ShareEntry = OwnerShare | { person: Person };

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

export interface PresenceEntry { person: Person; state: Exclude<PresenceState, "left"> }

export type Card = Suggestion | Comment;

export const MAX_BODY_BYTES = 65536;
export const MAX_DOC_CHARS = 200000;
export const MAX_INSERT_CHARS = 10000;
export const MAX_LINK_CHARS = 2000;

export const ROLE_LABEL: Record<Role, string> = { owner: "Owner", editor: "Editor", commenter: "Commenter", viewer: "Viewer" };
export const STYLE_LABEL: Record<BlockStyle, string> = {
  title: "Title", heading1: "Heading 1", heading2: "Heading 2", heading3: "Heading 3",
  paragraph: "Paragraph", bullet: "Bulleted item", numbered: "Numbered item",
};

/** The role permission table (Business rules, Roles): the only place it is decided. */
export function modesFor(role: Role): Mode[] {
  if (role === "owner" || role === "editor") return ["editing", "suggesting", "viewing"];
  if (role === "commenter") return ["suggesting", "viewing"];
  return ["viewing"];
}
export function canComment(role: Role): boolean { return role !== "viewer"; }
/** Op frames and replace all in a mode: Editing needs Editor or Owner, Suggesting needs Commenter or above. */
export function canWrite(role: Role, mode: EditMode): boolean { return modesFor(role).includes(mode); }
export function canDecide(role: Role): boolean { return role === "owner" || role === "editor"; }
export function isOwner(role: Role): boolean { return role === "owner"; }
export function defaultMode(role: Role): Mode { return modesFor(role)[0]; }
