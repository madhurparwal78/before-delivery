import { type FormEvent, useState } from "react";
import { announce, PRIORITY } from "../announce";
import { request } from "../api";
import { SERVER_ERROR } from "../copy";
import { SelectField } from "../components/Fields";
import { useLive } from "../hooks";
import { setApp, useApp } from "../store";

const HOURS = Array.from({ length: 16 }, (_, i) => i + 6);
const hourLabel = (hour: number): string => `${hour % 12 || 12}:00 ${hour < 12 ? "am" : "pm"}`;

export function Settings() {
  const me = useApp((s) => s.me)!;
  const [hour, setHour] = useState(String(me.reminder_hour));
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  useLive((event) => {
    if (event.type === "practice") {
      setHour(String(event.reminder_hour));
      setApp({ me: { ...me, reminder_hour: event.reminder_hour } });
    }
  });

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const answer = await request<{ reminder_hour: number }>("PATCH", "/api/practice", { reminder_hour: Number(hour) });
    if (answer.ok) {
      setError(undefined);
      announce("Reminder hour saved.");
    } else if (answer.failure.kind === "fields") {
      setError(answer.failure.errors.reminder_hour);
      announce(answer.failure.errors.reminder_hour, PRIORITY.fieldError);
    } else announce(SERVER_ERROR, PRIORITY.fieldError);
    setBusy(false);
  };

  return (
    <main className="settings">
      <h1>Settings</h1>
      <form onSubmit={submit} noValidate className="panel">
        <p className="muted">Reminders go out at this hour on the practice's Central clock, before the 7-day and 1-day marks.</p>
        <SelectField label="Reminder hour" value={hour} onChange={setHour} error={error}
          options={HOURS.map((h) => ({ value: String(h), label: hourLabel(h) }))} />
        <button type="submit" className="button primary" aria-disabled={busy}>{busy ? "Saving" : "Save reminder hour"}</button>
      </form>
    </main>
  );
}
