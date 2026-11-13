import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Booking, Quote } from '../../shared/api.js';
import { jsonRequest, noteActionFinished, sendAction, sendRefetch } from '../api.js';
import { errorCopy, NETWORK_FAILURE, PENDING, QUOTE_COPY, SUCCESS } from '../copy.js';
import { cutoffText } from '../format.js';
import { useLive } from '../live.js';
import { Dialog } from '../components/Dialog.js';

function quoteCopy(quote: Quote): string {
  if (!quote.late) return QUOTE_COPY.onTime(cutoffText(quote.cutoff));
  if (quote.interpreter_count === 0) return QUOTE_COPY.lateNoSeat;
  return QUOTE_COPY.lateWithCharge(quote.charge_cents);
}

export interface CancelDialogProps {
  booking: Booking;
  onClose: () => void;
  onCancelled: (booking: Booking, chargeCents: number) => void;
  onBecameFinal: () => void;
}

export function CancelDialog({
  booking,
  onClose,
  onCancelled,
  onBecameFinal,
}: CancelDialogProps): ReactNode {
  const live = useLive();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [changed, setChanged] = useState(false);
  const [pending, setPending] = useState(false);
  const keepButton = useRef<HTMLButtonElement | null>(null);
  const quoteStatus = useRef<HTMLSpanElement | null>(null);
  const opening = useRef(0);

  useEffect(() => {
    const generation = opening.current + 1;
    opening.current = generation;
    void sendRefetch<Quote>(`/api/bookings/${booking.id}/cancellation-quote`).then((outcome) => {
      if (generation !== opening.current) return;
      if (outcome.kind === 'ok') setQuote(outcome.data);
    });
  }, [booking.id]);

  const confirm = async (): Promise<void> => {
    if (quote === null) return;
    live.startAction();
    live.announceStatus(PENDING.cancel);
    setPending(true);
    const outcome = await sendAction<Booking>(
      jsonRequest('POST', `/api/bookings/${booking.id}/cancel`, {
        quoted_charge_cents: quote.charge_cents,
      }),
    );
    noteActionFinished();
    setPending(false);

    if (outcome.kind === 'ok') {
      live.announceStatus(SUCCESS.cancel(outcome.data.ref, quote.charge_cents));
      onCancelled(outcome.data, quote.charge_cents);
      return;
    }
    if (outcome.kind === 'network') {
      live.announceError(NETWORK_FAILURE);
      return;
    }
    if (outcome.kind !== 'error') return;
    live.announceError(
      errorCopy({
        action: 'cancel',
        code: outcome.body.error,
        status: outcome.body.status,
      }),
    );
    if (outcome.body.error === 'quote_changed' && outcome.body.quote !== undefined) {
      setQuote(outcome.body.quote);
      setChanged(true);
      quoteStatus.current?.focus();
      return;
    }
    if (outcome.body.error === 'invalid_transition') onBecameFinal();
  };

  const confirmLabel = pending
    ? PENDING.cancel
    : quote === null
      ? PENDING.quote
      : changed
        ? 'Confirm new charge'
        : 'Confirm cancellation';

  return (
    <Dialog
      title="Cancel booking"
      onEscape={pending ? null : onClose}
      focusOnOpen={() => keepButton.current}
    >
      <span
        className="quote-status"
        role="status"
        aria-label="Cancellation quote"
        tabIndex={0}
        ref={quoteStatus}
      >
        {quote === null ? PENDING.quote : quoteCopy(quote)}
      </span>
      <div className="dialog-buttons">
        <button type="button" ref={keepButton} onClick={onClose}>
          Keep booking
        </button>
        <button
          type="button"
          disabled={quote === null || pending}
          onClick={() => void confirm()}
        >
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
