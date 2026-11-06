export type Role = 'owner' | 'member' | 'guest';

export type IssueStatus = 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done' | 'cancelled';

export type Person = {
  id: string;
  name: string;
  email: string;
  handle: string | null;
  role: Role | null;
};

export type Holiday = { date: string; name: string };

export type Seats = { limit: number; active: number; pending: number };

export type Workspace = {
  id: string;
  name: string;
  slug: string;
  time_zone: string;
  working_weekdays: number[];
  holidays: Holiday[];
  cycle_anchor: string;
  today: string;
  is_working_day: boolean;
  next_digest_at: string;
  seats: Seats | null;
};

export type CycleDay = {
  date: string;
  counted: boolean;
  reason: string | null;
  clock_change: 'forward' | 'back' | null;
};

export type BurndownEntry = { date: string; open: number };

export type Cycle = {
  number: number;
  starts_at: string;
  ends_at: string;
  first_working_date: string;
  last_working_date: string;
  calendar_days: number;
  working_day_count: number;
  days: CycleDay[];
  burndown: BurndownEntry[];
  issue_keys: string[];
  is_current: boolean;
  is_finished: boolean;
};

export type AttachmentParentType = 'issue' | 'message' | 'doc';

export type Attachment = {
  id: string;
  filename: string;
  size: number;
  content_type: string;
  parent: { type: AttachmentParentType; id: string };
};

export type Issue = {
  key: string;
  project_id: string;
  title: string;
  description: string;
  status: IssueStatus;
  assignee_id: string | null;
  parent_key: string | null;
  sub_issue_keys: string[];
  cycle_number: number | null;
  due_date: string | null;
  closed_at: string | null;
  attachments: Attachment[];
};

export type Message = {
  id: number;
  channel_id: string;
  author_id: string;
  body: string;
  thread_root_id: number | null;
  reply_count: number;
  mentions: string[];
  created_at: string;
  attachments: Attachment[];
  client_key: string | null;
};

export type Doc = {
  id: string;
  project_id: string;
  title: string;
  body: string;
  version: number;
  updated_by: string | null;
  updated_at: string;
  attachments: Attachment[];
};

export type DocSummary = Omit<Doc, 'body'>;

export type DocVersion = {
  version: number;
  saved_at: string;
  saved_by: string | null;
  title: string;
  body: string;
};

export type Occupant = { person_id: string; name: string; status: 'active' | 'away' };

export type Room = {
  id: string;
  name: string;
  kind: 'open' | 'private';
  x: number;
  y: number;
  w: number;
  h: number;
  occupants: Occupant[];
};

export type Floor = { rooms: Room[]; me: { room_id: string | null; status: 'active' | 'away' } };

export type KnockStatus = 'waiting' | 'let_in' | 'not_now' | 'expired';

export type Knock = {
  id: string;
  room_id: string;
  person_id: string;
  status: KnockStatus;
  created_at: string;
  expires_at: string;
};

export type InviteStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

export type Invite = {
  id: string;
  email: string;
  role: Role;
  project_ids: string[];
  channel_ids: string[];
  status: InviteStatus;
  created_at: string;
  expires_at: string;
  workspace_name: string;
};

export type Billing = {
  limit: number;
  active: number;
  pending: number;
  price_per_seat: string;
  currency: string;
  monthly_total: string;
  billing_status: 'ok' | 'unavailable';
  account_external_key: string;
  scheduled_limit: number | null;
  scheduled_on: string | null;
};

export type ProjectSummary = { id: string; key: string; name: string };

export type ChannelSummary = { id: string; name: string; unread: number };

export type Unread = { channels: Record<string, number>; inbox: number };

export type ServiceStatus = {
  database: 'ok' | 'unavailable';
  mail: 'ok' | 'delayed';
  storage: 'ok' | 'unavailable';
  billing: 'ok' | 'unavailable';
  held_mail: number | null;
};

export type EventName =
  | 'message'
  | 'thread_reply'
  | 'message_deleted'
  | 'unread'
  | 'typing'
  | 'presence'
  | 'room'
  | 'knock'
  | 'issue'
  | 'doc'
  | 'notice'
  | 'revoked'
  | 'reset';

export type ApiErrorBody = {
  error: { code: string; message: string; fields?: Record<string, string> };
};
