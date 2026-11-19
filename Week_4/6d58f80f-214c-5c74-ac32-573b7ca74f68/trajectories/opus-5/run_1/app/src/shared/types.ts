export type PersonKind = 'staff' | 'partner';
export type StaffRole = 'engineer' | 'controller' | 'admin';
export type Role = 'viewer' | 'editor';
export type SortKey =
  | 'name-asc'
  | 'name-desc'
  | 'modified-desc'
  | 'modified-asc'
  | 'size-desc'
  | 'size-asc';

export const SORT_KEYS: readonly SortKey[] = [
  'name-asc',
  'name-desc',
  'modified-desc',
  'modified-asc',
  'size-desc',
  'size-asc',
];

export interface Person {
  id: string;
  name: string;
  email: string;
  firm: string;
  kind: PersonKind;
  staffRole: StaffRole | null;
}

export interface PersonRef {
  id: string;
  name: string;
}

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  projectId: string | null;
  owner: PersonRef;
  fileCount: number;
  access: Role;
}

export interface FileItem {
  id: string;
  name: string;
  folderId: string | null;
  folderName: string;
  size: number;
  contentType: string;
  modifiedAt: string;
  locked: boolean;
  access: Role;
  previewable: boolean;
  accessEnds: string | null;
}

export interface PathSegment {
  id: string;
  name: string;
}

export type GrantStatus = 'active' | 'ended';
export type GrantEndedReason = null | 'date' | 'removed' | 'purged';

export interface Grant {
  id: string;
  itemType: 'folder' | 'file';
  itemId: string;
  itemName: string;
  person: { id: string; name: string; firm: string };
  role: Role;
  endDate: string;
  daysLeft: number;
  status: GrantStatus;
  endedReason: GrantEndedReason;
}

export type UploadState =
  | 'started'
  | 'uploading'
  | 'paused'
  | 'confirmed'
  | 'cancelled'
  | 'abandoned';

export const PART_SIZE = 5_242_880;

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
  expiresAt: string | null;
}

export interface BinItem {
  file: FileItem;
  fromFolder: PersonRef;
  binnedDate: string;
  retentionDays: number;
  purgeDate: string;
  daysLeft: number;
  purgePending: boolean;
}

export type HandoverStatus = 'offered' | 'accepted' | 'declined' | 'lapsed';

export interface Handover {
  id: string;
  folder: PersonRef;
  from: PersonRef;
  to: PersonRef;
  offeredDate: string;
  lapseDate: string;
  status: HandoverStatus;
}

export type PolicyKind = 'bin_retention_days' | 'partner_grant_days';
export type PolicyState = 'in_force' | 'scheduled' | 'past';

export interface Policy {
  id: string;
  kind: PolicyKind;
  days: number;
  effectiveFrom: string;
  state: PolicyState;
}

export type LedgerAction =
  | 'uploaded'
  | 'renamed'
  | 'moved'
  | 'locked'
  | 'unlocked'
  | 'binned'
  | 'restored'
  | 'purged'
  | 'folder_created'
  | 'shared'
  | 'access_changed'
  | 'access_removed'
  | 'access_ended'
  | 'handover_offered'
  | 'handover_accepted'
  | 'handover_declined'
  | 'handover_lapsed'
  | 'policy_scheduled'
  | 'policy_withdrawn';

export interface LedgerDetail {
  fileName?: string;
  folderName?: string;
  fromFolderId?: string | null;
  fromFolderName?: string;
  toFolderId?: string | null;
  toFolderName?: string;
  personName?: string;
  role?: Role;
  endDate?: string;
  days?: number;
  effectiveFrom?: string;
  kind?: PolicyKind;
  previousName?: string;
}

export interface LedgerEntry {
  id: string;
  at: string;
  actor: PersonRef | null;
  action: LedgerAction;
  fileId: string | null;
  folderId: string | null;
  detail: LedgerDetail;
}

export interface ServiceStatus {
  storage: 'up' | 'down';
  directory: 'up' | 'down';
}

export interface ClockBody {
  now: string;
  today: string;
  zone: 'America/Phoenix';
}

export interface StorageTotals {
  usedBytes: number;
  binBytes: number;
  quotaBytes: number;
}

export interface MoveItem {
  fileId: string;
  fromFolderId: string;
}

export interface MoveResult {
  toFolder: PersonRef;
  moved: MoveItem[];
  stayed: { fileId: string; reason: 'locked' }[];
  lostTo: { fileId: string; folder: PersonRef; by: PersonRef }[];
  unchanged: string[];
  folderCounts: Record<string, number>;
}

export interface SharedItem {
  itemType: 'folder' | 'file';
  folder: Folder | null;
  file: FileItem | null;
  role: Role;
  endDate: string;
  daysLeft: number;
}

export type NoticeKind =
  | 'grant_ended'
  | 'grant_ended_fallback'
  | 'lowered'
  | 'removed'
  | 'write_forbidden'
  | 'gone'
  | 'handover_accepted'
  | 'handover_declined'
  | 'handover_lapsed';

export interface PushedNotice {
  id: string;
  kind: NoticeKind;
  text: string;
}

export interface FolderRef {
  id: string | null;
  name: string;
}

export interface MoveEventData {
  toFolder: FolderRef;
  actor: PersonRef;
  items: { fileId: string; fromFolderId: string | null; file: FileItem | null }[];
  folderCounts: Record<string, number>;
}

export type ServerEvent =
  | { type: 'status'; data: ServiceStatus }
  | { type: 'clock'; data: ClockBody }
  | { type: 'folder_created'; data: { folder: Folder } }
  | { type: 'folder_updated'; data: { folder: Folder } }
  | { type: 'file_created'; data: { file: FileItem; folderCounts: Record<string, number> } }
  | { type: 'file_updated'; data: { file: FileItem } }
  | { type: 'moved'; data: MoveEventData }
  | {
      type: 'files_removed';
      data: { fileIds: string[]; folderCounts: Record<string, number> };
    }
  | { type: 'storage'; data: StorageTotals }
  | { type: 'grants_changed'; data: { itemType: 'folder' | 'file'; itemId: string } }
  | { type: 'access_changed'; data: Record<string, never> }
  | { type: 'bin_changed'; data: Record<string, never> }
  | { type: 'handovers_changed'; data: Record<string, never> }
  | { type: 'policies_changed'; data: Record<string, never> }
  | { type: 'upload_expired'; data: { uploadId: string; name: string } }
  | { type: 'notice'; data: PushedNotice };
