export type Role = "owner" | "member" | "viewer";
export type DocumentStatus =
  | "draft"
  | "in_progress"
  | "sealing"
  | "completed"
  | "declined"
  | "voided";
export type RecipientStatus =
  | "waiting"
  | "invited"
  | "viewed"
  | "signed"
  | "declined"
  | "expired";
export type Delivery = null | "sent" | "held";
export type FieldKind = "signature" | "initials" | "date" | "text";
export type TemplateStatus = "draft" | "shared" | "retired";

export interface Recipient {
  id: string;
  documentId: string;
  name: string;
  email: string;
  order: number;
  status: RecipientStatus;
  delivery: Delivery;
  linkHash: string | null;
  linkExpiresAt: Date | null;
  turnStartedAt: Date | null;
  signedAt: Date | null;
  declineReason: string | null;
  binding: boolean;
}

export interface Field {
  id: string;
  documentId: string;
  recipientId: string;
  kind: FieldKind;
  label: string;
  required: boolean;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  value: string | null;
}

export interface DocumentRow {
  id: string;
  teamId: string;
  ownerId: string;
  title: string;
  status: DocumentStatus;
  timeZone: string;
  pageCount: number;
  originalSha256: string;
  completedSha256: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  currentOrder: number | null;
  reminderAvailableAt: Date | null;
  voidReason: string | null;
  voidedBy: string | null;
  declinedByRecipientId: string | null;
  declinedByName: string | null;
  sendToken: string | null;
  reminderToken: string | null;
}

export interface UserRow {
  id: string;
  teamId: string;
  email: string;
  name: string;
  passwordHash: string;
  role: Role;
}

export interface TeamRow { id: string; name: string }
export interface SessionRow { token: string; userId: string; createdAt: Date }

export interface AuditEventRow {
  seq: number;
  documentId: string;
  type: string;
  actor: string;
  recipientId: string | null;
  at: Date;
  prevHash: string;
  hash: string;
}

export interface TemplateRow {
  id: string;
  teamId: string;
  ownerId: string;
  name: string;
  status: TemplateStatus;
  pageCount: number;
  createdAt: Date;
}

export interface TemplateFieldRow {
  id: string;
  templateId: string;
  signer: number;
  kind: FieldKind;
  label: string;
  required: boolean;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface IdempotencyRow {
  key: string;
  documentId: string;
  status: number;
  body: string;
}
