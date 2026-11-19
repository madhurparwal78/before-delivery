// The contract between the server and the browser: what the API sends and what live events carry.

export type Role = 'reader' | 'writer' | 'maintainer' | 'owner';
export const ROLE_RANK: Record<Role, number> = { reader: 1, writer: 2, maintainer: 3, owner: 4 };

export type CheckState = 'queued' | 'in_progress' | 'success' | 'failure' | 'timed_out';
export const CHECK_WORD: Record<CheckState, string> = {
  queued: 'Queued',
  in_progress: 'In progress',
  success: 'Passed',
  failure: 'Failed',
  timed_out: 'Timed out',
};

export type ChangeState = 'draft' | 'open' | 'queued' | 'merged' | 'removed';
export type RestackResultKind = 'kept' | 'dismissed' | 'conflicting' | 'not_restacked';

export interface RestackResult {
  number: number;
  result: RestackResultKind;
  dismissed_count: number;
}

export interface LiveAnnouncement {
  text: string;
  /** Where the sentence is spoken: on change pages of the stack, on the queue page, or both. */
  on: 'change' | 'queue' | 'both';
}

export interface LiveEvent {
  /** Change numbers whose pages refresh, and whose stack the change announcements belong to. */
  numbers: number[];
  announce: LiveAnnouncement[];
  restack?: RestackResult[];
  queue?: boolean;
}

export interface MergeRule {
  rule: 'draft' | 'conflicting' | 'approvals' | 'code-owners' | 'changes-requested' | 'checks' | 'met';
  text: string;
}

export interface TimeView {
  iso: string;
  shown: string;
}

export interface CheckRow {
  name: string;
  state: CheckState;
  word: string;
  summary: string;
  timeout_at: TimeView | null;
}

export interface Counts {
  files_viewed: number;
  files_total: number;
  unresolved_threads: number;
  approvals_remaining: number;
}

export interface StackRow {
  number: number;
  position: number;
  title: string;
  state: ChangeState;
  restack: { result: RestackResultKind | null; dismissed_count: number };
}

export interface ChangeObject {
  id: string;
  number: number;
  title: string;
  state: ChangeState;
  draft: boolean;
  author: string;
  head: string;
  base: string;
  base_revision: string;
  head_revision: string;
  conflicting: boolean;
  conflict_paths: string[];
  changes_requested: boolean;
  merge_rules: MergeRule[];
  restack: { result: RestackResultKind | null; dismissed_count: number; notice: string | null };
  files: { path: string; status: 'added' | 'modified' | 'deleted' }[];
  counts: Counts;
  stack: { number: number; position: number; title: string; state: ChangeState }[];
  queue_entry: QueueEntryObject | null;
}

export interface QueueEntryObject {
  id: number;
  change: number;
  state: 'waiting' | 'checking' | 'merged' | 'removed';
  position: number | null;
  revision: string;
  reason: string | null;
}

export interface CommentView {
  id: number;
  author: string;
  author_name: string;
  body: string;
  created_at: TimeView;
  suggestion: { lines: string[]; state: 'open' | 'applied' } | null;
}

export interface ThreadView {
  id: number;
  path: string;
  side: 'old' | 'new';
  line: number;
  end_line: number;
  state: 'unresolved' | 'resolved';
  outdated: boolean;
  revision: string;
  comments: CommentView[];
}

export interface ReviewView {
  id: number;
  reviewer: string;
  reviewer_name: string;
  type: 'comment' | 'approve' | 'request_changes';
  state: 'commented' | 'approved' | 'changes_requested' | 'dismissed';
  summary: string;
  dismissed_text: string | null;
  created_at: TimeView;
}

export interface Viewer {
  username: string;
  name: string;
  role: Role | null;
  is_author: boolean;
  can_write: boolean;
  can_maintain: boolean;
  approve_block: string | null;
  request_block: string | null;
}

export type NoticeKind = 'base-changed' | 'restack-stopped' | 'not-restacked';

export interface ChangeView {
  change: ChangeObject;
  repo: { id: number; org: string; name: string; queue: boolean; required_checks: string[]; required_approvals: number };
  viewer: Viewer;
  reviews: ReviewView[];
  threads: ThreadView[];
  requested: { username: string; name: string }[];
  checks: CheckRow[];
  stack: StackRow[];
  notice: { kind: NoticeKind; text: string } | null;
  viewed: string[];
  queue_position: number | null;
  merged_into: { branch: string; revision: string } | null;
  storage_down: boolean;
}

export interface DiffFile {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  base_text: string | null;
  head_text: string | null;
  hunks: { header: string; rows: { kind: 'hunk' | 'context' | 'added' | 'removed'; old_line: number | null; new_line: number | null; text: string }[] }[];
}

export interface QueueEntryView {
  id: number;
  change: number;
  title: string;
  state: 'waiting' | 'checking' | 'merged' | 'removed';
  position: number | null;
  revision: string;
  reason: string | null;
  checks: CheckRow[];
  finished_at: TimeView | null;
}

export interface QueueView {
  repo: { id: number; org: string; name: string };
  can_reorder: boolean;
  entries: QueueEntryView[];
  history: QueueEntryView[];
}

export interface PageBoot {
  user: { username: string; name: string } | null;
  notFound: boolean;
  breakpoint: number;
  services: boolean | null;
}
