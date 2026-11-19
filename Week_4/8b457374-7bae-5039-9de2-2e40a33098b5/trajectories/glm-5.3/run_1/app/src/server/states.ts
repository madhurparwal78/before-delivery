import type { CampaignStatus } from "../shared/domain.js";

// Every campaign and pledge state transition, and its rejection, is decided in
// exactly one place per transition: each SQL statement that moves a pledge or
// a campaign between states carries its own status guard, so an impossible
// transition never happens and a rejection comes from the same predicate.
//
// The campaign state table: draft -> live (launch), live -> funded and
// live -> unfunded (close-out), live -> cancelled (creator cancellation),
// funded -> collecting (every authorised pledge has a capture result),
// collecting -> settled (no pledge remains errored).
//
// The pledge state table: authorising -> authorised (a confirmed AUTHORIZE),
// authorising -> nothing (a decline removes the attempt), authorised ->
// voided (a confirmed VOID), authorised -> captured or authorised -> errored
// (the funded close-out), errored -> captured or errored -> dropped (the final
// attempt). The counting and claiming state lists live with their SQL.

export function campaignClosedForPledging(status: CampaignStatus): boolean {
  return (
    status === "funded" ||
    status === "collecting" ||
    status === "settled" ||
    status === "unfunded" ||
    status === "cancelled"
  );
}
