import type { Currency } from './money.js';
import type { ErrorCode, ItemStatus, TierKey, TierName } from './copy.js';
import type { ExhibitKey } from './exhibits.js';

export type Role = 'visitor' | 'curator' | 'lead_curator' | 'manager';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface Preferences {
  motion: boolean;
  sound: boolean;
}

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; fields?: Record<string, string> };
}

export interface ChapterSummary {
  id: string;
  number: number;
  numeral: string;
  title: string;
  era: string;
  catalogue_number: string;
  sightline_deg: number;
  resolved: boolean;
}

export interface TimelineEvent {
  id: string;
  year: number;
  title: string;
  summary: string;
  chapter: number;
  source_ids: string[];
}

export interface Plate {
  media_url: string;
  caption: string;
}

export interface Narration {
  media_url: string;
  transcript: string;
}

export interface ChapterDetail extends ChapterSummary {
  body: string;
  viewpoints: number[];
  exhibit: ExhibitKey | null;
  narration: Narration | null;
  plates: Plate[];
  events: TimelineEvent[];
}

export interface SearchResult {
  type: 'chapter' | 'event';
  id: string;
  title: string;
  chapter: number;
}

export interface SourceRecord {
  id: string;
  citation: string;
  cited_by: string[];
}

export interface SavedPath {
  resolved: number[];
  last_chapter: number | null;
  last_exhibit: string;
}

export interface Bookmark {
  id: string;
  target_type: 'chapter' | 'event';
  target_id: string;
  title: string;
}

export type OrderKind = 'ticket' | 'donation' | 'membership_join' | 'membership_upgrade';
export type OrderStatus = 'settled' | 'partially_refunded' | 'refunded';

export interface Order {
  id: string;
  receipt_number: string;
  kind: OrderKind;
  description: string;
  currency: Currency;
  amount_minor: number;
  refunded_minor: number;
  status: OrderStatus;
  settled_at: string;
  card_last4: string;
  receipt_url: string;
}

export interface RefundRecord {
  id: string;
  amount_minor: number;
  reason: string;
  at: string;
}

export interface OrderNote {
  id: string;
  text: string;
  author_email: string;
  at: string;
}

export interface ManagerOrder extends Order {
  user_email: string;
  killbill_invoice_id: string;
  killbill_payment_id: string;
  refunds: RefundRecord[];
  notes: OrderNote[];
}

export type MembershipStatus = 'active' | 'pending_change' | 'overdue' | 'cancelled';

export type PendingChange =
  | { kind: 'downgrade'; tier: TierKey; effective_on: string }
  | { kind: 'cancel'; effective_on: string };

export interface Membership {
  tier: TierKey;
  tier_name: TierName;
  status: MembershipStatus;
  currency: Currency;
  price_minor: number;
  charged_through: string | null;
  pending: PendingChange | null;
  amount_due_minor: number | null;
  next_charge: { on: string; amount_minor: number } | null;
  card_last4: string;
}

export type SessionStatus = 'on_sale' | 'closed' | 'held' | 'cancelled';

export interface GuidedSession {
  id: string;
  title: string;
  starts_at: string;
  starts_at_display: string;
  duration_minutes: number;
  capacity: number;
  seats_left: number;
  status: SessionStatus;
  booking_closes_at: string;
  price_minor?: number;
  currency?: Currency;
}

export interface Booking {
  id: string;
  ticket_code: string;
  session_id: string;
  seats: number;
}

export interface ScheduledPriceChange {
  currency: Currency;
  amount_minor: number;
  effective_on: string;
}

export interface CatalogTier {
  tier: TierKey;
  name: TierName;
  prices: Record<Currency, number>;
  scheduled_changes: ScheduledPriceChange[];
}

export interface Catalog {
  currencies: Currency[];
  ticket: { prices: Record<Currency, number> };
  tiers: CatalogTier[];
  donation: { min_minor: Record<Currency, number>; max_minor: Record<Currency, number> };
}

export type ItemType = 'chapter' | 'event';

export interface CuratorItem {
  id: string;
  type: ItemType;
  title: string;
  status: ItemStatus;
  owner_email: string;
  publish_at: string | null;
  chapter: number;
}

export interface MediaRecord {
  id: string;
  kind: 'narration' | 'image' | 'scan';
  item_id: string;
  filename: string;
  bytes: number;
  content_type: string;
  key: string;
}

export interface OverdueSupporter {
  user_email: string;
  name: string;
  tier: TierKey;
  currency: Currency;
  amount_due_minor: number;
  failed_at: string;
  attempts: number;
  next_retry_at: string | null;
}

export interface ReconciliationRow {
  currency: Currency;
  ledger_net_minor: number;
  killbill_net_minor: number;
  difference_minor: number;
  matched: boolean;
}

export interface AuditRow {
  id: string;
  at: string;
  actor_email: string;
  action: string;
  target_type: string;
  target_id: string;
  detail: Record<string, unknown>;
}

export type ReceiptEmailState = 'sent' | 'delayed';
