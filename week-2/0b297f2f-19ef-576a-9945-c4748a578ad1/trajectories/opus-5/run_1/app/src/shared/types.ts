export type Role = 'curator' | 'registrar' | 'preparator';

export interface Staff {
  id: string;
  name: string;
  role: Role;
}

export interface Lender {
  id: string;
  name: string;
  email: string;
}

export interface Wall {
  id: string;
  name: string;
  lengthMm: number;
  heightMm: number;
  plannedLux: number;
}

export interface Exhibition {
  id: string;
  title: string;
  museum: string;
  timeZone: string;
  runStart: string;
  runEnd: string;
  openHoursPerDay: number;
  closedWeekdays: number[];
  openDays: number;
  openHours: number;
}

export interface Gallery {
  id: string;
  name: string;
  walls: Wall[];
}

export interface ExhibitionResponse {
  exhibition: Exhibition;
  gallery: Gallery;
  lenders: Lender[];
}

export type PlacementStatus = 'proposed' | 'claimed' | 'hung' | 'signed_off' | 'removed';
export type LuxStatus = 'within' | 'over';

export interface Placement {
  id: string;
  objectId: string;
  objectTitle: string;
  objectNumber: string;
  lenderId: string | null;
  wallId: string;
  wallName: string;
  offsetMm: number;
  centreHeightMm: number;
  widthMm: number;
  heightMm: number;
  heightOverride: boolean;
  plannedLux: number;
  plannedLuxHours: number;
  luxLimit: number;
  luxHourBudget: number;
  luxStatus: LuxStatus;
  status: PlacementStatus;
  claimedBy: { id: string; name: string } | null;
  version: number;
}

export interface UndoWindow {
  actionId: string;
  kind: 'remove' | 'move';
  undoUntil: string;
  remainingMs: number;
}

export interface ConditionPhoto {
  id: string;
  objectId: string;
  key: string;
  bytes: number;
  sha256: string;
  contentType: string;
  attachedAt: string;
}

export interface LoanObject {
  id: string;
  objectNumber: string;
  title: string;
  medium: string;
  lenderId: string | null;
  lenderName: string | null;
  widthMm: number;
  heightMm: number;
  luxLimit: number;
  luxHourBudget: number;
  insuranceValueGbp: number;
  registrarNote: string;
  conditionRecorded: boolean;
  photos: ConditionPhoto[];
  placementId: string | null;
  placementStatus: PlacementStatus | null;
}

export type PreviewStatus = 'draft' | 'scheduled' | 'published' | 'withdrawn';
export type DeliveryState = 'queued' | 'sent' | 'cancelled';

export interface PreviewRecipient {
  lenderId: string;
  lenderName: string;
  email: string;
  delivery: DeliveryState;
  sentAt: string | null;
}

export interface Preview {
  id: string | null;
  status: PreviewStatus;
  date: string | null;
  publishAt: string | null;
  publishAtDisplay: string | null;
  remainingMs: number | null;
  publishedAt: string | null;
  publishedAtDisplay: string | null;
  withdrawnAt: string | null;
  withdrawnAtDisplay: string | null;
  recipients: PreviewRecipient[];
}

export type EventKind =
  | 'placement.placed'
  | 'placement.moved'
  | 'placement.removed'
  | 'placement.restored'
  | 'placement.claimed'
  | 'placement.released'
  | 'placement.hung'
  | 'placement.signed_off'
  | 'object.created'
  | 'object.updated'
  | 'photo.attached'
  | 'wall.lux_changed'
  | 'preview.scheduled'
  | 'preview.cancelled'
  | 'preview.published'
  | 'preview.withdrawn';

export interface HangEvent {
  seq: number;
  kind: EventKind;
  at: string;
  actor: { id: string; name: string } | null;
  placementId: string | null;
  objectId: string | null;
  wallId: string | null;
  previewId: string | null;
  title: string | null;
  wallName: string | null;
  offsetMm: number | null;
  plannedLux: number | null;
  publishAtDisplay: string | null;
  recipientCount: number | null;
}

export type ServiceState = 'up' | 'down';

export interface StatusResponse {
  services: {
    database: ServiceState;
    imageStore: ServiceState;
    mailRelay: ServiceState;
  };
  checkedAt: string;
}

export type RejectionReason = 'off_wall' | 'off_centre_line' | 'too_close' | 'too_bright';

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
    reason?: RejectionReason;
    claimedBy?: { id: string; name: string };
    placement?: Placement;
  };
}

export interface SnapshotWork {
  title: string;
  objectNumber: string;
  wallName: string;
  offsetMm: number;
  centreHeightMm: number;
  widthMm: number;
  heightMm: number;
}

export interface Snapshot {
  exhibition: { title: string; runStart: string; runEnd: string };
  lender: { name: string };
  publishedAt: string;
  publishedAtDisplay: string;
  walls: { id: string; name: string; lengthMm: number; heightMm: number }[];
  works: SnapshotWork[];
}

export type Unit = 'cm' | 'in';
export type ViewName = 'plan' | 'wall' | 'light';
