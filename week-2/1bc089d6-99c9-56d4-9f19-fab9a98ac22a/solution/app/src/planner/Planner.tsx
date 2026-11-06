import { useEffect, useRef, useState, type FormEvent } from "react";

import { ritualStore } from "../shared/ritualStore";
import { api, CHECK_DETAILS, retryMinutes, type ApiFailure } from "./api";
import {
  BedtimeField,
  CheckYourHour,
  EmailField,
  HourSummary,
  NoteField,
  RitualsField,
  TimeZoneField,
  browserZone,
  checkHour,
  hourErrors,
  type FieldErrors,
  type HourField,
  type HourValues,
} from "./fields";
import { DEFAULT_BEDTIME } from "../shared/hour";

const PREFIX = "plan";
const NEW_HOUR_FIELDS: HourField[] = ["email", "bedtime", "time_zone", "rituals", "note"];
const RETRIES = 3;
const RETRY_DELAY_MS = 2500;

const SAVED = "Check your inbox. We sent a link to confirm your hour.";
const QUEUED = "Your hour is saved as a draft. The confirmation email is delayed and will arrive as soon as our mail service is back.";
const NOT_SAVED = "Your hour was not saved. Please try again.";

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

function failureCopy(failure: ApiFailure) {
  if (failure.status === 422) return CHECK_DETAILS;
  if (failure.status === 429) {
    return `You have saved three hours for this address in the last hour. Try again in ${retryMinutes(failure)} minutes.`;
  }
  if (failure.status === 503 && failure.message) return failure.message;
  return NOT_SAVED;
}

/** Chapter six: a bedtime, a time zone, the rituals chosen in chapter four, a note and an email, saved as a draft hour. */
export function Planner() {
  const [rituals, setRituals] = useState(() => ritualStore.get());
  const [bedtime, setBedtime] = useState(DEFAULT_BEDTIME);
  const [zone, setZone] = useState(browserZone);
  const [note, setNote] = useState("");
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const keys = useRef(new Map<string, string>());
  const alert = useRef<HTMLDivElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const sending = useRef(false);

  useEffect(() => ritualStore.subscribe(setRituals), []);

  const showErrors = (found: FieldErrors) => {
    setErrors(found);
    setStatus(CHECK_DETAILS);
    window.requestAnimationFrame(() => alert.current?.focus());
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (sending.current) return;
    const values: HourValues = { email: email.trim(), bedtime, time_zone: zone, rituals, note };
    const found = checkHour(values, NEW_HOUR_FIELDS);
    if (Object.keys(found).length) {
      showErrors(found);
      return;
    }
    const body = { email: values.email, bedtime, time_zone: zone, rituals: rituals.map(({ id, minutes }) => ({ id, minutes })), note };
    const payload = JSON.stringify(body);
    const key = keys.current.get(payload) ?? crypto.randomUUID();
    keys.current.set(payload, key);
    const hadFocus = document.activeElement === saveButton.current;
    sending.current = true;
    setPending(true);
    setErrors({});
    setStatus("Saving your hour…");
    let result = await api<{ status: string }>("POST", "/api/plans", body, { "Idempotency-Key": key });
    for (let retry = 0; retry < RETRIES && !result.ok && result.status === 0; retry += 1) {
      await wait(RETRY_DELAY_MS);
      result = await api<{ status: string }>("POST", "/api/plans", body, { "Idempotency-Key": key });
    }
    sending.current = false;
    setPending(false);
    if (hadFocus) window.requestAnimationFrame(() => saveButton.current?.focus());
    if (result.ok) {
      setStatus(result.data.status === "confirmation_queued" ? QUEUED : SAVED);
      window.dispatchEvent(new CustomEvent("stillhour:hour-saved"));
      return;
    }
    if (result.status === 422) {
      showErrors(hourErrors(result.fields));
      return;
    }
    setStatus(failureCopy(result));
  }

  return (
    <form className="sh-planner" noValidate aria-label="Plan your hour" onSubmit={submit}>
      <CheckYourHour prefix={PREFIX} errors={errors} ref={alert} />
      <div className="sh-planner__fields">
        <div className="sh-planner__row">
          <BedtimeField prefix={PREFIX} value={bedtime} error={errors.bedtime} onChange={setBedtime} />
          <TimeZoneField prefix={PREFIX} value={zone} error={errors.time_zone} onChange={setZone} />
        </div>
        <RitualsField
          prefix={PREFIX}
          error={errors.rituals}
          controls={{
            chosen: rituals,
            add: (id) => ritualStore.add(id),
            remove: (id) => ritualStore.remove(id),
            setMinutes: (id, minutes) => ritualStore.setMinutes(id, minutes),
          }}
        />
        <NoteField prefix={PREFIX} value={note} error={errors.note} onChange={setNote} />
        <EmailField prefix={PREFIX} value={email} error={errors.email} onChange={setEmail} />
        <div className="sh-planner__actions">
          <button className="sh-button sh-button--ember" type="submit" disabled={pending} ref={saveButton}>
            Save my hour
          </button>
          <p className="sh-live" role="status" aria-label="Planner status">
            {status}
          </p>
        </div>
      </div>
      <div className="sh-planner__summary">
        <HourSummary bedtime={bedtime} zone={zone} rituals={rituals}>
          <p className="sh-summary__note">One email each night when your hour starts, in your own time zone.</p>
        </HourSummary>
      </div>
    </form>
  );
}
