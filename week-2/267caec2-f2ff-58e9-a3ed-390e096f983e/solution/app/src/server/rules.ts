import {
  type EntryAction, type FeeTier, type RoundAction, entryActionLegal, roundActionLegal,
} from "../shared/transitions.js";
import { COPY, refuse } from "./errors.js";
import { cutoff, deadlineLabel } from "./time.js";

// The domain rules, each decided here once (brief: Business rules).

export const ENTRY_STATES = ["draft", "submitted", "screened", "disqualified", "withdrawn", "round_1", "shortlisted",
  "eliminated", "final_round", "winner", "finalist", "honourable_mention", "published"] as const;
export type EntryState = (typeof ENTRY_STATES)[number];

export type Award = "winner" | "finalist" | "honourable_mention";
export const AWARDS: readonly Award[] = ["winner", "finalist", "honourable_mention"];

/** 409 invalid_transition unless `action` is legal from `state` (brief: Entry states). */
export function guardEntry(state: string, action: EntryAction): void {
  if (!entryActionLegal(state, action)) throw refuse("invalid_transition", undefined, { from: state, action });
}

/** 409 invalid_transition unless the round may take `action` (brief: Round states). */
export function guardRound(state: string, action: RoundAction): void {
  if (!roundActionLegal(state, action)) throw refuse("invalid_transition", undefined, { from: state, action });
}

export interface ProgramDates {
  time_zone: string;
  early_bird_date: string;
  deadline_date: string;
}

/** A window is open at every instant before the boundary that ends its date. */
function windowOpen(date: string, zone: string, now: Date): boolean {
  return now.getTime() < cutoff(date, zone).getTime();
}

export function entriesOpen(program: ProgramDates, now: Date): boolean {
  return windowOpen(program.deadline_date, program.time_zone, now);
}

/** 409 deadline_passed for draft changes and submission after the entry deadline. */
export function guardEntriesOpen(program: ProgramDates, now: Date): void {
  if (!entriesOpen(program, now)) {
    throw refuse("deadline_passed", COPY.deadline_passed(deadlineLabel(program.deadline_date, program.time_zone)));
  }
}

/** 409 deadline_not_passed for screening and opening Round 1 while entries are open. */
export function guardEntriesClosed(program: ProgramDates, now: Date): void {
  if (entriesOpen(program, now)) {
    throw refuse("deadline_not_passed", COPY.deadline_not_passed(deadlineLabel(program.deadline_date, program.time_zone)));
  }
}

/** The fee in effect at `now`: early-bird while its window is open, standard afterwards. */
export function feeInEffect(program: ProgramDates & { early_bird_fee_cents: number; standard_fee_cents: number }, now: Date):
  { tier: FeeTier; amountCents: number } {
  return windowOpen(program.early_bird_date, program.time_zone, now)
    ? { tier: "early_bird", amountCents: program.early_bird_fee_cents }
    : { tier: "standard", amountCents: program.standard_fee_cents };
}

export const STATUS_LABEL: Record<Exclude<EntryState, "published">, string> = {
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
};

/** True once a published category's embargo instant has passed, by the server clock. */
export function embargoPassed(embargoAt: Date | null, now: Date): boolean {
  return embargoAt !== null && embargoAt.getTime() <= now.getTime();
}
