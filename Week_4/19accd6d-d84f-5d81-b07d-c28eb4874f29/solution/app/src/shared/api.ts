import type { Step } from "./operations/types";

export interface Owner {
  type: "user" | "team";
  id: string;
  name: string;
}

export interface RecipeSummary {
  id: string;
  name: string;
  owner: Owner;
  latestVersion: number;
  tags: string[];
  updatedAt: string;
  lastUsedAt: string;
}

export interface Author {
  id: string;
  displayName: string;
}

export interface VersionHeader {
  n: number;
  name: string;
  note: string;
  tags: string[];
  author: Author;
  createdAt: string;
}

export interface Version extends VersionHeader {
  steps: Step[];
}

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  verified: boolean;
}

export interface TeamRole {
  id: string;
  name: string;
  role: "owner" | "member";
}

export interface TeamMember {
  id: string;
  displayName: string;
  email: string;
  role: "owner" | "member";
}

export interface Team {
  id: string;
  name: string;
  owner: string;
  members: TeamMember[];
  invites?: { email: string; expiresAt: string }[];
}

export type SnapshotStatus = "pending" | "active" | "expired" | "revoked";

export interface Snapshot {
  token: string;
  status: SnapshotStatus;
  createdAt: string;
  expiresAt: string;
  recipe: { name: string; version: number | null; steps: Step[] } | null;
  inputBytes: number;
  outputBytes: number;
  url: string;
}

export interface AppConfig {
  autobakeMs: number;
  regexBudgetMs: number;
  inputMaxBytes: number;
  fileMaxBytes: number;
  outputDisplayBytes: number;
  versionsKept: number;
  teamMax: number;
  shareTtlChoices: string[];
}

export interface StoredFile {
  id: string;
  name: string;
  bytes: number;
  sha256: string;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: { fields?: Record<string, string>; lines?: string[]; latestVersion?: number; authorName?: string } };
}

export type LiveMessage =
  | { type: "version_saved"; recipeId: string; version: number; name: string; authorId: string; authorName: string; teamId: string | null }
  | { type: "membership_changed"; teamId: string };

export interface ImportResult {
  status: "created" | "already_imported";
  recipe: RecipeSummary;
  version: number;
  lineCount?: number;
  message?: string;
}
