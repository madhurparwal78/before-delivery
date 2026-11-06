export type Role = "curator" | "registrar" | "preparator";
export type View = "plan" | "wall" | "light";
export type PlacementStatus = "proposed" | "claimed" | "hung" | "signed_off" | "removed";
export type LuxStatus = "within" | "over";

export interface Staff {
  id: string;
  name: string;
  role: Role;
}

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

export interface Undo {
  actionId: string;
  kind: "remove" | "move";
  undoUntil: string;
  remainingMs: number;
}

export interface Photo {
  id: string;
  objectId: string;
  key: string;
  bytes: number;
  sha256: string;
  contentType: string;
  attachedAt: string;
}

export interface ObjectRecord {
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
  photos: Photo[];
  placementId: string | null;
  placementStatus: PlacementStatus | null;
}

export interface Wall {
  id: string;
  name: string;
  lengthMm: number;
  heightMm: number;
  plannedLux: number;
}

export interface Lender {
  id: string;
  name: string;
  email: string;
}

export interface ExhibitionData {
  exhibition: { id: string; title: string; museum: string; timeZone: string; openHours: number };
  gallery: { id: string; name: string; walls: Wall[] };
  lenders: Lender[];
}

export interface Recipient {
  lenderId: string;
  lenderName: string;
  email: string;
  delivery: "queued" | "sent" | "cancelled";
  sentAt: string | null;
}

export interface Preview {
  id: string | null;
  status: "draft" | "scheduled" | "published" | "withdrawn";
  date: string | null;
  publishAt: string | null;
  publishAtDisplay: string | null;
  remainingMs: number | null;
  publishedAt: string | null;
  publishedAtDisplay: string | null;
  withdrawnAt: string | null;
  withdrawnAtDisplay: string | null;
  recipients: Recipient[];
}

export type EventKind =
  | "placement.placed"
  | "placement.moved"
  | "placement.removed"
  | "placement.restored"
  | "placement.claimed"
  | "placement.released"
  | "placement.hung"
  | "placement.signed_off"
  | "object.created"
  | "object.updated"
  | "photo.attached"
  | "wall.lux_changed"
  | "preview.scheduled"
  | "preview.cancelled"
  | "preview.published"
  | "preview.withdrawn";

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

export interface Services {
  database: "up" | "down";
  imageStore: "up" | "down";
  mailRelay: "up" | "down";
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
