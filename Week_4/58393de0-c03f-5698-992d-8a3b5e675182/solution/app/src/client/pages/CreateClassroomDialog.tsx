import { useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import { copy } from "../../shared/copy";
import { formatLocalWire, parseLocalTime, timeZoneNames } from "../../shared/rules";
import type { Classroom } from "../../shared/types";
import { Field } from "../forms/Field";
import { fieldErrors } from "../forms/fields";
import { api, ApiError } from "../lib/api";
import { useRouter } from "../lib/router";
import { useStatus } from "../lib/status";
import { Dialog } from "../ui/Dialog";

/** The Classroom page focuses its level-1 heading on arrival when this key holds its id. */
const FOCUS_HEADING_KEY = "qy-focus-heading";

const FIELDS = ["name", "timeZone", "joinOpensLocal", "joinClosesLocal", "handInLocal"] as const;
type CreateField = (typeof FIELDS)[number];
type TimeField = Extract<CreateField, `${string}Local`>;

const TIME_FIELDS: readonly { key: TimeField; label: string; placeholder: string }[] = [
  { key: "joinOpensLocal", label: "Join opens", placeholder: "Now" },
  { key: "joinClosesLocal", label: "Join closes", placeholder: "14 days after Join opens" },
  { key: "handInLocal", label: "Hand-in time", placeholder: "70 days after Join opens" },
];

/** The wire form of a typed local time; text that is not a real time goes up as typed so the server can refuse it. */
function wireTime(text: string): string {
  const parts = parseLocalTime(text);
  return parts ? formatLocalWire(parts) : text.trim();
}

function CreateForm({ defaultZone, onClose }: { defaultZone: string; onClose: () => void }) {
  const { navigate } = useRouter();
  const { announce } = useStatus();
  const zones = useMemo(timeZoneNames, []);
  const [name, setName] = useState("");
  const [timeZone, setTimeZone] = useState(defaultZone);
  const [times, setTimes] = useState<Record<TimeField, string>>({ joinOpensLocal: "", joinClosesLocal: "", handInLocal: "" });
  const [errors, setErrors] = useState<Partial<Record<CreateField, string>>>({});
  const [busy, setBusy] = useState(false);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (busy) return;
    setBusy(true);
    setErrors({});
    const typed = TIME_FIELDS.filter(({ key }) => times[key].trim() !== "").map(({ key }) => [key, wireTime(times[key])]);
    try {
      const created = await api.post<Classroom>("/api/classrooms", { name, timeZone, ...Object.fromEntries(typed) });
      sessionStorage.setItem(FOCUS_HEADING_KEY, created.id);
      announce(copy.created(created.name));
      onClose();
      navigate(`/classrooms/${created.id}`);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      if (error.code === "email_unverified") {
        announce(copy.unverifiedClassroom);
      } else {
        const found = fieldErrors(error, FIELDS);
        setErrors(found);
        const messages = Object.values(found);
        announce(messages.length > 0 ? messages.join(" ") : error.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const submitOnEnter = (event: KeyboardEvent<HTMLSelectElement>) => {
    if (event.key === "Enter") void submit();
  };

  return (
    <form onSubmit={(event) => void submit(event)} noValidate>
      <Field label="Classroom name" error={errors.name}>
        {(control) => <input {...control} type="text" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />}
      </Field>
      <Field label="Time zone" error={errors.timeZone}>
        {(control) => (
          <select {...control} value={timeZone} onChange={(e) => setTimeZone(e.target.value)} onKeyDown={submitOnEnter}>
            {zones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
          </select>
        )}
      </Field>
      <p className="hint dialog-hint">Times are 24-hour in this zone, like 2026-11-20 09:00. Leave one empty to use its default.</p>
      {TIME_FIELDS.map(({ key, label, placeholder }) => (
        <Field key={key} label={label} error={errors[key]}>
          {(control) => (
            <input
              {...control}
              type="text"
              autoComplete="off"
              placeholder={placeholder}
              value={times[key]}
              onChange={(e) => setTimes({ ...times, [key]: e.target.value })}
            />
          )}
        </Field>
      ))}
      <div className="dialog-actions">
        <button className="pill" type="submit" disabled={busy}>Save classroom</button>
        <button className="pill pill--outline" type="button" onClick={onClose}>Cancel</button>
      </div>
    </form>
  );
}

/** The Create classroom dialog: opened by whichever `Create classroom` pill the page shows. */
export function CreateClassroomDialog({ open, defaultZone, onClose }: { open: boolean; defaultZone: string; onClose: () => void }) {
  return (
    <Dialog open={open} title="Create classroom" onClose={onClose}>
      <CreateForm defaultZone={defaultZone} onClose={onClose} />
    </Dialog>
  );
}
