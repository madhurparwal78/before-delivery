export interface User {
  id: string;
  email: string | null;
  name: string;
  kind: "mentor" | "learner";
}

export type Role = "mentor" | "student";
export type EmailStatus = "none" | "sent" | "queued";

export interface Member {
  user_id: string;
  name: string;
  role: Role;
  online: boolean;
  email_status: EmailStatus;
}

export type SessionState = "scheduled" | "live" | "paused" | "ended";

export interface Session {
  id: string;
  project_id: string;
  title: string;
  state: SessionState;
  scheduled_for: string;
  driver_id: string | null;
  version: number;
}

export interface FileMeta {
  id: string;
  path: string;
  revision: number;
  sha256: string;
  size: number;
}

export type CheckpointState = "pending_upload" | "saved" | "failed";

export interface Checkpoint {
  id: string;
  project_id: string;
  name: string;
  state: CheckpointState;
  created_by: { id: string; name: string };
  created_at: string;
  file_count: number;
}

export interface CheckpointFile {
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
  state: "active" | "expired" | "revoked";
  email_status: EmailStatus;
}

export interface Project {
  id: string;
  title: string;
  kind: "one_to_one" | "group";
  owner: { id: string; name: string };
  members: Member[];
  sessions: Session[];
}

export interface ProjectSummary {
  id: string;
  title: string;
  kind: "one_to_one" | "group";
  role: Role;
  student_count: number;
}

export interface ImportPlan {
  id: string;
  state: "planned";
  expires_at: string;
  entries: Array<{ path: string; status: "new" | "changed" | "unchanged"; file_id: string | null }>;
  only_in_project: string[];
  ignored: string[];
}

export interface Cursor {
  user_id: string;
  file_id: string;
  path: string;
  line: number;
  column: number;
}

export type ServerFrame =
  | { type: "hello"; you: User; session: Session | null; participants: Member[] }
  | { type: "presence"; participants: Member[] }
  | { type: "session"; session: Session }
  | { type: "file"; file: FileMeta }
  | { type: "file_deleted"; file_id: string }
  | { type: "checkpoint"; checkpoint: Checkpoint }
  | ({ type: "cursor" } & Cursor)
  | { type: "edit_rejected"; file_id: string; code: string; current_revision: number | null }
  | { type: "access_revoked" };
