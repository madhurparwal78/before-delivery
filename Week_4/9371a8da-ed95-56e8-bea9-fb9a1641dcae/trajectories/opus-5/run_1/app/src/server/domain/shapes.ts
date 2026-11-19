import { ProjectRole } from './roles.js';

export interface PersonRow {
  id: string;
  display_name: string;
  handle: string;
  email: string;
}

export interface Person {
  id: string;
  displayName: string;
  handle: string;
}

export interface User extends Person {
  email: string;
}

export interface SharePerson {
  displayName: string;
}

/** Which fields each audience may see about a person. */
export const personView = {
  person(row: PersonRow): Person {
    return { id: row.id, displayName: row.display_name, handle: row.handle };
  },
  user(row: PersonRow): User {
    return {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      handle: row.handle,
    };
  },
  shared(row: { display_name: string }): SharePerson {
    return { displayName: row.display_name };
  },
  /** An actor or label creator, named as they were when the record was written. */
  snapshot(row: { actor_id: string; actor_display_name: string; actor_handle: string }): Person {
    return {
      id: row.actor_id,
      displayName: row.actor_display_name,
      handle: row.actor_handle,
    };
  },
};

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

export interface FileRow {
  id: string;
  project_id: string;
  kind: 'text' | 'asset';
  path: string;
  revision: number;
  content: string | null;
  size: number;
  sha256: string;
  content_type: string | null;
  deleted: boolean;
}

export function fileShape(row: FileRow, withContent: boolean): ProjectFile {
  if (row.kind === 'text') {
    const file: TextFile = {
      id: row.id,
      path: row.path,
      kind: 'text',
      revision: row.revision,
      size: row.size,
    };
    if (withContent) file.content = row.content ?? '';
    return file;
  }
  return {
    id: row.id,
    path: row.path,
    kind: 'asset',
    size: row.size,
    contentType: row.content_type ?? 'application/octet-stream',
    sha256: row.sha256,
  };
}

export interface ProjectSummary {
  id: string;
  title: string;
  template: string;
  role: ProjectRole;
  projectRevision: number;
}

export type SuggestionStatus = 'open' | 'accepted' | 'rejected' | 'orphaned';

export interface Suggestion {
  id: string;
  fileId: string;
  from: number | null;
  to: number | null;
  deleted: string;
  inserted: string;
  status: SuggestionStatus;
  author: Person | SharePerson;
  createdAt: string;
  resolvedBy: Person | SharePerson | null;
  resolvedAt: string | null;
}

export interface ThreadComment {
  id: string;
  author: Person | SharePerson;
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
  comments: ThreadComment[];
  resolvedBy: Person | SharePerson | null;
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
  status: string;
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

export interface ExportShape {
  id: string;
  projectRevision: number;
  size: number;
  sha256: string;
  downloadUrl: string;
  filename: string;
}

export function iso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}
