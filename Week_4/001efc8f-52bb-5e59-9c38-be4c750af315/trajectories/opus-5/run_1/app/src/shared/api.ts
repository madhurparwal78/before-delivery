/** The wire shapes the API publishes. */

export type Role = 'dispatcher' | 'field_technician' | 'crew_lead' | 'ops_manager';
export type UserStatus = 'active' | 'invited' | 'deactivated';
export type ChannelKind = 'broadcast' | 'crew';
export type ScheduledState = 'scheduled' | 'firing' | 'sent' | 'cancelled';
export type RepeatRule = 'none' | 'weekly';

export interface User {
  id: string;
  name: string;
  handle: string;
  email?: string;
  role: Role;
  status: UserStatus;
}

export interface Workspace {
  id: string;
  name: string;
  time_zone: string;
}

export interface Channel {
  id: string;
  name: string;
  kind: ChannelKind;
  private: boolean;
  unread_count: number;
  member_count: number;
  pinned_message_ids: string[];
}

export interface Attachment {
  id: string;
  filename: string;
  content_type: string;
  bytes: number;
  width: number;
  height: number;
  url: string;
  thumb_url: string;
}

export interface MessageAuthor {
  id: string;
  name: string;
  role: Role;
}

export type Quote =
  | null
  | { message_id: string; author_name: string; text: string; edited: boolean; deleted: false }
  | { message_id: string; deleted: true };

export interface Message {
  id: string;
  channel_id: string;
  client_message_id: string | null;
  author: MessageAuthor;
  text: string;
  version: number;
  edited: boolean;
  sent_at: string;
  edited_at: string | null;
  editable_until: string;
  thread_root_id: string | null;
  reply_count: number;
  quote: Quote;
  attachments: Attachment[];
  pinned: boolean;
  pinned_by: { id: string; name: string } | null;
  recipient_count: number;
  delivered_count: number;
  read_count: number;
  deleted: false;
}

export interface DeletedMessage {
  id: string;
  channel_id: string;
  deleted: true;
  sent_at: string;
  reply_count: number;
}

export type MessageOrPlaceholder = Message | DeletedMessage;

export interface MessageVersion {
  version: number;
  text: string;
  edited_by: { id: string; name: string };
  created_at: string;
}

export interface Recipient {
  user: { id: string; name: string };
  delivered_at: string | null;
  reads: { version: number; read_at: string }[];
}

export interface Receipts {
  message_id: string;
  sent_at: string;
  as_of: string;
  versions: MessageVersion[];
  recipients: Recipient[];
  recipient_count: number;
  delivered_count: number;
  read_count: number;
}

export interface GalleryPhoto {
  attachment_id: string;
  message_id: string;
  filename: string;
  content_type: string;
  bytes: number;
  uploaded_by: { id: string; name: string };
  uploaded_at: string;
  url: string;
  thumb_url: string;
}

export interface SearchResult {
  kind: 'message' | 'photo';
  message_id: string;
  attachment_id?: string;
  channel: { id: string; name: string };
  thread_root_id: string | null;
  author_name: string;
  snippet: string;
  sent_at: string;
}

export interface Scheduled {
  id: string;
  channel_id: string;
  text: string;
  state: ScheduledState;
  repeat: RepeatRule;
  local_date: string;
  local_time: string;
  time_zone: string;
  next_fire_at: string | null;
  next_fire_local: string | null;
  upcoming_local: string[];
  fired_count: number;
  last_message_id: string | null;
}

export interface ApiErrorBody {
  error: string;
  message: string;
  errors?: Record<string, string>;
  current?: {
    version: number;
    text: string;
    edited_by: { id: string; name: string };
    edited_at: string;
  };
}

export interface ChannelMember {
  user: User;
  joined_at: string;
}

export type StreamEvent =
  | { id: number; type: 'message.created'; data: { message: Message } }
  | { id: number; type: 'message.updated'; data: { message: MessageOrPlaceholder } }
  | { id: number; type: 'message.deleted'; data: { message_id: string; channel_id: string } }
  | {
      id: number;
      type: 'receipts.updated';
      data: {
        message_id: string;
        channel_id: string;
        recipient_count: number;
        delivered_count: number;
        read_count: number;
      };
    }
  | { id: number; type: 'channel.updated'; data: { channel: Channel } }
  | { id: number; type: 'channel.added'; data: { channel: Channel } }
  | { id: number; type: 'channel.revoked'; data: { channel_id: string } }
  | { id: number; type: 'stream.reset'; data: Record<string, never> }
  | { id: number; type: 'session.ended'; data: Record<string, never> };

export const ROLE_LABELS: Record<Role, string> = {
  dispatcher: 'Dispatcher',
  field_technician: 'Field technician',
  crew_lead: 'Crew lead',
  ops_manager: 'Operations manager',
};
