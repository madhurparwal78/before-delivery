import { useLayoutEffect, useRef, useState } from "react";
import { STATUS_LABEL } from "./format";
import { DURATION, play } from "./motion";
import type { ApiRequest, RequestStatus } from "./types";

/** One cell per seat: solid when confirmed, hatched when open; then "<confirmed>/<team size>". */
export function SeatCounter({ request }: { request: ApiRequest }) {
  const seats = [...request.seats].sort((a, b) => a.label.localeCompare(b.label));
  const confirmed = seats.filter((s) => s.status === "confirmed").length;
  return (
    <span className="seat-counter">
      <span className="seat-cells" aria-hidden="true">
        {seats.map((seat) => (
          <span key={seat.id} className={`seat-cell seat-cell--${seat.status}`} />
        ))}
      </span>
      <span className="num">{`${confirmed}/${request.team_size ?? seats.length}`}</span>
    </span>
  );
}

const tone = (status: RequestStatus): string =>
  status === "cancelled_late" ? "alert" : status === "submitted" || status === "half-staffed" ? "open" : "settled";

function Mark({ request }: { request: ApiRequest }) {
  return (
    <>
      <span className={`status-label status-label--${tone(request.status)}`}>{STATUS_LABEL[request.status]}</span>
      {request.seats.length > 0 && <SeatCounter request={request} />}
    </>
  );
}

/**
 * The status label and seat counter. When the staffing status changes on screen, the old mark
 * fades out over the new one (about a third of a second); reduced motion swaps it instantly.
 */
export function StatusMark({ request }: { request: ApiRequest }) {
  const [previous, setPrevious] = useState<ApiRequest | null>(null);
  const last = useRef(request);
  const fadeIn = useRef<HTMLSpanElement>(null);
  const fadeOut = useRef<HTMLSpanElement>(null);
  const signature = `${request.status}:${request.seats.map((s) => s.status).join("")}`;
  const lastSignature = useRef(signature);
  useLayoutEffect(() => {
    if (lastSignature.current !== signature) {
      setPrevious(last.current);
      lastSignature.current = signature;
    }
    last.current = request;
  }, [signature, request]);
  useLayoutEffect(() => {
    if (!previous) return;
    play(fadeIn.current, [{ opacity: 0 }, { opacity: 1 }], DURATION.status);
    const out = play(fadeOut.current, [{ opacity: 1 }, { opacity: 0 }], DURATION.status);
    if (!out) setPrevious(null);
    else out.onfinish = () => setPrevious(null);
  }, [previous]);
  return (
    <span className="status-mark">
      <span ref={fadeIn} className="status-mark-current">
        <Mark request={request} />
      </span>
      {previous && (
        <span ref={fadeOut} className="status-mark-previous" aria-hidden="true">
          <Mark request={previous} />
        </span>
      )}
    </span>
  );
}
