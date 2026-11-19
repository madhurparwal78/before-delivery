// The desk state object and API shapes, exactly as the brief's API section publishes them.

import type { Cell } from "./limits.js";

export type Role = "dealer" | "counterpart" | "outsider";
export type Party = "dealer" | "counterpart";
export type Actor = Party | "system";

export type SpecimenStatus =
  | "intake"
  | "pending_catalogue"
  | "attributed"
  | "quarantined"
  | "shelved"
  | "reserved"
  | "outbound"
  | "transferred"
  | "missing";

type HolderKind = "flip" | "slab" | "capsule";
export type PhotoLabel = "obverse" | "reverse" | "arrival" | "dispatch";

export interface Holder {
  kind: HolderKind;
  width_mm: number;
  height_mm: number;
}

export interface Attribution {
  reference: string | null;
  mintmark: string | null;
  revision: number | null;
  certainty: "certain" | "uncertain";
  note: string | null;
  correction: string | null;
  register: "stored" | "pending";
}

export interface Photo {
  id: string;
  label: PhotoLabel;
  object_key: string;
  sha256: string;
  width: number;
  height: number;
}

export interface Annotation {
  id: string;
  photo: string;
  x: number;
  y: number;
  text: string;
}

export interface Specimen {
  display_label: string;
  owner: Role;
  status: SpecimenStatus;
  version: number;
  holder: Holder;
  attribution: Attribution;
  quarantined: boolean;
  missing: boolean;
  photos: Photo[];
  annotations: Annotation[];
}

interface TrayCell {
  specimen: string | null;
  audit_mark: "missing" | null;
  audit_version: number;
}

interface AlbumHole {
  reference: string;
  mintmark: string;
  specimen: string | null;
}

export interface Album {
  set: string;
  revision: number;
  holes: Record<string, AlbumHole>;
}

export type OfferStatus =
  | "draft"
  | "sent"
  | "countered"
  | "accepted"
  | "dispatched"
  | "received"
  | "disputed"
  | "transferred"
  | "returned"
  | "expired";

export interface Offer {
  version: number;
  status: OfferStatus;
  dealer_items: string[];
  counterpart_items: string[];
  acceptances: { dealer: number | null; counterpart: number | null };
  holds: string[];
  expires_at: string | null;
  remaining_seconds: number | null;
  closing: boolean;
}

export interface EvidenceItem {
  specimen: string;
  label: "dispatch";
  object_key: string;
  sha256: string;
}

export interface Manifest {
  version: number;
  order: string[];
  frozen: boolean;
  evidence: EvidenceItem[];
}

export interface Receipt {
  confirmed: boolean;
  matches: boolean;
}

export interface Marker {
  id: string;
  x: number;
  y: number;
  text: string;
}

export interface Dispute {
  offer: string;
  specimen: string;
  version: number;
  open: boolean;
  markers: Marker[];
  resolution: { outcome: "transfer" | "return"; proposed_by: Party } | null;
  resolution_approvals: Party[];
}

export interface AuditEvent {
  cell: Cell;
  mark: "missing";
  actor: Actor;
  sequence: number;
  command_id: string;
}

export type EventType =
  | "specimen.created"
  | "specimen.quarantined"
  | "specimen.reconciled"
  | "annotation.saved"
  | "tray.placed"
  | "album.reconciled"
  | "album.filled"
  | "album.reopened"
  | "keeper.reordered"
  | "keeper.restored"
  | "offer.sent"
  | "offer.replaced"
  | "offer.accepted"
  | "offer.expired"
  | "hold.placed"
  | "hold.released"
  | "manifest.frozen"
  | "arrival.saved"
  | "receipt.recorded"
  | "ownership.transferred"
  | "offer.returned"
  | "dispute.opened"
  | "marker.moved"
  | "resolution.proposed"
  | "resolution.approved"
  | "link.created"
  | "link.revoked"
  | "audit.marked"
  | "access.ended";

export interface DeskEvent {
  command_id: string;
  actor: Actor;
  type: EventType;
  sequence: number;
  at: string;
}

/** A streamed event: the state's event plus what a screen needs to announce it. */
export interface StreamEvent extends DeskEvent {
  detail: { specimen?: string; subject?: string; offer?: string };
}

export interface DeskState {
  version: number;
  versions: { tray: number; album: number; keeper_order: number };
  specimens: Record<string, Specimen>;
  tray: Partial<Record<Cell, TrayCell>>;
  album: Album | Record<string, never>;
  keeper_order: string[];
  offers: Record<string, Offer>;
  manifests: Record<string, Manifest>;
  receipts: Record<string, Receipt>;
  disputes: Record<string, Dispute>;
  audit_events: AuditEvent[];
  events: DeskEvent[];
}

export interface SessionInfo {
  subject: string;
  username: string;
  role: Role;
  namespace: string;
  step_up_fresh: boolean;
  step_up_expires_at: string | null;
}

export interface ApiError {
  error: string;
  message: string;
  fields?: Record<string, string>;
  retry_after_seconds?: number;
}

export interface SpecimenPage {
  items: (Specimen & { key: string })[];
  next: string | null;
}

export interface AuditCellPage {
  items: { cell: Cell; specimen: string | null; audit_mark: "missing" | null; audit_version: number }[];
  next: string | null;
}

export interface AuditMarkRequest {
  command_id: string;
  expected_version: number;
  cell: Cell;
  mark: "missing";
}

export interface SyncResult {
  command_id: string;
  status: number;
  body: unknown;
}

export interface EvidenceLink {
  token: string;
  url: string;
  expires_at: string;
}
