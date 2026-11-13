import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { DEFAULTS, HUBS, MODELS, isHub, isModel, type HubId, type ModelId } from "../shared/catalogue.js";
import { FIELD, STATUS, rideBooked } from "../shared/copy.js";
import type { Ride, RideDay, SlotsReply } from "../shared/types.js";
import { follow, room } from "./live.js";
import { acting, applyRide, mine, refreshMine } from "./mine.js";
import { call } from "./net.js";
import { ensureSignedIn, requestSignIn, session } from "./session.js";
import { RANK, announce } from "./status.js";
import { useStore } from "./store.js";
import { CellGrid, Choice, Pick } from "./ui.js";
import { Link } from "./router.js";

const SLOT_KEY = /^([01]\d|2[0-3]):[0-5]\d$/;
const slotOf = (startsAt: string): string => startsAt.slice(11, 16);

type Faults = { number?: string; until?: string; mcwg?: string };

function readUrl(search: string): { hub: HubId; model: ModelId; date: string | null; slot: string | null } {
  const q = new URLSearchParams(search);
  const hub = q.get("hub");
  const model = q.get("model");
  return { hub: isHub(hub) ? hub : DEFAULTS.hub, model: isModel(model) ? model : DEFAULTS.model, date: q.get("date"), slot: q.get("slot") };
}

/** What a rider typed into the server-drawn form before the script took it over. */
const typedBeforeHydration = (name: string): string =>
  typeof document === "undefined" ? "" : document.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)?.value ?? "";

export function TestRide({ search }: { search: string }): JSX.Element {
  const start = useRef(readUrl(search));
  const [hub, setHub] = useState<HubId>(start.current.hub);
  const [model, setModel] = useState<ModelId>(start.current.model);
  const [date, setDate] = useState<string | null>(start.current.date);
  const [slot, setSlot] = useState<string | null>(start.current.slot);
  const [days, setDays] = useState<RideDay[] | null>(null);
  const [slots, setSlots] = useState<SlotsReply | null>(null);
  const [number, setNumber] = useState(() => typedBeforeHydration("Licence number"));
  const [until, setUntil] = useState(() => typedBeforeHydration("Licence valid until"));
  const firstRun = useRef(true);
  const [mcwg, setMcwg] = useState(false);
  const [faults, setFaults] = useState<Faults>({});
  const [busy, setBusy] = useState(false);
  const resetKey = useStore(session, (s) => s.resetKey);
  const seq = useStore(room, (s) => s.drawn?.seq ?? 0);
  const rides = useStore(mine, (s) => s.rides);
  const asked = useRef(0);
  const askedDays = useRef(0);
  const slotRef = useRef(slot);
  slotRef.current = slot;

  const active: Ride | undefined = rides?.filter((r) => r.state === "booked" && r.model === model && r.hub === hub)[0];

  useEffect(() => {
    follow({ hub, model, finish: DEFAULTS.finish });
  }, [hub, model]);

  // licence fields start empty on every load and clear when a different account takes over
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    setNumber("");
    setUntil("");
    setMcwg(false);
    setFaults({});
  }, [resetKey]);

  // ride days
  useEffect(() => {
    const mark = ++askedDays.current;
    void call<{ days: RideDay[] }>("GET", `/api/hubs/${hub}/ride-days`).then((r) => {
      if (mark !== askedDays.current || !r.ok) return;
      setDays(r.data.days);
    });
  }, [hub, seq]);

  // the day: keep a chosen day that is still offered, otherwise move to the first offered one
  useEffect(() => {
    if (!days || days.length === 0) return;
    if (date && days.some((d) => d.date === date)) return;
    const had = slotRef.current;
    setDate(days[0]!.date);
    if (had) {
      setSlot(null);
      if (date) announce(STATUS.slotClosed, RANK.other);
    }
  }, [days, date]);

  // slots for the chosen day, newest choice wins
  useEffect(() => {
    if (!date) return;
    const mark = ++asked.current;
    void call<SlotsReply>("GET", `/api/hubs/${hub}/slots?date=${date}`).then((r) => {
      if (mark !== asked.current || !r.ok) return;
      setSlots(r.data);
    });
  }, [hub, date, seq]);

  // a chosen cell that is no longer available clears, with the matching status
  useEffect(() => {
    if (!slots || slots.date !== date || !slot) return;
    const cell = slots.slots.find((s) => slotOf(s.startsAt) === slot);
    if (!SLOT_KEY.test(slot) || !cell) {
      setSlot(null);
      return;
    }
    if (cell.state === "taken") {
      setSlot(null);
      announce(STATUS.slotTaken, RANK.other);
    } else if (cell.state === "past_cut_off") {
      setSlot(null);
      announce(STATUS.slotClosed, RANK.other);
    }
  }, [slots, slot, date]);

  // the URL holds the choices
  useEffect(() => {
    if (!date) return;
    const next = `/test-ride?hub=${hub}&model=${model}&date=${date}${slot ? `&slot=${slot}` : ""}`;
    if (location.pathname + location.search !== next) history.replaceState(history.state, "", next);
  }, [hub, model, date, slot]);

  const cells = (slots?.open ? slots.slots : []).map((s) => ({
    key: slotOf(s.startsAt),
    label: s.label,
    disabled: s.state !== "free",
    selected: slot === slotOf(s.startsAt),
  }));
  const dayFull = slots !== null && slots.open && slots.slots.every((s) => s.state !== "free");
  const startsAtOf = (key: string): string | null => slots?.slots.find((s) => slotOf(s.startsAt) === key)?.startsAt ?? null;

  const reread = (): void => {
    asked.current += 1;
    const mark = asked.current;
    void call<SlotsReply>("GET", `/api/hubs/${hub}/slots?date=${date}`).then((r) => {
      if (mark === asked.current && r.ok) setSlots(r.data);
    });
  };

  const refusal = (code: string | null, status: number, moving: boolean): void => {
    if (code === "slot_taken") announce(STATUS.slotTaken, RANK.other);
    else if (code === "ride_cut_off") announce(moving && slot && slots?.slots.find((s) => slotOf(s.startsAt) === slot)?.state === "free" ? STATUS.rideLocked : STATUS.slotClosed, RANK.other);
    else if (code === "ride_exists") announce(STATUS.rideExists, RANK.other);
    else if (status === 503) announce(STATUS.rideRefused, RANK.other);
    reread();
    void refreshMine();
  };

  const book = async (): Promise<void> => {
    if (busy) return;
    if (!(await ensureSignedIn())) {
      requestSignIn();
      return;
    }
    const startsAt = slot ? startsAtOf(slot) : null;
    if (!startsAt) return;
    setBusy(true);
    setFaults({});
    announce(STATUS.ridePending, RANK.other);
    const r = await acting(() => call<{ ride: Ride }>("POST", "/api/rides", { hub, model, startsAt, licenceNumber: number, licenceValidUntil: until, hasMcwg: mcwg }));
    setBusy(false);
    if (r.ok) {
      applyRide(r.data.ride);
      announce(rideBooked(r.data.ride.startsAt), RANK.other);
      setSlot(null);
      reread();
      void refreshMine();
    } else if (r.code === "licence_invalid") setFaults({ number: FIELD.licenceNumber });
    else if (r.code === "licence_expired") setFaults({ until: FIELD.licenceDate });
    else if (r.code === "mcwg_required") setFaults({ mcwg: FIELD.mcwg });
    else if (r.code === "invalid_body") setFaults({ until: FIELD.licenceDate });
    else if (r.code !== "unauthenticated" && r.code !== "session_ended") refusal(r.code, r.status, false);
  };

  const move = async (): Promise<void> => {
    if (busy || !active) return;
    if (!(await ensureSignedIn())) {
      requestSignIn();
      return;
    }
    const startsAt = slot ? startsAtOf(slot) : null;
    if (!startsAt) return;
    setBusy(true);
    announce(STATUS.ridePending, RANK.other);
    const r = await acting(() => call<{ ride: Ride }>("POST", `/api/rides/${active.id}/move`, { startsAt }));
    setBusy(false);
    if (r.ok) {
      applyRide(r.data.ride);
      announce(rideBooked(r.data.ride.startsAt), RANK.other);
      setSlot(null);
      reread();
      void refreshMine();
    } else if (r.code !== "unauthenticated" && r.code !== "session_ended") refusal(r.code, r.status, true);
  };

  const cancel = async (): Promise<void> => {
    if (busy || !active) return;
    if (!(await ensureSignedIn())) {
      requestSignIn();
      return;
    }
    setBusy(true);
    const r = await acting(() => call<{ ride: Ride }>("POST", `/api/rides/${active.id}/cancel`));
    setBusy(false);
    if (r.ok) {
      applyRide(r.data.ride);
      announce(STATUS.rideCancelled, RANK.other);
      reread();
      void refreshMine();
    } else if (r.code === "ride_cut_off") {
      announce(STATUS.rideLocked, RANK.other);
      reread();
    } else if (r.code !== "unauthenticated" && r.code !== "session_ended") refusal(r.code, r.status, true);
  };

  const nextDay = (): void => {
    const i = days?.findIndex((d) => d.date === date) ?? -1;
    const next = days?.[i + 1];
    if (next) {
      setDate(next.date);
      setSlot(null);
    }
  };

  return (
    <main class="work">
      <h1 class="lede">Pick the hour you ride it.</h1>
      <div class="row">
        <Pick
          label="Hub city"
          visible
          value={hub}
          options={HUBS}
          onChange={(v) => {
            setHub(v);
            setSlot(null);
            setSlots(null);
          }}
        />
        <div class="field-label">
          <span>Model</span>
          <Choice label="Model" value={model} options={MODELS} onChange={(v) => setModel(v)} />
        </div>
        <label class="field-label">
          <span>Ride day</span>
          <span class="select">
            <select
              aria-label="Ride day"
              value={date ?? ""}
              onChange={(e) => {
                setDate((e.target as HTMLSelectElement).value);
                setSlot(null);
              }}
            >
              {(days ?? []).map((d) => (
                <option key={d.date} value={d.date}>
                  {d.dayLabel}
                </option>
              ))}
            </select>
          </span>
        </label>
      </div>

      {dayFull ? (
        <div class="empty">
          <p class="lede">Every slot on this day is taken.</p>
          <button class="btn primary" type="button" onClick={nextDay}>
            Try the next day
          </button>
        </div>
      ) : (
        <CellGrid label="Test-ride slots" cells={cells} onChoose={(key) => setSlot(key)} />
      )}

      <div class="form">
        <label class="field-label">
          <span>Licence number</span>
          <input class="input" type="text" role="textbox" aria-label="Licence number" autocomplete="off" value={number} aria-invalid={faults.number ? "true" : undefined} onInput={(e) => setNumber((e.target as HTMLInputElement).value)} />
          {faults.number ? <span class="fault">{faults.number}</span> : null}
        </label>
        <label class="field-label">
          <span>Licence valid until</span>
          <input class="input" type="text" role="textbox" aria-label="Licence valid until" placeholder="YYYY-MM-DD" autocomplete="off" value={until} aria-invalid={faults.until ? "true" : undefined} onInput={(e) => setUntil((e.target as HTMLInputElement).value)} />
          {faults.until ? <span class="fault">{faults.until}</span> : null}
        </label>
        <div>
          <label class="check">
            <input type="checkbox" checked={mcwg} aria-label="My licence covers motorcycles with gear (MCWG)" onChange={(e) => setMcwg((e.target as HTMLInputElement).checked)} />
            <span>My licence covers motorcycles with gear (MCWG)</span>
          </label>
          {faults.mcwg ? <span class="fault">{faults.mcwg}</span> : null}
        </div>
        <div class="row">
          {active ? (
            <>
              <button class="btn primary" type="button" aria-disabled={busy || !slot ? "true" : undefined} onClick={() => !busy && slot && void move()}>
                Move this ride
              </button>
              <button class="btn" type="button" aria-disabled={busy ? "true" : undefined} onClick={() => void cancel()}>
                Cancel this ride
              </button>
            </>
          ) : (
            <button class="btn primary" type="button" aria-disabled={busy ? "true" : undefined} onClick={() => void book()}>
              Book this ride
            </button>
          )}
          <Link class="link-quiet" href="/garage">
            See it in the Garage
          </Link>
        </div>
      </div>
    </main>
  );
}
