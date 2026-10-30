import { useCallback, useMemo, useRef, useState } from "react";
import { NetworkError, api, newIdempotencyKey } from "../api";
import { Drawer } from "../components/Drawer";
import { EmptyNote, LoadingRows } from "../components/EmptyNote";
import { Field } from "../components/Field";
import { SeatLane } from "../components/SeatLane";
import { Status, type StatusMessage, quiet } from "../components/Status";
import { LANGUAGES, SETTINGS, STATUS_LABELS, coveredCount, languageName, settingName } from "../labels";
import { usePolling } from "../poll";
import { laneLabel, laneSnapshot, useHatchSeam } from "../seam";
import { agencyInputToIso, formatRange } from "../../shared/time";
import type { Assignment, User } from "../types";
import { AssignmentDetail } from "./AssignmentDetail";

interface RequestDraft {
  language: string;
  setting: string;
  date: string;
  time: string;
  duration: string;
  street: string;
  city: string;
  initials: string;
  notes: string;
}

const EMPTY: RequestDraft = { language: "", setting: "", date: "", time: "", duration: "", street: "", city: "", initials: "", notes: "" };

function RequestForm({ onSubmitted }: { onSubmitted: (assignment: Assignment) => void }) {
  const [draft, setDraft] = useState<RequestDraft>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<StatusMessage>(quiet);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  // One key per request until a success arrives, so a retry after a timeout returns the original.
  const key = useRef(newIdempotencyKey());

  const set = (name: keyof RequestDraft) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setDraft((current) => ({ ...current, [name]: event.target.value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage({ tone: "neutral", text: "Submitting…" });
    const duration = /^\d+$/.test(draft.duration.trim()) ? Number.parseInt(draft.duration, 10) : draft.duration;
    const body = {
      language: draft.language,
      setting: draft.setting,
      start_at: agencyInputToIso(draft.date, draft.time) ?? `${draft.date}T${draft.time}`,
      duration_minutes: duration,
      street_address: draft.street,
      city: draft.city,
      patient_initials: draft.initials,
      medical_notes: draft.notes,
    };
    try {
      const result = await api<Assignment>("POST", "/api/assignments", {
        json: body,
        headers: { "Idempotency-Key": key.current },
      });
      if (result.ok) {
        key.current = newIdempotencyKey();
        setDraft(EMPTY);
        setErrors({});
        setMessage({ tone: "success", text: `Request ${result.data.number} submitted. Awaiting release by dispatch.` });
        onSubmitted(result.data);
      } else if (result.error.code === "validation") {
        setErrors(result.error.fields);
        setMessage({ tone: "error", text: `Check the highlighted fields. ${Object.values(result.error.fields).join(" ")}` });
      } else if (result.error.code === "idempotency_conflict") {
        setMessage({ tone: "error", text: "This request was already submitted with different details. Reload to see it." });
      } else {
        setMessage({ tone: "error", text: result.error.message });
      }
    } catch (error) {
      if (!(error instanceof NetworkError)) throw error;
      setMessage({ tone: "error", text: "Couldn't reach Teamseat. Your request is safe to submit again." });
    }
    inFlight.current = false;
    setBusy(false);
  };

  return (
    <section className="panel request-panel" aria-labelledby="request-heading">
      <h2 id="request-heading">Request an interpreter</h2>
      <form className="form" aria-label="Request an interpreter" noValidate onSubmit={(event) => void submit(event)}>
        <Field label="Language" error={errors.language}>
          {(props) => (
            <select {...props} value={draft.language} onChange={set("language")}>
              <option value="">Choose a language</option>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Setting" error={errors.setting}>
          {(props) => (
            <select {...props} value={draft.setting} onChange={set("setting")}>
              <option value="">Choose a setting</option>
              {SETTINGS.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <div className="form-row">
          <Field label="Date" hint="YYYY-MM-DD, Central">
            {(props) => (
              <input {...props} type="text" inputMode="numeric" autoComplete="off" placeholder="YYYY-MM-DD" value={draft.date} onChange={set("date")} />
            )}
          </Field>
          <Field label="Start time" hint="HH:MM, 24-hour" error={errors.start_at}>
            {(props) => (
              <input {...props} type="text" inputMode="numeric" autoComplete="off" placeholder="HH:MM" value={draft.time} onChange={set("time")} />
            )}
          </Field>
        </div>
        <Field label="Duration (minutes)" hint="30 to 480, in steps of 15" error={errors.duration_minutes}>
          {(props) => <input {...props} type="number" min={30} max={480} step={15} value={draft.duration} onChange={set("duration")} />}
        </Field>
        <Field label="Street address" error={errors.street_address}>
          {(props) => <input {...props} type="text" autoComplete="street-address" value={draft.street} onChange={set("street")} />}
        </Field>
        <Field label="City" error={errors.city}>
          {(props) => <input {...props} type="text" autoComplete="address-level2" value={draft.city} onChange={set("city")} />}
        </Field>
        <Field label="Patient initials" hint="2 or 3 capital letters" error={errors.patient_initials}>
          {(props) => <input {...props} type="text" autoComplete="off" autoCapitalize="characters" value={draft.initials} onChange={set("initials")} />}
        </Field>
        <Field label="Medical notes" hint="Optional, up to 1,000 characters" error={errors.medical_notes}>
          {(props) => <textarea {...props} rows={3} value={draft.notes} onChange={set("notes")} />}
        </Field>
        <button type="submit" className="button button-primary" disabled={busy}>
          Submit request
        </button>
        <Status name="Request status" message={message} />
      </form>
    </section>
  );
}


export function Requests({ user }: { user: User }) {
  const [assignments, setAssignments] = useState<Assignment[] | null>(null);
  const [query, setQuery] = useState("");
  const [pinned, setPinned] = useState<string | null>(null);
  const [open, setOpen] = useState<Assignment | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  const load = useCallback(async () => {
    const path = query.trim() ? `/api/assignments?q=${encodeURIComponent(query.trim())}` : "/api/assignments";
    const result = await api<{ assignments: Assignment[] }>("GET", path);
    if (!result.ok) return;
    setAssignments(result.data.assignments);
    setOpen((current) => (current ? (result.data.assignments.find((a) => a.number === current.number) ?? current) : current));
  }, [query]);
  usePolling(load, [load]);

  const ordered = useMemo(() => {
    if (!assignments) return null;
    const first = assignments.filter((a) => a.number === pinned);
    return [...first, ...assignments.filter((a) => a.number !== pinned)];
  }, [assignments, pinned]);

  const snapshot = useMemo(() => (assignments ? laneSnapshot(assignments) : null), [assignments]);
  const seam = useHatchSeam(snapshot, query);

  const submitted = (assignment: Assignment) => {
    setPinned(assignment.number);
    setAssignments((current) => [assignment, ...(current ?? []).filter((a) => a.number !== assignment.number)]);
    void load();
  };

  const scheduler = user.role === "scheduler";

  return (
    <div className={scheduler ? "requests-layout" : "requests-layout requests-layout-wide"}>
      {scheduler ? <RequestForm onSubmitted={submitted} /> : null}
      <section className="panel list-panel" aria-labelledby="list-heading">
        <div className="list-head">
          <h2 id="list-heading">{user.org?.name ?? "Requests"}</h2>
          <div className="search">
            <label htmlFor="request-search">Search requests</label>
            <input
              id="request-search"
              type="search"
              placeholder="Number or city"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>
        <table className="table request-table" aria-label="Requests" role="table">
          <thead role="rowgroup">
            <tr role="row">
              <th role="columnheader" scope="col">Number</th>
              <th role="columnheader" scope="col">Language</th>
              <th role="columnheader" scope="col">Setting</th>
              <th role="columnheader" scope="col">Time (Central)</th>
              <th role="columnheader" scope="col">Seats</th>
              <th role="columnheader" scope="col">Status</th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {(ordered ?? []).map((a) => {
              const covered = seam.covered(a.number, coveredCount(a.seats));
              return (
                <tr role="row" key={a.number} className={a.number === pinned ? "row-new" : undefined}>
                  <td role="cell" data-label="Number">
                    <button
                      type="button"
                      className="row-open num"
                      aria-label={`Open ${a.number}`}
                      onClick={(event) => {
                        opener.current = event.currentTarget;
                        setOpen(a);
                      }}
                    >
                      {a.number}
                    </button>
                  </td>
                  <td role="cell" data-label="Language">{languageName(a.language)}</td>
                  <td role="cell" data-label="Setting">{settingName(a.setting)}</td>
                  <td role="cell" data-label="Time" className="num cell-time">{formatRange(a.start_at, a.end_at)}</td>
                  <td role="cell" data-label="Seats">
                    <span className="cell-stack">
                    <span className="mini-lanes">
                      {a.seats.map((seat) => {
                        const key = `${a.number}#${seat.seat}`;
                        const actual = { held: seat.status !== "open", label: laneLabel(seat) };
                        return <SeatLane key={key} seat={seat.seat} shown={seam.lane(key, actual)} fillRef={seam.fillRef(key)} />;
                      })}
                    </span>
                    <span className="covered-count num">{`${covered} of ${a.seats.length} covered`}</span>
                    </span>
                  </td>
                  <td role="cell" data-label="Status">
                    <span className={`status-word status-word-${a.status}`}>{STATUS_LABELS[a.status]}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {ordered === null ? <LoadingRows /> : null}
        {ordered?.length === 0 ? (
          <EmptyNote>
            {query.trim()
              ? "No request matches that number or city."
              : scheduler
                ? "No requests yet. Use the form to request an interpreter."
                : "No requests from your organisation yet."}
          </EmptyNote>
        ) : null}
      </section>
      {open ? (
        <Drawer
          title={`Assignment ${open.number}`}
          contentKey={open.number}
          onClosed={() => {
            setOpen(null);
            opener.current?.focus({ preventScroll: true });
          }}
        >
          <AssignmentDetail
            assignment={open}
            role={user.role}
            onChanged={(changed) => {
              setOpen(changed);
              setAssignments((current) => (current ?? []).map((a) => (a.number === changed.number ? changed : a)));
            }}
          />
        </Drawer>
      ) : null}
    </div>
  );
}
