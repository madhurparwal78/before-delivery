// Care round (brief: Screens and layout › Care round; Interactions › Care round entry, Rows and
// cards that move, A car that leaves the round). The round re-reads every 15 s, also behind an open
// round-entry dialog, which keeps its car, values, focus and idempotency key.
import { useEffect, useRef, useState } from "react";
import type { CareRoundRow, Entry, Startup } from "../../shared/api.js";
import { FLAG_LABEL } from "../../shared/domain.js";
import { PRESSURE_SYMBOL } from "../../shared/units.js";
import { HttpError, Interrupted, NoAnswer, errorCode, get, request } from "../api.js";
import { applyInPlace, useIdempotencyKey, usePoll, useTwoPanes } from "../hooks.js";
import { IDEMPOTENCY_CONFLICT, NO_ANSWER, SIGNED_IN_AGAIN } from "../labels.js";
import { useSession } from "../session.js";
import { Dialog } from "../ui/Dialog.js";
import { ErrorSummary, FieldError, StartupBadge, StatusRegion, summaryOf, useNote } from "../ui/Feedback.js";

interface RoundCar {
  id: string;
  name: string;
}

export function CareRound(): JSX.Element {
  const [rows, setRows] = useState<CareRoundRow[] | null>(null);
  const [entryFor, setEntryFor] = useState<RoundCar | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [note, say] = useNote();
  const wide = useTwoPanes();
  const heading = useRef<HTMLHeadingElement>(null);
  const { user } = useSession();
  const canLog = user.role === "care_technician" || user.role === "house_manager";

  const read = async (firstLoad: boolean): Promise<void> => {
    const answer = await get<{ cars: CareRoundRow[] }>("/api/care-round", firstLoad);
    const fresh = JSON.stringify(answer.cars);
    setRows((current) => {
      if (current && JSON.stringify(current) === fresh) return current;
      return answer.cars;
    });
  };

  useEffect(() => {
    void read(true).catch(() => undefined);
  }, []);

  usePoll(async () => {
    const answer = await get<{ cars: CareRoundRow[] }>("/api/care-round");
    if (JSON.stringify(answer.cars) !== JSON.stringify(rows)) applyInPlace(() => setRows(answer.cars));
  }, 15_000);

  const opener = (car: RoundCar): JSX.Element =>
    canLog ? (
      <button
        type="button"
        className="button"
        data-car={car.id}
        onClick={() => setEntryFor(car)}
      >
        Log round entry<span className="visually-hidden"> for {car.name}</span>
      </button>
    ) : (
      <span />
    );

  const rowClass = (car: RoundCar): string =>
    [entryFor?.id === car.id ? "taped" : "", saved === car.id ? "just-saved" : ""].filter(Boolean).join(" ");

  return (
    <div className="screen">
      <header className="screen-header">
        <h1 ref={heading} tabIndex={-1}>
          Care round
        </h1>
        <StatusRegion name="Round updates" note={note} />
      </header>
      {rows === null ? (
        <div className="placeholder" aria-hidden="true" />
      ) : wide ? (
        <table aria-label="Care round" className="table round-table">
          <thead>
            <tr>
              <th scope="col">Car</th>
              <th scope="col">Bay</th>
              <th scope="col">Start-up</th>
              <th scope="col">Battery</th>
              <th scope="col">Flags</th>
              <th scope="col">
                <span className="visually-hidden">Round entry</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.car.id} data-row={row.car.id} className={rowClass(row.car)}>
                <td>{row.car.name}</td>
                <td className="mono-text">{row.bay_code}</td>
                <td>
                  <StartupBadge startup={row.startup} />
                </td>
                <td className="mono-text">{battery(row.last_entry)}</td>
                <td>{flags(row.last_entry)}</td>
                <td>{opener(row.car)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <ul aria-label="Care round" className="round-cards">
          {rows.map((row) => (
            <li key={row.car.id} data-row={row.car.id} className={`round-card ${rowClass(row.car)}`}>
              <p className="round-card-name">{row.car.name}</p>
              <p className="mono-text">{`Bay ${row.bay_code}`}</p>
              <StartupBadge startup={row.startup} />
              <p className="mono-text">{`Battery ${battery(row.last_entry)}`}</p>
              <p>{flags(row.last_entry)}</p>
              {opener(row.car)}
            </li>
          ))}
        </ul>
      )}
      {rows && rows.length === 0 ? <p className="empty">No cars are in a bay.</p> : null}
      {entryFor ? (
        <RoundEntry
          car={entryFor}
          say={say}
          fallbackFocus={() => heading.current}
          returnFocus={() => document.querySelector<HTMLElement>(`button[data-car="${CSS.escape(entryFor.id)}"]`)}
          onClose={() => setEntryFor(null)}
          onSaved={() => {
            setSaved(entryFor.id);
            setEntryFor(null);
            void read(false).catch(() => undefined);
          }}
        />
      ) : null}
    </div>
  );
}

function battery(entry: Entry | null): string {
  return entry?.battery_v ? `${entry.battery_v} V` : "—";
}

function flags(entry: Entry | null): string {
  return entry && entry.flags.length ? entry.flags.map((flag) => FLAG_LABEL[flag]).join(", ") : "None";
}

const ENTRY_FIELDS = ["entry", "battery_v", "tyres", "note"];
const TYRES = [
  ["fl", "Front left tyre"],
  ["fr", "Front right tyre"],
  ["rl", "Rear left tyre"],
  ["rr", "Rear right tyre"],
] as const;

function RoundEntry({
  car,
  say,
  onClose,
  onSaved,
  fallbackFocus,
  returnFocus,
}: {
  car: RoundCar;
  say: (text: string, tone?: "info" | "error") => void;
  onClose: () => void;
  onSaved: () => void;
  fallbackFocus: () => HTMLElement | null;
  returnFocus: () => HTMLElement | null;
}): JSX.Element {
  const { units } = useSession();
  const [started, setStarted] = useState(false);
  const [volts, setVolts] = useState("");
  const [tyres, setTyres] = useState({ fl: "", fr: "", rl: "", rr: "" });
  const [text, setText] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const key = useIdempotencyKey();

  const save = async (): Promise<void> => {
    say("Saving round entry...");
    const anyTyre = Object.values(tyres).some((value) => value.trim() !== "");
    const blank = (value: string): string | null => (value.trim() === "" ? null : value.trim());
    const body = {
      started,
      battery_v: blank(volts),
      tyres: anyTyre
        ? { unit: units.pressure, fl: blank(tyres.fl), fr: blank(tyres.fr), rl: blank(tyres.rl), rr: blank(tyres.rr) }
        : null,
      note: text,
    };
    try {
      const answer = await request<{ entry: Entry; startup: Startup; message: string }>(`/api/cars/${car.id}/care-entries`, {
        method: "POST",
        body,
        idempotencyKey: key.take(),
      });
      key.discard();
      onSaved();
      say(answer.data.message);
    } catch (error) {
      if (error instanceof NoAnswer) {
        say(NO_ANSWER.round, "error");
        return;
      }
      if (error instanceof Interrupted) {
        say(SIGNED_IN_AGAIN);
        return;
      }
      key.discard();
      const code = errorCode(error);
      if (code === "car_not_stored") {
        onClose();
        say("This car is no longer in a bay.", "error");
      } else if (code === "idempotency_conflict") say(IDEMPOTENCY_CONFLICT, "error");
      else if (error instanceof HttpError && error.status === 422) {
        setErrors(error.fields);
        say(Object.values(error.fields)[0] ?? "", "error");
      }
    }
  };

  const unit = PRESSURE_SYMBOL[units.pressure];
  return (
    <Dialog title={`Round entry: ${car.name}`} onClose={onClose} fallbackFocus={fallbackFocus} returnFocus={returnFocus}>
      <form
        className="form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <ErrorSummary items={summaryOf(errors, ENTRY_FIELDS)} idFor={(field) => `entry-${field.replace(/[^a-z_]/g, "-")}`} />
        <p id="entry-entry" tabIndex={-1} className="sub">
          Record a start-up, a battery voltage or all four tyre pressures.
        </p>
        <label className="check">
          <input type="checkbox" checked={started} onChange={(event) => setStarted(event.target.checked)} />
          Started the engine
        </label>
        <div className="field">
          <label htmlFor="entry-battery_v">Battery voltage (V)</label>
          <input id="entry-battery_v" type="text" inputMode="decimal" value={volts} onChange={(event) => setVolts(event.target.value)} />
          <FieldError id="entry-battery-error" message={errors.battery_v} />
        </div>
        <fieldset className="tyres" id="entry-tyres" tabIndex={-1}>
          <legend>Tyre pressures</legend>
          <div className="form-grid">
            {TYRES.map(([position, label]) => (
              <div className="field" key={position}>
                <label htmlFor={`entry-tyre-${position}`}>{`${label} (${unit})`}</label>
                <input
                  id={`entry-tyre-${position}`}
                  type="text"
                  inputMode="decimal"
                  value={tyres[position]}
                  onChange={(event) => setTyres({ ...tyres, [position]: event.target.value })}
                />
              </div>
            ))}
          </div>
          <FieldError id="entry-tyres-error" message={errors.tyres} />
        </fieldset>
        <div className="field">
          <label htmlFor="entry-note">Note</label>
          <input id="entry-note" type="text" value={text} onChange={(event) => setText(event.target.value)} />
          <FieldError id="entry-note-error" message={errors.note} />
        </div>
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary">
            Save entry
          </button>
        </div>
      </form>
    </Dialog>
  );
}
