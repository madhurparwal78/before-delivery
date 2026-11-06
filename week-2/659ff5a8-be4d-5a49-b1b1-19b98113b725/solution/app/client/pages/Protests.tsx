import { type FormEvent, useState } from "react";
import type { CorrectionEntry, Protest, RegistrationView } from "../../shared/api.js";
import { localClock } from "../../shared/time.js";
import { ApiFailure, api } from "../api.js";
import { Dialog } from "../components/Dialog.js";
import { useEvent } from "../components/EventFrame.js";
import { Field, type FieldErrors, FixFields } from "../components/Forms.js";
import { EmptyState, Skeleton, StatusRegion } from "../components/ui.js";
import { formatValues } from "../format.js";
import { useRefresh } from "../hooks.js";
import { isStaff, useUser } from "../session.js";

export function Protests() {
  const { event, reload } = useEvent();
  const user = useUser();
  const chair = isStaff(user, "chair");
  const [protests, setProtests] = useState<Protest[] | null>(null);
  const [registrations, setRegistrations] = useState<RegistrationView[]>([]);
  const [corrections, setCorrections] = useState<CorrectionEntry[]>([]);
  const [message, setMessage] = useState("");
  const [filing, setFiling] = useState(false);

  const reloadAll = useRefresh(
    async () => {
      setProtests((await api.get<{ protests: Protest[] }>(`/api/events/${event.id}/protests`)).protests);
      setRegistrations((await api.get<{ registrations: RegistrationView[] }>(`/api/events/${event.id}/registrations`)).registrations);
      if (chair) setCorrections((await api.get<{ corrections: CorrectionEntry[] }>(`/api/events/${event.id}/corrections`)).corrections);
    },
    10,
    [event.id],
  );
  const changed = (): void => {
    reload();
    reloadAll();
  };
  const windowLine =
    event.protestWindowOpen && event.protestWindowClosesAt !== null
      ? `Protest window open until ${localClock(new Date(event.protestWindowClosesAt), event.timeZone)}`
      : "Protest window closed";

  return (
    <>
      <div className="page-head">
        <h1>Protests</h1>
        <button type="button" className="btn btn-primary" disabled={!event.protestWindowOpen} onClick={() => setFiling(true)}>
          File a protest
        </button>
      </div>
      {event.provisionalAt !== null ? <p className="status-fact">{windowLine}</p> : null}
      <StatusRegion name="Protest updates">{message}</StatusRegion>
      {protests === null ? (
        <Skeleton />
      ) : protests.length === 0 ? (
        <EmptyState next="While the protest window is open, a registered driver files one with File a protest.">No protests have been filed.</EmptyState>
      ) : (
        <ul className="protest-list">
          {protests.map((protest) => (
            <ProtestCard
              key={protest.id}
              protest={protest}
              chair={chair}
              corrections={corrections.filter((c) => c.registrationId === protest.subject.registrationId)}
              timeZone={event.timeZone}
              onMessage={setMessage}
              onChanged={changed}
            />
          ))}
        </ul>
      )}
      {filing ? (
        <FileProtest
          eventId={event.id}
          registrations={registrations}
          onClose={() => setFiling(false)}
          onMessage={setMessage}
          onFiled={() => {
            setFiling(false);
            changed();
          }}
        />
      ) : null}
    </>
  );
}

function ProtestCard(props: {
  protest: Protest;
  chair: boolean;
  corrections: CorrectionEntry[];
  timeZone: string;
  onMessage: (text: string) => void;
  onChanged: () => void;
}) {
  const { protest, corrections } = props;
  const car = `${protest.subject.carNumber} ${protest.subject.classCode}`;
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);
  const form = `decide-${protest.id}`;

  const decide = async (decision: "upheld" | "denied"): Promise<void> => {
    setPending(true);
    setErrors({});
    props.onMessage("Saving decision");
    try {
      await api.post(`/api/protests/${protest.id}/decision`, { decision, note });
      props.onMessage(decision === "upheld" ? "Protest upheld." : "Protest denied.");
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 422) {
        setErrors({ note: error.fields["note"] ?? error.message });
        props.onMessage("");
      } else props.onMessage(error instanceof ApiFailure ? error.message : "Could not save the decision. Try again.");
    } finally {
      setPending(false);
      props.onChanged();
    }
  };

  const body = (
    <>
      <p className="protest-subject">
        <span className="num">Car {car}</span>, {protest.subject.driverName}
      </p>
      <p>{protest.text}</p>
      <p className="muted">
        Filed by {protest.filedBy.name}. Status: {protest.status}.
        {protest.decisionNote ? ` Decision note: ${protest.decisionNote}` : ""}
      </p>
    </>
  );
  if (!props.chair) return <li className="protest">{body}</li>;
  return (
    <li className="protest">
      <section aria-label={`Protest against car ${car}`}>
        {body}
        {corrections.length > 0 ? (
          <ul aria-label={`Corrections for car ${car}`} className="correction-items">
            {corrections.map((c) => (
              <li key={c.id}>
                {`Run ${c.runNumber}: ${formatValues(c.before)} to ${formatValues(c.after)} by ${c.actor.name} at ${localClock(new Date(c.at), props.timeZone)}, reason: ${c.reason}`}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No corrections for this car.</p>
        )}
        {protest.status === "pending" ? (
          <div className="stack">
            <FixFields form={form} errors={errors} />
            <Field form={form} name="note" label="Decision note" error={errors["note"]}>
              {(p) => <input type="text" {...p} value={note} onChange={(e) => setNote(e.target.value)} />}
            </Field>
            <div className="actions">
              <button type="button" className="btn btn-primary" disabled={pending} onClick={() => void decide("upheld")}>
                Uphold
              </button>
              <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => void decide("denied")}>
                Deny
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </li>
  );
}

function FileProtest(props: {
  eventId: number;
  registrations: RegistrationView[];
  onClose: () => void;
  onMessage: (text: string) => void;
  onFiled: () => void;
}) {
  const [subject, setSubject] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);
  const chosen = subject ?? props.registrations[0]?.id ?? null;

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const target = props.registrations.find((r) => r.id === chosen);
    if (!target) return;
    setPending(true);
    setErrors({});
    props.onMessage("Filing protest");
    try {
      await api.post(`/api/events/${props.eventId}/protests`, { registrationId: target.id, text });
      props.onMessage(`Protest filed against car ${target.carNumber} ${target.classCode}.`);
      props.onFiled();
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 422) {
        setErrors(error.fields["text"] ? { text: error.fields["text"] } : error.fields);
        props.onMessage("");
      } else {
        props.onMessage(error instanceof ApiFailure && error.code === "protest_window_closed" ? "The protest window has closed." : error instanceof ApiFailure ? error.message : "Could not file the protest. Try again.");
        props.onClose();
      }
    } finally {
      setPending(false);
    }
  };
  return (
    <Dialog title="File a protest" onClose={props.onClose}>
      <form aria-label="File a protest form" onSubmit={(e) => void submit(e)} noValidate>
        <FixFields form="protest" errors={errors} />
        <Field form="protest" name="registrationId" label="Car protested" error={errors["registrationId"]}>
          {(p) => (
            <select {...p} value={chosen ?? ""} onChange={(e) => setSubject(Number(e.target.value))}>
              {props.registrations.map((r) => (
                <option key={r.id} value={r.id}>
                  Car {r.carNumber} {r.classCode}, {r.driver.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field form="protest" name="text" label="Protest details" error={errors["text"]}>
          {(p) => <textarea rows={4} {...p} value={text} onChange={(e) => setText(e.target.value)} />}
        </Field>
        <div className="dialog-actions">
          <button type="submit" className="btn btn-primary" disabled={pending} aria-busy={pending}>
            File protest
          </button>
          <button type="button" className="btn btn-secondary" onClick={props.onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}
