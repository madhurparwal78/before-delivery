// Display helpers for server-supplied stamps; numbers themselves are formatted in shared/numerals.
import { money } from "../../shared/numerals";
import { zoneAbbreviation } from "../../shared/portTime";
import type { Move, Role } from "../../shared/types";

/** `HH:MM` of a `YYYY-MM-DDTHH:MM[:SS]` port stamp. */
export const clockOf = (stamp: string): string => stamp.slice(11, 16);

/** `MM-DD HH:MM` of a port stamp, for compact rows. */
export const shortStamp = (stamp: string): string => `${stamp.slice(5, 10)} ${stamp.slice(11, 16)}`;

/** `YYYY-MM-DD HH:MM` of a port stamp. */
export const dateTimeOf = (stamp: string): string => `${stamp.slice(0, 10)} ${stamp.slice(11, 16)}`;

export const dollars = (cents: number): string => `$${money(cents)}`;

/** The move's notice cutoff as `YYYY-MM-DD HH:MM ADT` or `AST`. */
export const cutoffText = (notice: Move["notice"]): string =>
  `${dateTimeOf(notice.cutoff_at)} ${zoneAbbreviation(notice.cutoff_utc_offset)}`;

export const verdictText = (notice: Move["notice"]): string =>
  notice.state === "late" ? "Under 2 hours' notice - cancellation charge applies" : "Notice on time - no cancellation charge";

/** A move's status as shown, with the detained sub-state of On board. */
export const statusText = (move: Pick<Move, "status" | "detained">): string =>
  move.detained ? "On board - detained" : move.status;

export const CHARGES: Record<Move["billing"]["state"], string> = { none: "No charges", pending: "Charges pending", posted: "Charges posted" };

export const ROLE_NAMES: Record<Role, string> = {
  dispatcher: "Duty dispatcher",
  pilot: "Harbour pilot",
  agent: "Port agent",
  clerk: "Accounts clerk",
};
