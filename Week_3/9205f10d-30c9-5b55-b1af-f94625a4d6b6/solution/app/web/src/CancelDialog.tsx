import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { OFFLINE_COPY, api, idempotencyKey } from "./api";
import { cutoffText } from "./format";
import { DURATION, play } from "./motion";
import type { ApiRequest, Invoice, Quote } from "./types";

function quoteCopy(quote: Quote): string {
  return quote.kind === "early"
    ? `Free cancellation until ${cutoffText(quote.free_cancel_until)}. Cancelling now costs $0.00.`
    : `Late cancellation: $${quote.fee} (${quote.billable_minutes} minutes × ${quote.seats_charged} confirmed seats at $${quote.hourly_rate} per hour).`;
}

/**
 * Cancel booking: states the server's exact fee before anything changes. Confirming sends that
 * fee; if the server says it changed, the dialog shows the new quote and the next confirm sends it.
 */
export function CancelDialog({
  request,
  quote: firstQuote,
  onClose,
  onCancelled,
}: {
  request: ApiRequest;
  quote: Quote;
  onClose: () => void;
  onCancelled: (request: ApiRequest, fee: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const [quote, setQuote] = useState(firstQuote);
  const [changed, setChanged] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    keep.current?.focus();
    play(element, [{ opacity: 0 }, { opacity: 1 }], DURATION.dialog);
  }, []);

  // The modal dialog leaves the top layer before focus returns to the page behind it.
  const dismiss = () => {
    dialog.current?.close();
    onClose();
  };

  useEffect(() => {
    const element = dialog.current;
    const cancel = (event: Event) => {
      event.preventDefault();
      element?.close();
      onClose();
    };
    element?.addEventListener("cancel", cancel);
    return () => element?.removeEventListener("cancel", cancel);
  }, [onClose]);

  const confirmCancellation = async () => {
    setPending(true);
    setMessage("Cancelling…");
    const result = await api<{ request: ApiRequest; invoice: Invoice | null }>(
      "POST",
      `/api/requests/${request.id}/cancel`,
      { expected_fee: quote.fee },
      { "Idempotency-Key": idempotencyKey() },
    );
    setPending(false);
    if (result.ok) {
      dialog.current?.close();
      onCancelled(result.data.request, quote.fee);
      return;
    }
    if (result.error?.code === "fee_changed" && result.error.quote) {
      setQuote(result.error.quote);
      setChanged(true);
      setMessage("");
      return;
    }
    setMessage(result.error?.message ?? OFFLINE_COPY);
  };

  return (
    <dialog ref={dialog} className="dialog" aria-labelledby="cancel-heading">
      <h2 id="cancel-heading">Cancel booking</h2>
      <p className="dialog-reference num">{request.reference}</p>
      {changed && (
        <p className="dialog-alert">
          The fee is now ${quote.fee} because the free-cancellation window has closed. Review it and confirm again.
        </p>
      )}
      <p className={`dialog-quote${quote.kind === "late" ? " dialog-quote--late" : ""}`}>{quoteCopy(quote)}</p>
      <p className="quiet">Cancelling frees every seat and emails the confirmed interpreters. You'll get a receipt by email.</p>
      {message && <p className="live">{message}</p>}
      <div className="button-row button-row--end">
        <button ref={keep} type="button" className="button" onClick={dismiss}>
          Keep booking
        </button>
        <button type="button" className="button button--primary" disabled={pending} onClick={() => void confirmCancellation()}>
          Confirm cancellation
        </button>
      </div>
    </dialog>
  );
}
