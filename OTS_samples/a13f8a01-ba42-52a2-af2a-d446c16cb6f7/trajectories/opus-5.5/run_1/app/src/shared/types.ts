export type Visibility = "private" | "unlisted" | "public";

export interface Files {
  html: string;
  css: string;
  js: string;
}

export type PaneName = keyof Files;

export const paneNames: readonly PaneName[] = ["html", "css", "js"];

export interface User {
  id: string;
  handle: string;
  email: string;
  verified: boolean;
}

export interface PenSummary {
  id: string;
  title: string;
  owner: string;
  visibility: Visibility;
  tags: string[];
  head: number;
  updated_at: string;
  likes: number;
  forks: number;
}

export type ForkedFrom =
  | null
  | { pen_id: string; version: number; title: string; owner: string }
  | { removed: true }
  | { hidden: true };

export interface Version {
  pen_id: string;
  number: number;
  created_at: string;
  sha256: string;
  files: Files;
  libraries: string[];
  restored_from: number | null;
}

export interface Pen extends PenSummary {
  liked: boolean;
  forked_from: ForkedFrom;
  version: Version | null;
}

export interface VersionEntry {
  number: number;
  created_at: string;
  sha256: string;
  restored_from: number | null;
  added: number;
  removed: number;
  changed_chars: number;
}

export type DiffChange = "same" | "added" | "removed";

export interface PaneDiff {
  added: number;
  removed: number;
  rows: { change: DiffChange; text: string }[];
}

export interface DiffResult {
  a: number;
  b: number;
  added: number;
  removed: number;
  panes: Record<PaneName, PaneDiff>;
}

export interface ShelfLibrary {
  id: string;
  name: string;
  version: string;
  global: string;
  path: string;
  license: string;
  bytes: number;
  sha256: string;
}

export interface ClientConfig {
  preview_delay_ms: number;
  draft_interval_ms: number;
  search_debounce_ms: number;
  loop_limit: number;
  pane_limit_bytes: number;
  max_tags: number;
  live_poll_ms: number;
}

export interface CollectionDetail {
  id: string;
  title: string;
  pens: PenSummary[];
}

export interface CollectionListItem {
  id: string;
  title: string;
  count: number;
}

export interface RenderTicket {
  render: string;
  nonce: string;
  url: string;
}

export type ErrorCode =
  | "body_too_large"
  | "not_signed_in"
  | "bad_credentials"
  | "not_found"
  | "forbidden"
  | "unverified"
  | "version_conflict"
  | "idempotency_conflict"
  | "duplicate"
  | "already_verified"
  | "nothing_to_fork"
  | "nothing_to_export"
  | "validation"
  | "token_invalid"
  | "token_expired"
  | "storage_unavailable"
  | "mail_unavailable";

export interface ErrorBody {
  error: ErrorCode;
  message: string;
  fields?: Record<string, string>;
  head?: number;
}

export type PreviewKind = "log" | "info" | "warn" | "error" | "uncaught" | "loop" | "blocked" | "ready";

export interface PreviewMessage {
  source: "ashlar-preview";
  render: string;
  nonce: string;
  kind: PreviewKind;
  text: string;
  line: number | null;
  title: string | null;
}

export type LiveEvent =
  | { type: "counts"; data: { pen_id: string; likes: number; forks: number } }
  | { type: "head"; data: { pen_id: string; head: number } }
  | { type: "account"; data: { verified: true } };
