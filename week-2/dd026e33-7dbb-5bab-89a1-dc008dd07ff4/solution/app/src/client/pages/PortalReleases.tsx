// Owner portal releases (brief: Owner portal › Request release and Release; Interactions › Request
// release, Portal release page). The server decides slot eligibility; the form only submits.
import { useEffect, useState } from "react";
import { releaseActionAllowed } from "../../shared/transitions.js";
import type { CarDetail, Release, ReleaseStatus } from "../../shared/api.js";
import { formatMoment, formatSlot } from "../../shared/zurich.js";
import { HttpError, Interrupted, NoAnswer, errorCode, get, request } from "../api.js";
import { applyInPlace, useIdempotencyKey, useLoad, usePoll } from "../hooks.js";
import { IDEMPOTENCY_CONFLICT, NO_ANSWER, PORTAL_RELEASE_HEADING, RELEASE_STATUS_LABEL, SIGNED_IN_AGAIN } from "../labels.js";
import { NotFound } from "../ui/NotFound.js";
import { Link } from "../Shell.js";
import { ErrorSummary, FieldError, StatusRegion, summaryOf, useNote } from "../ui/Feedback.js";

const TIMES = Array.from({ length: 20 }, (_, i) => `${String(8 + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);

interface Earliest {
  earliest: string;
  earliest_label: string;
}

const REQUEST_ERRORS: Record<string, string> = {
  slot_taken: "That slot was just taken. Choose another.",
  release_already_open: "This car already has an open release.",
  car_in_workshop: "This car is in the workshop and can't be released yet.",
  car_not_stored: "This car is not in a bay.",
  idempotency_conflict: IDEMPOTENCY_CONFLICT,
};

export function RequestRelease({ carId }: { carId: string }): JSX.Element {
  const { data: car, missing } = useLoad(() => get<{ car: CarDetail }>(`/api/cars/${carId}`, true).then((answer) => answer.car), [carId]);
  const [earliest, setEarliest] = useState<Earliest | null>(null);
  const [day, setDay] = useState("");
  const [time, setTime] = useState("08:00");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [requested, setRequested] = useState<Release | null>(null);
  const [note, say] = useNote();
  const key = useIdempotencyKey();

  useEffect(() => {
    get<Earliest>("/api/releases/earliest-slot").then(
      (answer) => {
        setEarliest(answer);
        setDay(answer.earliest.slice(0, 10));
        setTime(answer.earliest.slice(11, 16));
      },
      () => undefined,
    );
  }, []);

  usePoll(async () => {
    const answer = await get<Earliest>("/api/releases/earliest-slot");
    if (answer.earliest !== earliest?.earliest) applyInPlace(() => setEarliest(answer));
  }, 60_000);

  if (missing) return <NotFound />;

  const submit = async (): Promise<void> => {
    say("Requesting release...");
    try {
      const answer = await request<{ release: Release }>("/api/releases", {
        method: "POST",
        body: { car_id: carId, slot: `${day}T${time}` },
        idempotencyKey: key.take(),
      });
      key.discard();
      setErrors({});
      setRequested(answer.data.release);
      say(`We'll confirm ${formatSlot(answer.data.release.slot)} by email once the concierge books it.`);
    } catch (error) {
      if (error instanceof NoAnswer) {
        say(NO_ANSWER.release, "error");
        return;
      }
      if (error instanceof Interrupted) {
        say(SIGNED_IN_AGAIN);
        return;
      }
      key.discard();
      const code = errorCode(error);
      if (code && REQUEST_ERRORS[code]) say(REQUEST_ERRORS[code] ?? "", "error");
      else if (error instanceof HttpError && error.status === 422) {
        setErrors(error.fields);
        say(Object.values(error.fields)[0] ?? "", "error");
      }
    }
  };

  if (requested) {
    return (
      <div className="screen narrow-screen">
        <h1>We've received your release request</h1>
        <StatusRegion name="Release updates" note={note} />
        <Link to={`/portal/releases/${requested.id}`}>Follow this release</Link>
      </div>
    );
  }

  return (
    <div className="screen narrow-screen">
      <header className="screen-header">
        <h1>Request release</h1>
        {car ? <p className="identity-sub">{car.name}</p> : null}
        <StatusRegion name="Release updates" note={note} />
      </header>
      <form
        className="form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <p className="lead-line">{earliest ? `Earliest slot: ${earliest.earliest_label}` : " "}</p>
        <p className="sub">Releases need at least 48 hours' notice. Slots are on the half hour, 08:00 to 17:30, Monday to Saturday, Zurich time.</p>
        <ErrorSummary items={summaryOf(errors, ["slot", "car_id"])} idFor={() => "release-date"} />
        <div className="form-grid">
          <div className="field">
            <label htmlFor="release-date">Date</label>
            <input id="release-date" type="text" inputMode="numeric" placeholder="YYYY-MM-DD" value={day} onChange={(event) => setDay(event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="release-time">Time</label>
            <select id="release-time" value={time} onChange={(event) => setTime(event.target.value)}>
              {TIMES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
        </div>
        <FieldError id="release-slot-error" message={errors.slot} />
        <button type="submit" className="button primary">
          Request release
        </button>
      </form>
    </div>
  );
}

const LIVE_COPY: Record<ReleaseStatus, (release: Release) => string> = {
  requested: () => "",
  booked: (release) => `Your release is booked for ${release.slot_label}.`,
  staged: () => "Your car is ready for handover.",
  released: () => "Your car has been released.",
  cancelled: () => "Release cancelled.",
};

export function PortalRelease({ releaseId }: { releaseId: string }): JSX.Element {
  const { data: release, setData: setRelease, missing } = useLoad(
    () => get<{ release: Release }>(`/api/releases/${releaseId}`, true).then((answer) => answer.release),
    [releaseId],
  );
  const [note, say] = useNote();

  usePoll(
    async () => {
      if (!release) return;
      const fresh = (await get<{ release: Release }>(`/api/releases/${releaseId}`)).release;
      if (JSON.stringify(fresh) === JSON.stringify(release)) return;
      applyInPlace(() => setRelease(fresh));
      if (fresh.status !== release.status) say(LIVE_COPY[fresh.status](fresh));
    },
    10_000,
    release !== null,
  );

  if (missing) return <NotFound />;
  if (!release) return <div className="screen placeholder" aria-hidden="true" />;

  const cancel = async (): Promise<void> => {
    say("Saving...");
    try {
      const answer = await request<{ release: Release }>(`/api/releases/${release.id}/cancel`, { method: "POST" });
      setRelease(answer.data.release);
      say("Release cancelled.");
    } catch (error) {
      if (error instanceof Interrupted) say(SIGNED_IN_AGAIN);
      else if (errorCode(error) === "invalid_transition") say("This release has moved on. Reload to see its current state.", "error");
      else say("No answer from the server. Nothing has changed; press again.", "error");
    }
  };

  const held = release.status === "staged" && release.held_by.length > 0;
  return (
    <div className="screen narrow-screen">
      <header className="screen-header">
        <h1>{PORTAL_RELEASE_HEADING[release.status]}</h1>
        <StatusRegion name="Release updates" note={note} />
      </header>
      {held ? <p className="hold-line">{`Your car is held until invoice ${release.held_by.map((hold) => hold.number).join(", ")} is paid.`}</p> : null}
      {releaseActionAllowed("cancel", release.status, true) ? (
        <button type="button" className="button" onClick={() => void cancel()}>
          Cancel release
        </button>
      ) : null}
      <dl className="facts">
        <div>
          <dt>Car</dt>
          <dd>{release.car.name}</dd>
        </div>
        <div>
          <dt>Slot</dt>
          <dd className="mono-text">{release.slot_label}</dd>
        </div>
        <div>
          <dt>Bay</dt>
          <dd className="mono-text">{release.bay_code ?? "—"}</dd>
        </div>
      </dl>
      <h2 className="section-heading">History</h2>
      <ol className="plain-list ruled-list">
        {release.events.map((event, index) => (
          <li key={`${event.status}-${index}`}>
            <span>{RELEASE_STATUS_LABEL[event.status]}</span>
            <span className="mono-text">{formatMoment(event.at)}</span>
            <span className="sub">{event.by.name}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
