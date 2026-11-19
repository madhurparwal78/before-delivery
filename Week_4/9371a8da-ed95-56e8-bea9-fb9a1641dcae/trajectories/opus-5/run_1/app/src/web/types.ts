export type ProjectRole = 'owner' | 'editor' | 'reviewer' | 'viewer';

export interface Person {
  id?: string;
  displayName: string;
  handle?: string;
}

export interface User {
  id: string;
  email: string;
  displayName: string;
  handle: string;
}

export interface Workspace {
  id: string;
  name: string;
  role: 'owner' | 'member';
}

export interface ProjectSummary {
  id: string;
  title: string;
  template: string;
  role: ProjectRole;
  projectRevision: number;
}

export interface TextFile {
  id: string;
  path: string;
  kind: 'text';
  revision: number;
  size: number;
  content?: string;
}

export interface Asset {
  id: string;
  path: string;
  kind: 'asset';
  size: number;
  contentType: string;
  sha256: string;
}

export type ProjectFile = TextFile | Asset;

export type SuggestionStatus = 'open' | 'accepted' | 'rejected' | 'orphaned';

export interface Suggestion {
  id: string;
  fileId: string;
  from: number | null;
  to: number | null;
  deleted: string;
  inserted: string;
  status: SuggestionStatus;
  author: Person;
  createdAt: string;
  resolvedBy: Person | null;
  resolvedAt: string | null;
}

export interface Comment {
  id: string;
  author: Person;
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
  resolvedBy: Person | null;
}

export interface Review {
  suggestions: Suggestion[];
  threads: Thread[];
  openSuggestions: number;
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

export interface Entry {
  projectRevision: number;
  kind: string;
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
  role: ProjectRole;
}

export interface Invite {
  id: string;
  email: string;
  role: string;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
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

export interface ExportRecord {
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
