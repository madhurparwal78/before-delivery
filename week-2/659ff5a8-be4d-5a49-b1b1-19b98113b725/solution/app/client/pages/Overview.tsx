import { type FormEvent, useState } from "react";
import type { EventView, Protest, RegistrationView } from "../../shared/api.js";
import { EVENT_STATUS_LABEL, type EventStatus, MOVE_BUTTON, checkInOpen, nextEventStatus, withdrawalOpen } from "../../shared/lifecycle.js";
import { WAIVER_PARAGRAPHS } from "../../shared/copy.js";
import { localClock } from "../../shared/time.js";
import { ApiFailure, api } from "../api.js";
import { useEvent } from "../components/EventFrame.js";
import { Dialog } from "../components/Dialog.js";
import { Field, type FieldErrors, FixFields } from "../components/Forms.js";
import { Skeleton, StatusRegion } from "../components/ui.js";
import { useRefresh } from "../hooks.js";
import { Link } from "../router.js";
import { isStaff, useUser } from "../session.js";

export function Overview() {
  const { event, reload, reloadRota } = useEvent();
  const user = useUser();
  const [registrations, setRegistrations] = useState<RegistrationView[] | null>(null);
  const [protests, setProtests] = useState<Protest[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [checkingIn, setCheckingIn] = useState(false);

  const reloadAll = useRefresh(
    async () => {
      setRegistrations((await api.get<{ registrations: RegistrationView[] }>(`/api/events/${event.id}/registrations`)).registrations);
      if (isStaff(user, "chair")) setProtests((await api.get<{ protests: Protest[] }>(`/api/events/${event.id}/protests`)).protests);
    },
    10,
    [event.id],
  );
  const refreshEverything = (): void => {
    reload();
    reloadAll();
    reloadRota();
  };
  const mine = registrations?.find((r) => r.driver.id === user.id) ?? null;
  const move = MOVE_BUTTON[event.status];
  const undecided = protests.some((p) => p.status === "pending");

  const transition = async (): Promise<void> => {
    setBusy(true);
    setMessage("Updating event");
    try {
      const { event: updated } = await api.post<{ event: EventView }>(`/api/events/${event.id}/transition`, {
        to: nextEventStatus(event.status),
      });
      setMessage(`Event is now ${EVENT_STATUS_LABEL[updated.status]}.`);
    } catch (error) {
      setMessage(transitionMessage(error, EVENT_STATUS_LABEL[event.status]));
    } finally {
      setBusy(false);
      refreshEverything();
    }
  };

  return (
    <>
      <div className="page-head">
        <h1>{event.name}</h1>
        <span className="badge">{EVENT_STATUS_LABEL[event.status]}</span>
      </div>
      <dl className="facts">
        <div>
          <dt>Date</dt>
          <dd className="mono">{event.date}</dd>
        </div>
        <div>
          <dt>Venue</dt>
          <dd>{event.venue}</dd>
        </div>
        <div>
          <dt>Runs per driver</dt>
          <dd className="mono">{event.runsPerDriver}</dd>
        </div>
      </dl>
      <p className="status-fact">{registrationLine(event.registrationOpen, event.registrationCutoff)}</p>
      {event.provisionalAt !== null ? (
        <p className="status-fact">
          {event.protestWindowOpen && event.protestWindowClosesAt !== null
            ? `Protest window open until ${localClock(new Date(event.protestWindowClosesAt), event.timeZone)}`
            : "Protest window closed"}
        </p>
      ) : null}
      <StatusRegion name="Event updates">{message}</StatusRegion>

      {isStaff(user, "chair") && move ? (
        <div className="actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || (event.status === "provisional" && (event.protestWindowOpen || undecided))}
            aria-busy={busy}
            onClick={() => void transition()}
          >
            {move}
          </button>
        </div>
      ) : null}

      <section aria-labelledby="your-registration" className="panel">
        <h2 id="your-registration">Your registration</h2>
        {registrations === null ? (
          <Skeleton rows={2} />
        ) : mine ? (
          <Registered
            registration={mine}
            eventStatus={event.status}
            onMessage={setMessage}
            onChanged={refreshEverything}
            eventName={event.name}
            checkingIn={checkingIn}
            setCheckingIn={setCheckingIn}
          />
        ) : (
          <RegisterForm
            classes={event.heats.flatMap((h) => h.classes)}
            open={event.registrationOpen}
            eventId={event.id}
            onMessage={setMessage}
            onChanged={refreshEverything}
          />
        )}
      </section>

      <section aria-labelledby="factors" className="panel">
        <h2 id="factors">Index table effective {event.indexTable.effectiveDate}</h2>
        <ul className="factor-list">
          {Object.entries(event.factors).map(([code, factor]) => (
            <li key={code}>
              <span className="mono">{code}</span>
              <span className="mono num">{factor}</span>
            </li>
          ))}
        </ul>
      </section>
      <p className="muted link-note">
        <Link href={`/events/${event.id}/rota`}>Claim a work station on the rota.</Link>
      </p>
    </>
  );
}

function registrationLine(open: boolean, cutoff: string): string {
  return open ? `Registration closes ${cutoff.replace("T", " at ")}` : "Registration closed";
}

function transitionMessage(error: unknown, label: string): string {
  if (!(error instanceof ApiFailure)) return "Could not update the event. Try again.";
  if (error.code === "protest_window_open") return "The protest window is still open.";
  if (error.code === "protests_pending") return "Decide every protest before setting results final.";
  return `That step is not available from ${label}.`;
}

function RegisterForm(props: {
  classes: string[];
  open: boolean;
  eventId: number;
  onMessage: (text: string) => void;
  onChanged: () => void;
}) {
  const [values, setValues] = useState({ classCode: props.classes[0] ?? "", carNumber: "", carDescription: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setPending(true);
    setErrors({});
    props.onMessage("Registering");
    try {
      const { registration } = await api.post<{ registration: RegistrationView }>(`/api/events/${props.eventId}/registrations`, {
        classCode: values.classCode,
        carNumber: /^\d+$/.test(values.carNumber.trim()) ? Number(values.carNumber.trim()) : values.carNumber,
        carDescription: values.carDescription,
      });
      props.onMessage(
        `Registered: car ${registration.carNumber} ${registration.classCode}, run heat ${registration.runHeat}.` +
          (registration.confirmationEmail === "pending" ? " Your confirmation email is delayed. We'll keep trying." : ""),
      );
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 422) {
        setErrors(error.fields);
        props.onMessage("");
      } else if (error instanceof ApiFailure) {
        props.onMessage(registerMessage(error, values));
      } else props.onMessage("Could not register. Try again.");
    } finally {
      setPending(false);
      props.onChanged();
    }
  };
  return (
    <form aria-label="Register car" onSubmit={(e) => void submit(e)} noValidate className="stack">
      <FixFields form="register" errors={errors} />
      <Field form="register" name="classCode" label="Class" error={errors["classCode"]}>
        {(p) => (
          <select {...p} value={values.classCode} onChange={(e) => setValues({ ...values, classCode: e.target.value })}>
            {props.classes.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field form="register" name="carNumber" label="Car number" error={errors["carNumber"]}>
        {(p) => <input type="text" inputMode="numeric" {...p} value={values.carNumber} onChange={(e) => setValues({ ...values, carNumber: e.target.value })} />}
      </Field>
      <Field form="register" name="carDescription" label="Car description" error={errors["carDescription"]}>
        {(p) => <input type="text" {...p} value={values.carDescription} onChange={(e) => setValues({ ...values, carDescription: e.target.value })} />}
      </Field>
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={!props.open || pending} aria-busy={pending}>
          Register
        </button>
      </div>
    </form>
  );
}

function registerMessage(error: ApiFailure, values: { classCode: string; carNumber: string }): string {
  if (error.code === "registration_closed") return "Registration for this event is closed.";
  if (error.code === "already_registered") return "You are already registered for this event.";
  if (error.code === "car_number_taken") return `Car ${values.carNumber.trim()} is already taken in ${values.classCode}.`;
  return error.message;
}

function Registered(props: {
  registration: RegistrationView;
  eventStatus: EventStatus;
  eventName: string;
  onMessage: (text: string) => void;
  onChanged: () => void;
  checkingIn: boolean;
  setCheckingIn: (open: boolean) => void;
}) {
  const { registration } = props;
  const [pending, setPending] = useState(false);

  const withdraw = async (): Promise<void> => {
    setPending(true);
    props.onMessage("Withdrawing");
    try {
      await api.delete(`/api/registrations/${registration.id}`);
      props.onMessage(`You have withdrawn from ${props.eventName}.`);
    } catch (error) {
      props.onMessage(error instanceof ApiFailure && error.code === "withdrawal_closed" ? "Withdrawal closed once the event starts." : "Could not withdraw. Try again.");
    } finally {
      setPending(false);
      props.onChanged();
    }
  };
  return (
    <div className="stack">
      <p>
        <span className="mono">
          Car {registration.carNumber} {registration.classCode}
        </span>
        , run heat <span className="mono">{registration.runHeat}</span>
      </p>
      <p>{registration.carDescription}</p>
      <p>{registration.checkedIn ? "Checked in" : "Not checked in"}</p>
      <p>
        {registration.station
          ? `Work station: ${registration.station.name}, heat ${registration.station.heat}`
          : "No work station yet."}
      </p>
      <div className="actions">
        {withdrawalOpen(props.eventStatus) ? (
          <button type="button" className="btn btn-secondary" disabled={pending} aria-busy={pending} onClick={() => void withdraw()}>
            Withdraw
          </button>
        ) : null}
        {!registration.checkedIn && checkInOpen(props.eventStatus) ? (
          <button type="button" className="btn btn-primary" onClick={() => props.setCheckingIn(true)}>
            Check in
          </button>
        ) : null}
      </div>
      {props.checkingIn ? (
        <CheckIn
          registration={registration}
          onClose={() => props.setCheckingIn(false)}
          onMessage={props.onMessage}
          onChanged={props.onChanged}
        />
      ) : null}
    </div>
  );
}

function CheckIn(props: {
  registration: RegistrationView;
  onClose: () => void;
  onMessage: (text: string) => void;
  onChanged: () => void;
}) {
  const [signature, setSignature] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setPending(true);
    setErrors({});
    props.onMessage("Signing your waiver");
    try {
      await api.post(`/api/registrations/${props.registration.id}/check-in`, { signature });
      props.onMessage("Checked in. Your signed waiver is saved.");
      props.onClose();
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 422) {
        setErrors(error.fields);
        props.onMessage("");
      } else {
        props.onMessage(checkInMessage(error));
        props.onClose();
      }
    } finally {
      setPending(false);
      props.onChanged();
    }
  };
  return (
    <Dialog title="Check in and sign waiver" onClose={props.onClose}>
      <form aria-label="Check in form" onSubmit={(e) => void submit(e)} noValidate>
        <FixFields form="checkin" errors={errors} />
        <div className="waiver">
          {WAIVER_PARAGRAPHS.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
        <Field form="checkin" name="signature" label="Type your full name to sign" error={errors["signature"]}>
          {(p) => <input type="text" autoComplete="off" {...p} value={signature} onChange={(e) => setSignature(e.target.value)} />}
        </Field>
        <div className="dialog-actions">
          <button type="submit" className="btn btn-primary" disabled={pending} aria-busy={pending}>
            Sign and check in
          </button>
          <button type="button" className="btn btn-secondary" onClick={props.onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function checkInMessage(error: unknown): string {
  if (error instanceof ApiFailure && error.code === "renderer_unavailable") {
    return "Waiver signing is unavailable right now. Check in at the registration table.";
  }
  if (error instanceof ApiFailure && error.code === "storage_unavailable") {
    return "We could not save your signed waiver. You are not checked in yet; try again shortly.";
  }
  return error instanceof ApiFailure ? error.message : "Could not check in. Try again.";
}
