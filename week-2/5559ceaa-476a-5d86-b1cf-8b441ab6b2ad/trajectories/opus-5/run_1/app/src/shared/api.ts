export type UserKind = 'mentor' | 'learner';
export type MemberRole = 'mentor' | 'student';
export type EmailStatus = 'sent' | 'queued' | 'none';
export type ProjectKind = 'one_to_one' | 'group';
export type SessionState = 'scheduled' | 'live' | 'paused' | 'ended';
export type CheckpointState = 'pending_upload' | 'saved' | 'failed';
export type LinkState = 'active' | 'expired' | 'revoked';
export type EntryStatus = 'new' | 'changed' | 'unchanged';
export type ImportDecision = 'keep' | 'replace';

export interface User {
  id: string;
  email: string | null;
  name: string;
  kind: UserKind;
}

export interface Member {
  user_id: string;
  name: string;
  role: MemberRole;
  online: boolean;
  email_status: EmailStatus;
}

export interface FileMeta {
  id: string;
  path: string;
  revision: number;
  sha256: string;
  size: number;
}

export interface Session {
  id: string;
  project_id: string;
  title: string;
  state: SessionState;
  scheduled_for: string;
  driver_id: string | null;
  version: number;
}

export interface Checkpoint {
  id: string;
  project_id: string;
  name: string;
  state: CheckpointState;
  created_by: { id: string | null; name: string };
  created_at: string;
  file_count: number;
}

export interface CheckpointFileRow {
  file_id: string;
  path: string;
  current_path: string | null;
  sha256: string;
  size: number;
}

export interface ReviewerLink {
  id: string;
  checkpoint_id: string;
  url: string;
  expires_at: string;
  state: LinkState;
  email_status: EmailStatus;
}

export interface ProjectListEntry {
  id: string;
  title: string;
  kind: ProjectKind;
  role: MemberRole;
  student_count: number;
}

export interface ProjectDetail {
  id: string;
  title: string;
  kind: ProjectKind;
  owner: { id: string; name: string };
  members: Member[];
  sessions: Session[];
}

export interface AuditEvent {
  id: string;
  type: string;
  actor: { id: string | null; name: string };
  subject: Record<string, unknown>;
  at: string;
}

export interface ImportEntry {
  path: string;
  status: EntryStatus;
  file_id: string | null;
}

export interface ImportPlanView {
  id: string;
  state: 'planned';
  expires_at: string;
  entries: ImportEntry[];
  only_in_project: string[];
  ignored: string[];
}

export interface ImportAppliedView {
  id: string;
  state: 'applied';
  added: number;
  replaced: number;
  kept: number;
  unchanged: number;
}

export interface RejectedEntry {
  path: string;
  reason: string;
  limit?: number;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    [extra: string]: unknown;
  };
}

export type ServerFrame =
  | { type: 'hello'; you: Member; session: Session | null; participants: Member[] }
  | { type: 'presence'; participants: Member[] }
  | { type: 'session'; session: Session }
  | { type: 'file'; file: FileMeta }
  | { type: 'file_deleted'; file_id: string }
  | { type: 'checkpoint'; checkpoint: Checkpoint }
  | { type: 'cursor'; user_id: string; file_id: string; path: string; line: number; column: number }
  | {
      type: 'edit_rejected';
      file_id: string;
      code: 'not_driver' | 'session_paused' | 'stale_revision' | 'validation';
      current_revision: number | null;
    }
  | { type: 'access_revoked' };

export type ClientFrame =
  | { type: 'edit'; file_id: string; base_revision: number; content: string }
  | { type: 'cursor'; file_id: string; line: number; column: number };
