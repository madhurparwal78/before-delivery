// The cancellation outcome, defined once: the server's cancel and the Cancel booking dialog's
// outcome line both decide it here, from the booking's cutoff and the server's clock.

export type CancellationOutcome = "credited" | "forfeited";

/** Strictly before the cutoff returns the hours; at or after it they are forfeited. */
export function cancellationOutcome(cutoffAt: number, now: number): CancellationOutcome {
  return now < cutoffAt ? "credited" : "forfeited";
}
