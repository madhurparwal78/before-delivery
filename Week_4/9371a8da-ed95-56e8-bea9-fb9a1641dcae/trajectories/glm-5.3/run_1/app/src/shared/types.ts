export type Role = 'owner' | 'editor' | 'reviewer' | 'viewer';

export interface UserShape {
  id: string;
  email: string;
  displayName: string;
  handle: string;
}

export interface PersonShape {
  id: string;
  displayName: string;
  handle: string;
}

export interface ProjectSummary {
  id: string;
  title: string;
  template: string;
  role: Role;
  projectRevision: number;
}

export interface TextFile {
  id: string;
  path: string;
  kind: 'text';
  revision: number;
  size: number;
  content: string;
}

export interface AssetShape {
  id: string;
  path: string;
  kind: 'asset';
  size: number;
  contentType: string;
  sha256: string;
}

export type FileSummary = (TextFile | AssetShape) & { content?: string };

export type SuggestionStatus = 'open' | 'accepted' | 'rejected' | 'orphaned';

export interface Suggestion {
  id: string;
  fileId: string;
  from: number | null;
  to: number | null;
  deleted: string;
  inserted: string;
  status: SuggestionStatus;
  author: PersonShape;
  createdAt: string;
  resolvedBy: PersonShape | null;
  resolvedAt: string | null;
}

export interface Comment {
  id: string;
  author: PersonShape;
  body: string;
  createdAt: string;
}

export interface Thread {
  id: string;
  fileId: string;
  from: number | null;
  to: number | null;
  quote: string;
  status: 'open' | 'resolved';
  orphaned: boolean;
  comments: Comment[];
  resolvedBy: PersonShape | null;
}

export type EntryKind =
  | 'created'
  | 'save'
  | 'accept'
  | 'file_create'
  | 'file_rename'
  | 'file_delete'
  | 'upload'
  | 'restore';

export interface LedgerEntry {
  projectRevision: number;
  kind: EntryKind;
  summary: string;
  actor: PersonShape;
  at: string;
  labels: string[];
}

export interface Label {
  id: string;
  name: string;
  projectRevision: number;
  createdAt: string;
  createdBy: PersonShape;
}

export interface Member {
  user: UserShape | PersonShape;
  role: Role;
}

export type InviteStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

export interface Invite {
  id: string;
  email: string;
  role: Role;
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

export interface CitationItem {
  key: string;
  path: string;
  line: number;
}

export interface CitationReport {
  projectRevision: number;
  checkId: string;
  undefined: CitationItem[];
  unused: CitationItem[];
  duplicate: CitationItem[];
}

export interface ExportShape {
  id: string;
  projectRevision: number;
  size: number;
  sha256: string;
  downloadUrl: string;
  filename: string;
}

export interface Readiness {
  openSuggestions: number;
  openThreads: number;
  undefinedCitations: number;
  duplicateKeys: number;
}
