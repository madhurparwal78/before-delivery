export const PANES = ["html", "css", "js"] as const;
export type PaneKey = (typeof PANES)[number];
export type Files = Record<PaneKey, string>;
export const PANE_LABEL: Record<PaneKey, string> = { html: "HTML", css: "CSS", js: "JS" };

export type Visibility = "private" | "unlisted" | "public";
export const VISIBILITIES: readonly Visibility[] = ["private", "unlisted", "public"];

export const EMBED_TABS = ["html", "css", "js", "result"] as const;
export type EmbedTab = (typeof EMBED_TABS)[number];

export interface User {
  id: string;
  handle: string;
  email: string;
  verified: boolean;
}

export type ForkedFrom =
  | null
  | { pen_id: string; version: number; title: string; owner: string }
  | { removed: true }
  | { hidden: true };

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

export interface DiffRow {
  change: "same" | "added" | "removed";
  text: string;
}

export interface PaneDiff {
  added: number;
  removed: number;
  rows: DiffRow[];
}

export interface Diff {
  a: number;
  b: number;
  added: number;
  removed: number;
  panes: Record<PaneKey, PaneDiff>;
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

export interface CollectionSummary {
  id: string;
  title: string;
  count: number;
}

export interface Collection {
  id: string;
  title: string;
  pens: PenSummary[];
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
  | "mail_unavailable"
  | "internal_error";

export interface ErrorBody {
  error: ErrorCode;
  message: string;
  fields?: Record<string, string>;
  head?: number;
}

export const PREVIEW_SOURCE = "ashlar-preview";
const PREVIEW_KINDS = ["log", "info", "warn", "error", "uncaught", "loop", "blocked", "ready"] as const;
export type PreviewKind = (typeof PREVIEW_KINDS)[number];

export interface PreviewMessage {
  source: typeof PREVIEW_SOURCE;
  render: string;
  nonce: string;
  kind: PreviewKind;
  text: string;
  line: number | null;
  title: string | null;
}

export interface LiveCounts {
  pen_id: string;
  likes: number;
  forks: number;
}

export interface LiveHead {
  pen_id: string;
  head: number;
}

export const DISPLAY_ENTRY_LIMIT = 500;
