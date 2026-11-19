import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from "react";
import type { BookingMode, PriceRange, Ride, Vehicle } from "../../shared/api";
import { euros, plural, roundHalfUp50 } from "../../shared/money";
import { addDays, brusselsInstant, isoBrussels, todayOf, type CalendarDay } from "../../shared/time";
import { announce } from "../lib/announce";
import { pageConfig } from "../lib/config";
import { ApiError, api, errorMessage } from "../lib/http";
import { navigate } from "../lib/router";
import { useSession } from "../lib/session";
import { showToast } from "../lib/toasts";
import { Alert, FieldError, PageHeading } from "../ui/Bits";
import { Combobox } from "../ui/Combobox";
import { DateField } from "../ui/DatePicker";
import { Stepper } from "../ui/Stepper";

function middle(low: number, high: number): number {
  return roundHalfUp50(Math.floor((low + high) / 2));
}

export function OfferPage(): ReactElement | null {
  const session = useSession();
  const today = todayOf(session.serverNow);
  const member = session.member;
  const [vehicles, setVehicles] = useState<Vehicle[] | null>(null);
  const [vehicleId, setVehicleId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [stopovers, setStopovers] = useState<string[]>([]);
  const [range, setRange] = useState<PriceRange | null>(null);
  const [rangeError, setRangeError] = useState("");
  const [price, setPrice] = useState(0);
  const [seats, setSeats] = useState(3);
  const [date, setDate] = useState<CalendarDay>(() => addDays(today, 1));
  const [time, setTime] = useState("08:00");
  const [mode, setMode] = useState<BookingMode>("instant");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const focusTarget = useRef<{ city: string; act: string } | null>(null);

  useEffect(() => {
    if (!member) navigate(`/sign-in?next=${encodeURIComponent("/offer")}`, true);
  }, [member]);

  const loadVehicles = async (): Promise<void> => {
    const reply = await api<{ vehicles: Vehicle[] }>("GET", "/api/vehicles");
    setVehicles(reply.vehicles);
    setVehicleId((current) => current || reply.vehicles[0]?.id || "");
  };

  useEffect(() => {
    if (member) void loadVehicles();
  }, [member]);

  const vehicle = vehicles?.find((v) => v.id === vehicleId);
  const seatCap = Math.min(4, vehicle?.seats ?? 4);
  useEffect(() => {
    if (vehicle) setSeats((s) => Math.min(s, seatCap) || 1);
  }, [vehicle, seatCap]);

  const route = from && to ? [from, ...stopovers, to] : null;
  const routeKey = route?.join(",") ?? "";
  useEffect(() => {
    if (!routeKey) {
      setRange(null);
      return undefined;
    }
    let current = true;
    api<PriceRange>("GET", `/api/price-range?stops=${encodeURIComponent(routeKey)}`)
      .then((reply) => {
        if (!current) return;
        setRange(reply);
        setRangeError("");
        setPrice(middle(reply.low_cents, reply.high_cents));
      })
      .catch((e: unknown) => {
        if (!current) return;
        setRange(null);
        setRangeError(errorMessage(e));
      });
    return () => {
      current = false;
    };
  }, [routeKey]);

  useLayoutEffect(() => {
    const target = focusTarget.current;
    if (!target) return;
    focusTarget.current = null;
    document.querySelector<HTMLElement>(`[data-city="${target.city}"][data-act="${target.act}"]`)?.focus();
  });

  if (!member) return null;

  const move = (city: string, delta: -1 | 1): void => {
    const index = stopovers.indexOf(city);
    const target = index + delta;
    focusTarget.current = { city, act: delta < 0 ? "up" : "down" };
    if (target < 0 || target >= stopovers.length) {
      setStopovers([...stopovers]);
      return;
    }
    const next = [...stopovers];
    next.splice(index, 1);
    next.splice(target, 0, city);
    setStopovers(next);
    announce(`${city} moved to stop ${target + 1} of ${next.length}`);
  };

  const remove = (city: string): void => {
    const index = stopovers.indexOf(city);
    setStopovers(stopovers.filter((c) => c !== city));
    announce(`${city} removed. Undo is available for ${plural(pageConfig.toastSeconds, "second")}.`);
    showToast({
      text: `${city} removed`,
      actionLabel: "Undo",
      onExpire: () => undefined,
      onAction: () => {
        setStopovers((list) => {
          const at = Math.min(index, list.length);
          const next = [...list];
          next.splice(at, 0, city);
          announce(`${city} restored to stop ${at + 1}`);
          return next;
        });
        focusTarget.current = { city, act: "remove" };
      },
    });
  };

  const publish = async (): Promise<void> => {
    if (pending) return;
    setError("");
    const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
    if (!match) {
      setFields({ departure: "Enter the time as HH:MM." });
      setError("Check the highlighted fields.");
      return;
    }
    setPending(true);
    setFields({});
    try {
      const instant = brusselsInstant(date.year, date.month, date.day, Number(match[1]), Number(match[2]));
      const ride = await api<Ride>("POST", "/api/rides", {
        body: { vehicle_id: vehicleId, stops: route ?? [], departure: isoBrussels(instant), seats, price_cents: price, booking_mode: mode },
      });
      navigate(`/rides/${ride.id}`);
    } catch (e) {
      setError(errorMessage(e));
      if (e instanceof ApiError) setFields(e.fields);
      setPending(false);
    }
  };

  const saveCar = async (body: { make_model: string; colour: string; seats: number }): Promise<void> => {
    const car = await api<Vehicle>("POST", "/api/vehicles", { body });
    setVehicleId(car.id);
    await loadVehicles();
  };

  return (
    <div className="offer-page">
      <PageHeading>Offer a ride</PageHeading>
      <form
        className="stack-form"
        onSubmit={(event) => {
          event.preventDefault();
          void publish();
        }}
      >
        {vehicles && vehicles.length === 0 ? (
          <CarForm onSave={saveCar} />
        ) : (
          <div className="field">
            <label htmlFor="vehicle">Vehicle</label>
            <select id="vehicle" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
              {(vehicles ?? []).map((v) => (
                <option key={v.id} value={v.id}>
                  {`${v.make_model}, ${v.colour}, ${plural(v.seats, "seat")}`}
                </option>
              ))}
            </select>
            <FieldError id="vehicle-error" message={fields.vehicle_id} />
          </div>
        )}

        <Combobox label="Leaving from" value={from} onSelect={setFrom} />
        <Combobox label="Going to" value={to} onSelect={setTo} />
        <Combobox
          label="Add a stopover"
          value=""
          clearOnSelect
          exclude={[from, to, ...stopovers]}
          onSelect={(city) => setStopovers((list) => [...list, city])}
        />
        <FieldError id="stops-error" message={fields.stops} />
        <ul className="stopovers" aria-label="Stopovers">
          {stopovers.map((city, index) => (
            <li key={city} data-id={city}>
              <span className="stopover-name">{city}</span>
              <div className="actions">
                <button type="button" data-city={city} data-act="up" aria-label={`Move ${city} up`} aria-disabled={index === 0 || undefined} onClick={() => move(city, -1)}>
                  Up
                </button>
                <button type="button" data-city={city} data-act="down" aria-label={`Move ${city} down`} aria-disabled={index === stopovers.length - 1 || undefined} onClick={() => move(city, 1)}>
                  Down
                </button>
                <button type="button" data-city={city} data-act="remove" aria-label={`Remove ${city}`} onClick={() => remove(city)}>
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>

        <DateField value={date} today={today} onChange={setDate} />
        <div className="field">
          <label htmlFor="departure">Departure time</label>
          <input id="departure" type="text" inputMode="numeric" autoComplete="off" value={time} onChange={(e) => setTime(e.target.value)} aria-describedby="departure-error" />
          <FieldError id="departure-error" message={fields.departure} />
        </div>

        <Stepper
          label="Seats"
          value={seats}
          min={1}
          max={seatCap}
          step={1}
          pageStep={2}
          format={String}
          onChange={setSeats}
          topNote="This is the most."
          bottomNote="This is the fewest."
          decreaseLabel="Fewer seats"
          increaseLabel="More seats"
          describedBy="seats-error"
        />
        <FieldError id="seats-error" message={fields.seats} />

        <div className="price-block">
          <Stepper
            label="Price per seat"
            value={price}
            min={range?.low_cents ?? 0}
            max={range?.high_cents ?? 0}
            step={50}
            pageStep={500}
            format={euros}
            disabled={!range}
            onChange={setPrice}
            topNote="This is the top of the recommended range."
            bottomNote="This is the bottom of the recommended range."
            decreaseLabel="Lower price"
            increaseLabel="Higher price"
            describedBy="price-error"
          />
          {range ? <p className="muted">{`Recommended: ${euros(range.low_cents)} to ${euros(range.high_cents)} for ${range.route_km} km`}</p> : null}
          <FieldError id="price-error" message={fields.price_cents} />
          <Alert>{rangeError}</Alert>
        </div>

        <div role="radiogroup" aria-label="Booking mode" className="radios">
          <p className="field-label">Booking mode</p>
          <label className="check">
            <input type="radio" name="mode" checked={mode === "instant"} onChange={() => setMode("instant")} />
            <span>Instant booking</span>
          </label>
          <label className="check">
            <input type="radio" name="mode" checked={mode === "request"} onChange={() => setMode("request")} />
            <span>Review each request</span>
          </label>
        </div>

        <div className="actions">
          <button type="submit" className="primary">
            {pending ? "Working" : "Publish ride"}
          </button>
        </div>
        <Alert>{error}</Alert>
      </form>
    </div>
  );
}

function CarForm({ onSave }: { onSave: (car: { make_model: string; colour: string; seats: number }) => Promise<void> }): ReactElement {
  const [makeModel, setMakeModel] = useState("");
  const [colour, setColour] = useState("");
  const [seats, setSeats] = useState(3);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});

  const save = async (): Promise<void> => {
    if (pending) return;
    setPending(true);
    setError("");
    setFields({});
    try {
      await onSave({ make_model: makeModel, colour, seats });
    } catch (e) {
      setError(errorMessage(e));
      if (e instanceof ApiError) setFields(e.fields);
    } finally {
      setPending(false);
    }
  };

  return (
    <fieldset className="car-form">
      <legend>Your car</legend>
      <div className="field">
        <label htmlFor="car-make">Car make and model</label>
        <input id="car-make" type="text" value={makeModel} onChange={(e) => setMakeModel(e.target.value)} />
        <FieldError id="car-make-error" message={fields.make_model} />
      </div>
      <div className="field">
        <label htmlFor="car-colour">Car colour</label>
        <input id="car-colour" type="text" value={colour} onChange={(e) => setColour(e.target.value)} />
        <FieldError id="car-colour-error" message={fields.colour} />
      </div>
      <Stepper label="Car seats" value={seats} min={1} max={4} step={1} pageStep={2} format={String} onChange={setSeats}
        topNote="This is the most." bottomNote="This is the fewest." decreaseLabel="Fewer car seats" increaseLabel="More car seats" />
      <button type="button" onClick={() => void save()}>
        {pending ? "Working" : "Save car"}
      </button>
      <Alert>{error}</Alert>
    </fieldset>
  );
}
