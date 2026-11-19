/** The published state object and its domain vocabulary, shared verbatim. */

export type Role = 'dealer' | 'counterpart' | 'outsider';
export type Party = 'dealer' | 'counterpart';
export type Owner = Role;
export type Actor = Party | 'system';

export type SpecimenStatus =
  | 'intake'
  | 'pending_catalogue'
  | 'attributed'
  | 'quarantined'
  | 'shelved'
  | 'reserved'
  | 'outbound'
  | 'transferred'
  | 'missing';

export type Certainty = 'certain' | 'uncertain';
export type RegisterState = 'stored' | 'pending';
export type HolderKind = 'flip' | 'slab' | 'capsule';
export type PhotoLabel = 'obverse' | 'reverse' | 'dispatch' | 'arrival' | 'register';

export type OfferStatus =
  | 'draft'
  | 'sent'
  | 'countered'
  | 'accepted'
  | 'dispatched'
  | 'received'
  | 'disputed'
  | 'transferred'
  | 'returned'
  | 'expired';

export type ResolutionOutcome = 'transfer' | 'return';

export type EventType =
  | 'specimen.created'
  | 'specimen.quarantined'
  | 'specimen.reconciled'
  | 'annotation.saved'
  | 'tray.placed'
  | 'album.reconciled'
  | 'album.filled'
  | 'album.reopened'
  | 'keeper.reordered'
  | 'keeper.restored'
  | 'offer.sent'
  | 'offer.replaced'
  | 'offer.accepted'
  | 'offer.expired'
  | 'hold.placed'
  | 'hold.released'
  | 'manifest.frozen'
  | 'arrival.saved'
  | 'receipt.recorded'
  | 'ownership.transferred'
  | 'offer.returned'
  | 'dispute.opened'
  | 'marker.moved'
  | 'resolution.proposed'
  | 'resolution.approved'
  | 'link.created'
  | 'link.revoked'
  | 'audit.marked'
  | 'access.ended';

export interface Holder {
  kind: HolderKind;
  width_mm: number;
  height_mm: number;
}

export interface Attribution {
  reference: string | null;
  mintmark: string | null;
  revision: number | null;
  certainty: Certainty;
  note: string | null;
  correction: string | null;
  register: RegisterState;
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
  owner: Owner;
  status: SpecimenStatus;
  version: number;
  holder: Holder;
  attribution: Attribution;
  quarantined: boolean;
  missing: boolean;
  photos: Photo[];
  annotations: Annotation[];
}

export interface KeyedSpecimen extends Specimen {
  key: string;
}

export interface TrayCell {
  specimen: string | null;
  audit_mark: 'missing' | null;
  audit_version: number;
}

export interface AlbumHole {
  reference: string;
  mintmark: string;
  specimen: string | null;
}

export interface Album {
  set: string | null;
  revision: number | null;
  holes: Record<string, AlbumHole>;
}

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
  resolution: { outcome: ResolutionOutcome; proposed_by: Party } | null;
  resolution_approvals: Party[];
}

export interface AuditEvent {
  cell: string;
  mark: 'missing';
  actor: Actor;
  sequence: number;
  command_id: string;
}

export interface DeskEvent {
  command_id: string | null;
  actor: Actor;
  type: EventType;
  sequence: number;
  at: string;
}

export interface DeskState {
  version: number;
  versions: { tray: number; album: number; keeper_order: number };
  specimens: Record<string, Specimen>;
  tray: Record<string, TrayCell>;
  album: Album;
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

export interface ApiErrorBody {
  error: string;
  message: string;
  fields?: Record<string, string>;
  retry_after_seconds?: number;
}

/** The fourteen seedable workflows. */
export const WORKFLOWS = [
  'intake',
  'attribution',
  'catalog_reconciliation',
  'tray_placement',
  'set_tracking',
  'condition_comparison',
  'duplicate_selection',
  'offer_assembly',
  'counteroffers',
  'dispatch',
  'receipt',
  'disputes',
  'stock_audit',
  'cross-cutting',
] as const;

export type Workflow = (typeof WORKFLOWS)[number];

export const VARIANTS = ['base', 'conflict', 'outage', 'offline', 'session'] as const;
export type Variant = (typeof VARIANTS)[number];

/** Workspace route segments under /desk/<ns>/<workspace>. */
export const WORKSPACES = [
  'intake',
  'attribution',
  'catalog-reconciliation',
  'tray-placement',
  'album',
  'condition',
  'keepers',
  'stock-audit',
  'offers',
  'counteroffers',
  'dispatch',
  'receipt',
  'disputes',
] as const;

export type WorkspaceId = (typeof WORKSPACES)[number];

/** Which desk tab a workspace belongs to. */
export const WORKSPACE_TAB: Record<WorkspaceId, 'stock' | 'exchange'> = {
  intake: 'stock',
  attribution: 'stock',
  'catalog-reconciliation': 'stock',
  'tray-placement': 'stock',
  album: 'stock',
  condition: 'stock',
  keepers: 'stock',
  'stock-audit': 'stock',
  offers: 'exchange',
  counteroffers: 'exchange',
  dispatch: 'exchange',
  receipt: 'exchange',
  disputes: 'exchange',
};

/** G38 link labels, in published order. */
export const WORKSPACE_LABEL: Record<WorkspaceId, string> = {
  intake: 'Intake',
  attribution: 'Attribution',
  'catalog-reconciliation': 'Catalog reconciliation',
  'tray-placement': 'Tray placement',
  album: 'Album',
  condition: 'Condition',
  keepers: 'Keepers',
  'stock-audit': 'Stock audit',
  offers: 'Offers',
  counteroffers: 'Counteroffers',
  dispatch: 'Dispatch',
  receipt: 'Receipt',
  disputes: 'Disputes',
};

/** A counterpart sees only the exchange side of the desk. */
export const COUNTERPART_WORKSPACES: WorkspaceId[] = [
  'offers',
  'counteroffers',
  'dispatch',
  'receipt',
  'disputes',
];
