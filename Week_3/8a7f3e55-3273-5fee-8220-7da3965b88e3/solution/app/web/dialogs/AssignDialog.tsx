import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Booking, InterpreterChoice } from "../../shared/api";
import { Modal } from "../components/Modal";
import { useAction } from "../lib/actions";
import { ApiFailure, apiGet, apiPost } from "../lib/api";
import { PENDING, SEAT_FILLED_NOTICE, SUCCESS } from "../lib/copy";
import { isCoordinatorHolder } from "../lib/holders";

const DEBOUNCE_MS = 300;

interface AssignProps {
  booking: Booking;
  seat: number;
  onAssigned: (booking: Booking) => void;
  onClose: () => void;
}

/** The Assign interpreter dialog for one named seat, with a debounced search that only ever shows its latest answer. */
export function AssignDialog({ booking, seat, onAssigned, onClose }: AssignProps) {
  const action = useAction();
  const [text, setText] = useState("");
  const [results, setResults] = useState<InterpreterChoice[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const latest = useRef(0);
  const first = useRef(true);
  const dialogRef = useRef<HTMLDivElement>(null);
  const holder = booking.seats.find((candidate) => candidate.seat === seat)?.holder ?? null;
  const onBookingHolders = booking.seats.flatMap((candidate) => (candidate.holder !== null && isCoordinatorHolder(candidate.holder) ? [candidate.holder.id] : []));

  const search = useCallback(
    async (query: string, moveFocus: boolean) => {
      latest.current += 1;
      const mine = latest.current;
      try {
        const answer = await apiGet<{ interpreters: InterpreterChoice[] }>(`/api/interpreters?booking_id=${booking.id}&q=${encodeURIComponent(query)}`);
        if (mine !== latest.current) return;
        const qualified = answer.interpreters.filter((choice) => choice.qualified === true);
        setSearchError(null);
        setResults(qualified);
        setChosen((held) => (held !== null && qualified.some((choice) => choice.id === held && choice.busy !== true) ? held : null));
      } catch (failure) {
        if (mine !== latest.current) return;
        const message = failure instanceof ApiFailure ? failure.body?.fields?.["q"] : undefined;
        setSearchError(message ?? null);
        setResults([]);
        setChosen(null);
      }
      if (moveFocus) setFocusRequest((count) => count + 1);
    },
    [booking.id],
  );

  useEffect(() => {
    void search("", true);
  }, [search]);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return undefined;
    }
    const timer = setTimeout(() => void search(text, false), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, search]);

  useLayoutEffect(() => {
    if (focusRequest === 0) return;
    const dialog = dialogRef.current?.closest<HTMLElement>('[role="dialog"]');
    const radio = dialog?.querySelector<HTMLInputElement>('input[type="radio"]:not(:disabled)');
    (radio ?? dialog?.querySelector<HTMLElement>("[data-close]"))?.focus();
  }, [focusRequest]);

  const assign = async () => {
    const pick = results?.find((choice) => choice.id === chosen);
    if (pick === undefined) return;
    const updated = await action.run({
      kind: "assign",
      pending: PENDING.assign,
      work: () => apiPost<Booking>(`/api/bookings/${booking.id}/assign`, { interpreter_id: pick.id, seat }),
      success: () => SUCCESS.assigned(pick.name, seat, booking.ref),
      onFailure: (failure) => {
        const code = failure.body?.error;
        if (code === "schedule_conflict" || code === "not_qualified") {
          setChosen(null);
          void search(text, true);
        }
      },
    });
    if (updated !== undefined) onAssigned(updated);
  };

  const trimmed = text.trim();
  return (
    <Modal
      label="Assign interpreter"
      onClose={onClose}
      initialFocus={() => null}
      fallbackFocus={() => document.querySelector<HTMLElement>("[data-detail-heading]")}
    >
      <div className="dialog-form" ref={dialogRef}>
        <h2 className="dialog-title">Assign seat {seat}</h2>
        <p className="dialog-note">
          <span className="mono">{booking.ref}</span> · {booking.title}
        </p>
        <div className="field">
          <label htmlFor="find-interpreter" className="field-label">
            Find interpreter
          </label>
          <input
            id="find-interpreter"
            type="search"
            value={text}
            autoComplete="off"
            aria-describedby={searchError ? "find-interpreter-error" : undefined}
            onChange={(event) => setText(event.target.value)}
          />
          {searchError ? (
            <p id="find-interpreter-error" className="field-error">
              {searchError}
            </p>
          ) : null}
        </div>
        <fieldset className="choices">
          <legend className="visually-hidden">Qualified interpreters</legend>
          {results?.map((choice) => {
            const unavailable = choice.busy === true || onBookingHolders.includes(choice.id);
            return (
              <label key={choice.id} className={`choice${unavailable ? " choice--disabled" : ""}`}>
                <input
                  type="radio"
                  name="interpreter"
                  value={choice.id}
                  aria-label={choice.name}
                  aria-describedby={unavailable ? `choice-${choice.id}-detail choice-${choice.id}-busy` : `choice-${choice.id}-detail`}
                  checked={chosen === choice.id}
                  disabled={unavailable}
                  onChange={() => setChosen(choice.id)}
                />
                <span className="choice-name" aria-hidden="true">
                  {choice.name}
                </span>
                <span id={`choice-${choice.id}-detail`} className="choice-codes mono">{choice.credentials.map((credential) => credential.code).join(" · ")}</span>
                {unavailable ? <span id={`choice-${choice.id}-busy`} className="choice-busy">{choice.busy === true ? "Busy at this time" : "Already on this booking"}</span> : null}
              </label>
            );
          })}
        </fieldset>
        {results !== null && results.length === 0 && !searchError ? <p className="empty-note">No interpreter matches "{trimmed}".</p> : null}
        <div role="status" aria-label="Assign status" className="assign-status">
          {holder !== null ? SEAT_FILLED_NOTICE(seat) : ""}
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn btn--primary" disabled={chosen === null || action.pending} onClick={() => void assign()}>
            {action.pending ? PENDING.assign : "Assign"}
          </button>
          <button type="button" className="btn" data-close onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}
