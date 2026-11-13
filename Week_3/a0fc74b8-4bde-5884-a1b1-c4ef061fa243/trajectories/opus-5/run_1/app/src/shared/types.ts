export type Role = 'owner' | 'member' | 'viewer';

export type DocumentStatus =
  | 'draft'
  | 'in_progress'
  | 'sealing'
  | 'completed'
  | 'declined'
  | 'voided';

export type RecipientStatus =
  | 'waiting'
  | 'invited'
  | 'viewed'
  | 'signed'
  | 'declined'
  | 'expired';

export type Delivery = 'sent' | 'held';

export type FieldKind = 'signature' | 'initials' | 'date' | 'text';

export type TemplateStatus = 'draft' | 'shared' | 'retired';

export type LinkState =
  | 'your_turn'
  | 'signed_waiting'
  | 'sealing'
  | 'completed'
  | 'declined'
  | 'voided'
  | 'expired';

export type DocumentFilter = 'all' | 'in_progress' | 'completed' | 'closed';

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

export interface FieldJson {
  id: string;
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

export interface DocumentJson {
  id: string;
  title: string;
  status: DocumentStatus;
  teamId: string;
  ownerId: string;
  ownerName: string;
  timeZone: string;
  pageCount: number;
  originalSha256: string;
  completedSha256: string | null;
  version: number;
  currentOrder: number | null;
  reminderAvailableAt: string | null;
  nextStep: string;
  declinedBy: string | null;
  declineReason: string | null;
  voidedBy: string | null;
  voidReason: string | null;
  updatedAt: string;
  recipients: RecipientJson[];
  fields: FieldJson[];
}

export interface DocumentRowJson {
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

export interface TemplateFieldJson {
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

export interface TemplateJson {
  id: string;
  name: string;
  status: TemplateStatus;
  pageCount: number;
  signerCount: number;
  fields: TemplateFieldJson[];
}

export interface SessionJson {
  user: { id: string; email: string; name: string };
  team: { id: string; name: string };
  role: Role;
}

export interface TeamMemberJson {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface TeamJson {
  id: string;
  name: string;
  members: TeamMemberJson[];
}

export interface SignFieldJson {
  id: string;
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

export interface SignOtherField {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SignViewJson {
  state: LinkState;
  title: string;
  recipient: { id: string; name: string; order: number; status: RecipientStatus };
  signerCount: number;
  current: { name: string; order: number } | null;
  senderName: string;
  declinedBy: string | null;
  voidReason: string | null;
  pageCount: number;
  timeZone: string;
  fields: SignFieldJson[];
  otherFields: SignOtherField[];
}

export interface ServiceNotice {
  mail: boolean;
  storage: boolean;
}

export type Stroke = Array<[number, number]>;
