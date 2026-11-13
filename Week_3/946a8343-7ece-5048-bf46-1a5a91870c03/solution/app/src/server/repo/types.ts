import type { Access, ProjectRow } from "../access.ts";
import type { MergeSegment, TreeConflict } from "../../shared/merge.ts";
import type { Hunk } from "../../shared/diff.ts";

export interface Person {
  readonly id: number;
  readonly username: string;
}

// Commit times are unix seconds: the hash formula uses whole seconds and the API converts them to ISO strings.
export interface CommitRow {
  readonly id: string;
  readonly project_id: number;
  readonly tree: string;
  readonly parents: string[];
  readonly author: string;
  readonly authored_at: number;
  readonly committer: string;
  readonly committed_at: number;
  readonly message: string;
  readonly [key: string]: unknown;
}

// A snapshot of a commit's files: path to UTF-8 text.
export type FileMap = Map<string, string>;

export interface FileAction {
  readonly action: "create" | "update" | "delete" | "move";
  readonly path: string;
  readonly content?: string;
  readonly previous_path?: string;
}

// Where a push came from. `train` merges and `seed` bypass the checks that guard people.
export type PushSource = "editor" | "api" | "suggestion" | "conflict" | "rebase" | "merge" | "train" | "seed" | "import";

export interface BranchUpdate {
  readonly project: ProjectRow;
  readonly branch: string;
  readonly oldHead: string | null;
  readonly newHead: string;
  readonly actor: Person;
  readonly source: PushSource;
  // Commits reachable from newHead and not from oldHead, newest first. For a branch created by a commit the commits
  // are those not reachable from the commit it started from.
  readonly newCommits: readonly CommitRow[];
}

export type PipelineOutcome = { readonly id: number } | { readonly created: false; readonly reason: string };

export interface FileChange {
  readonly path: string;
  readonly oldPath: string | null;
  readonly status: "added" | "modified" | "deleted" | "moved";
}

export interface FileDiff {
  readonly path: string;
  readonly old_path: string | null;
  readonly status: "added" | "modified" | "deleted" | "moved";
  readonly hunks: Hunk[];
}

export interface CommitInput {
  readonly project: ProjectRow;
  readonly access: Access | null; // null = system (seed, train): skips role checks, never push rules
  readonly actor: Person;
  readonly branch: string;
  readonly startRef?: string | null;
  readonly baseCommit: string | null;
  readonly message: string;
  readonly actions: readonly FileAction[];
  readonly source: PushSource;
  readonly authoredAt?: number; // unix seconds, default: server clock
  // Field errors found while reading the request body; reported with the other 422 errors.
  readonly invalid?: Readonly<Record<string, string>>;
}

export interface WriteCommitInput {
  readonly projectId: number;
  readonly parents: readonly string[];
  readonly files: FileMap;
  readonly author: string;
  readonly authoredAt: number; // unix seconds
  readonly committer: string;
  readonly committedAt: number; // unix seconds
  readonly message: string;
}

export interface MoveBranchInput {
  readonly project: ProjectRow;
  readonly access: Access | null;
  readonly actor: Person;
  readonly branch: string;
  readonly to: string;
  readonly expectedOld: string | null;
  readonly source: PushSource;
  /** Merges check `allowed_to_merge`, everything else `allowed_to_push`. */
  readonly kind: "push" | "merge";
}

export type MergeOutcome =
  | { readonly clean: true; readonly files: FileMap; readonly base: string | null }
  | { readonly clean: false; readonly conflicts: TreeConflict[]; readonly base: string | null };

export interface MergeInput {
  readonly project: ProjectRow;
  readonly access: Access | null;
  readonly actor: Person;
  readonly targetBranch: string;
  readonly sourceBranch: string;
  readonly sourceHead: string;
  readonly title: string;
  readonly iid: number;
  readonly method: ProjectRow["merge_method"];
}

export interface RebaseInput {
  readonly project: ProjectRow;
  readonly access: Access | null;
  readonly actor: Person;
  readonly sourceBranch: string;
  readonly targetBranch: string;
}

export interface ConflictFile {
  readonly path: string;
  readonly kind: "content" | "whole";
  readonly segments: MergeSegment[] | null;
  readonly markedText: string;
}

export interface TagInput {
  readonly project: ProjectRow;
  readonly access: Access | null; // null = seed
  readonly name: string;
  readonly commit: string;
  readonly message: string;
  readonly creator: Person;
}

export interface CommitWithParentsInput {
  readonly project: ProjectRow;
  readonly access: Access | null;
  readonly actor: Person;
  readonly branch: string;
  readonly expectedOld: string | null;
  readonly parents: readonly string[];
  readonly files: FileMap;
  readonly message: string;
  readonly source: PushSource;
  readonly authoredAt?: number;
}
