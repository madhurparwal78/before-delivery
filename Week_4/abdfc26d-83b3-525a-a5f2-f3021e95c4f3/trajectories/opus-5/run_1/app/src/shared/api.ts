import type { EasingValue, ServiceName } from './copy.js';

export type PieceState = 'draft' | 'published' | 'withdrawn';
export type RenderState =
  | 'accepted'
  | 'queued'
  | 'rendering'
  | 'stored'
  | 'ready'
  | 'failed'
  | 'timed_out'
  | 'credits_released';
export type RenderFailureReason =
  | 'provider_error'
  | 'timeout'
  | 'malformed'
  | 'storage_error'
  | 'cancelled';
export type OrderState =
  | 'held'
  | 'paying'
  | 'paid'
  | 'invoiced'
  | 'receipted'
  | 'refunded'
  | 'failed'
  | 'expired';
export type EditionStatus = 'available' | 'held' | 'collected';
export type AspectRatio = '16:9' | '9:16' | '1:1' | '4:5';
export type Resolution = '720p' | '1080p';
export type ExportFormat = 'mp4' | 'webm';
export type SplitParty = 'creator' | 'remixer' | 'platform';

export interface ApiErrorShape {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
    current_version?: number;
    needed?: number;
    available?: number;
    next_free?: number | null;
    invoice_number?: string;
  };
}

export interface MeResponse {
  id: string;
  username: string;
  display_name: string;
  email: string;
  roles: string[];
}

export interface RemixCredit {
  slug: string;
  title: string;
  creator_display_name: string;
}

export interface PieceCard {
  slug: string;
  title: string;
  creator_display_name: string;
  engine: 'GLSL';
  edition_count: number;
  editions_left: number;
  price_cents: number;
  remix_of: RemixCredit | null;
  published_at: string;
}

export interface GallerySection {
  id: 'runs' | 'remixes';
  title: string;
  total: number;
  pieces: PieceCard[];
}

export interface GalleryResponse {
  featured: PieceCard | null;
  sections: GallerySection[];
}

export interface PieceUniform {
  name: string;
  label: string;
  min: number;
  max: number;
  value: number;
}

export interface Keyframe {
  time_s: number;
  value: number;
  easing: EasingValue;
}

export interface TimelineTrack {
  uniform: string;
  keyframes: Keyframe[];
}

export interface PieceTimeline {
  duration_s: number;
  tracks: TimelineTrack[];
  audio_asset_id: string | null;
}

export interface PieceAsset {
  id: string;
  kind: 'font' | 'model' | 'audio';
  filename: string;
  bytes: number;
}

export interface Piece {
  slug: string;
  title: string;
  state: PieceState;
  version: number;
  engine: 'GLSL';
  creator: { id: string; display_name: string };
  fragment_source?: string;
  uniforms: PieceUniform[];
  timeline: PieceTimeline;
  assets?: PieceAsset[];
  remix_of: RemixCredit | null;
  edition_count: number | null;
  price_cents: number | null;
  editions_left: number | null;
  export_render_id: string | null;
}

export interface EditionEntry {
  number: number;
  status: EditionStatus;
  held_by_you: boolean;
  seed_hash: string;
}

export interface EditionsResponse {
  edition_count: number;
  editions: EditionEntry[];
}

export interface RenderHistoryEntry {
  state: RenderState;
  at: string;
}

export interface Render {
  id: string;
  piece_slug: string;
  state: RenderState;
  failure_reason: RenderFailureReason | null;
  cost_credits: number;
  attempts: number;
  format: ExportFormat;
  resolution: Resolution;
  duration_s: number;
  aspect: AspectRatio;
  sha256: string | null;
  history: RenderHistoryEntry[];
  created_at: string;
}

export interface Order {
  id: string;
  piece_slug: string;
  piece_title: string;
  edition: number;
  edition_count: number;
  state: OrderState;
  expires_at: string | null;
  seconds_left: number | null;
  billing_name: string | null;
  email: string | null;
  billing_country: string | null;
  net_cents: number;
  vat_rate_percent: number;
  vat_cents: number;
  gross_cents: number;
  currency: 'USD';
  invoice_number: string | null;
  invoice_status: 'none' | 'pending' | 'ready';
  receipt_status: 'none' | 'queued' | 'sent';
  refunded_net_cents: number;
  paid_at: string | null;
  created_at: string;
}

export interface CreditLedgerRow {
  account: string;
  amount: number;
}

export interface CreditLedgerEntry {
  id: string;
  kind: 'grant' | 'pack' | 'reserve' | 'capture' | 'release';
  render_id: string | null;
  created_at: string;
  rows: CreditLedgerRow[];
}

export interface CreditsResponse {
  available: number;
  held: number;
  entries: CreditLedgerEntry[];
}

export interface PlanSummary {
  code: 'studio-monthly' | 'pro-monthly';
  state: 'pending_payment' | 'active' | 'cancelling' | 'ended';
  ends_on: string | null;
}

export interface PlanResponse {
  plan: PlanSummary | null;
}

export interface CreditPackPurchase {
  id: string;
  state: 'paying' | 'paid' | 'failed';
  credits: number;
  price_cents: number;
}

export interface StatementLine {
  date: string;
  piece_title: string;
  edition: number;
  kind: 'sale' | 'remix_sale' | 'royalty' | 'refund';
  amount_cents: number;
}

export interface StatementResponse {
  period: string;
  status: 'open' | 'closed';
  lines: StatementLine[];
  total_cents: number;
}

export interface SplitRow {
  party: SplitParty;
  holder: string;
  kind: 'sale' | 'refund';
  amount_cents: number;
  refund_id: string | null;
}

export interface SplitsResponse {
  net_cents: number;
  rows: SplitRow[];
}

export interface RefundResponse {
  refund: {
    id: string;
    credit_note_number: string;
    net_cents: number;
    vat_cents: number;
    gross_cents: number;
    rows: SplitRow[];
  };
}

export interface ServiceStatus {
  name: ServiceName;
  reachable: boolean;
  checked_at: string;
}

export interface ServicesResponse {
  services: ServiceStatus[];
}

export interface DownloadLink {
  url: string;
  expires_in: number;
}
