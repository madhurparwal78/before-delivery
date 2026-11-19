// Shapes of the API's JSON bodies, shared by the server and the browser (brief: API, Shared objects).

export type Role = "viewer" | "editor";
export type PersonKind = "staff" | "partner";
export type StaffRole = "engineer" | "controller" | "admin";
export type CompanyDate = string;
type Instant = string;

export interface Person {
  id: string;
  name: string;
  email: string;
  firm: string;
  kind: PersonKind;
  staffRole: StaffRole | null;
}

export interface Named {
  id: string;
  name: string;
}

export interface ShownFolder {
  id: string | null;
  name: string;
}

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  projectId: string | null;
  owner: Named;
  fileCount: number;
  access: Role;
}

export interface DriveFile {
  id: string;
  name: string;
  folderId: string | null;
  folderName: string;
  size: number;
  contentType: string;
  modifiedAt: Instant;
  locked: boolean;
  access: Role;
  previewable: boolean;
  accessEnds: CompanyDate | null;
}

export type ItemType = "folder" | "file";
type GrantStatus = "active" | "ended";
export type GrantEndedReason = "date" | "removed" | "purged";

export interface Grant {
  id: string;
  itemType: ItemType;
  itemId: string;
  itemName: string;
  person: { id: string; name: string; firm: string };
  role: Role;
  endDate: CompanyDate;
  daysLeft: number;
  status: GrantStatus;
  endedReason: GrantEndedReason | null;
}

export type UploadState = "started" | "uploading" | "paused" | "confirmed" | "cancelled" | "abandoned";

export interface Upload {
  id: string;
  folderId: string;
  name: string;
  size: number;
  contentType: string;
  state: UploadState;
  partSize: number;
  partCount: number;
  confirmedParts: number[];
  expiresAt: Instant | null;
}

export interface BinItem {
  file: DriveFile;
  fromFolder: Named;
  binnedDate: CompanyDate;
  retentionDays: number;
  purgeDate: CompanyDate;
  daysLeft: number;
  purgePending: boolean;
}

export type HandoverStatus = "offered" | "accepted" | "declined" | "lapsed";

export interface Handover {
  id: string;
  folder: Named;
  from: Named;
  to: Named;
  offeredDate: CompanyDate;
  lapseDate: CompanyDate;
  status: HandoverStatus;
}

export type PolicyKind = "bin_retention_days" | "partner_grant_days";
export type PolicyState = "in_force" | "scheduled" | "past";

export interface Policy {
  id: string;
  kind: PolicyKind;
  days: number;
  effectiveFrom: CompanyDate;
  state: PolicyState;
}

export type LedgerAction =
  | "uploaded" | "renamed" | "moved" | "locked" | "unlocked" | "binned" | "restored" | "purged"
  | "folder_created"
  | "shared" | "access_changed" | "access_removed" | "access_ended"
  | "handover_offered" | "handover_accepted" | "handover_declined" | "handover_lapsed"
  | "policy_scheduled" | "policy_withdrawn";

export interface LedgerDetail {
  folder?: ShownFolder;
  from?: ShownFolder;
  to?: ShownFolder;
  oldName?: string;
  newName?: string;
  name?: string;
  person?: Named;
  role?: Role;
  endDate?: CompanyDate;
  item?: { type: ItemType; name: string };
  lapseDate?: CompanyDate;
  kind?: PolicyKind;
  days?: number;
  effectiveFrom?: CompanyDate;
  retentionDays?: number;
}

export interface LedgerEntry {
  id: string;
  at: Instant;
  actor: Named | null;
  action: LedgerAction;
  fileId: string | null;
  folderId: string | null;
  detail: LedgerDetail;
}

export interface MoveResult {
  toFolder: Named;
  moved: { fileId: string; fromFolderId: string }[];
  stayed: { fileId: string; reason: "locked" }[];
  lostTo: { fileId: string; folder: ShownFolder; by: Named }[];
  unchanged: string[];
  folderCounts: Record<string, number>;
}

export interface ServiceStatus {
  storage: "up" | "down";
  directory: "up" | "down";
}

export interface Clock {
  now: Instant;
  today: CompanyDate;
  zone: "America/Phoenix";
}

export interface SharedItem {
  itemType: ItemType;
  folder: Folder | null;
  file: DriveFile | null;
  role: Role;
  endDate: CompanyDate;
  daysLeft: number;
}

/** A notice the server pushes to the one person it concerns (brief: Feedback states, Notices). */
export type Notice =
  | { kind: "access_ended"; item: string; date: CompanyDate }
  | { kind: "editor_ended"; item: string; date: CompanyDate }
  | { kind: "view_only"; item: string }
  | { kind: "removed"; item: string }
  | { kind: "handover_accepted"; person: string; folder: string }
  | { kind: "handover_declined"; person: string; folder: string }
  | { kind: "handover_lapsed"; person: string; folder: string };

/** Messages on GET /api/events, one per state change the session may see. */
export type EventMessage =
  | { type: "status"; data: ServiceStatus }
  | { type: "day"; data: { today: CompanyDate } }
  | { type: "files"; data: { fileIds: string[]; folderIds: string[]; storage: boolean } }
  | { type: "moved"; data: { by: Named; toFolder: ShownFolder; items: { fileId: string; fromFolderId: string | null }[] } }
  | { type: "folders"; data: { folderIds: string[] } }
  | { type: "grants"; data: { itemType: ItemType; itemId: string } }
  | { type: "access"; data: { notice: Notice | null } }
  | { type: "handovers"; data: { notice: Notice | null } }
  | { type: "policies"; data: Record<string, never> }
  | { type: "upload"; data: { upload: Upload; expired: boolean } };

export const PART_SIZE = 5_242_880;
export const SORT_KEYS = ["name-asc", "name-desc", "modified-desc", "modified-asc", "size-desc", "size-asc"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
