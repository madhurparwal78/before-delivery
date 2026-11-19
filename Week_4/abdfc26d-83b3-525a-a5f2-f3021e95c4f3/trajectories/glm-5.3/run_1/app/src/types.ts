export interface User {
  id: string;
  username: string;
  display_name: string;
  email: string;
  roles: string[];
}

export interface Uniform {
  name: string;
  label: string;
  min: number;
  max: number;
  value: number;
}

export type SplitRowParty = 'creator' | 'remixer' | 'platform';
export type SplitParty = 'creator' | 'remixer' | 'royalty' | 'platform';
export type Easing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';

export interface Keyframe {
  time_s: number;
  value: number;
  easing: Easing;
}

export interface Track {
  uniform: string;
  keyframes: Keyframe[];
}

export interface Timeline {
  duration_s: number;
  tracks: Track[];
  audio_asset_id: string | null;
}

export interface Asset {
  id: string;
  kind: 'font' | 'model' | 'audio';
  filename: string;
  bytes: number;
}

export interface RemixLink {
  slug: string;
  title: string;
  creator_display_name: string;
}

export type PieceState = 'draft' | 'published' | 'withdrawn';

export interface Piece {
  slug: string;
  title: string;
  state: PieceState;
  version: number;
  engine: 'GLSL';
  creator: { id: string; display_name: string };
  fragment_source: string;
  uniforms: Uniform[];
  timeline: Timeline;
  assets: Asset[];
  remix_of: RemixLink | null;
  edition_count: number | null;
  price_cents: number | null;
  editions_left: number | null;
  export_render_id: string | null;
}

export type RenderFailure = 'provider_error' | 'timeout' | 'malformed' | 'storage_error' | 'cancelled';

export interface RenderEvent { state: string; at: string }

export interface Render {
  id: string;
  piece_slug: string;
  state: 'accepted' | 'queued' | 'rendering' | 'stored' | 'ready' | 'failed' | 'timed_out' | 'credits_released';
  failure_reason: RenderFailure | null;
  cost_credits: number;
  attempts: number;
  format: 'mp4' | 'webm';
  resolution: '720p' | '1080p';
  duration_s: number;
  aspect: '16:9' | '9:16' | '1:1' | '4:5';
  sha256: string | null;
  history: RenderEvent[];
  created_at: string;
}

export type OrderState =
  | 'held' | 'paying' | 'failed' | 'expired'
  | 'paid' | 'invoiced' | 'receipted' | 'refunded';

export interface Order {
  id: string;
  piece_slug: string;
  piece_title: string;
  edition: number;
  edition_count: number;
  state: OrderState;
  expires_at: string | null;
  seconds_left: number | null;
  billing_name: string;
  email: string;
  billing_country: string;
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
