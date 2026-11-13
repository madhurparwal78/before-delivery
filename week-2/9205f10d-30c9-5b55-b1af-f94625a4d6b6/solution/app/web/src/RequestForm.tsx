import { type FormEvent, useEffect, useState } from "react";
import { OFFLINE_COPY, api } from "./api";
import { agencyDateOf, clockOf } from "./format";
import { NotFound } from "./NotFound";
import { navigate } from "./router";
import type { ApiRequest } from "./types";

const DEFAULT_CREDENTIAL = { medical: "NIC", education: "EIPA", legal: "SC:L" } as const;
type Setting = keyof typeof DEFAULT_CREDENTIAL;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(0?[1-9]|1[0-2]):([0-5]\d) (AM|PM)$/i;

/** "9:00 AM" → "09:00"; the entry is agency wall-clock time. */
function to24Hour(time: string): string {
  const [, hour = "", minute = "", period = ""] = TIME_PATTERN.exec(time.trim()) ?? [];
  const h = (Number(hour) % 12) + (period.toUpperCase() === "PM" ? 12 : 0);
  return `${String(h).padStart(2, "0")}:${minute}`;
}

interface Draft {
  setting: Setting;
  date: string;
  time: string;
  duration: string;
  credential: string;
  consumer: string;
  address: string;
  city: string;
  notes: string;
}

const EMPTY: Draft = { setting: "medical", date: "", time: "", duration: "", credential: "NIC", consumer: "", address: "", city: "", notes: "" };

function fromRequest(r: ApiRequest): Draft {
  return {
    setting: r.setting,
    date: agencyDateOf(r.starts_at),
    time: clockOf(r.starts_at),
    duration: String(r.duration_minutes),
    credential: r.required_credential,
    consumer: r.consumer_name ?? "",
    address: r.location_address ?? "",
    city: r.city,
    notes: r.notes ?? "",
  };
}

/** API field name → the form control its error belongs under. */
const FIELD_OF: Record<string, keyof Draft> = {
  setting: "setting",
  starts_at: "time",
  duration_minutes: "duration",
  required_credential: "credential",
  consumer_name: "consumer",
  location_address: "address",
  city: "city",
  notes: "notes",
};

/** New request, also used to edit a draft. */
export function RequestForm({ editId }: { editId: string | null }) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [reference, setReference] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [credentialChosen, setCredentialChosen] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!editId) return;
    void api<ApiRequest>("GET", `/api/requests/${editId}`).then((result) => {
      if (result.ok && result.data.status === "draft") {
        setDraft(fromRequest(result.data));
        setReference(result.data.reference);
        setCredentialChosen(true);
      } else if (result.ok) navigate(`/requests/${editId}`, { replace: true });
      else if (result.status === 404) setMissing(true);
      else setMessage(result.error?.message ?? OFFLINE_COPY);
    });
  }, [editId]);

  if (missing) return <NotFound />;

  const set = (key: keyof Draft, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const chooseSetting = (value: Setting) =>
    setDraft((current) => ({ ...current, setting: value, credential: credentialChosen ? current.credential : DEFAULT_CREDENTIAL[value] }));

  const save = async (submitAfter: boolean, event?: FormEvent) => {
    event?.preventDefault();
    const local: Partial<Record<keyof Draft, string>> = {};
    if (!DATE_PATTERN.test(draft.date.trim())) local.date = "Enter the date as YYYY-MM-DD.";
    if (!TIME_PATTERN.test(draft.time.trim())) local.time = "Enter the time like 9:00 AM.";
    setErrors(local);
    if (Object.keys(local).length > 0) {
      setMessage("");
      return;
    }
    const body = {
      setting: draft.setting,
      starts_at: `${draft.date.trim()}T${to24Hour(draft.time)}`,
      duration_minutes: /^\d+$/.test(draft.duration.trim()) ? Number(draft.duration.trim()) : draft.duration,
      required_credential: draft.credential,
      consumer_name: draft.consumer,
      location_address: draft.address,
      city: draft.city,
      notes: draft.notes,
    };
    setPending(true);
    setMessage(submitAfter ? "Submitting request…" : "Saving draft…");
    const saved = editId ? await api<ApiRequest>("PATCH", `/api/requests/${editId}`, body) : await api<ApiRequest>("POST", "/api/requests", body);
    if (!saved.ok) {
      setPending(false);
      if (!saved.error) {
        setMessage(OFFLINE_COPY);
        return;
      }
      const mapped: Partial<Record<keyof Draft, string>> = {};
      for (const [field, text] of Object.entries(saved.error.fields ?? {})) {
        const key = FIELD_OF[field];
        if (key) mapped[key] = text;
      }
      setErrors(mapped);
      setMessage(saved.error.message);
      return;
    }
    if (!submitAfter) {
      navigate(`/requests/${saved.data.id}`, { state: { message: "Draft saved." } });
      return;
    }
    const submitted = await api<ApiRequest>("POST", `/api/requests/${saved.data.id}/submit`, {});
    setPending(false);
    navigate(`/requests/${saved.data.id}`, {
      state: { message: submitted.ok ? "Request submitted. Seats are open for interpreters." : (submitted.error?.message ?? OFFLINE_COPY) },
    });
  };

  const control = (key: keyof Draft) => ({
    id: `request-${key}`,
    "aria-invalid": errors[key] ? true : false,
    "aria-describedby": [errors[key] ? `request-${key}-error` : "", key === "date" || key === "time" ? `request-${key}-hint` : ""]
      .filter(Boolean)
      .join(" ") || undefined,
  });
  const error = (key: keyof Draft) =>
    errors[key] ? (
      <p id={`request-${key}-error`} className="field-error">
        {errors[key]}
      </p>
    ) : null;

  return (
    <div className="page form-page">
      <h1>{editId ? `Edit draft ${reference ?? ""}` : "New request"}</h1>
      <form className="request-form" aria-label="New request" onSubmit={(e) => void save(false, e)} noValidate>
        <div className="field">
          <label htmlFor="request-setting">Setting</label>
          <select className="input" value={draft.setting} onChange={(e) => chooseSetting(e.target.value as Setting)} {...control("setting")}>
            <option value="medical">Medical</option>
            <option value="education">Education</option>
            <option value="legal">Legal</option>
          </select>
          {error("setting")}
        </div>
        <div className="field-pair">
          <div className="field">
            <label htmlFor="request-date">Date</label>
            <input className="input num" type="text" inputMode="numeric" autoComplete="off" value={draft.date} onChange={(e) => set("date", e.target.value)} {...control("date")} />
            <p id="request-date-hint" className="hint">
              YYYY-MM-DD
            </p>
            {error("date")}
          </div>
          <div className="field">
            <label htmlFor="request-time">Start time</label>
            <input className="input num" type="text" autoComplete="off" value={draft.time} onChange={(e) => set("time", e.target.value)} {...control("time")} />
            <p id="request-time-hint" className="hint">
              h:mm AM/PM
            </p>
            {error("time")}
          </div>
        </div>
        <div className="field-pair">
          <div className="field">
            <label htmlFor="request-duration">Duration (minutes)</label>
            <input className="input num" type="number" min={30} max={480} step={5} value={draft.duration} onChange={(e) => set("duration", e.target.value)} {...control("duration")} />
            {error("duration")}
          </div>
          <div className="field">
            <label htmlFor="request-credential">Required credential</label>
            <select
              className="input"
              value={draft.credential}
              onChange={(e) => {
                setCredentialChosen(true);
                set("credential", e.target.value);
              }}
              {...control("credential")}
            >
              {["NIC", "CDI", "SC:L", "EIPA"].map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
            {error("credential")}
          </div>
        </div>
        <div className="field">
          <label htmlFor="request-consumer">Deaf consumer name</label>
          <input className="input" type="text" autoComplete="off" value={draft.consumer} onChange={(e) => set("consumer", e.target.value)} {...control("consumer")} />
          {error("consumer")}
        </div>
        <div className="field">
          <label htmlFor="request-address">Street address</label>
          <input className="input" type="text" autoComplete="off" value={draft.address} onChange={(e) => set("address", e.target.value)} {...control("address")} />
          {error("address")}
        </div>
        <div className="field">
          <label htmlFor="request-city">City</label>
          <input className="input" type="text" autoComplete="off" value={draft.city} onChange={(e) => set("city", e.target.value)} {...control("city")} />
          {error("city")}
        </div>
        <div className="field">
          <label htmlFor="request-notes">Notes for interpreters</label>
          <textarea className="input" rows={4} value={draft.notes} onChange={(e) => set("notes", e.target.value)} {...control("notes")} />
          {error("notes")}
        </div>
        <p className="quiet">Times are in agency time (Eastern). The consumer's name, address and notes are only shown to confirmed interpreters.</p>
        <div className="button-row">
          <button type="submit" className="button" disabled={pending}>
            Save draft
          </button>
          <button type="button" className="button button--primary" disabled={pending} onClick={() => void save(true)}>
            Submit request
          </button>
        </div>
        <p className="live" role="status" aria-label="Request status">
          {message}
        </p>
      </form>
    </div>
  );
}
