export type UserKind = "mentor" | "learner";

export interface User {
  id: string;
  email: string | null;
  name: string;
  kind: UserKind;
}

export type MemberRole = "mentor" | "student";

export type EmailStatus = "sent" | "queued" | "none";

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

export type LinkState = "active" | "expired" | "revoked";

export interface ReviewerLink {
  id: string;
  checkpoint_id: string;
  url: string;
  expires_at: string;
  state: LinkState;
  email_status: EmailStatus;
}

export interface ImportEntry {
  path: string;
  status: "new" | "changed" | "unchanged";
  file_id: string | null;
}

export interface ImportPlan {
  id: string;
  state: "planned" | "applied" | "superseded";
  expires_at: string;
  entries: ImportEntry[];
  only_in_project: string[];
  ignored: string[];
}

export interface AuditEvent {
  id: string;
  type: string;
  actor: { id: string | null; name: string };
  subject: string;
  at: string;
}

export const IDENTITY_TINTS = [
  "slateblue",
  "sage",
  "rose",
  "lavender",
  "steel",
  "moss",
  "clay",
] as const;
