import { type FormEvent, useState } from "react";
import type { EventView, IndexTableView } from "../../shared/api.js";
import { EVENT_STATUS_LABEL } from "../../shared/lifecycle.js";
import { tableInForce } from "../../shared/rules.js";
import { ApiFailure, api } from "../api.js";
import { Dialog } from "../components/Dialog.js";
import { Field, type FieldErrors, FixFields } from "../components/Forms.js";
import {
  EmptyState,
  LoadFailed,
  Skeleton,
  StatusRegion,
} from "../components/ui.js";
import { useRefresh } from "../hooks.js";
import { Link } from "../router.js";
import { isStaff, useUser } from "../session.js";

export function Events() {
  const user = useUser();
  const [events, setEvents] = useState<EventView[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");
  const reload = useRefresh(
    async () => {
      try {
        setEvents(
          (await api.get<{ events: EventView[] }>("/api/events")).events,
        );
        setFailed(false);
      } catch {
        setFailed(true);
      }
    },
    10,
    [],
  );
  return (
    <>
      <div className="page-head">
        <h1>Events</h1>
        {isStaff(user, "chair") ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setCreating(true)}
          >
            New event
          </button>
        ) : null}
      </div>
      <StatusRegion name="Event updates">{message}</StatusRegion>
      {events === null ? (
        failed ? (
          <LoadFailed retry={reload} />
        ) : (
          <Skeleton />
        )
      ) : events.length === 0 ? (
        <EmptyState
          next={
            isStaff(user, "chair")
              ? "Create one with New event, then open registration."
              : "The chair has not opened an event yet. Check back once one is listed."
          }
        >
          No events yet.
        </EmptyState>
      ) : (
        <ul className="event-list">
          {events.map((event) => (
            <li key={event.id}>
              <Link href={`/events/${event.id}`} className="event-link">
                <span className="event-name">{event.name}</span>
                <span className="event-meta mono">{event.date}</span>
                <span className="event-meta">{event.venue}</span>
                <span className="badge">
                  {EVENT_STATUS_LABEL[event.status]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {creating ? (
        <NewEvent
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            setMessage("Event saved as draft.");
            reload();
          }}
          onStatus={setMessage}
        />
      ) : null}
    </>
  );
}

const FIELD_LABELS = {
  name: "Event name",
  date: "Date",
  venue: "Venue",
  registrationCutoff: "Registration cutoff",
  runsPerDriver: "Runs per driver",
  heats: "Heats",
  stations: "Stations",
} as const;

/** Accept the date and time joined by `T`, by a space, or by ` at `. */
function normalizeCutoff(text: string): string {
  return text
    .trim()
    .replace(/^(\d{4}-\d{2}-\d{2})\s+(?:at\s+)?(\d{2}:\d{2})$/, "$1T$2");
}

function NewEvent({
  onClose,
  onSaved,
  onStatus,
}: {
  onClose: () => void;
  onSaved: () => void;
  onStatus: (message: string) => void;
}) {
  const [tables, setTables] = useState<IndexTableView[]>([]);
  useRefresh(
    async () =>
      setTables(
        (await api.get<{ tables: IndexTableView[] }>("/api/index-tables"))
          .tables,
      ),
    3600,
    [],
  );
  const [values, setValues] = useState({
    name: "",
    date: "",
    venue: "",
    registrationCutoff: "",
    runsPerDriver: "2",
    heats: "2",
    stations: "",
  });
  const [assigned, setAssigned] = useState<Record<string, number>>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState("");

  const heatCount = Math.max(2, Math.min(4, Number(values.heats) || 2));
  const classes = Object.keys(tableInForce(tables, values.date)?.factors ?? {});

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setPending(true);
    onStatus("Saving event");
    setErrors({});
    setFailure("");
    const heats = Array.from({ length: Number(values.heats) }, (_, index) => ({
      number: index + 1,
      classes: classes.filter((code) => assigned[code] === index + 1),
    }));
    try {
      await api.post("/api/events", {
        name: values.name,
        date: values.date.trim(),
        venue: values.venue,
        registrationCutoff: normalizeCutoff(values.registrationCutoff),
        runsPerDriver: Number(values.runsPerDriver),
        heats,
        stations: values.stations
          .split("\n")
          .map((s) => s.trim())
          .filter((s) => s !== ""),
      });
      onSaved();
    } catch (error) {
      onStatus("");
      if (error instanceof ApiFailure && error.status === 422)
        setErrors(error.fields);
      else setFailure("Could not save the event. Try again.");
    } finally {
      setPending(false);
    }
  };
  const bind = (field: keyof typeof values) => ({
    value: values[field],
    onChange: (e: { target: { value: string } }) =>
      setValues({ ...values, [field]: e.target.value }),
  });
  return (
    <Dialog title="New event" onClose={onClose}>
      <form
        id="new-event"
        aria-label="New event form"
        onSubmit={(e) => void submit(e)}
        noValidate
      >
        <FixFields form="event" errors={errors} />
        <Field
          form="event"
          name="name"
          label={FIELD_LABELS.name}
          error={errors["name"]}
        >
          {(p) => <input type="text" {...p} {...bind("name")} />}
        </Field>
        <Field
          form="event"
          name="date"
          label={FIELD_LABELS.date}
          error={errors["date"]}
          hint="YYYY-MM-DD"
        >
          {(p) => (
            <input type="text" inputMode="numeric" {...p} {...bind("date")} />
          )}
        </Field>
        <Field
          form="event"
          name="venue"
          label={FIELD_LABELS.venue}
          error={errors["venue"]}
        >
          {(p) => <input type="text" {...p} {...bind("venue")} />}
        </Field>
        <Field
          form="event"
          name="registrationCutoff"
          label={FIELD_LABELS.registrationCutoff}
          error={errors["registrationCutoff"]}
          hint="Club time, YYYY-MM-DDTHH:MM"
        >
          {(p) => <input type="text" {...p} {...bind("registrationCutoff")} />}
        </Field>
        <div className="field-pair">
          <Field
            form="event"
            name="runsPerDriver"
            label={FIELD_LABELS.runsPerDriver}
            error={errors["runsPerDriver"]}
          >
            {(p) => (
              <input
                type="number"
                min={1}
                max={6}
                {...p}
                {...bind("runsPerDriver")}
              />
            )}
          </Field>
          <Field
            form="event"
            name="heats"
            label={FIELD_LABELS.heats}
            error={errors["heats"]}
          >
            {(p) => (
              <input type="number" min={2} max={4} {...p} {...bind("heats")} />
            )}
          </Field>
        </div>
        {classes.length > 0 ? (
          <fieldset className="class-heats">
            <legend>Heat for each class</legend>
            {classes.map((code) => (
              <div className="field" key={code}>
                <label htmlFor={`event-heat-${code}`}>Heat for {code}</label>
                <select
                  id={`event-heat-${code}`}
                  value={assigned[code] ?? 0}
                  onChange={(e) =>
                    setAssigned({ ...assigned, [code]: Number(e.target.value) })
                  }
                >
                  <option value={0}>Not run</option>
                  {Array.from({ length: heatCount }, (_, index) => (
                    <option key={index} value={index + 1}>
                      Heat {index + 1}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </fieldset>
        ) : null}
        <Field
          form="event"
          name="stations"
          label={FIELD_LABELS.stations}
          error={errors["stations"]}
          hint="One station per line"
        >
          {(p) => <textarea rows={4} {...p} {...bind("stations")} />}
        </Field>
        {failure ? (
          <div role="alert" className="form-alert">
            {failure}
          </div>
        ) : null}
        <div className="dialog-actions">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={pending}
            aria-busy={pending}
          >
            Save event
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}
