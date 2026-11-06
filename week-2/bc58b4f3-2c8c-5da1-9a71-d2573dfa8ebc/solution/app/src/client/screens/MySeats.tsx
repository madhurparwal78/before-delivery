import { useCallback, useMemo, useState } from "react";
import { NetworkError, api } from "../api";
import { EmptyNote, LoadingRows } from "../components/EmptyNote";
import { VerifiedMark } from "../components/Icons";
import { SeatLane } from "../components/SeatLane";
import { Status, type StatusMessage, quiet } from "../components/Status";
import { STATUS_LABELS, languageName, settingName } from "../labels";
import { usePolling } from "../poll";
import { laneLabel, laneSnapshot, useHatchSeam } from "../seam";
import { formatRange } from "../../shared/time";
import type { Assignment, User } from "../types";

const GIVE_BACK_STATUSES = new Set(["partially_covered", "covered"]);


function VerifyForm({ number, seat, onStored }: { number: string; seat: number; onStored: () => void }) {
  const [minutes, setMinutes] = useState("");
  const [miles, setMiles] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<StatusMessage>(quiet);
  const [busy, setBusy] = useState(false);
  const base = `verify-${number}-${seat}`;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setErrors({});
    setMessage({ tone: "neutral", text: "Uploading…" });
    const form = new FormData();
    form.set("actual_minutes", minutes);
    form.set("round_trip_miles", miles);
    if (file) form.set("form", file, file.name);
    try {
      const result = await api<Assignment>("POST", `/api/assignments/${number}/seats/${seat}/verification`, { form });
      if (result.ok) {
        setMessage({ tone: "success", text: `Verification for seat ${seat} received.` });
        onStored();
      } else if (result.error.code === "payload_too_large") {
        setMessage({ tone: "error", text: "The file is larger than 5,000,000 bytes." });
      } else if (result.error.code === "storage_unavailable") {
        setMessage({ tone: "error", text: "File storage is unavailable. Your form was not saved. Try again shortly." });
      } else if (result.error.code === "validation") {
        setErrors(result.error.fields);
        const others = Object.entries(result.error.fields).filter(([field]) => field !== "form").map(([, text]) => text);
        setMessage({
          tone: "error",
          text: result.error.fields.form && others.length === 0 ? "Upload a PDF, JPEG or PNG file." : `Check the highlighted fields. ${Object.values(result.error.fields).join(" ")}`,
        });
      } else {
        setMessage({ tone: "error", text: result.error.message });
      }
    } catch (error) {
      if (!(error instanceof NetworkError)) throw error;
      setMessage({ tone: "error", text: "Couldn't reach Teamseat. Try again." });
    }
    setBusy(false);
  };

  return (
    <form className="form verify-form" aria-label={`Verify seat ${seat} on ${number}`} noValidate onSubmit={(event) => void submit(event)}>
      <div className="form-row">
        <div className={`field ${errors.actual_minutes ? "field-invalid" : ""}`}>
          <label htmlFor={`${base}-minutes`}>Actual minutes</label>
          <input
            id={`${base}-minutes`}
            type="number"
            min={1}
            max={960}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            aria-describedby={errors.actual_minutes ? `${base}-minutes-error` : undefined}
          />
          {errors.actual_minutes ? <span className="field-error" id={`${base}-minutes-error`}>{errors.actual_minutes}</span> : null}
        </div>
        <div className={`field ${errors.round_trip_miles ? "field-invalid" : ""}`}>
          <label htmlFor={`${base}-miles`}>Round-trip miles</label>
          <input
            id={`${base}-miles`}
            type="number"
            min={0}
            max={1000}
            value={miles}
            onChange={(e) => setMiles(e.target.value)}
            aria-describedby={errors.round_trip_miles ? `${base}-miles-error` : undefined}
          />
          {errors.round_trip_miles ? <span className="field-error" id={`${base}-miles-error`}>{errors.round_trip_miles}</span> : null}
        </div>
      </div>
      <div className={`field ${errors.form ? "field-invalid" : ""}`}>
        <label htmlFor={`${base}-file`}>Signed verification form</label>
        <span className="field-hint" id={`${base}-file-hint`}>
          PDF, JPEG or PNG, up to 5,000,000 bytes. Choosing a file does not upload it.
        </span>
        <input
          id={`${base}-file`}
          type="file"
          accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          aria-describedby={`${base}-file-hint${errors.form ? ` ${base}-file-error` : ""}`}
        />
        {errors.form ? <span className="field-error" id={`${base}-file-error`}>{errors.form}</span> : null}
      </div>
      <button type="submit" className="button button-primary" disabled={busy}>
        Submit verification
      </button>
      <Status name="Upload status" message={message} />
    </form>
  );
}

async function openSignedForm(number: string, seat: number): Promise<void> {
  const result = await api<{ url: string }>("GET", `/api/assignments/${number}/seats/${seat}/verification-link`);
  if (result.ok) window.open(result.data.url, "_blank", "noopener");
}

export function MySeats({ user }: { user: User }) {
  const [assignments, setAssignments] = useState<Assignment[] | null>(null);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [verified, setVerified] = useState<Map<string, StatusMessage>>(new Map());
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<StatusMessage>(quiet);

  const load = useCallback(async () => {
    const result = await api<{ assignments: Assignment[] }>("GET", "/api/my-seats");
    if (result.ok) setAssignments(result.data.assignments);
  }, []);
  usePolling(load, [load]);

  const snapshot = useMemo(() => (assignments ? laneSnapshot(assignments) : null), [assignments]);
  const seam = useHatchSeam(snapshot, "mine");

  const giveBack = async (number: string, seat: number) => {
    setBusy(`${number}#${seat}`);
    setMessage({ tone: "neutral", text: "Giving back…" });
    try {
      const result = await api("POST", `/api/assignments/${number}/seats/${seat}/give-back`, { json: {} });
      setMessage(
        result.ok
          ? { tone: "success", text: `Seat ${seat} on ${number} given back.` }
          : { tone: "error", text: "This seat can no longer be given back." },
      );
      await load();
    } catch (error) {
      if (!(error instanceof NetworkError)) throw error;
      setMessage({ tone: "error", text: "Couldn't reach Teamseat. Try again." });
    }
    setBusy(null);
  };

  // The holder view names seats by initials only; the caller's own seats carry the caller's initials.
  const mine = (a: Assignment) => a.seats.filter((s) => s.status !== "open" && s.interpreter_initials === user.initials);

  return (
    <section className="panel my-seats" aria-labelledby="mine-heading">
      <div className="list-head">
        <h2 id="mine-heading">My seats</h2>
        <p className="muted">Confirmed appointments with their full details. Verify each seat after the job.</p>
      </div>
      <Status name="Claim status" message={message} />
      <ul className="cards cards-wide" aria-label="My seats">
        {(assignments ?? []).map((a) => (
          <li key={a.number} className={`card ${a.status === "cancelled" ? "card-cancelled" : ""}`}>
            <div className="card-head">
              <h3>
                {languageName(a.language)} <span className="num muted">{a.number}</span>
              </h3>
              <span className={`status-word status-word-${a.status}`}>{STATUS_LABELS[a.status]}</span>
            </div>
            <dl className="card-facts">
              <div>
                <dt>Time</dt>
                <dd className="num">{formatRange(a.start_at, a.end_at)}</dd>
              </div>
              <div>
                <dt>Setting</dt>
                <dd>{settingName(a.setting)}</dd>
              </div>
              <div>
                <dt>Address</dt>
                <dd>
                  {a.street_address}, {a.city}
                </dd>
              </div>
              <div>
                <dt>Patient initials</dt>
                <dd>{a.patient_initials}</dd>
              </div>
              <div>
                <dt>Medical notes</dt>
                <dd>{a.medical_notes ? a.medical_notes : <span className="muted">None</span>}</dd>
              </div>
              <div>
                <dt>Scheduler</dt>
                <dd>
                  {a.scheduler?.name}
                  {a.scheduler?.phone ? <span className="num">, {a.scheduler.phone}</span> : null}
                </dd>
              </div>
            </dl>
            <div className="card-seats">
              {a.seats.map((seat) => {
                const key = `${a.number}#${seat.seat}`;
                const actual = { held: seat.status !== "open", label: laneLabel(seat) };
                return <SeatLane key={key} seat={seat.seat} shown={seam.lane(key, actual)} fillRef={seam.fillRef(key)} />;
              })}
            </div>
            {mine(a).map((seat) => {
              const key = `${a.number}#${seat.seat}`;
              if (seat.status === "served") {
                return (
                  <div key={key} className="verified">
                    <VerifiedMark />
                    <span>Seat {seat.seat} verified</span>
                    <a
                      href={`#signed-${key}`}
                      className="link"
                      onClick={(event) => {
                        event.preventDefault();
                        void openSignedForm(a.number, seat.seat);
                      }}
                    >
                      View signed form
                    </a>
                  </div>
                );
              }
              if (a.status === "cancelled") return null;
              return (
                <div key={key} className="seat-actions">
                  {GIVE_BACK_STATUSES.has(a.status) ? (
                    <button
                      type="button"
                      className="button"
                      aria-label={`Give back seat ${seat.seat} on ${a.number}`}
                      disabled={busy === key}
                      onClick={() => void giveBack(a.number, seat.seat)}
                    >
                      Give back
                    </button>
                  ) : null}
                  <a
                    href={`#verify-${key}`}
                    className="button button-link"
                    aria-label={`Verify seat ${seat.seat} on ${a.number}`}
                    aria-expanded={verifying === key}
                    onClick={(event) => {
                      event.preventDefault();
                      setVerifying((current) => (current === key ? null : key));
                    }}
                  >
                    Verify
                  </a>
                </div>
              );
            })}
            {mine(a).map((seat) => {
              const key = `${a.number}#${seat.seat}`;
              return verifying === key && seat.status === "held" ? (
                <VerifyForm
                  key={`form-${key}`}
                  number={a.number}
                  seat={seat.seat}
                  onStored={() => {
                    setVerified((current) => new Map(current).set(a.number, { tone: "success", text: `Verification for seat ${seat.seat} received.` }));
                    setVerifying(null);
                    void load();
                  }}
                />
              ) : null;
            })}
            <Status name="Upload status" message={verifying?.startsWith(`${a.number}#`) ? quiet : (verified.get(a.number) ?? quiet)} />
          </li>
        ))}
      </ul>
      {assignments === null ? <LoadingRows /> : null}
      {assignments?.length === 0 ? <EmptyNote>No seats yet. Claim one from Open seats and it appears here with its full details.</EmptyNote> : null}
    </section>
  );
}
