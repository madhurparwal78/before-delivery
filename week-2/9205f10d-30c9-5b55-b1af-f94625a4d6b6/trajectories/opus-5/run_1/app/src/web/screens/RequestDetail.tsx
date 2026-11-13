import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Quote, RequestView } from '../../shared/types.js';
import { api, newIdempotencyKey, RequestFailed, UNREACHABLE_COPY } from '../api.js';
import { usePolled, useReducedMotion } from '../hooks.js';
import { takeFlash, useNavigation } from '../router.jsx';
import { cutoffText, isCancelled } from '../format.js';
import { Braid, RotationTable, readoutText } from '../components/Braid.jsx';
import { JobFacts, SeatsList } from '../components/JobFacts.jsx';
import { StatusCell } from '../components/StatusCell.jsx';
import { NotFound } from './NotFound.jsx';

const CANCELLABLE: readonly string[] = ['draft', 'submitted', 'half-staffed', 'staffed'];

export function RequestDetail({ requestId }: { requestId: string }): ReactNode {
  const { navigate } = useNavigation();
  const reducedMotion = useReducedMotion();
  const resource = usePolled(() => api.request(requestId), ['request', requestId]);
  const [minute, setMinute] = useState(0);
  const [message, setMessage] = useState(takeFlash);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [dialogCopy, setDialogCopy] = useState('');
  const [pending, setPending] = useState(false);
  const cancelButton = useRef<HTMLButtonElement | null>(null);
  const keepButton = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (quote !== null) keepButton.current?.focus();
  }, [quote]);

  if (resource.data === null) {
    return resource.error?.code === 'not_found' ? <NotFound /> : <main className="page" />;
  }
  const request = resource.data;

  const closeDialog = (): void => {
    setQuote(null);
    setDialogCopy('');
    cancelButton.current?.focus();
  };

  const openDialog = async (): Promise<void> => {
    setPending(true);
    try {
      const fetched = await api.cancellationQuote(request.id);
      setQuote(fetched);
      setDialogCopy(quoteCopy(fetched));
    } catch (failure) {
      if (failure instanceof RequestFailed) {
        setMessage(failure.code === 'unreachable' ? UNREACHABLE_COPY : failure.message);
      }
    } finally {
      setPending(false);
    }
  };

  const confirmCancellation = async (): Promise<void> => {
    if (quote === null) return;
    setPending(true);
    try {
      const result = await api.cancel(request.id, quote.fee, newIdempotencyKey());
      setMessage(
        `${result.request.reference} cancelled. Fee: $${quote.fee}. A receipt is on its way by email.`,
      );
      setQuote(null);
      setDialogCopy('');
      resource.refresh();
    } catch (failure) {
      if (failure instanceof RequestFailed) {
        if (failure.code === 'fee_changed' && failure.quote !== null) {
          setQuote(failure.quote);
          setDialogCopy(
            `The fee is now $${failure.quote.fee} because the free-cancellation window has closed. Review it and confirm again.`,
          );
        } else if (failure.code === 'unreachable') setMessage(UNREACHABLE_COPY);
        else {
          setMessage(failure.message);
          setQuote(null);
        }
      }
      resource.refresh();
    } finally {
      setPending(false);
    }
  };

  const submit = async (): Promise<void> => {
    setPending(true);
    try {
      await api.submitRequest(request.id);
      setMessage('Request submitted. Seats are open for interpreters.');
      resource.refresh();
    } catch (failure) {
      if (failure instanceof RequestFailed) {
        setMessage(failure.code === 'unreachable' ? UNREACHABLE_COPY : failure.message);
      }
      resource.refresh();
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="page">
      <h1 className={isCancelled(request.status) ? 'struck' : undefined}>{request.reference}</h1>
      <p>
        <StatusCell request={request} />
      </p>
      <JobFacts request={request} />
      <FreeCancellationLine request={request} />
      <SeatsList request={request} />
      <h4>Rotation</h4>
      {request.seats.length > 0 ? (
        <>
          <Braid
            request={request}
            reducedMotion={reducedMotion}
            minute={minute}
            onMinuteChange={setMinute}
          />
          <p className="readout" role="status" aria-label="Rotation readout">
            {readoutText(request, minute)}
          </p>
        </>
      ) : null}
      <RotationTable request={request} />
      <div className="button-row" style={{ marginTop: 16 }}>
        {request.status === 'draft' ? (
          <>
            <button
              type="button"
              className="quiet"
              onClick={() => navigate(`/requests/${request.id}/edit`)}
            >
              Edit draft
            </button>
            <button type="button" disabled={pending} onClick={() => void submit()}>
              Submit request
            </button>
          </>
        ) : null}
        {CANCELLABLE.includes(request.status) ? (
          <button
            type="button"
            className="quiet"
            ref={cancelButton}
            disabled={pending}
            onClick={() => void openDialog()}
          >
            Cancel booking
          </button>
        ) : null}
      </div>
      <p className="live" role="status" aria-label="Request status">
        {message}
      </p>
      {quote !== null ? (
        <CancelDialog
          copy={dialogCopy}
          pending={pending}
          keepRef={keepButton}
          onConfirm={() => void confirmCancellation()}
          onKeep={closeDialog}
        />
      ) : null}
    </main>
  );
}

function FreeCancellationLine({ request }: { request: RequestView }): ReactNode {
  if (request.free_cancel_until === undefined) return null;
  const passed = new Date(request.free_cancel_until).getTime() <= Date.now();
  const text = cutoffText(request.free_cancel_until);
  return (
    <p className={passed ? 'outage' : undefined}>
      {passed ? `Free cancellation ended ${text}` : `Free cancellation until ${text}`}
    </p>
  );
}

function quoteCopy(quote: Quote): string {
  if (quote.kind === 'early') {
    return `Free cancellation until ${cutoffText(quote.free_cancel_until)}. Cancelling now costs $0.00.`;
  }
  return `Late cancellation: $${quote.fee} (${quote.billable_minutes} minutes × ${quote.seats_charged} confirmed seats at $${quote.hourly_rate} per hour).`;
}

function CancelDialog({
  copy,
  pending,
  keepRef,
  onConfirm,
  onKeep,
}: {
  copy: string;
  pending: boolean;
  keepRef: React.RefObject<HTMLButtonElement | null>;
  onConfirm: () => void;
  onKeep: () => void;
}): ReactNode {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onKeep();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onKeep]);

  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Cancel booking">
        <h3>Cancel booking</h3>
        <p>{copy}</p>
        <div className="dialog-actions">
          <button type="button" disabled={pending} onClick={onConfirm}>
            Confirm cancellation
          </button>
          <button type="button" className="quiet" ref={keepRef} onClick={onKeep}>
            Keep booking
          </button>
        </div>
      </div>
    </div>
  );
}
