import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Booking, Quote } from "../../shared/api";
import { isChargedCancellation } from "../../shared/status";
import { Modal } from "../components/Modal";
import { useAction } from "../lib/actions";
import { ApiFailure, apiGet, apiPost } from "../lib/api";
import { PENDING, SUCCESS, failureCopy } from "../lib/copy";
import { cutoffLabel, formatDollars } from "../lib/format";
import { announceError, announceStatus, clearError } from "../lib/live";

interface CancelProps {
  booking: Booking;
  onCancelled: (booking: Booking) => void;
  /** The booking became final while the dialog was open. */
  onFinal: () => void;
  onClose: () => void;
}

function quoteText(quote: Quote): string {
  if (isChargedCancellation(quote)) {
    return `This is a late cancellation (inside two business days). Charge: ${formatDollars(quote.charge_cents)}.`;
  }
  if (quote.late) return "This is inside two business days, but no interpreter holds a seat yet. No charge.";
  return `Cancelling now is on time. No charge. Free cancellation ended or ends ${cutoffLabel(quote.cutoff)}.`;
}

/** The keyboard-complete cancellation dialog: it quotes the charge first and sends back exactly the charge it showed. */
export function CancelDialog({ booking, onCancelled, onFinal, onClose }: CancelProps) {
  const action = useAction();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [changed, setChanged] = useState(false);
  const [focusQuote, setFocusQuote] = useState(0);
  const quoteRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    clearError();
    apiGet<Quote>(`/api/bookings/${booking.id}/cancellation-quote`).then(
      (fresh) => live && setQuote(fresh),
      (failure: unknown) => {
        if (!live) return;
        announceStatus("");
        announceError(failureCopy(failure, "cancel"));
        if (failure instanceof ApiFailure) onClose();
      },
    );
    return () => {
      live = false;
    };
    // The quote is fetched once, when the dialog opens.
  }, []);

  useLayoutEffect(() => {
    if (focusQuote > 0) quoteRef.current?.focus();
  }, [focusQuote]);

  const confirmCancellation = async () => {
    if (quote === null) return;
    const cancelled = await action.run({
      kind: "cancel",
      pending: PENDING.cancel,
      work: () => apiPost<Booking>(`/api/bookings/${booking.id}/cancel`, { quoted_charge_cents: quote.charge_cents }),
      success: (updated) => (updated.charge ? SUCCESS.cancelledLate(updated.ref, updated.charge.amount_cents) : SUCCESS.cancelled(updated.ref)),
      onFailure: (failure) => {
        if (failure.body?.error === "quote_changed" && failure.body.quote) {
          setQuote(failure.body.quote);
          setChanged(true);
          setFocusQuote((count) => count + 1);
        }
        if (failure.body?.error === "invalid_transition") onFinal();
      },
    });
    if (cancelled !== undefined) onCancelled(cancelled);
  };

  const confirmLabel = quote === null ? PENDING.quote : action.pending ? PENDING.cancel : changed ? "Confirm new charge" : "Confirm cancellation";

  return (
    <Modal
      label="Cancel booking"
      onClose={onClose}
      closable={!action.pending}
      initialFocus={(dialog) => dialog.querySelector<HTMLElement>("[data-keep]")}
      fallbackFocus={() => document.querySelector<HTMLElement>("[data-detail-heading]")}
    >
      <div className="dialog-form">
        <h2 className="dialog-title">Cancel booking</h2>
        <p className="dialog-note">
          <span className="mono">{booking.ref}</span> · {booking.title}
        </p>
        <div ref={quoteRef} role="status" aria-label="Cancellation quote" tabIndex={0} className="quote">
          {quote === null ? PENDING.quote : quoteText(quote)}
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn" data-keep disabled={action.pending} onClick={onClose}>
            Keep booking
          </button>
          <button type="button" className="btn btn--primary" disabled={quote === null || action.pending} onClick={() => void confirmCancellation()}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
