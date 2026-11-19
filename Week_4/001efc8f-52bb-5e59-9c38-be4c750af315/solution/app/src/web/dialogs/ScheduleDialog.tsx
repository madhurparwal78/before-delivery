import { useId, useState, type FormEvent } from "react";
import { api, ApiFailure, apiMessage } from "../api";
import { Dialog, ErrorSummary, FieldError, type FieldErrors } from "../components/Dialog";
import { notify } from "../store";
import { formatWhen } from "../../shared/when";
import type { Channel, Scheduled } from "../types";

// Date and time are typed in the workspace's business time zone; the server reads them there.
export function ScheduleDialog({ channel, zone, onClose, onScheduled }: { channel: Channel; zone: string; onClose: () => void; onScheduled: () => void }) {
  const [text, setText] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [weekly, setWeekly] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const ids = { text: useId(), date: useId(), time: useId(), repeat: useId(), textError: useId(), dateError: useId(), timeError: useId(), repeatError: useId() };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      const body = await api<{ scheduled: Scheduled }>("POST", `/api/channels/${channel.id}/scheduled`, {
        text,
        local_date: date,
        local_time: time,
        repeat: weekly ? "weekly" : "none",
      });
      notify(`Scheduled for ${formatWhen(zone, body.scheduled.upcoming_local[0] ?? "")}.`);
      onScheduled();
      onClose();
    } catch (failure) {
      setBusy(false);
      if (failure instanceof ApiFailure && failure.body?.errors) setErrors(failure.body.errors);
      else notify(apiMessage(failure));
    }
  };

  return (
    <Dialog title="Schedule post" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <ErrorSummary errors={errors} ids={{ text: ids.text, local_date: ids.date, local_time: ids.time, repeat: ids.repeat }} />
        <div className="field">
          <label htmlFor={ids.text}>Post text</label>
          <textarea
            id={ids.text}
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-invalid={errors.text ? true : undefined}
            aria-describedby={errors.text ? ids.textError : undefined}
          />
          <FieldError id={ids.textError} text={errors.text} />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor={ids.date}>Date</label>
            <input
              id={ids.date}
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              aria-invalid={errors.local_date ? true : undefined}
              aria-describedby={errors.local_date ? ids.dateError : undefined}
            />
            <FieldError id={ids.dateError} text={errors.local_date} />
          </div>
          <div className="field">
            <label htmlFor={ids.time}>Time</label>
            <input
              id={ids.time}
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              aria-invalid={errors.local_time ? true : undefined}
              aria-describedby={errors.local_time ? ids.timeError : undefined}
            />
            <FieldError id={ids.timeError} text={errors.local_time} />
          </div>
        </div>
        <label className="check" htmlFor={ids.repeat}>
          <input id={ids.repeat} type="checkbox" checked={weekly} onChange={(e) => setWeekly(e.target.checked)} aria-describedby={errors.repeat ? ids.repeatError : undefined} />
          <span>Repeat weekly</span>
        </label>
        <FieldError id={ids.repeatError} text={errors.repeat} />
        <p className="zone-line">Times are in {zone}</p>
        <div className="dialog-actions">
          <button className="button button-primary" type="submit" disabled={busy}>
            {busy ? "Scheduling…" : "Schedule"}
          </button>
          <button className="button button-quiet" type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}
