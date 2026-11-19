export type StaffRole = 'engineer' | 'controller' | 'admin';
export type PersonKind = 'staff' | 'partner';
export type Role = 'viewer' | 'editor';
export type DateStr = string;
export type IsoInstant = string;

export interface Person {
  id: string;
  name: string;
  email: string;
  firm: string;
  kind: PersonKind;
  staffRole: StaffRole | null;
}

export interface FolderRef { id: string; name: string; }

export interface Folder {
  id: string | null;
  name: string;
  parentId: string | null;
  projectId: string | null;
  owner: { id: string; name: string };
  fileCount: number;
  access: Role;
}

export interface FileRow {
  id: string;
  name: string;
  folderId: string | null;
  folderName: string;
  size: number;
  contentType: string;
  modifiedAt: IsoInstant;
  locked: boolean;
  access: Role;
  previewable: boolean;
  accessEnds: DateStr | null;
}

export interface GrantRow {
  id: string;
  itemType: 'folder' | 'file';
  itemId: string;
  itemName: string;
  person: { id: string; name: string; firm: string };
  role: Role;
  endDate: DateStr;
  daysLeft: number;
  status: 'active' | 'ended';
  endedReason: 'date' | 'removed' | 'purged' | null;
}

export interface UploadRow {
  id: string;
  folderId: string;
  name: string;
  size: number;
  contentType: string;
  state: 'started' | 'uploading' | 'paused' | 'confirmed' | 'cancelled' | 'abandoned';
  partSize: number;
  partCount: number;
  confirmedParts: number[];
  expiresAt: IsoInstant | null;
}

export interface BinRow {
  file: FileRow;
  fromFolder: { id: string; name: string };
  binnedDate: DateStr;
  retentionDays: number;
  purgeDate: DateStr;
  daysLeft: number;
  purgePending: boolean;
}

export interface HandoverRow {
  id: string;
  folder: FolderRef;
  from: { id: string; name: string };
  to: { id: string; name: string };
  offeredDate: DateStr;
  lapseDate: DateStr;
  status: 'offered' | 'accepted' | 'declined' | 'lapsed';
}

export interface PolicyRow {
  id: string;
  kind: 'bin_retention_days' | 'partner_grant_days';
  days: number;
  effectiveFrom: DateStr;
  state: 'in_force' | 'scheduled' | 'past';
}

export interface LedgerEntry {
  id: string;
  at: IsoInstant;
  actor: { id: string; name: string } | null;
  action: string;
  fileId: string | null;
  folderId: string | null;
  detail: Record<string, unknown>;
}

export interface SessionPerson extends Person {}
