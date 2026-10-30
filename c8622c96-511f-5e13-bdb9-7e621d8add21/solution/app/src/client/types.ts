// Shapes of the API bodies the browser reads.

export type Role = "contributor" | "picture_editor" | "licensing_manager" | "desk_editor" | "treasurer";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  newsroom: { slug: string; name: string; home_zone: string } | null;
  contributor_handle: string | null;
}

export interface WindowState {
  state: "open" | "claimed";
  held_by: "you" | "your_newsroom" | "another_newsroom" | null;
  held_until: string | null;
  held_until_display: string | null;
  standard_running_until: string | null;
  standard_running_until_display: string | null;
}

export interface Frame {
  id: string;
  position: number;
  caption: string;
  grid_url: string | null;
  story_url?: string | null;
  preview_url: string | null;
}

export interface Credit {
  handle: string;
  name: string;
  position: number;
  split_bp?: number;
}

export interface Essay {
  id: string;
  version: number;
  title: string;
  caption: string;
  credit_line: string;
  credits: Credit[];
  state: "draft" | "in_review" | "embargoed" | "live" | "withdrawn" | "taken_down";
  lift_local: string;
  lift_at: string;
  lift_display: string;
  lift_resolution: string;
  exclusive_days: number;
  standard_days: number;
  exclusive_price_minor: number;
  standard_price_minor: number;
  frames: Frame[];
  desk_notes?: { note: string; at: string; at_display: string }[];
  withdrawal_requested?: boolean;
  window: WindowState;
  licences?: { newsroom: { slug: string; name: string }; kind: string; state: string; window_end: string;
    window_end_display: string; amount_minor: number }[];
}

export interface FeedEssay {
  id: string;
  title: string;
  credit_line: string;
  state: "embargoed" | "live";
  lift_at: string;
  lift_display: string;
  frame_count: number;
  cover_url: string | null;
  window: WindowState;
}

export interface Licence {
  id: string;
  essay_id: string;
  essay_title: string;
  credit_line: string | null;
  kind: "exclusive" | "standard";
  state: "pending_invoice" | "active" | "expired" | "revoked";
  newsroom: { slug: string; name: string };
  licensed_by: { name: string };
  confirmed_at: string;
  confirmed_display: string;
  window_start: string;
  window_end: string;
  window_end_display: string;
  hold_until: string | null;
  hold_until_display: string | null;
  amount_minor: number;
  currency: "USD";
  invoice_state: "pending" | "raised";
  receipt_state: "queued" | "sent" | "cancelled" | null;
  frames: { id: string; position: number }[];
}

export interface ShortlistItem {
  id: string;
  essay_id: string;
  essay_title: string;
  frame_id: string;
  position: number;
  added_by: string;
  added_at: string;
  added_display: string;
}

export interface Follow {
  id: string;
  essay_id: string | null;
  contributor: string | null;
  essay_title?: string | null;
  contributor_name?: string | null;
}
