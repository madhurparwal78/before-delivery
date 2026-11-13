import type { RemovedSpan } from './sanitiser';

export type ThreadStatus = 'waiting' | 'answered' | 'closed';
export type Topic = 'bug' | 'account' | 'purchase' | 'other';
export type RuleAction = 'read' | 'reply' | 'close' | 'receipts';
export type RuleTopic = Topic | '*';
export type RuleEffect = 'grant' | 'deny';
export type StaffRole = 'developer' | 'moderator';

export interface SessionBody {
  user: { id: string; name: string; email: string; role: StaffRole };
  game: { slug: string; name: string };
  change_token: string;
}

export interface InboxRow {
  id: string;
  status: ThreadStatus;
  topic: Topic;
  player: { id: string; name: string };
  first_line: string;
  last_player_message_at: string;
  waiting_since: string | null;
}

export interface InboxBody {
  counts: { waiting: number; answered: number; closed: number };
  threads: InboxRow[];
  next_cursor: string | null;
}

export type AttachmentStatus = 'uploading' | 'attached' | 'failed';

export interface Attachment {
  id: string;
  message_id: string;
  filename: string;
  content_type: string;
  size: number;
  status: AttachmentStatus;
}

export type EventType = 'purchase.receipt' | 'purchase.refunded' | 'match.finished';

export interface EventDetail {
  type: string;
  verdict: 'accepted' | 'refused';
  receipt_id: string | null;
  refund_id: string | null;
  refund_applied: boolean | null;
  item: string | null;
  amount_minor: number | null;
  currency: string | null;
  match_id: string | null;
  mode: string | null;
  result: string | null;
  duration_seconds: number | null;
}

export interface Unfurl {
  url: string;
  title: string;
  description: string | null;
}

export interface ThreadMessage {
  id: string;
  kind: 'player' | 'reply' | 'event';
  author: { role: 'player' | 'developer' | 'moderator' | 'game_server' | 'support'; name: string };
  body: string | null;
  created_at: string;
  attachments: Attachment[];
  unfurl: Unfurl | null;
  event: EventDetail | null;
}

export type PurchaseStatus = 'paid' | 'partly_refunded' | 'refunded';

export interface Purchase {
  receipt_id: string;
  item: string;
  amount_minor: number;
  currency: string;
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
  player: { id: string; name: string };
  messages: ThreadMessage[];
  purchases: Purchase[];
  waiting_since?: string | null;
  statistics?: ThreadStatistics;
}

export type ForensicsStage = 'signature' | 'bucket' | 'sanitiser' | 'link';

export interface ForensicsLine {
  stage: ForensicsStage;
  state: 'checking' | 'settled';
  verdict: string;
  previous?: number | null;
  level?: number | null;
  capacity?: number | null;
  before?: string | null;
  after?: string | null;
  removed?: RemovedSpan[];
  url?: string | null;
  address?: string | null;
}

export interface ForensicsBody {
  message_id: string;
  settled: boolean;
  lines: ForensicsLine[];
}

export interface ServerReceipt {
  receipt_id: string;
  item: string;
  amount_minor: number;
  currency: string;
  purchased_at: string;
  status: string;
}

export interface PurchaseComparison {
  receipt_id: string;
  on_game_server: boolean | null;
  differences: string[];
}

export interface ReceiptLookupBody {
  available: boolean;
  receipts: ServerReceipt[];
  purchases: PurchaseComparison[];
}

export interface Rule {
  id: string;
  effect: RuleEffect;
  action: RuleAction;
  topic: RuleTopic;
}

export interface Moderator {
  id: string;
  name: string;
  email: string;
  rules: Rule[];
}

export interface TeamBody {
  moderators: Moderator[];
}

export interface EffectiveEntry {
  action: RuleAction;
  topic: Topic;
  allowed: boolean;
  decided_by: string[];
}

export interface EffectiveBody {
  effective: EffectiveEntry[];
}

export interface WidgetMeBody {
  player: { id: string; name: string };
  thread_id: string | null;
  bucket: { level: number; capacity: number; retry_after_seconds: number | null };
}

export interface ApiErrorBody {
  error: { code: string; message: string; fields?: Record<string, string> };
}

export const TOPICS: Topic[] = ['bug', 'account', 'purchase', 'other'];
export const RULE_ACTIONS: RuleAction[] = ['read', 'reply', 'close', 'receipts'];
