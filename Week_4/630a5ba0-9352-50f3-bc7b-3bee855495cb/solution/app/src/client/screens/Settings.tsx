import { useEffect, useId, useState, type FormEvent } from "react";
import { Copy, Plus, RotateCw, Trash2 } from "lucide-react";
import type { Routine } from "../../shared/types.js";
import { dayLabel, isTime } from "../../shared/time.js";
import { api, ApiFailure, SERVER_ERROR } from "../api.js";
import { announce } from "../announce.js";
import type { Me } from "../App.js";
import { Dialog } from "../components/Dialog.js";
import { Field, ZoneSelect } from "../components/Field.js";

function DaySettings({ me, onSaved }: { me: Me; onSaved: () => Promise<void> }) {
  const [zone, setZone] = useState(me.member.timeZone);
  const [threshold, setThreshold] = useState(String(me.member.thresholdMinutes));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const thresholdId = useId();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const minutes = Number(threshold);
    if (!(Number.isInteger(minutes) && minutes >= 60 && minutes <= 960 && minutes % 15 === 0)) {
      setErrors({ thresholdMinutes: "Use 60 to 960 minutes in steps of 15." });
      return;
    }
    setPending(true);
    setErrors({});
    try {
      const result = await api<{ today: string }>("PATCH", "/api/me", { body: { timeZone: zone, thresholdMinutes: minutes } });
      announce(`Settings saved. Today is ${dayLabel(result.today)} in ${zone}.`);
      await onSaved();
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.status === 422) setErrors(failure.fields);
      else announce(SERVER_ERROR);
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="settings-section" aria-labelledby={`${thresholdId}-title`}>
      <h2 id={`${thresholdId}-title`} className="section-title">
        Day settings
      </h2>
      <form aria-label="Day settings" onSubmit={(event) => void submit(event)} noValidate>
        <ZoneSelect value={zone} onChange={setZone} error={errors.timeZone} />
        <Field
          label="Workload threshold (minutes)"
          type="number"
          inputMode="numeric"
          min={60}
          max={960}
          step={15}
          value={threshold}
          error={errors.thresholdMinutes}
          hint="Your Waterline's tidemark: 60 to 960 minutes, in steps of 15."
          onChange={(e) => setThreshold(e.currentTarget.value)}
        />
        <button type="submit" className="button button-primary" aria-busy={pending} disabled={pending}>
          {pending ? "Saving…" : "Save settings"}
        </button>
      </form>
    </section>
  );
}

function Feed() {
  const [url, setUrl] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const fieldId = useId();

  useEffect(() => {
    api<{ url: string }>("GET", "/api/feed")
      .then((data) => setUrl(data.url))
      .catch(() => announce(SERVER_ERROR));
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      announce("Feed URL copied.");
    } catch {
      announce("Couldn't copy. Select the URL and copy it yourself.");
    }
  };

  const rotate = async () => {
    setPending(true);
    try {
      const data = await api<{ url: string }>("POST", "/api/feed/rotate");
      setUrl(data.url);
      setConfirming(false);
      announce("Feed URL rotated. The old URL has stopped working.");
    } catch {
      announce(SERVER_ERROR);
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="settings-section" aria-label="Calendar feed">
      <h2 className="section-title">Calendar feed</h2>
      <p className="muted">Subscribe to this private address in another calendar app to see your timed sessions and routines there.</p>
      <div className="field">
        <label className="field-label" htmlFor={fieldId}>
          Feed URL
        </label>
        <input id={fieldId} className="input mono feed-url" type="text" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
      </div>
      <div className="button-row">
        <button type="button" className="button" onClick={() => void copy()}>
          <Copy aria-hidden="true" size={18} /> Copy feed URL
        </button>
        <button type="button" className="button" onClick={() => setConfirming(true)}>
          <RotateCw aria-hidden="true" size={18} /> Rotate feed URL
        </button>
      </div>
      <Dialog title="Rotate feed URL?" alert open={confirming} onClose={() => setConfirming(false)}>
        <p>Calendar apps using the old URL will stop updating.</p>
        <div className="dialog-actions">
          <button type="button" className="button button-strong" aria-busy={pending} disabled={pending} onClick={() => void rotate()}>
            {pending ? "Rotating…" : "Rotate"}
          </button>
          <button type="button" className="button" onClick={() => setConfirming(false)}>
            Keep current URL
          </button>
        </div>
      </Dialog>
    </section>
  );
}

type RoutineForm = { name: string; startTime: string; minutes: string; repeats: "daily" | "weekdays" };
const EMPTY: RoutineForm = { name: "", startTime: "", minutes: "30", repeats: "daily" };

function Routines() {
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<RoutineForm>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const repeatsId = useId();

  const load = () =>
    api<{ routines: Routine[] }>("GET", "/api/routines")
      .then((data) => setRoutines(data.routines))
      .catch(() => announce(SERVER_ERROR));

  useEffect(() => {
    void load();
  }, []);

  const open = () => {
    setForm(EMPTY);
    setErrors({});
    setAdding(true);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const minutes = Number(form.minutes);
    const local: Record<string, string> = {};
    if (!form.name.trim()) local.name = "Enter a name.";
    else if (form.name.trim().length > 80) local.name = "Keep the name to 80 characters or fewer.";
    if (!isTime(form.startTime)) local.startTime = "Use a start time written as HH:MM.";
    if (!(Number.isInteger(minutes) && minutes >= 5 && minutes <= 240 && minutes % 5 === 0)) local.durationMinutes = "Use 5 to 240 minutes in steps of 5.";
    setErrors(local);
    if (Object.keys(local).length) return;
    setPending(true);
    try {
      const result = await api<{ routine: Routine }>("POST", "/api/routines", {
        body: { name: form.name.trim(), startTime: form.startTime, durationMinutes: minutes, repeats: form.repeats },
      });
      announce(`Added routine ${result.routine.name} at ${result.routine.startTime}.`);
      setAdding(false);
      await load();
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.status === 422) setErrors(failure.fields);
      else if (failure instanceof ApiFailure && failure.code === "workspace_read_only") announce("This workspace is read-only. Planning resumes when the subscription is active.");
      else announce(SERVER_ERROR);
    } finally {
      setPending(false);
    }
  };

  const remove = async (routine: Routine) => {
    try {
      await api("DELETE", `/api/routines/${routine.id}`);
      announce(`Deleted routine ${routine.name}.`);
      await load();
    } catch (failure) {
      announce(failure instanceof ApiFailure && failure.code === "workspace_read_only" ? "This workspace is read-only. Planning resumes when the subscription is active." : SERVER_ERROR);
    }
  };

  return (
    <section className="settings-section" aria-label="Routines">
      <h2 className="section-title">Routines</h2>
      <p className="muted">Routines hold the same local time on every day they apply, through daylight-saving changes.</p>
      {routines.length ? (
        <ul className="routine-list">
          {routines.map((r) => (
            <li key={r.id} className="routine">
              <span className="routine-line">
                {r.name} · <span className="mono">{r.startTime}</span> · <span className="mono">{r.durationMinutes}m</span> · {r.repeats === "daily" ? "Every day" : "Weekdays"}
              </span>
              <button type="button" className="button button-quiet button-icon" aria-label={`Delete routine ${r.name}`} onClick={() => void remove(r)}>
                <Trash2 aria-hidden="true" size={18} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty">No routines yet.</p>
      )}
      <button type="button" className="button" onClick={open}>
        <Plus aria-hidden="true" size={18} /> Add routine
      </button>
      <Dialog title="Add routine" open={adding} onClose={() => setAdding(false)}>
        <form onSubmit={(event) => void save(event)} noValidate>
          <Field label="Name" value={form.name} maxLength={80} error={errors.name} onChange={(e) => setForm({ ...form, name: e.currentTarget.value })} />
          <Field label="Start time" type="time" step={300} value={form.startTime} error={errors.startTime} onChange={(e) => setForm({ ...form, startTime: e.currentTarget.value })} />
          <Field
            label="Minutes"
            type="number"
            inputMode="numeric"
            min={5}
            max={240}
            step={5}
            value={form.minutes}
            error={errors.durationMinutes}
            onChange={(e) => setForm({ ...form, minutes: e.currentTarget.value })}
          />
          <fieldset className="field radio-row" role="radiogroup" aria-labelledby={repeatsId}>
            <legend id={repeatsId} className="field-label">
              Repeats
            </legend>
            {(["daily", "weekdays"] as const).map((value) => (
              <label key={value} className="radio">
                <input type="radio" name="repeats" checked={form.repeats === value} onChange={() => setForm({ ...form, repeats: value })} />
                <span>{value === "daily" ? "Every day" : "Weekdays"}</span>
              </label>
            ))}
          </fieldset>
          <div className="dialog-actions">
            <button type="submit" className="button button-strong" aria-busy={pending} disabled={pending}>
              {pending ? "Saving…" : "Save routine"}
            </button>
            <button type="button" className="button" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </form>
      </Dialog>
    </section>
  );
}

export function Settings({ me, onSaved }: { me: Me; onSaved: () => Promise<void> }) {
  return (
    <div className="settings">
      <h1 className="page-title">Settings</h1>
      <DaySettings me={me} onSaved={onSaved} />
      <Feed />
      <Routines />
    </div>
  );
}
