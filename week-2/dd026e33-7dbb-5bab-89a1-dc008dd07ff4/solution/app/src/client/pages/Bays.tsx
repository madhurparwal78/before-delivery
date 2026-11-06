// Bays (brief: Screens and layout › Bays; Interactions › Search cars): the floor plan, the searchable
// Cars table whose settled search lives in the address, and Register car.
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { Bay, Car } from "../../shared/api.js";
import { carName } from "../../shared/domain.js";
import { DISTANCE_SYMBOL, PRESSURE_SYMBOL } from "../../shared/units.js";
import { HttpError, Interrupted, NoAnswer, get, request } from "../api.js";
import { FloorPlan } from "../FloorPlan.js";
import { CAR_STATUS_LABEL, SIGNED_IN_AGAIN } from "../labels.js";
import { navigate, replaceQuery } from "../router.js";
import { useSession } from "../session.js";
import { Link } from "../Shell.js";
import { Dialog } from "../ui/Dialog.js";
import { ErrorSummary, FieldError, StatusRegion, summaryOf, useNote } from "../ui/Feedback.js";

export function Bays(): JSX.Element {
  const { user } = useSession();
  const initialQuery = new URLSearchParams(window.location.search).get("q") ?? "";
  const [query, setQuery] = useState(initialQuery);
  const [cars, setCars] = useState<Car[] | null>(null);
  const [bays, setBays] = useState<Bay[] | null>(null);
  const [registering, setRegistering] = useState(false);
  const [searching, setSearching] = useState(false);
  const [note, say] = useNote();
  const latest = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const canRegister = user.role === "concierge" || user.role === "house_manager";

  const search = async (text: string, announce: boolean): Promise<void> => {
    const sequence = ++latest.current;
    const answering = get<{ cars: Car[]; total: number }>(`/api/cars${text ? `?q=${encodeURIComponent(text)}` : ""}`, !announce);
    // The table says it is updating from the moment the search is sent until its answer lands.
    flushSync(() => setSearching(true));
    const answer = await answering.finally(() => {
      if (sequence === latest.current) setSearching(false);
    });
    if (sequence !== latest.current) return;
    setCars(answer.cars);
    replaceQuery(text ? `q=${encodeURIComponent(text)}` : "");
    if (announce) say(answer.total === 1 ? "1 car found." : `${answer.total} cars found.`);
  };

  useEffect(() => {
    void search(initialQuery, false).catch(() => undefined);
    get<{ bays: Bay[] }>("/api/bays", true).then((answer) => setBays(answer.bays), () => setBays([]));
    return () => window.clearTimeout(timer.current);
    // First load only: later searches come from typing.
  }, []);

  const type = (text: string): void => {
    setQuery(text);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void search(text, true).catch(() => undefined), 300);
  };

  return (
    <div className="screen">
      <header className="screen-header">
        <h1>Bays</h1>
        <StatusRegion name="Bay updates" note={note} />
      </header>
      {/* The layout lands whole once the floor plan has its bays, so nothing already shown moves. */}
      {bays === null ? (
        <div className="placeholder" aria-hidden="true" />
      ) : (
      <div className="bays-layout">
        <section className="bays-plan" aria-labelledby="bays-plan-heading">
          <h2 id="bays-plan-heading" className="section-heading">
            Floor plan
          </h2>
          <FloorPlan bays={bays} onActivate={(bay) => bay.car && navigate(`/cars/${bay.car.id}`)} />
        </section>
        <section className="bays-cars" aria-labelledby="bays-cars-heading">
          <div className="section-head-row">
            <h2 id="bays-cars-heading" className="section-heading">
              Cars
            </h2>
            {canRegister ? (
              <button type="button" className="button primary" onClick={() => setRegistering(true)}>
                Register car
              </button>
            ) : null}
          </div>
          <div className="field">
            <label htmlFor="search-cars">Search cars</label>
            <input id="search-cars" type="search" value={query} autoComplete="off" onChange={(event) => type(event.target.value)} />
          </div>
          <table aria-label="Cars" className="table" aria-busy={searching}>
            <thead>
              <tr>
                <th scope="col">Car</th>
                <th scope="col">Status</th>
                <th scope="col">Bay</th>
              </tr>
            </thead>
            <tbody>
              {cars === null ? (
                <tr className="placeholder-row" aria-hidden="true">
                  <td colSpan={3} />
                </tr>
              ) : (
                cars.map((car) => (
                  <tr key={car.id}>
                    <td>
                      <Link to={`/cars/${car.id}`}>{car.name}</Link>
                      <span className="sub mono-text">{car.registration}</span>
                    </td>
                    <td>{CAR_STATUS_LABEL[car.status]}</td>
                    <td className="mono-text">{car.bay?.code ?? "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {cars && cars.length === 0 ? <p className="empty">No cars match this search.</p> : null}
        </section>
      </div>
      )}
      {registering ? (
        <RegisterCar
          onClose={() => setRegistering(false)}
          say={say}
          onRegistered={() => {
            setRegistering(false);
            void search(query, false).catch(() => undefined);
          }}
        />
      ) : null}
    </div>
  );
}

const REGISTER_FIELDS = ["owner_id", "year", "make", "model", "registration", "colour", "length_mm", "width_mm", "odometer.value", "tyre_spec.value"];

function fieldId(field: string): string {
  return `register-${field.replace(/[^a-z_]/g, "-")}`;
}

function wholeOrText(text: string): number | string {
  return /^\d+$/.test(text.trim()) ? Number(text.trim()) : text;
}

function RegisterCar({
  onClose,
  onRegistered,
  say,
}: {
  onClose: () => void;
  onRegistered: () => void;
  say: (text: string, tone?: "info" | "error") => void;
}): JSX.Element {
  const { units } = useSession();
  const [owners, setOwners] = useState<{ id: string; name: string }[]>([]);
  const [form, setForm] = useState({
    owner_id: "",
    year: "",
    make: "",
    model: "",
    registration: "",
    colour: "",
    length_mm: "",
    width_mm: "",
    odometer: "",
    tyre: "",
    startup_schedule: false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    get<{ owners: { id: string; name: string }[] }>("/api/owners").then(
      (answer) => {
        setOwners(answer.owners);
        setForm((current) => (current.owner_id ? current : { ...current, owner_id: answer.owners[0]?.id ?? "" }));
      },
      () => undefined,
    );
  }, []);

  const set = (key: keyof typeof form, value: string | boolean): void => setForm({ ...form, [key]: value });

  const submit = async (): Promise<void> => {
    say("Registering car...");
    const body = {
      owner_id: form.owner_id,
      year: wholeOrText(form.year),
      make: form.make,
      model: form.model,
      registration: form.registration,
      colour: form.colour,
      length_mm: wholeOrText(form.length_mm),
      width_mm: wholeOrText(form.width_mm),
      odometer: { value: form.odometer, unit: units.distance },
      tyre_spec: { value: form.tyre, unit: units.pressure },
      startup_schedule: form.startup_schedule,
    };
    try {
      const answer = await request<{ car: Car }>("/api/cars", { method: "POST", body });
      setErrors({});
      onRegistered();
      say(`${carName(answer.data.car)} registered.`);
    } catch (error) {
      if (error instanceof HttpError && error.status === 422) {
        setErrors(error.fields);
        say(Object.values(error.fields)[0] ?? "", "error");
      } else if (error instanceof Interrupted) say(SIGNED_IN_AGAIN);
      else if (error instanceof NoAnswer) say("No answer from the server. Press Register again.", "error");
      else if (error instanceof HttpError) say("This owner could not be found. Choose another owner.", "error");
    }
  };

  const text = (key: "make" | "model" | "registration" | "colour", label: string, field: string = key): JSX.Element => (
    <div className="field">
      <label htmlFor={fieldId(field)}>{label}</label>
      <input
        id={fieldId(field)}
        type="text"
        value={form[key]}
        aria-invalid={errors[field] ? true : undefined}
        onChange={(event) => set(key, event.target.value)}
      />
      <FieldError id={`${fieldId(field)}-error`} message={errors[field]} />
    </div>
  );

  const number = (key: "year" | "length_mm" | "width_mm", label: string): JSX.Element => (
    <div className="field">
      <label htmlFor={fieldId(key)}>{label}</label>
      <input
        id={fieldId(key)}
        type="number"
        inputMode="numeric"
        value={form[key]}
        aria-invalid={errors[key] ? true : undefined}
        onChange={(event) => set(key, event.target.value)}
      />
      <FieldError id={`${fieldId(key)}-error`} message={errors[key]} />
    </div>
  );

  return (
    <Dialog title="Register car" onClose={onClose} wide>
      <form
        className="form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <ErrorSummary items={summaryOf(errors, REGISTER_FIELDS)} idFor={fieldId} />
        <div className="field">
          <label htmlFor={fieldId("owner_id")}>Owner</label>
          <select id={fieldId("owner_id")} value={form.owner_id} onChange={(event) => set("owner_id", event.target.value)}>
            {owners.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.name}
              </option>
            ))}
          </select>
          <FieldError id="register-owner-error" message={errors.owner_id} />
        </div>
        <div className="form-grid">
          {number("year", "Year")}
          {text("make", "Make")}
          {text("model", "Model")}
          {text("registration", "Registration")}
          {text("colour", "Colour")}
          {number("length_mm", "Length (mm)")}
          {number("width_mm", "Width (mm)")}
          <div className="field">
            <label htmlFor={fieldId("odometer.value")}>{`Odometer (${DISTANCE_SYMBOL[units.distance]})`}</label>
            <input
              id={fieldId("odometer.value")}
              type="text"
              inputMode="numeric"
              value={form.odometer}
              aria-invalid={errors["odometer.value"] ? true : undefined}
              onChange={(event) => set("odometer", event.target.value)}
            />
            <FieldError id="register-odometer-error" message={errors["odometer.value"]} />
          </div>
          <div className="field">
            <label htmlFor={fieldId("tyre_spec.value")}>{`Tyre pressure (${PRESSURE_SYMBOL[units.pressure]})`}</label>
            <input
              id={fieldId("tyre_spec.value")}
              type="text"
              inputMode="decimal"
              value={form.tyre}
              aria-invalid={errors["tyre_spec.value"] ? true : undefined}
              onChange={(event) => set("tyre", event.target.value)}
            />
            <FieldError id="register-tyre-error" message={errors["tyre_spec.value"]} />
          </div>
        </div>
        <label className="check">
          <input type="checkbox" checked={form.startup_schedule} onChange={(event) => set("startup_schedule", event.target.checked)} />
          Start-up schedule
        </label>
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary">
            Register
          </button>
        </div>
      </form>
    </Dialog>
  );
}
