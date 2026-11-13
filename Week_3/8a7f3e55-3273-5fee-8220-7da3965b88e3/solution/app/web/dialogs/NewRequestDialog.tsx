import { useLayoutEffect, useRef, useState } from "react";
import type { Booking, Contract, SessionUser } from "../../shared/api";
import { Field } from "../components/Field";
import { Modal } from "../components/Modal";
import { useAction } from "../lib/actions";
import { apiPost } from "../lib/api";
import { PENDING, SUCCESS } from "../lib/copy";
import { TEXT_LIMITS, textLength } from "../../shared/text";
import { withCommas } from "../lib/format";

interface NewRequestProps {
  user: SessionUser;
  organisations: Pick<Contract, "org_id" | "org_name">[];
  agencyZone: string;
  onCreated: (booking: Booking) => void;
  onClose: () => void;
}

const FIELD_ORDER = ["org_id", "setting", "title", "location", "onsite_contact_name", "onsite_contact_phone", "consumer_name", "start", "duration_minutes", "requester_notes"] as const;
const FIELD_ELEMENTS: Record<(typeof FIELD_ORDER)[number], string> = {
  org_id: "nr-org",
  setting: "nr-setting",
  title: "nr-title",
  location: "nr-location",
  onsite_contact_name: "nr-contact-name",
  onsite_contact_phone: "nr-contact-phone",
  consumer_name: "nr-consumer",
  start: "nr-start-date",
  duration_minutes: "nr-length",
  requester_notes: "nr-notes",
};

const SETTINGS = [
  ["medical", "Medical"],
  ["educational", "Educational"],
  ["legal", "Legal"],
  ["workplace", "Workplace"],
] as const;

export function NewRequestDialog({ user, organisations, agencyZone, onCreated, onClose }: NewRequestProps) {
  const action = useAction();
  const [values, setValues] = useState({
    org_id: "",
    setting: "",
    title: "",
    location: "",
    onsite_contact_name: "",
    onsite_contact_phone: "",
    consumer_name: "",
    start_date: "",
    start_time: "",
    duration: "",
    requester_notes: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [focusRequest, setFocusRequest] = useState<string | null>(null);
  // One Idempotency-Key per draft: it is kept while the body is unchanged since the previous press, and replaced when it changes.
  const draft = useRef({ key: crypto.randomUUID(), sent: null as string | null });
  const set = (key: keyof typeof values) => (event: { target: { value: string } }) => setValues((held) => ({ ...held, [key]: event.target.value }));

  useLayoutEffect(() => {
    if (focusRequest !== null) document.getElementById(focusRequest)?.focus();
  }, [focusRequest, errors]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const length = values.duration.trim() !== "" && /^\d+$/.test(values.duration.trim()) ? Number(values.duration.trim()) : values.duration;
    const body = {
      ...(user.role === "coordinator" ? { org_id: values.org_id } : {}),
      setting: values.setting,
      title: values.title,
      location: values.location,
      onsite_contact_name: values.onsite_contact_name,
      onsite_contact_phone: values.onsite_contact_phone,
      consumer_name: values.consumer_name,
      start: values.start_date === "" || values.start_time === "" ? "" : `${values.start_date}T${values.start_time}`,
      duration_minutes: length,
      requester_notes: values.requester_notes,
    };
    const serialised = JSON.stringify(body);
    if (draft.current.sent !== null && draft.current.sent !== serialised) draft.current.key = crypto.randomUUID();
    draft.current.sent = serialised;
    const created = await action.run({
      kind: "submit",
      pending: PENDING.submit,
      work: () => apiPost<Booking>("/api/bookings", body, draft.current.key),
      success: (booking) => SUCCESS.submitted(booking.ref),
      onFailure: (failure) => {
        const fields = failure.body?.fields ?? {};
        setErrors(fields);
        const first = FIELD_ORDER.find((name) => fields[name] !== undefined);
        setFocusRequest(first ? FIELD_ELEMENTS[first] : "nr-submit");
      },
    });
    if (created !== undefined) onCreated(created);
  };

  const titleHint = `${withCommas(textLength(values.title))} of ${withCommas(TEXT_LIMITS.title)} characters`;
  const notesHint = `${withCommas(textLength(values.requester_notes))} of ${withCommas(TEXT_LIMITS.requester_notes)} characters`;
  const zoneHint = `Agency time (${agencyZone})`;

  return (
    <Modal
      label="New request"
      onClose={onClose}
      closable={!action.pending}
      initialFocus={(dialog) => dialog.querySelector<HTMLElement>("select, input")}
      fallbackFocus={() => document.querySelector<HTMLElement>("[data-detail-heading]")}
    >
      <form className="dialog-form" noValidate onSubmit={(event) => void submit(event)}>
        <h2 className="dialog-title">New request</h2>
        {user.role === "coordinator" ? (
          <Field id="nr-org" label="Organisation" error={errors["org_id"]}>
            {(props) => (
              <select {...props} value={values.org_id} onChange={set("org_id")}>
                <option value="">Choose an organisation</option>
                {organisations.map((org) => (
                  <option key={org.org_id} value={org.org_id}>
                    {org.org_name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        ) : null}
        <Field id="nr-setting" label="Setting" error={errors["setting"]}>
          {(props) => (
            <select {...props} value={values.setting} onChange={set("setting")}>
              <option value="">Choose a setting</option>
              {SETTINGS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field id="nr-title" label="Title" hint={titleHint} error={errors["title"]}>
          {(props) => <input {...props} type="text" value={values.title} onChange={set("title")} autoComplete="off" />}
        </Field>
        <Field id="nr-location" label="Location" error={errors["location"]}>
          {(props) => <input {...props} type="text" value={values.location} onChange={set("location")} autoComplete="off" />}
        </Field>
        <Field id="nr-contact-name" label="On-site contact name" error={errors["onsite_contact_name"]}>
          {(props) => <input {...props} type="text" value={values.onsite_contact_name} onChange={set("onsite_contact_name")} autoComplete="off" />}
        </Field>
        <Field id="nr-contact-phone" label="On-site contact phone" error={errors["onsite_contact_phone"]}>
          {(props) => <input {...props} type="tel" value={values.onsite_contact_phone} onChange={set("onsite_contact_phone")} autoComplete="off" />}
        </Field>
        <Field id="nr-consumer" label="Deaf consumer name" error={errors["consumer_name"]}>
          {(props) => <input {...props} type="text" value={values.consumer_name} onChange={set("consumer_name")} autoComplete="off" />}
        </Field>
        <div className="field-pair">
          <Field id="nr-start-date" label="Start date" hint={zoneHint} error={errors["start"]}>
            {(props) => <input {...props} type="text" inputMode="numeric" placeholder="YYYY-MM-DD" className="mono" value={values.start_date} onChange={set("start_date")} autoComplete="off" />}
          </Field>
          <Field id="nr-start-time" label="Start time" hint={zoneHint}>
            {(props) => <input {...props} type="text" inputMode="numeric" placeholder="HH:MM" className="mono" value={values.start_time} onChange={set("start_time")} autoComplete="off" />}
          </Field>
        </div>
        <Field id="nr-length" label="Length (minutes)" error={errors["duration_minutes"]}>
          {(props) => <input {...props} type="text" inputMode="numeric" value={values.duration} onChange={set("duration")} autoComplete="off" />}
        </Field>
        <Field id="nr-notes" label="Notes for the agency" hint={notesHint} error={errors["requester_notes"]}>
          {(props) => <textarea {...props} rows={4} value={values.requester_notes} onChange={set("requester_notes")} />}
        </Field>
        <div className="dialog-actions">
          <button id="nr-submit" type="submit" className="btn btn--primary" disabled={action.pending}>
            {action.pending ? PENDING.submit : "Submit request"}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </form>
    </Modal>
  );
}
