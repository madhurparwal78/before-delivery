// Shared client types matching the server's published bodies.

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: 'developer' | 'moderator';
}

export interface SessionBody {
  user: SessionUser;
  game: { id?: string; slug: string; name: string };
  change_token: string;
}

export interface Attachment {
  id: string;
  message_id: string;
  filename: string;
  content_type: string;
  size: number;
  status: 'uploading' | 'attached' | 'failed';
}

export interface Unfurl {
  url: string;
  title: string;
  description: string | null;
}

export interface EventDetails {
  type: 'purchase.receipt' | 'purchase.refunded' | 'match.finished' | null;
  verdict: 'accepted' | 'refused' | null;
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

export interface Message {
  id: string;
  kind: 'player' | 'reply' | 'event';
  author: { role: string; name: string };
  body: string | null;
  created_at: string;
  attachments: Attachment[];
  unfurl: Unfurl | null;
  event: EventDetails | null;
}

export interface Purchase {
  receipt_id: string;
  item: string;
  amount_minor: number;
  currency: string;
  refunded_minor: number;
  status: 'paid' | 'partly_refunded' | 'refunded';
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
  status: 'waiting' | 'answered' | 'closed';
  topic: string;
  player: { id: string; name: string };
  waiting_since: string | null;
  messages: Message[];
  purchases: Purchase[];
  statistics?: ThreadStatistics;
}

export interface InboxRowBody {
  id: string;
  status: 'waiting' | 'answered' | 'closed';
  topic: string;
  player: { id: string; name: string };
  first_line: string;
  last_player_message_at: string | null;
  waiting_since: string | null;
}

export interface InboxBody {
  counts: { waiting: number; answered: number; closed: number };
  threads: InboxRowBody[];
  next_cursor: string | null;
}

export interface MeBody {
  player: { id: string; name: string };
  game?: { name: string };
  thread_id: string | null;
  bucket: { level: number; capacity: number; retry_after_seconds: number | null };
}

export interface ForensicsLine {
  stage: 'signature' | 'bucket' | 'sanitiser' | 'link';
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

export interface GameReceipt {
  receipt_id: string;
  item: string;
  amount_minor: number;
  currency: string;
  purchased_at: string;
  status: 'paid' | 'partly_refunded' | 'refunded';
}

export interface ReceiptLookupBody {
  available: boolean;
  receipts: GameReceipt[];
  purchases: { receipt_id: string; on_game_server: boolean | null; differences: string[] }[];
}

export interface RuleBody {
  id: string;
  effect: 'grant' | 'deny';
  action: 'read' | 'reply' | 'close' | 'receipts';
  topic: 'bug' | 'account' | 'purchase' | 'other' | '*';
}

export interface TeamBody {
  moderators: { id: string; name: string; email: string; rules: RuleBody[] }[];
}
