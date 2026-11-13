// The JSON the API speaks, as the brief's Records and Endpoints sections define it.
import type { Diagnostic, ManifestEntry, Pose, Solid, Value, Values, Vec3 } from "./tine";

export type { Diagnostic, ManifestEntry, Pose, Solid, Value, Values, Vec3 };

export interface Config {
  evalDebounceMs: number;
  slowEvalNoticeMs: number;
  commentMaxChars: number;
  requiredApprovals: number;
  preflightSignedOutLimit: number;
}

export interface Person {
  id: string;
  email: string;
  displayName: string;
}

export interface RevisionJson {
  id: string;
  label: string;
  partSlug: string;
  parentRevisionId: string | null;
  authorId: string;
  createdAt: string;
  values: Values;
  sourceRef: string;
  evaluationId: string;
  geometryDigest: string;
  message: string;
  restoredFrom: string | null;
  forkedFrom: { revisionId: string; operation: number } | null;
}

export interface PartJson {
  slug: string;
  title: string;
  category: string;
  visibility: "public" | "private";
  owner: { id: string; displayName: string };
  likes: number;
  liked: boolean;
  headRevisionId: string;
  revision: RevisionJson;
  source: string;
  manifest: ManifestEntry[];
  preflightLeft: number | null;
  /** Display names of the people who authored this part's revisions, by id (extra to the brief's fields). */
  authors: Record<string, string>;
}

export interface RevisionListJson {
  revisions: RevisionJson[];
}

export interface GalleryPart {
  slug: string;
  title: string;
  category: string;
  author: { id: string; displayName: string };
  likes: number;
  liked: boolean;
  createdAt: string;
  head: { id: string; label: string; geometryDigest: string; volume: number; bbox: Vec3 };
}

export interface GalleryJson {
  parts: GalleryPart[];
  nextCursor: string | null;
  categories: { slug: string; name: string; count: number }[];
  total: number;
}

export interface EvaluationJson {
  id: string;
  partSlug: string;
  viewerId: string;
  seq: number;
  status: "succeeded" | "failed" | "cancelled";
  engineVersion: string;
  geometryDigest: string | null;
  volume: number;
  bbox: Vec3;
  faces: number;
  solid: Solid | null;
  diagnostics: Diagnostic[];
  startedAt: string;
  finishedAt: string;
}

export interface TapeOperation {
  index: number;
  kind: "start" | "params" | "body" | "cut" | "join";
  op: string;
  line: number | null;
  digest: string;
  volume: number;
  delta: number;
  bbox: Vec3;
}

export interface Finding {
  id: string;
  severity: "Blocking" | "Advisory" | "Pass";
  code: string;
  message: string;
  cutLabel: string | null;
  measured: number | null;
  threshold: number | null;
  operation: number;
  parameters: string[];
  pose: Pose;
}

export interface PreflightReport {
  id: string;
  partSlug: string;
  process: string;
  values: Values;
  geometryDigest: string;
  status: "complete" | "unsupported";
  message: string | null;
  findings: Finding[];
  costBands: { quantity: number; low: number; high: number; text: string }[];
  confidence: "High" | "Medium" | "Low" | null;
  createdAt: string;
}

export interface TapeJson {
  revisionId: string;
  /** The part this revision belongs to (extra to the brief's fields, so the tape address can name its part). */
  partSlug: string;
  n: number;
  operations: TapeOperation[];
  preflight: PreflightReport | null;
}

export interface CompareHunk {
  index: number;
  kind: "added" | "removed";
  volume: number;
  box: { min: Vec3; max: Vec3 };
  pose: Pose;
}

export interface CompareJson {
  base: RevisionJson;
  head: RevisionJson;
  identical: boolean;
  added: number;
  removed: number;
  unchanged: number;
  hunks: CompareHunk[];
  parameterChanges: { name: string; label: string; base: Value; head: Value; unit: "mm" | "°" | null }[];
}

export interface CommentJson {
  id: string;
  roomId: string;
  author: { id: string; displayName: string };
  body: string;
  anchor: { kind: "point"; position: Vec3 } | { kind: "none" };
  pose: Pose;
  revisionId: string;
  createdAt: string;
}

export interface RoomJson {
  id: string;
  partSlug: string;
  baseRevisionId: string;
  headRevisionId: string;
  title: string;
  state: "open" | "approved" | "closed";
  requiredApprovals: number;
  approvals: { reviewerId: string; revisionId: string; geometryDigest: string; at: string }[];
  reviewers: { email: string; userId: string | null; displayName: string | null }[];
  createdBy: string;
}

export interface RoomResponse {
  room: RoomJson;
  comments: CommentJson[];
}

export interface DashboardJson {
  parts: { slug: string; title: string; visibility: string; likes: number; head: { id: string; label: string; geometryDigest: string }; revisionCount: number }[];
  rooms: { id: string; title: string; partSlug: string; state: string; approvals: number; requiredApprovals: number; geometryDigest: string }[];
  liked: { slug: string; title: string; author: string; geometryDigest: string }[];
}

export type LiveEvent =
  | { type: "revision"; revision: RevisionJson; authorDisplayName: string; digestChanged: boolean }
  | { type: "comment"; comment: CommentJson }
  | { type: "approvals"; room: RoomJson; reason: "approved" | "reset" | "carried" | "matched" | "closed"; label: string; displayName: string | null }
  | { type: "like"; partSlug: string; likes: number };

export interface ApiError {
  error: string;
  message: string;
  errors?: Record<string, string>;
  field?: string;
  head?: RevisionJson;
  headRevisionId?: string;
}
