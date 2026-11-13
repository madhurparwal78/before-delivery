import { type ReactNode, useState } from "react";
import { OFFLINE_COPY, api } from "./api";
import { SETTING_LABEL, clockOf, dateLine, monthDayOfInstant, seatWho, windowParts } from "./format";
import type { ApiRequest, Seat, SeatLabel } from "./types";

/** Date, time window, setting, credential, city, and the consumer's details when the viewer may see them. */
export function Facts({ request }: { request: ApiRequest }) {
  const window = windowParts(request);
  const rows: [string, ReactNode][] = [
    ["Date", dateLine(request.starts_at)],
    [
      "Time",
      <>
        <span className="keep">{window.start}</span> <span className="keep">to {window.end}</span>
      </>,
    ],
    ["Setting", SETTING_LABEL[request.setting]],
    ["Credential", request.required_credential],
    ["City", request.city],
  ];
  if (request.organisation) rows.push(["Organisation", request.organisation.name]);
  if (request.consumer_name !== undefined) rows.push(["Consumer", request.consumer_name]);
  if (request.location_address !== undefined) rows.push(["Address", request.location_address]);
  if (request.notes !== undefined) rows.push(["Notes", request.notes || "None"]);
  return (
    <dl className="facts">
      {rows.map(([term, value]) => (
        <div key={term} className="fact">
          <dt>{term}</dt>
          <dd className={term === "Time" ? "num" : undefined}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SeatsList({ request }: { request: ApiRequest }) {
  return (
    <ul className="seats" aria-label="Seats">
      {request.seats.map((seat) => {
        const who = seatWho(seat);
        return (
          <li key={seat.id} aria-label={`Seat ${seat.label}: ${who}`} className={`seat seat--${seat.status}`}>
            <span className={`seat-cell seat-cell--${seat.status}`} aria-hidden="true" />
            <span className="seat-label">Seat {seat.label}</span>
            <span className="seat-who">{who}</span>
            {seat.interpreter && seat.interpreter.credentials.length > 0 && (
              <span className="badges">
                {seat.interpreter.credentials.map((code) => (
                  <span key={code} className="badge">
                    {code}
                  </span>
                ))}
              </span>
            )}
            {seat.interpreter?.phone && <span className="seat-phone num">{seat.interpreter.phone}</span>}
          </li>
        );
      })}
    </ul>
  );
}

/** Shows a seat as taken (confirmed by someone else) before the server's next read says so. */
export function markTaken(request: ApiRequest, labels: SeatLabel[]): ApiRequest {
  if (labels.length === 0) return request;
  const seats = request.seats.map(
    (seat): Seat => (labels.includes(seat.label) && seat.status === "open" ? { ...seat, status: "confirmed", interpreter: null } : seat),
  );
  return { ...request, seats };
}

const CLAIMABLE = ["submitted", "half-staffed"];

export function ClaimControls({
  request,
  onClaimed,
  onTaken,
  refresh,
}: {
  request: ApiRequest;
  onClaimed: (request: ApiRequest) => void;
  onTaken: (label: SeatLabel) => void;
  refresh: () => void;
}) {
  const [pending, setPending] = useState<SeatLabel | null>(null);
  const [message, setMessage] = useState("");
  const open = CLAIMABLE.includes(request.status) ? request.seats.filter((s) => s.status === "open") : [];

  const claim = async (seat: Seat) => {
    setPending(seat.label);
    setMessage(`Claiming seat ${seat.label}…`);
    const result = await api<{ request: ApiRequest }>("POST", `/api/seats/${seat.id}/claim`, {});
    setPending(null);
    if (result.ok) {
      onClaimed(result.data.request);
      setMessage(`Seat ${seat.label} confirmed. Consumer details are now shown below.`);
      return;
    }
    if (!result.error) {
      setMessage(OFFLINE_COPY);
      return;
    }
    switch (result.error.code) {
      case "seat_taken":
        onTaken(seat.label);
        setMessage(`Seat taken: another interpreter confirmed seat ${seat.label} first.`);
        break;
      case "credential_invalid":
        setMessage(`Your ${request.required_credential} credential isn't verified through this job's date.`);
        break;
      case "schedule_conflict":
        setMessage("You already hold a seat that overlaps this job.");
        break;
      case "invalid_transition":
      case "not_found":
        setMessage("This job is no longer taking claims.");
        break;
      default:
        setMessage(result.error.message);
    }
    refresh();
  };

  return (
    <section className="pane-section" aria-labelledby="claim-heading">
      <h3 id="claim-heading">Claim</h3>
      {open.length > 0 ? (
        <div className="button-row">
          {open.map((seat) => (
            <button key={seat.id} type="button" className="button button--primary" disabled={pending !== null} onClick={() => void claim(seat)}>
              Claim seat {seat.label}
            </button>
          ))}
        </div>
      ) : (
        <p className="quiet">No seat on this job is open to claim.</p>
      )}
      <p className="live" role="status" aria-label="Claim status">
        {message}
      </p>
    </section>
  );
}

export function HistoryList({ request }: { request: ApiRequest }) {
  return (
    <section className="pane-section" aria-labelledby="history-heading">
      <h3 id="history-heading">History</h3>
      <ol className="history" aria-label="History">
        {[...(request.history ?? [])].reverse().map((entry, i) => (
          <li key={`${entry.at}-${i}`}>
            <span className="num">
              {clockOf(entry.at)} {monthDayOfInstant(entry.at)}
            </span>
            {` · ${entry.actor} · ${entry.action}${entry.detail ? ` · ${entry.detail}` : ""}`}
          </li>
        ))}
      </ol>
    </section>
  );
}
