import type { Currency } from './amount.js';

export const THREAD_STATUSES = ['waiting', 'answered', 'closed'] as const;
export type ThreadStatus = (typeof THREAD_STATUSES)[number];
export type Topic = 'bug' | 'account' | 'purchase' | 'other';
export type RuleTopic = Topic | '*';
export type RuleEffect = 'grant' | 'deny';
export type RuleAction = 'read' | 'reply' | 'close' | 'receipts';
export type Role = 'developer' | 'moderator';
export const PURCHASE_STATUSES = ['paid', 'partly_refunded', 'refunded'] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];
export type AttachmentStatus = 'uploading' | 'attached' | 'failed';
export const EVENT_TYPES = ['purchase.receipt', 'purchase.refunded', 'match.finished'] as const;
export type EventType = (typeof EVENT_TYPES)[number];
export type Stage = 'signature' | 'bucket' | 'sanitiser' | 'link';

export const TOPICS: readonly Topic[] = ['bug', 'account', 'purchase', 'other'];
export const ACTIONS: readonly RuleAction[] = ['read', 'reply', 'close', 'receipts'];
export const STAGES: readonly Stage[] = ['signature', 'bucket', 'sanitiser', 'link'];
export const BUCKET_CAPACITY = 8;

export interface ApiErrorBody {
  error: { code: string; message: string; fields?: Record<string, string> };
}

export interface SessionBody {
  user: { id: string; name: string; email: string; role: Role };
  game: { slug: string; name: string };
  change_token: string;
}

interface PlayerRef {
  id: string;
  name: string;
}

export interface Author {
  role: 'player' | 'developer' | 'moderator' | 'game_server' | 'support';
  name: string;
}

export interface AttachmentBody {
  id: string;
  message_id: string;
  filename: string;
  content_type: string;
  size: number;
  status: AttachmentStatus;
}

export interface EventBody {
  type: EventType;
  verdict: 'accepted' | 'refused';
  receipt_id: string | null;
  refund_id: string | null;
  refund_applied: boolean | null;
  item: string | null;
  amount_minor: number | null;
  currency: Currency | null;
  match_id: string | null;
  mode: string | null;
  result: 'won' | 'lost' | 'abandoned' | null;
  duration_seconds: number | null;
}

export interface LinkPreviewBody {
  url: string;
  title: string;
  description: string | null;
}

export interface MessageBody {
  id: string;
  kind: 'player' | 'reply' | 'event';
  author: Author;
  body: string | null;
  created_at: string;
  attachments: AttachmentBody[];
  unfurl: LinkPreviewBody | null;
  event: EventBody | null;
}

export interface PurchaseBody {
  receipt_id: string;
  item: string;
  amount_minor: number;
  currency: Currency;
  refunded_minor: number;
  status: PurchaseStatus;
}

export interface ThreadStatistics {
  player_messages: number;
  replies: number;
  reopens: number;
  first_reply_at: string | null;
  first_closed_at: string | null;
  last_closed_at: string | null;
}

export interface ThreadBody {
  id: string;
  status: ThreadStatus;
  topic: Topic;
  player: PlayerRef;
  messages: MessageBody[];
  purchases: PurchaseBody[];
  statistics?: ThreadStatistics;
  waiting_since?: string | null;
}

export interface InboxRow {
  id: string;
  status: ThreadStatus;
  topic: Topic;
  player: PlayerRef;
  first_line: string;
  last_player_message_at: string;
  waiting_since: string | null;
}

export interface InboxBody {
  counts: Record<ThreadStatus, number>;
  threads: InboxRow[];
  next_cursor: string | null;
}

export interface LookupBody {
  available: boolean;
  receipts: { receipt_id: string; item: string; amount_minor: number; currency: Currency; purchased_at: string; status: PurchaseStatus }[];
  purchases: { receipt_id: string; on_game_server: boolean | null; differences: string[] }[];
}

export interface ForensicsLine {
  stage: Stage;
  state: 'checking' | 'settled';
  verdict: string;
  previous?: number | null;
  level?: number | null;
  capacity?: number | null;
  before?: string | null;
  after?: string | null;
  removed?: { start: number; end: number; text: string }[];
  url?: string | null;
  address?: string | null;
}

export interface ForensicsBody {
  message_id: string;
  settled: boolean;
  lines: ForensicsLine[];
}

export interface RuleBody {
  id: string;
  effect: RuleEffect;
  action: RuleAction;
  topic: RuleTopic;
}

export interface TeamBody {
  moderators: { id: string; name: string; email: string; rules: RuleBody[] }[];
}

export interface WidgetMe {
  game: { slug: string; name: string };
  player: PlayerRef;
  thread_id: string | null;
  bucket: { level: number; capacity: number; retry_after_seconds: number | null };
}

export type WidgetThreadBody = Omit<ThreadBody, 'statistics' | 'waiting_since'>;
