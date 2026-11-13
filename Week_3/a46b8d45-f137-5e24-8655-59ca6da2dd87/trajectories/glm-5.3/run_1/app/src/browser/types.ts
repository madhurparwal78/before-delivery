// Types shared across the browser modules, so no module imports values it
// does not need.
export interface ApiErrorShape {
  error: { code: string; message: string; fields?: Record<string, string>; state?: string };
}

export interface ShareView {
  reference: string;
  state: string;
  language: string;
  model: { name: string } | null;
  part: { booklet_number: number; part_number: string; name: string } | null;
  quantity: number | null;
  purchase_date: string | null;
  ruling: { inside: boolean; edition: string; cover_ends_at: string; cover_ends_on: string } | null;
  quote: {
    revision: number; part_line_minor: number; carriage_minor: number; total_minor: number;
    band: string; promise: { kind: string; date: string };
  } | null;
  paid_minor: number | null;
  decline: { reason: string; charged_minor: number; refunded_minor: number } | null;
  dispatched_at: string | null;
  history: Array<{ state: string; at: string }>;
}

export interface ClaimView {
  reference: string;
  state: string;
  language: string;
  owner: { name: string; email: string; postcode: string };
  purchase_date: string | null;
  club_member: boolean;
  model: { slug: string; name: string } | null;
  part: { booklet_number: number; part_number: string; name: string; status: string; bin_count: number } | null;
  quantity: number | null;
  description: string;
  photos: Array<{ index: number; content_type: string; bytes: number }>;
  started_at: string;
  confirm_by: string | null;
  confirmed_at: string | null;
  ruling: {
    inside: boolean; edition: string; cover_ends_at: string; cover_ends_on: string;
    term_months: number | null; decided_at: string;
  } | null;
  quotes: Array<{
    revision: number; status: string; source: string; part_line_minor: number; carriage_minor: number;
    total_minor: number; band: string; carriage_valid_until: string | null;
    promise: { kind: string; date: string }; quoted_at: string;
  }>;
  payment: { paid_minor: number; paid_at: string } | null;
  decline: { reason: string; charged_minor: number; refunded_minor: number } | null;
  dispatched_at: string | null;
  closed_at: string | null;
  share_link: { url: string; state: string };
  notices_pending: number;
}

export interface ModelSummary {
  slug: string;
  name: string;
  axis: 'x' | 'y' | 'iso' | null;
  diagram: boolean;
  part_count: number;
}

export interface ModelDetail extends ModelSummary {
  parts: Array<{ booklet_number: number; part_number: string; name: string; longest_side_mm: number; status: string }>;
}
