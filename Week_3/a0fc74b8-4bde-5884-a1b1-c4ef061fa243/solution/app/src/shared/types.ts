export type Role = "owner" | "member" | "viewer";
export type DocumentStatus = "draft" | "in_progress" | "sealing" | "completed" | "declined" | "voided";
export type RecipientStatus = "waiting" | "invited" | "viewed" | "signed" | "declined" | "expired";
export type Delivery = "sent" | "held";
export type FieldKind = "signature" | "initials" | "date" | "text";
export type LinkState = "your_turn" | "signed_waiting" | "sealing" | "completed" | "declined" | "voided" | "expired";
export type TemplateStatus = "draft" | "shared" | "retired";

export interface PageSize {
  w: number;
  h: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RecipientJson {
  id: string;
  name: string;
  email: string;
  order: number;
  status: RecipientStatus;
  delivery: Delivery | null;
  linkExpiresAt: string | null;
  signedAt: string | null;
  declineReason: string | null;
  binding: boolean;
}

export interface FieldJson extends Box {
  id: string;
  recipientId: string;
  kind: FieldKind;
  label: string;
  required: boolean;
  page: number;
  value: string | null;
}

export interface DocumentJson {
  id: string;
  title: string;
  status: DocumentStatus;
  teamId: string;
  ownerId: string;
  ownerName: string;
  timeZone: string;
  pageCount: number;
  pageSizes: PageSize[];
  originalSha256: string;
  completedSha256: string | null;
  version: number;
  currentOrder: number | null;
  reminderAvailableAt: string | null;
  nextStep: string;
  voidReason: string | null;
  voidedByName: string | null;
  recipients: RecipientJson[];
  fields: FieldJson[];
}

export interface DocumentSummary {
  id: string;
  title: string;
  status: DocumentStatus;
  nextStep: string;
  updatedAt: string;
}

export interface AuditEventJson {
  seq: number;
  type: string;
  actor: string;
  recipientId: string | null;
  at: string;
  prevHash: string;
  hash: string;
}

export interface SessionJson {
  user: { id: string; email: string; name: string };
  team: { id: string; name: string };
  role: Role;
}

export interface TemplateFieldJson extends Box {
  signer: number;
  kind: FieldKind;
  label: string;
  required: boolean;
  page: number;
}

export interface TemplateJson {
  id: string;
  name: string;
  status: TemplateStatus;
  pageCount: number;
  signerCount: number;
  fields: TemplateFieldJson[];
}

export interface MemberJson {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface TeamJson {
  id: string;
  name: string;
  members: MemberJson[];
}

export type Stroke = [number, number][];

export interface SignFieldJson extends FieldJson {
  strokes: Stroke[] | null;
}

export interface SignLinkJson {
  state: LinkState;
  title: string;
  recipient: { id: string; name: string; order: number; status: RecipientStatus };
  signerCount: number;
  current: { name: string; order: number } | null;
  senderName: string;
  declinedBy: string | null;
  voidReason: string | null;
  pageCount: number;
  pageSizes: PageSize[];
  timeZone: string;
  fields: SignFieldJson[];
  otherFields: (Box & { page: number })[];
}

export type LiveEvent =
  | { type: "document"; documentId: string; teamId: string }
  | { type: "role"; userId: string }
  | { type: "templates"; teamId: string }
  | { type: "services"; mail: boolean; storage: boolean }
  | { type: "resync" };
