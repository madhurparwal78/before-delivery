// Wire shapes of the Marginalia API, shared by the server and the browser.

export type Role = "owner" | "editor" | "reviewer" | "viewer";
export type InviteRole = Exclude<Role, "owner">;
export type TemplateId = "thesis-numbered" | "article-single";

export interface User {
  id: string;
  email: string;
  displayName: string;
  handle: string;
}

export interface Person {
  id: string;
  displayName: string;
  handle: string;
}

/** How a person is named through a share link. */
export interface SharedPerson {
  displayName: string;
}

export interface Workspace {
  id: string;
  name: string;
  role: "owner" | "member";
}

export interface ProjectSummary {
  id: string;
  title: string;
  template: TemplateId;
  role: Role;
  projectRevision: number;
}

export interface TextFile {
  id: string;
  path: string;
  kind: "text";
  revision: number;
  size: number;
  content?: string;
}

export interface Asset {
  id: string;
  path: string;
  kind: "asset";
  size: number;
  contentType: string;
  sha256: string;
}

export type ProjectFile = TextFile | Asset;

export type SuggestionStatus = "open" | "accepted" | "rejected" | "orphaned";

export interface Suggestion<P = Person> {
  id: string;
  fileId: string;
  from: number | null;
  to: number | null;
  deleted: string;
  inserted: string;
  status: SuggestionStatus;
  author: P;
  createdAt: string;
  resolvedBy: P | null;
  resolvedAt: string | null;
}

export interface Comment<P = Person> {
  id: string;
  author: P;
  body: string;
  createdAt: string;
}

export interface Thread<P = Person> {
  id: string;
  fileId: string;
  from: number | null;
  to: number | null;
  quote: string;
  status: "open" | "resolved";
  orphaned: boolean;
  comments: Comment<P>[];
  resolvedBy: P | null;
}

export interface Review<P = Person> {
  suggestions: Suggestion<P>[];
  threads: Thread<P>[];
  openSuggestions: number;
}

export type EntryKind =
  | "created"
  | "save"
  | "accept"
  | "file_create"
  | "file_rename"
  | "file_delete"
  | "upload"
  | "restore";

export interface Entry {
  projectRevision: number;
  kind: EntryKind;
  summary: string;
  actor: Person;
  at: string;
  labels: string[];
}

export interface Label {
  id: string;
  name: string;
  projectRevision: number;
  createdAt: string;
  createdBy: Person;
}

export interface Member {
  user: User | Person;
  role: Role;
}

export type InviteStatus = "pending" | "accepted" | "revoked" | "expired";

export interface Invite {
  id: string;
  email: string;
  role: InviteRole;
  status: InviteStatus;
  sentAt: string;
  expiresAt: string;
}

export interface ShareLink {
  token: string;
  url: string;
  createdAt: string;
  expiresAt: string;
  active: boolean;
}

export interface CitationWarning {
  key: string;
  path: string;
  line: number;
}

export interface CitationReport {
  projectRevision: number;
  checkId: string;
  undefined: CitationWarning[];
  unused: CitationWarning[];
  duplicate: CitationWarning[];
}

export interface Readiness {
  openSuggestions: number;
  openThreads: number;
  undefinedCitations: number;
  duplicateKeys: number;
}

export interface Export {
  id: string;
  projectRevision: number;
  size: number;
  sha256: string;
  downloadUrl: string;
  filename: string;
}

export interface InvitePreview {
  projectTitle: string;
  role: InviteRole;
  inviterName: string;
  email: string;
  expiresAt: string;
}

/** Every error body: a code, optional field messages and the extra keys of its row. */
export interface ApiErrorBody {
  error: string;
  errors?: Record<string, string>;
  current?: TextFile;
  suggestion?: Suggestion;
  readiness?: Readiness;
  retryAfterSeconds?: number;
  status?: InviteStatus;
  projectId?: string;
}
