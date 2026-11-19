export type Party = "dealer" | "counterpart";
export type Actor = Party | "system" | "outsider";
export type Owner = "dealer" | "counterpart" | "outsider";
export type Role = "dealer" | "counterpart" | "outsider";
export type Face = "obverse" | "reverse" | "arrival" | "dispatch" | "register";

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

export interface PhotoRecord {
  id: string;
  label: Face;
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

export interface Holder {
  kind: "flip" | "slab" | "capsule";
  width_mm: number;
  height_mm: number;
}

export interface Attribution {
  reference: string;
  mintmark: string;
  revision: number;
  certainty: "certain" | "uncertain";
  note: string;
  correction: string;
  register: "stored" | "pending";
}

export interface Specimen {
  display_label: string;
  owner: Owner;
  status: SpecimenStatus;
  version: number;
  holder: Holder;
  attribution: Attribution;
  quarantined: boolean;
  missing: boolean;
  photos: PhotoRecord[];
  annotations: Annotation[];
}

export interface TrayCellState {
  specimen: string;
  audit_mark: "missing" | null;
  audit_version: number;
}

export interface AlbumHole {
  reference: string;
  mintmark: string;
  specimen: string | null;
}

export interface AlbumState {
  set: string;
  revision: number;
  holes: Record<string, AlbumHole>;
}

export interface OfferAcceptances {
  dealer: number | null;
  counterpart: number | null;
}

export interface Offer {
  version: number;
  status: OfferStatus;
  dealer_items: string[];
  counterpart_items: string[];
  acceptances: OfferAcceptances;
  holds: string[];
  expires_at: string | null;
  remaining_seconds: number | null;
  closing: boolean;
}

export interface ManifestEvidence {
  specimen: string;
  label: string;
  object_key: string;
  sha256: string;
}

export interface Manifest {
  version: number;
  order: string[];
  frozen: boolean;
  evidence: ManifestEvidence[];
}

export interface Receipt {
  confirmed: boolean;
  matches: boolean;
}

export interface DisputeMarker {
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
  markers: DisputeMarker[];
  resolution: { outcome: "transfer" | "return"; proposed_by: Party } | null;
  resolution_approvals: Party[];
}

export interface AuditEvent {
  cell: string;
  mark: "missing";
  actor: Actor;
  sequence: number;
  command_id: string;
}

export interface DeskEvent {
  command_id: string;
  actor: Actor;
  type: EventType;
  sequence: number;
  at: string;
}

export interface DeskState {
  version: number;
  versions: { tray: number; album: number; keeper_order: number };
  specimens: Record<string, Specimen>;
  tray: Record<string, TrayCellState>;
  album: AlbumState;
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
