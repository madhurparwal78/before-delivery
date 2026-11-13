export type FieldType = "number" | "date" | "boolean" | "text" | "keyword";
export type Phase = "hot" | "warm" | "archive" | "delete";
export type GroupState = "inactive" | "pending" | "active" | "recovered";
export type CaseStatus = "open" | "investigating" | "resolved" | "closed";
export type Role = "viewer" | "editor" | "admin";
export type KeyAction = "read" | "upload" | "manage";
export type AnalyzerName = "standard" | "keyword" | "whitespace";
export type Comparison = ">" | ">=" | "<" | "<=";
export type FilterOp = "eq" | "ne" | "exists" | "gt" | "gte" | "lt" | "lte";

export interface Filter {
  field: string;
  op: FilterOp;
  value: string | number | boolean | null;
}

export interface FlattenedEvent {
  _id: string;
  "@timestamp": string;
  _generation: number;
  _phase: "hot" | "warm" | "archive";
  _pipeline: string | null;
  _score: number | null;
  fields: Record<string, unknown>;
  highlights: Record<string, [number, number][]>;
  explanation?: Explanation;
  explanation_text?: string;
}

export interface ExplanationChild {
  value: number;
  leaf: string;
  field: string;
  idf: number;
  tf_norm: number;
  boost: number;
  text: string;
}

export interface Explanation {
  value: number;
  text: string;
  children: ExplanationChild[];
}

export interface GenerationInfo {
  number: number;
  phase: "hot" | "warm" | "archive" | "delete";
  created_at: string;
  rolled_over_at: string | null;
  events: number;
  next: { step: string; at: string } | null;
  segment: { key: string; bytes: number } | null;
  timeline: string;
}

export interface LifecyclePolicy {
  rollover_max_age_ms: number | null;
  rollover_max_events: number | null;
  warm_after_ms: number | null;
  archive_after_ms: number | null;
  delete_after_ms: number | null;
}

export interface Settings {
  page_size: number;
  tail_buffer: number;
  query_max_len: number;
  query_max_depth: number;
  upload_max_bytes: number;
  sse_heartbeat_ms: number;
}
