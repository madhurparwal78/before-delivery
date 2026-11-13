export type Lang = "en-GB" | "pl-PL";

export type ClaimState = "started" | "confirmed" | "identified" | "quoted" | "declined" | "dispatched" | "closed" | "erased";
export type PartStatus = "active" | "withdrawn";
export type Axis = "x" | "y" | "iso";
export type DeclineReason = "owner_declined" | "cannot_send";
export type LinkState = "active" | "withdrawn" | "ended";

export interface PromiseView {
  kind: "same_day" | "later";
  date: string;
}

export interface RulingView {
  inside: boolean;
  edition: string;
  cover_ends_at: string;
  cover_ends_on: string;
  term_months: number | null;
  decided_at: string;
}

export interface DeclineView {
  reason: DeclineReason;
  charged_minor: number;
  refunded_minor: number;
}

export interface QuoteView {
  revision: number;
  status: "current" | "void";
  source: "bin" | "supplier";
  part_line_minor: number;
  carriage_minor: number;
  total_minor: number;
  band: string;
  carriage_valid_until: string;
  promise: PromiseView;
  quoted_at: string;
}

export interface OpsPartView {
  booklet_number: number;
  part_number: string;
  name: string;
  status: PartStatus;
  bin_count: number;
}

export interface PhotoView {
  index: number;
  content_type: string;
  bytes: number;
}

export interface ClaimView {
  reference: string;
  state: Exclude<ClaimState, "erased">;
  language: Lang;
  owner: { name: string; email: string; postcode: string };
  purchase_date: string;
  club_member: boolean;
  model: { slug: string; name: string };
  part: OpsPartView;
  quantity: number;
  description: string;
  photos: PhotoView[];
  started_at: string;
  confirm_by: string;
  confirmed_at: string | null;
  ruling: RulingView | null;
  quotes: QuoteView[];
  payment: { paid_minor: number; paid_at: string } | null;
  decline: DeclineView | null;
  dispatched_at: string | null;
  closed_at: string | null;
  share_link: { url: string; state: LinkState } | null;
  notices_pending: number;
}

export interface ErasedClaimView {
  reference: string;
  state: "erased";
  erased_at: string;
}

export type OpsClaimView = ClaimView | ErasedClaimView;

export interface ShareQuote {
  revision: number;
  part_line_minor: number;
  carriage_minor: number;
  total_minor: number;
  band: string;
  promise: PromiseView;
}

export interface ShareView {
  reference: string;
  state: ClaimState;
  language: Lang;
  model: { name: string };
  part: { booklet_number: number; part_number: string; name: string };
  quantity: number;
  purchase_date: string;
  ruling: Pick<RulingView, "inside" | "edition" | "cover_ends_at" | "cover_ends_on"> | null;
  quote: ShareQuote | null;
  paid_minor: number | null;
  decline: DeclineView | null;
  dispatched_at: string | null;
  history: { state: ClaimState; at: string }[];
}

export interface CatalogueModel {
  slug: string;
  name: string;
  axis: Axis | null;
  diagram: boolean;
  part_count: number;
}

export interface CatalogueModelPart {
  booklet_number: number;
  part_number: string;
  name: string;
  longest_side_mm: number;
  status: PartStatus;
}

export interface CatalogueModelDetail {
  slug: string;
  name: string;
  axis: Axis | null;
  diagram: boolean;
  parts: CatalogueModelPart[];
}

export interface OpsClaimRow {
  reference: string;
  state: ClaimState;
  model: string | null;
  confirmed_at: string | null;
}

export interface OpsStats {
  decided_claims: number;
  decided_inside: number;
  decided_outside: number;
}

export interface EditionView {
  code: string;
  title: string;
  starts_on: string;
  standard_months: number;
  club_months: number;
  owner_contribution_percent: number;
}

export interface ImportReport {
  created: number;
  updated: number;
  unchanged: number;
  unmatched: { line: number; reason: string }[];
}

export interface EstimateView {
  band: string;
  charge_minor: number;
  currency: "GBP";
  valid_until: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
    state?: ClaimState;
  };
}
