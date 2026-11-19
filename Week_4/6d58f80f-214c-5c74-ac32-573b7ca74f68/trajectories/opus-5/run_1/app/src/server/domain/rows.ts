export interface FolderRow {
  id: string;
  name: string;
  parent_id: string | null;
  owner_id: string | null;
}

export interface FileRow {
  id: string;
  name: string;
  folder_id: string;
  size: number;
  content_type: string;
  modified_at: Date;
  locked: boolean;
  state: 'live' | 'binned';
}

export interface GrantRow {
  id: string;
  item_type: 'folder' | 'file';
  item_id: string;
  person_id: string;
  role: 'viewer' | 'editor';
  end_date: string;
  status: 'active' | 'ended';
  ended_reason: string | null;
}

export interface BinRow {
  file_id: string;
  from_folder_id: string;
  binned_date: string;
  retention_days: number;
  purge_date: string;
}

export interface UploadRow {
  id: string;
  person_id: string;
  folder_id: string;
  name: string;
  size: number;
  content_type: string;
  state: 'started' | 'uploading' | 'paused' | 'confirmed' | 'cancelled' | 'abandoned';
  storage_upload_id: string;
  parts: { partNumber: number; etag: string; size: number }[];
  last_activity_at: Date;
}

export interface HandoverRow {
  id: string;
  folder_id: string;
  from_id: string;
  to_id: string;
  offered_date: string;
  lapse_date: string;
  status: 'offered' | 'accepted' | 'declined' | 'lapsed';
}

export interface PolicyRow {
  id: string;
  kind: 'bin_retention_days' | 'partner_grant_days';
  days: number;
  effective_from: string;
}

export interface LedgerRow {
  id: string;
  at: Date;
  actor_id: string | null;
  action: string;
  file_id: string | null;
  folder_id: string | null;
  detail: Record<string, unknown>;
}
