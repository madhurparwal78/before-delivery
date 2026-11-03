import { ReactElement, useEffect, useRef, useState } from 'react';
import { ApiCallError, api } from '../api';
import { Dialog } from '../components/Dialog';
import { LiveRegion } from '../components/LiveRegion';
import { cardDate, clock, dateAndClock } from '../format';
import { Quote, RequestObject, SETTING_LABELS, SessionUser } from '../types';

const CANCELLABLE = ['draft', 'submitted', 'partially_staffed', 'staffed'];

function quoteCopy(quote: Quote): string {
  return quote.late
    ? `Late cancellation. $${quote.fee} will be charged for ${quote.seated} seated interpreter(s).`
    : 'On-time cancellation. No charge.';
}

export function RequestDetail({
  requestId,
  user,
}: {
  requestId: string;
  user: SessionUser;
}): ReactElement {
  const [request, setRequest] = useState<RequestObject | null>(null);
  const [message, setMessage] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [cancelMessage, setCancelMessage] = useState('');
  const [pending, setPending] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const cancelKey = useRef<string>('');
  const cancelButton = useRef<HTMLButtonElement>(null);

  const load = async (): Promise<void> => {
    try {
      const payload = await api.request(requestId);
      setRequest(payload.request);
    } catch {
      setMessage('That request could not be loaded.');
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId]);

  const upload = async (file: File): Promise<void> => {
    setMessage(`Uploading ${file.name}…`);
    try {
      await api.uploadPrep(requestId, file);
      setMessage(`${file.name} attached.`);
      await load();
    } catch (error) {
      const code = error instanceof ApiCallError ? error.failure.code : 'internal';
      if (code === 'payload_too_large') setMessage(`${file.name} is too large.`);
      else if (code === 'unsupported_media_type') {
        setMessage(`${file.name} is not a supported file type.`);
      } else if (code === 'storage_unavailable') {
        setMessage('File storage is unreachable. Nothing was uploaded.');
      } else setMessage(`${file.name} could not be attached.`);
    }
  };

  const submit = async (): Promise<void> => {
    setMessage('Submitting…');
    try {
      const payload = await api.submitRequest(requestId);
      setRequest(payload.request);
      setMessage(`${payload.request.ref} submitted to dispatch.`);
    } catch (error) {
      const failure = error instanceof ApiCallError ? error.failure : null;
      if (failure?.code === 'invalid_transition') {
        setMessage('This request can no longer be submitted.');
      } else if (failure?.code === 'validation') {
        setMessage('Check the highlighted fields.');
      } else setMessage('This request can no longer be submitted.');
      await load();
    }
  };

  const openCancel = async (): Promise<void> => {
    setCancelOpen(true);
    setQuote(null);
    cancelKey.current = crypto.randomUUID();
    setCancelMessage('Working out the charge…');
    try {
      const payload = await api.cancellationQuote(requestId);
      setQuote(payload.quote);
      setCancelMessage(quoteCopy(payload.quote));
    } catch (error) {
      const failure = error instanceof ApiCallError ? error.failure : null;
      setCancelMessage(
        failure?.code === 'already_started'
          ? 'This assignment has started and can no longer be cancelled.'
          : 'The charge could not be worked out.',
      );
    }
  };

  const confirmCancel = async (): Promise<void> => {
    if (!quote || !request) return;
    setPending(true);
    setCancelMessage(`Cancelling ${request.ref}…`);
    try {
      const payload = await api.cancelRequest(requestId, quote.fee, cancelKey.current);
      setRequest(payload.request);
      setCancelMessage(`${payload.request.ref} cancelled. Charge: $${payload.quote.fee}.`);
      setMessage(`${payload.request.ref} cancelled. Charge: $${payload.quote.fee}.`);
      setCancelOpen(false);
      cancelButton.current?.focus();
    } catch (error) {
      const failure = error instanceof ApiCallError ? error.failure : null;
      if (failure?.code === 'fee_changed' && failure.quote) {
        setQuote(failure.quote);
        setCancelMessage(`The charge is now $${failure.quote.fee}. Review it and confirm again.`);
      } else if (failure?.code === 'billing_unavailable') {
        setCancelMessage(
          'Billing is unreachable. The request is not cancelled. Try again in a few minutes.',
        );
      } else if (failure?.code === 'already_started') {
        setCancelMessage('This assignment has started and can no longer be cancelled.');
      } else {
        setCancelMessage('That cancellation did not go through.');
      }
    } finally {
      setPending(false);
    }
  };

  if (!request) {
    return (
      <main className="column">
        <h1>Request</h1>
        <LiveRegion label="Request status" message={message} />
      </main>
    );
  }

  const canCancel =
    CANCELLABLE.includes(request.status) &&
    (user.role === 'requester' || user.role === 'coordinator');

  return (
    <main className="column">
      <h1>
        <span className="ref">{request.ref}</span> {request.title}
      </h1>
      <dl>
        <div className="pair">
          <dt>Status</dt>
          <dd>{request.status}</dd>
        </div>
        <div className="pair">
          <dt>Setting</dt>
          <dd>{SETTING_LABELS[request.setting]}</dd>
        </div>
        <div className="pair">
          <dt>Organisation</dt>
          <dd>{request.org_name}</dd>
        </div>
        <div className="pair">
          <dt>When</dt>
          <dd className="mono">
            {cardDate(request.start)} {clock(request.start)}–{clock(request.end)}
          </dd>
        </div>
        <div className="pair">
          <dt>Location</dt>
          <dd>{request.location}</dd>
        </div>
        <div className="pair">
          <dt>Deaf consumer</dt>
          <dd>{request.consumer.name}</dd>
        </div>
        <div className="pair">
          <dt>Seats</dt>
          <dd className="counter">
            {request.seats_accepted}/{request.seats_total}
          </dd>
        </div>
        <div className="pair">
          <dt>Notes</dt>
          <dd>{request.notes || 'None'}</dd>
        </div>
        {request.cancellation_fee ? (
          <div className="pair">
            <dt>Cancellation charge</dt>
            <dd className="amount">${request.cancellation_fee}</dd>
          </div>
        ) : null}
      </dl>

      <p>
        Cancellation window: {request.duration_hours} h assignment,{' '}
        {Number(request.duration_hours) <= 2 ? '48' : '72'} hours before start.{' '}
        {request.in_cancellation_window ? 'In cancellation window' : 'Not in the window yet.'}
      </p>

      <div className="detail-section">
        <h2>Seats</h2>
        <ul className="plain" aria-label="Seats">
          {request.seats.map((seat) => (
            <li key={seat.id}>
              Seat {seat.position}: {seat.status}
              {seat.interpreter ? ` — ${seat.interpreter.name}` : ''}
              {seat.held_by ? `, held by ${seat.held_by.name}` : ''}
              {seat.offer ? (
                <span className="mono"> expires {dateAndClock(seat.offer.expires_at)}</span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>

      <div className="detail-section">
        <h2>Prep materials</h2>
        <ul className="plain" aria-label="Prep materials">
          {request.prep_files.map((file) => (
            <li key={file.id}>
              <a href={`/api/prep/${file.id}`}>{file.filename}</a>
            </li>
          ))}
        </ul>
        {user.role === 'requester' ? (
          <>
            <button type="button" onClick={() => fileInput.current?.click()}>
              Add prep file
            </button>
            <input
              ref={fileInput}
              type="file"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
                event.target.value = '';
              }}
            />
          </>
        ) : null}
      </div>

      <div className="row-actions">
        {request.status === 'draft' && user.role === 'requester' ? (
          <button type="button" onClick={() => void submit()}>
            Submit request
          </button>
        ) : null}
        {canCancel ? (
          <button type="button" ref={cancelButton} onClick={() => void openCancel()}>
            Cancel request
          </button>
        ) : null}
      </div>

      <LiveRegion label="Request status" message={message} />
      <LiveRegion label="Cancellation status" message={cancelMessage} />

      {cancelOpen ? (
        <Dialog
          label="Cancel request"
          onClose={() => {
            setCancelOpen(false);
            cancelButton.current?.focus();
          }}
        >
          <h2>Cancel request</h2>
          <p>{cancelMessage}</p>
          <div className="row-actions">
            <button type="button" disabled={!quote || pending} onClick={() => void confirmCancel()}>
              Confirm cancellation
            </button>
            <button
              type="button"
              className="quiet"
              onClick={() => {
                setCancelOpen(false);
                cancelButton.current?.focus();
              }}
            >
              Keep request
            </button>
          </div>
        </Dialog>
      ) : null}
    </main>
  );
}
