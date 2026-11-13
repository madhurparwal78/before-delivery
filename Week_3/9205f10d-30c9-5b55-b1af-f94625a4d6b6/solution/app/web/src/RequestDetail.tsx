import { useCallback, useEffect, useRef, useState } from "react";
import { OFFLINE_COPY, api } from "./api";
import { Braid } from "./Braid";
import { CancelDialog } from "./CancelDialog";
import { CANCELLED, cutoffText } from "./format";
import { Facts, SeatsList } from "./JobDetail";
import { REFRESH_MS, useInterval } from "./motion";
import { NotFound } from "./NotFound";
import { navigate, usePlace } from "./router";
import { StatusMark } from "./StatusMark";
import type { ApiRequest, Quote } from "./types";

const CANCELLABLE = ["draft", "submitted", "half-staffed", "staffed"];

function arrivalMessage(state: unknown): string {
  return state && typeof state === "object" && "message" in state && typeof state.message === "string" ? state.message : "";
}

/** The client scheduler's view of one request: status, seats, the braid, and its actions. */
export function RequestDetail({ id }: { id: string }) {
  const place = usePlace();
  const [request, setRequest] = useState<ApiRequest | null>(null);
  const [missing, setMissing] = useState(false);
  const [message, setMessage] = useState(() => arrivalMessage(place.state));
  const [quote, setQuote] = useState<Quote | null>(null);
  const [pending, setPending] = useState(false);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  const load = useCallback(async () => {
    const result = await api<ApiRequest>("GET", `/api/requests/${id}`);
    if (result.ok) setRequest(result.data);
    else if (result.status === 404) setMissing(true);
  }, [id]);
  useEffect(() => void load(), [load]);
  useInterval(() => void load(), REFRESH_MS);

  if (missing && !request) return <NotFound />;
  if (!request) return <p className="page quiet">Loading request…</p>;

  const submit = async () => {
    setPending(true);
    setMessage("Submitting request…");
    const result = await api<ApiRequest>("POST", `/api/requests/${request.id}/submit`, {});
    setPending(false);
    if (result.ok) {
      setRequest(result.data);
      setMessage("Request submitted. Seats are open for interpreters.");
    } else setMessage(result.error?.message ?? OFFLINE_COPY);
  };

  const openCancel = async () => {
    setPending(true);
    setMessage("Getting the cancellation fee…");
    const result = await api<Quote>("GET", `/api/requests/${request.id}/cancellation-quote`);
    setPending(false);
    if (result.ok) {
      setMessage("");
      setQuote(result.data);
    } else setMessage(result.error?.message ?? OFFLINE_COPY);
  };

  const closeDialog = () => {
    setQuote(null);
    cancelButton.current?.focus();
  };

  const cutoff = request.free_cancel_until;
  const passed = cutoff ? new Date(cutoff).getTime() <= Date.now() : false;

  return (
    <div className="page detail">
      <header className="detail-head">
        <h1 ref={heading} tabIndex={-1} className="num-heading">
          {request.reference}
        </h1>
        <StatusMark request={request} />
      </header>
      <p className="live" role="status" aria-label="Request status">
        {message}
      </p>
      <Facts request={request} />
      {cutoff && (
        <p className={`cutoff${passed ? " cutoff--passed" : ""}`}>
          {passed ? `Free cancellation ended ${cutoffText(cutoff)}` : `Free cancellation until ${cutoffText(cutoff)}`}
        </p>
      )}
      {CANCELLED.includes(request.status) && <p className="quiet">The seats were released when this request was cancelled.</p>}
      {request.seats.length > 0 && !CANCELLED.includes(request.status) && (
        <>
          <section className="detail-section" aria-labelledby="seats-heading">
            <h2 id="seats-heading">Seats</h2>
            <SeatsList request={request} />
          </section>
          <section className="detail-section" aria-labelledby="rotation-heading">
            <h2 id="rotation-heading">Rotation</h2>
            <Braid request={request} />
          </section>
        </>
      )}
      <div className="button-row detail-actions">
        {request.status === "draft" && (
          <>
            <button type="button" className="button" onClick={() => navigate(`/requests/${request.id}/edit`)}>
              Edit draft
            </button>
            <button type="button" className="button button--primary" disabled={pending} onClick={() => void submit()}>
              Submit request
            </button>
          </>
        )}
        {CANCELLABLE.includes(request.status) && (
          <button ref={cancelButton} type="button" className="button" disabled={pending} onClick={() => void openCancel()}>
            Cancel booking
          </button>
        )}
      </div>
      {quote && (
        <CancelDialog
          request={request}
          quote={quote}
          onClose={closeDialog}
          onCancelled={(updated, fee) => {
            setQuote(null);
            setRequest(updated);
            setMessage(`${updated.reference} cancelled. Fee: $${fee}. A receipt is on its way by email.`);
            heading.current?.focus();
          }}
        />
      )}
    </div>
  );
}
