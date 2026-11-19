import type { ArgValues, Step } from './catalogue.js';

export interface ApiError {
  code: string;
  message: string;
  details?: { fields?: Record<string, string>; lines?: string[]; latestVersion?: number; authorName?: string; [k: string]: unknown };
}

export interface User {
  id: string;
  email: string;
  displayName: string;
  verified: boolean;
}

export interface TeamRef {
  id: string;
  name: string;
  role: 'owner' | 'member';
}

export interface OwnerRef {
  type: 'user' | 'team';
  id: string;
  name: string;
}

export interface Author {
  id: string;
  displayName: string;
}

export interface RecipeVersion {
  n: number;
  name: string;
  note: string;
  tags: string[];
  steps: Step[];
  author: Author;
  createdAt: string;
}

export interface RecipeSummary {
  id: string;
  name: string;
  owner: OwnerRef;
  latestVersion: number;
  tags: string[];
  updatedAt: string;
  lastUsedAt: string;
}

export interface ClientConfig {
  autobakeMs: number;
  regexBudgetMs: number;
  inputMaxBytes: number;
  fileMaxBytes: number;
  outputDisplayBytes: number;
  versionsKept: number;
  teamMax: number;
  shareTtlChoices: string[];
  shareTtlLabels: Record<string, string>;
}

export interface FileRecord {
  id: string;
  name: string;
  bytes: number;
  sha256: string;
}

export type SnapshotStatus = 'pending' | 'active' | 'expired' | 'revoked';

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

export interface ImportResult {
  status: 'created' | 'already_imported';
  recipe?: RecipeSummary;
  version?: number;
  lineCount?: number;
  message?: string;
}

export interface Team {
  id: string;
  name: string;
  owner: Author;
  members: { id: string; displayName: string; email: string; role: 'owner' | 'member' }[];
  invites?: { email: string; expiresAt: string }[];
}

export interface InviteInfo {
  teamName: string;
  inviterName: string;
  email: string;
}

export interface LiveMessage {
  type: 'version_saved' | 'membership_changed';
  recipeId?: string;
  version?: number;
  name?: string;
  authorId?: string;
  authorName?: string;
  teamId?: string | null;
}

export interface GradingSeedResponse {
  users: Record<string, { id: string; session: string }>;
  teams: Record<string, { id: string }>;
  recipes: Record<string, { id: string; latestVersion: number }>;
  files: Record<string, { id: string }>;
  snapshots: Record<string, { token: string; status: string; expiresAt: string }>;
}

export interface BakeRequest {
  runId: number;
  steps: Step[];
  input: ArrayBuffer;
  /** Step numbers (1-based, counting every step) to stop before; each entry is a step index. */
  stopBefore?: number[];
  /** Run only the first N enabled steps (Step mode). */
  runUpTo?: number;
}

export interface BakeProgress {
  type: 'progress';
  runId: number;
  /** Input bytes of the step about to run. */
  output: ArrayBuffer;
  stepIndex: number;
}

export type WorkerResponse =
  | { type: 'done'; runId: number; output: ArrayBuffer; ms: number; steps: number[]; outputs: ArrayBuffer[] }
  | { type: 'error'; runId: number; stepIndex: number; step: number; branch: number | null; message: string }
  | { type: 'badMessage' };

export type StepArgPatch = Partial<ArgValues>;
