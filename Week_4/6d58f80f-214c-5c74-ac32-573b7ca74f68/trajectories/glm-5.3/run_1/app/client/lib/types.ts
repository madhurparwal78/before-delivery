export type Role = 'viewer' | 'editor';
export type StaffRole = 'engineer' | 'controller' | 'admin';
export type PersonKind = 'staff' | 'partner';

export interface Person {
  id: string;
  name: string;
  email: string;
  firm: string;
  kind: PersonKind;
  staffRole: StaffRole | null;
}

export interface Folder {
  id: string | null;
  name: string;
  parentId: string | null;
  projectId: string | null;
  owner: { id: string; name: string };
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

export interface Grant {
  id: string;
  itemType: 'folder' | 'file';
  itemId: string;
  itemName: string;
  person: { id: string; name: string; firm: string };
  role: Role;
  endDate: string;
  daysLeft: number;
  status: 'active' | 'ended';
  endedReason: string | null;
}

export interface UploadItem {
  id: string;
  folderId: string;
  name: string;
  size: number;
  contentType: string;
  state: 'started' | 'uploading' | 'paused' | 'confirmed' | 'cancelled' | 'abandoned';
  partSize: number;
  partCount: number;
  confirmedParts: number[];
  expiresAt: string | null;
}

export interface BinItem {
  file: DriveFile;
  fromFolder: { id: string; name: string };
  binnedDate: string;
  retentionDays: number;
  purgeDate: string;
  daysLeft: number;
  purgePending: boolean;
}

export interface Handover {
  id: string;
  folder: { id: string; name: string };
  from: { id: string; name: string };
  to: { id: string; name: string };
  offeredDate: string;
  lapseDate: string;
  status: 'offered' | 'accepted' | 'declined' | 'lapsed';
}

export interface Policy {
  id: string;
  kind: 'bin_retention_days' | 'partner_grant_days';
  days: number;
  effectiveFrom: string;
  state: 'in_force' | 'scheduled' | 'past';
}

export interface LedgerEntry {
  id: string;
  at: string;
  actor: { id: string; name: string } | null;
  action: string;
  fileId: string | null;
  folderId: string | null;
  detail: Record<string, unknown>;
}

export interface MoveResult {
  toFolder: { id: string | null; name: string };
  moved: Array<{ fileId: string; fromFolderId: string }>;
  stayed: Array<{ fileId: string; reason: 'locked' }>;
  lostTo: Array<{ fileId: string; folder: { id: string | null; name: string }; by: { id: string; name: string } }>;
  unchanged: string[];
  folderCounts: Record<string, number>;
}

export interface SharedItem {
  itemType: 'folder' | 'file';
  folder: Folder | null;
  file: DriveFile | null;
  role: Role;
  endDate: string;
  daysLeft: number;
}
