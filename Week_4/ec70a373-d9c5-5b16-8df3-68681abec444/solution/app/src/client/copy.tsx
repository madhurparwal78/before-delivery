// Feedback copy shared by several actions, verbatim from the brief's Feedback states.
import { useEffect, useState, type ReactNode } from "react";
import { quartersText } from "../shared/format.ts";
import { cancellationSplit, hoursToQuarters, type ForfeitSplit } from "../shared/rules.ts";
import type { Booking } from "../shared/api.ts";
import { serverNow } from "./api.ts";
import { Numerals, StatusRegion } from "./ui.tsx";

export const TICKET_CHANGED = "This booking changed elsewhere. Its ticket now shows the current state.";
export const ROW_CHANGED = "This booking changed elsewhere. Its row now shows the current state.";
export const HOLD_EXPIRED = "Your hold expired and the window was released.";

export function certificateCopy(date: string): string {
  return `Your certificate of insurance doesn't cover ${date}. Upload a current one to book.`;
}

export const HOLD_ERRORS: Record<string, string> = {
  slot_taken: "Someone else just claimed that window. Your pack hours are unchanged.",
  cutoff: "That date is closed for booking. Bookings for tomorrow close at 18:00 site time.",
  hold_limit: "You already hold 3 windows. Confirm or release one first.",
  insufficient_hours: "Not enough pack hours for this window. Buy a pack to continue.",
  idempotency_in_progress: "Your hold is still being placed. Wait a moment.",
  idempotency_conflict: "That hold request was already used for another window. Drag the window again.",
  validation: "That window isn't valid. Pick quarter-hour times within one day.",
};

/** The outcome sentence of a cancel dialog, before the request is sent. */
function cancelOutcome(split: ForfeitSplit): { lead: string; forfeit: string | null; tail: string } {
  if (split.forfeited === 0) return { lead: `Cancelling refunds ${quartersText(split.refunded)} pack hours.`, forfeit: null, tail: "" };
  if (split.refunded === 0) return { lead: "", forfeit: `Cancelling now forfeits ${quartersText(split.forfeited)} pack hours.`, tail: "" };
  return {
    lead: `Cancelling now refunds ${quartersText(split.refunded)} pack hours and `,
    forfeit: `forfeits ${quartersText(split.forfeited)} pack hours`,
    tail: ".",
  };
}

/** The member's success copy for a cancellation, from the server's refunded and forfeited quarters. */
export function memberCancelled(refunded: number, forfeited: number): string {
  if (forfeited === 0) return `Booking cancelled. ${quartersText(refunded)} pack hours refunded.`;
  if (refunded === 0) return `Booking cancelled. ${quartersText(forfeited)} pack hours forfeited.`;
  return `Booking cancelled. ${quartersText(refunded)} pack hours refunded, ${quartersText(forfeited)} forfeited.`;
}

export function managerCancelled(reference: string, business: string, refunded: number, forfeited: number): string {
  const lead = `Cancelled ${reference} for ${business}.`;
  if (forfeited === 0) return `${lead} ${quartersText(refunded)} pack hours refunded.`;
  if (refunded === 0) return `${lead} ${quartersText(forfeited)} pack hours forfeited.`;
  return `${lead} ${quartersText(refunded)} pack hours refunded, ${quartersText(forfeited)} forfeited.`;
}

const OUTCOME_CHECK_MS = 250;

/**
 * `status "Cancellation outcome"`: empty in its first frame, written once on open, and written again only when the
 * outcome changes. It works the outcome out from the server-now estimate four times a second, also behind Sign in again: the estimate
 * can read just under a second behind the server, and the sentence has 2 seconds to change at a notice edge.
 */
export function CancellationOutcome({ booking }: { booking: Booking }): ReactNode {
  const [split, setSplit] = useState<ForfeitSplit | null>(null);
  useEffect(() => {
    const check = (): void => {
      const next = cancellationSplit(booking.status, hoursToQuarters(booking.hours), Date.parse(booking.start_at) - serverNow());
      setSplit((now) => (now && now.refunded === next.refunded && now.forfeited === next.forfeited ? now : next));
    };
    check();
    const id = setInterval(check, OUTCOME_CHECK_MS);
    return () => clearInterval(id);
  }, [booking]);
  const outcome = split && cancelOutcome(split);
  return (
    <StatusRegion name="Cancellation outcome" className="dialog-text">
      {outcome && (
        <>
          <Numerals text={outcome.lead} />
          {outcome.forfeit && (
            <span className="forfeit">
              <Numerals text={outcome.forfeit} />
            </span>
          )}
          {outcome.tail}
        </>
      )}
    </StatusRegion>
  );
}
