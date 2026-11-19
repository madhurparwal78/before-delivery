export const ROLES = ['dispatcher', 'field_technician', 'crew_lead', 'ops_manager'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  dispatcher: 'Dispatcher',
  field_technician: 'Field technician',
  crew_lead: 'Crew lead',
  ops_manager: 'Operations manager',
};

export const ROLE_SHORT: Record<Role, string> = {
  dispatcher: 'Dispatch',
  field_technician: 'Field tech',
  crew_lead: 'Crew lead',
  ops_manager: 'Ops',
};

export type UserStatus = 'active' | 'invited' | 'deactivated';

export type ChannelKind = 'broadcast' | 'crew';

export interface UserRecord {
  id: string;
  name: string;
  handle: string;
  email: string;
  role: Role;
  status: UserStatus;
}

export interface WorkspaceRecord {
  id: string;
  name: string;
  timeZone: string;
}

export interface ChannelRecord {
  id: string;
  workspace_id: string;
  name: string;
  kind: ChannelKind;
  private: boolean;
}

export interface MembershipRecord {
  channel_id: string;
  user_id: string;
  joined_at: string;
}

export interface MessageRow {
  id: string;
  channel_id: string;
  workspace_id: string;
  client_message_id: string;
  author_id: string;
  text: string;
  version: number;
  sent_at: Date;
  edited_at: Date | null;
  thread_root_id: string | null;
  quoted_message_id: string | null;
  deleted: boolean;
}

export interface AttachmentRow {
  id: string;
  message_id: string;
  workspace_id: string;
  channel_id: string;
  filename: string;
  content_type: string;
  bytes: number;
  width: number;
  height: number;
  original_key: string;
  thumb_key: string;
  state: 'stored' | 'removal_queued' | 'removed';
  uploaded_by: string;
  uploaded_at: Date;
}

export const MAX_MESSAGE_LENGTH = 4000;
export const PIN_LIMIT = 3;
export const MAX_PHOTOS = 4;
export const MAX_PHOTO_BYTES = 10000000;
export const MAX_PHOTO_PIXELS = 40000000;
export const SEARCH_MIN_CHARS = 2;
export const SEARCH_MAX_CHARS = 200;
export const SEARCH_MAX_TERMS = 8;
export const PAGE_DEFAULT_LIMIT = 30;
export const PAGE_MAX_LIMIT = 100;
