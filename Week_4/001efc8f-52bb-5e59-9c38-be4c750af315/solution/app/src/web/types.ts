export type Role = "dispatcher" | "field_technician" | "crew_lead" | "ops_manager";

export type User = { id: string; name: string; handle: string; email?: string; role: Role; status: "active" | "invited" | "deactivated" };
export type Workspace = { id: string; name: string; time_zone: string };
export type Me = { user: User; workspace: Workspace };

export type Channel = {
  id: string;
  name: string;
  kind: "broadcast" | "crew";
  private: boolean;
  unread_count: number;
  member_count: number;
  pinned_message_ids: string[];
};

export type Attachment = { id: string; filename: string; content_type: string; bytes: number; width: number; height: number; url: string; thumb_url: string };

export type Quote =
  | { message_id: string; author_name: string; text: string; edited: boolean; deleted: false }
  | { message_id: string; deleted: true };

export type Message = {
  id: string;
  channel_id: string;
  client_message_id: string | null;
  author: { id: string; name: string; role: Role };
  text: string;
  version: number;
  edited: boolean;
  sent_at: string;
  edited_at: string | null;
  editable_until: string;
  thread_root_id: string | null;
  reply_count: number;
  quote: Quote | null;
  attachments: Attachment[];
  pinned: boolean;
  pinned_by: { id: string; name: string } | null;
  recipient_count: number;
  delivered_count: number;
  read_count: number;
  deleted: false;
};

export type Placeholder = { id: string; channel_id: string; deleted: true; sent_at: string; reply_count: number };
export type Entry = Message | Placeholder;

export type VersionEntry = { version: number; text: string; edited_by: { id: string; name: string }; created_at: string };

export type Receipts = {
  message_id: string;
  sent_at: string;
  as_of: string;
  versions: VersionEntry[];
  recipients: { user: { id: string; name: string }; delivered_at: string | null; reads: { version: number; read_at: string }[] }[];
  recipient_count: number;
  delivered_count: number;
  read_count: number;
};

export type GalleryPhoto = {
  attachment_id: string;
  message_id: string;
  filename: string;
  content_type: string;
  bytes: number;
  uploaded_by: { id: string; name: string };
  uploaded_at: string;
  url: string;
  thumb_url: string;
};

export type SearchResult = {
  kind: "message" | "photo";
  message_id: string;
  attachment_id?: string;
  channel: { id: string; name: string };
  thread_root_id: string | null;
  author_name: string;
  snippet: string;
  sent_at: string;
};

export type Scheduled = {
  id: string;
  channel_id: string;
  text: string;
  state: "scheduled" | "firing" | "sent" | "cancelled";
  repeat: "none" | "weekly";
  local_date: string;
  local_time: string;
  time_zone: string;
  next_fire_at: string | null;
  next_fire_local: string | null;
  upcoming_local: string[];
  fired_count: number;
  last_message_id: string | null;
};

export const ROLE_LABEL: Record<Role, string> = {
  dispatcher: "Dispatcher",
  field_technician: "Field technician",
  crew_lead: "Crew lead",
  ops_manager: "Operations manager",
};
