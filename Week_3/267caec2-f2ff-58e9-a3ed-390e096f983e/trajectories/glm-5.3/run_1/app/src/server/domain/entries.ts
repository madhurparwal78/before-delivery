import { windowOpen } from "./time.js";
import { errors } from "../http/errors.js";

export type EntryState =
  | "draft" | "submitted" | "screened" | "disqualified" | "withdrawn"
  | "round_1" | "shortlisted" | "eliminated" | "final_round"
  | "winner" | "finalist" | "honourable_mention" | "published";

export type EntryAction =
  | "edit" | "delete" | "upload" | "remove_image" | "submit" | "withdraw"
  | "screen_pass" | "screen_disqualify" | "reinstate" | "open_round_1" | "open_final"
  | "confirm_round_1" | "confirm_final" | "publish";

interface Transition {
  from: EntryState[];
  to?: EntryState | "outcome";
}

/** The single transition table for entry states. */
const TRANSITIONS: Record<EntryAction, Transition> = {
  edit: { from: ["draft"] },
  delete: { from: ["draft"] },
  upload: { from: ["draft"] },
  remove_image: { from: ["draft"] },
  submit: { from: ["draft"], to: "submitted" },
  withdraw: { from: ["submitted"], to: "withdrawn" },
  screen_pass: { from: ["submitted"], to: "screened" },
  screen_disqualify: { from: ["submitted", "screened"], to: "disqualified" },
  reinstate: { from: ["disqualified"], to: "screened" },
  open_round_1: { from: ["screened"], to: "round_1" },
  open_final: { from: ["shortlisted"], to: "final_round" },
  confirm_round_1: { from: ["round_1"], to: "outcome" },
  confirm_final: { from: ["final_round"], to: "outcome" },
  publish: { from: ["winner", "finalist", "honourable_mention"], to: "published" },
};

/** Checks an action against the single transition table, answering the documented conflict. */
export function assertTransition(state: EntryState, action: EntryAction): void {
  if (!TRANSITIONS[action].from.includes(state)) {
    throw errors.invalidTransition(state, action);
  }
}

export interface ProgramRecord {
  id: string;
  name: string;
  year: number;
  time_zone: string;
  early_bird_date: string;
  deadline_date: string;
  early_bird_fee_cents: number;
  standard_fee_cents: number;
}

export type FeeTier = "early_bird" | "standard";

/** The single place deciding the fee tier: fixed at the moment of payment. */
export function feeTierAtPayment(program: Pick<ProgramRecord, "early_bird_date" | "time_zone">, now = new Date()): FeeTier {
  return windowOpen(program.early_bird_date, program.time_zone, now) ? "early_bird" : "standard";
}

export function feeForTier(program: Pick<ProgramRecord, "early_bird_fee_cents" | "standard_fee_cents">, tier: FeeTier): number {
  return tier === "early_bird" ? program.early_bird_fee_cents : program.standard_fee_cents;
}

export function tierLabel(tier: FeeTier): string {
  return tier === "early_bird" ? "Early-bird" : "Standard";
}

export const STATUS_LABELS: Record<EntryState, string> = {
  draft: "Draft",
  submitted: "Submitted",
  screened: "Screened",
  disqualified: "Disqualified",
  withdrawn: "Withdrawn",
  round_1: "Round 1",
  shortlisted: "Shortlisted",
  eliminated: "Not shortlisted",
  final_round: "Final round",
  winner: "Winner",
  finalist: "Finalist",
  honourable_mention: "Honourable mention",
  published: "Published",
};

const AWARD_LABELS: Record<string, string> = {
  winner: "Winner",
  finalist: "Finalist",
  honourable_mention: "Honourable mention",
};

/** The states a studio sees as "final_round" while an embargo hides the outcome. */
const EMBARGO_MASKED: EntryState[] = ["winner", "finalist", "honourable_mention", "published"];

export interface EntryRecord {
  id: string;
  program_id: string;
  category_id: string;
  studio_id: string;
  entry_number: number;
  title: string;
  summary: string;
  site_url: string;
  credits: string;
  state: EntryState;
  submitted_at: Date | null;
  paid_fee_cents: number | null;
  fee_tier: FeeTier | null;
  invoice_id: string | null;
  payment_id: string | null;
  paid_at: Date | null;
  refund_amount_cents: number | null;
  refunded_at: Date | null;
  disqualify_reason: string | null;
  award: string | null;
  r1_score: string | null;
  final_score: string | null;
}

export interface StudioView {
  state: EntryState;
  statusLabel: string;
  award: string | null;
  score: string | null;
  disqualifyReason: string | null;
}

/**
 * The single place for studio-facing masking. `embargoPassed` is checked against
 * the server clock for the entry's category embargo by the caller.
 */
export function studioView(entry: EntryRecord, embargoPassed: boolean): StudioView {
  let state = entry.state;
  if (!embargoPassed && EMBARGO_MASKED.includes(state)) {
    state = "final_round";
  }
  let award: string | null = entry.award;
  let score: string | null = null;
  if (state === "published" || (embargoPassed && EMBARGO_MASKED.includes(entry.state))) {
    state = "published";
    score = entry.final_score;
    if (!entry.award) {
      award = null;
    }
  } else if (state === "eliminated") {
    award = null;
    score = embargoPassed ? entry.r1_score : null;
  } else if (state === "shortlisted") {
    award = null;
    score = entry.r1_score;
  } else if (state === "winner" || state === "finalist" || state === "honourable_mention") {
    award = entry.award;
    score = entry.final_score;
  } else {
    award = null;
  }
  const statusLabel =
    state === "published" && entry.award
      ? (AWARD_LABELS[entry.award] ?? STATUS_LABELS[state])
      : STATUS_LABELS[state];
  return { state, statusLabel, award, score, disqualifyReason: entry.disqualify_reason };
}

export interface EntryRecord {
  id: string;
  program_id: string;
  category_id: string;
  studio_id: string;
  entry_number: number;
  title: string;
  summary: string;
  site_url: string;
  credits: string;
  state: EntryState;
  submitted_at: Date | null;
  paid_fee_cents: number | null;
  fee_tier: FeeTier | null;
  invoice_id: string | null;
  payment_id: string | null;
  paid_at: Date | null;
  refund_amount_cents: number | null;
  refunded_at: Date | null;
  disqualify_reason: string | null;
  award: string | null;
  r1_score: string | null;
  final_score: string | null;
}

export interface AssetRecord {
  id: string;
  entry_id: string;
  name: string;
  type: "image/png" | "image/jpeg";
  width: number;
  height: number;
  bytes: number;
}

export function scoreString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}
