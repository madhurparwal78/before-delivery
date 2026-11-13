import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { finishName, hubName, modelName } from "../shared/catalogue.js";
import { hourOnly, parseInstant, weekdayName, istDate } from "../shared/clock.js";
import { STATUS, deliverySet, inLine } from "../shared/copy.js";
import { shortDate } from "../shared/clock.js";
import { rupees } from "../shared/money.js";
import type { DeliveryDay, Lock, Ride } from "../shared/types.js";
import { follow, room } from "./live.js";
import { acting, applyLock, mine, refreshMine } from "./mine.js";
import { call } from "./net.js";
import { Link } from "./router.js";
import { screenNeedsSignIn, session, setReadsRiderData } from "./session.js";
import { RANK, announce } from "./status.js";
import { useStore } from "./store.js";
import { CellGrid } from "./ui.js";
import { DEFAULTS } from "../shared/catalogue.js";

const ACTIVE = new Set(["requested", "locked", "delivery_set"]);
const hoursText = (n: number): string => `${n} ${n === 1 ? "hour" : "hours"} left`;

function statementOf(locks: Lock[]): string {
  const locked = locks.filter((l) => l.state === "locked" && l.expiresAt).sort((a, b) => (parseInstant(a.expiresAt as string) as number) - (parseInstant(b.expiresAt as string) as number));
  if (locked[0]?.expiresAt) {
    const ms = parseInstant(locked[0].expiresAt) as number;
    return `Yours until ${weekdayName(istDate(ms))}, ${hourOnly(ms)} IST.`;
  }
  const set = locks.filter((l) => l.state === "delivery_set" && l.deliveryDate).sort((a, b) => (a.deliveryDate as string).localeCompare(b.deliveryDate as string));
  if (set[0]?.deliveryDate) return `Yours to collect on ${shortDate(set[0].deliveryDate)}.`;
  if (locks.some((l) => l.state === "requested")) return "The hub is checking your unit.";
  return "Your Garage is empty.";
}

// --- lock band

function LockBlock({ lock }: { lock: Lock }): JSX.Element {
  const user = useStore(session, (s) => s.user);
  const [sheetFailed, setSheetFailed] = useState(false);
  const [remindFailed, setRemindFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  if (lock.state === "requested") {
    return <p class="lede">{STATUS.checking}</p>;
  }

  const run = async <T,>(name: string, work: () => Promise<T>): Promise<T | null> => {
    if (busy) return null;
    setBusy(name);
    const out = await acting(work);
    setBusy(null);
    return out;
  };

  const release = async (): Promise<void> => {
    const r = await run("release", () => call<{ lock: Lock }>("POST", `/api/locks/${lock.id}/release`));
    if (!r) return;
    if (r.ok) {
      applyLock(r.data.lock);
      announce(STATUS.released, RANK.other);
      void refreshMine();
    } else if (r.status === 503) announce(STATUS.releaseRefused, RANK.other);
    else void refreshMine();
  };

  const makeSheet = async (): Promise<void> => {
    announce(STATUS.sheetPending, RANK.other);
    const r = await run("sheet", () => call<{ lock: Lock }>("POST", `/api/locks/${lock.id}/sheet`));
    if (!r) return;
    if (r.ok) {
      setSheetFailed(false);
      applyLock(r.data.lock);
      announce(STATUS.sheetReady, RANK.other);
    } else if (r.status === 503 || r.status === 0) {
      setSheetFailed(true);
      announce(STATUS.sheetFailed, RANK.other);
    } else void refreshMine();
  };

  const remind = async (): Promise<void> => {
    announce(STATUS.remindersPending, RANK.other);
    const r = await run("remind", () => call("POST", "/api/reminders"));
    if (!r) return;
    if (r.ok) {
      setRemindFailed(false);
      if (user) session.set({ user: { ...user, remindersOn: true } });
      announce(STATUS.remindersOn, RANK.other);
    } else if (r.status === 503 || r.status === 0) {
      setRemindFailed(true);
      announce(STATUS.remindersFailed, RANK.other);
    }
  };

  return (
    <div class="lock-block">
      <div class="band-numbers">
        <div class="figure">{rupees(lock.onRoadPaise)}</div>
        <div class="caption">
          <span>
            {modelName(lock.model)}, {finishName(lock.finish)} at {hubName(lock.hub)}
          </span>
          <span>
            Ex-showroom {rupees(lock.exShowroomPaise)}, road tax {rupees(lock.roadTaxPaise)}, insurance {rupees(lock.insurancePaise)}
          </span>
          {lock.state === "locked" ? (
            <span>
              {hoursText(lock.hoursLeft)}, until {lock.expiresLabel}
            </span>
          ) : null}
        </div>
      </div>
      <div class="row">
        {lock.state === "locked" ? (
          <button class="btn" type="button" aria-disabled={busy ? "true" : undefined} onClick={() => void release()}>
            Release this lock
          </button>
        ) : null}
        {!lock.sheetReady ? (
          <button class="btn" type="button" aria-disabled={busy ? "true" : undefined} onClick={() => void makeSheet()}>
            Make price sheet
          </button>
        ) : (
          <a class="btn" href={`/api/locks/${lock.id}/sheet`} download>
            Download price sheet
          </a>
        )}
        {user?.remindersOn ? (
          <span>Reminders on.</span>
        ) : (
          <button class="btn" type="button" aria-disabled={busy ? "true" : undefined} onClick={() => void remind()}>
            Turn on reminders
          </button>
        )}
      </div>
      {sheetFailed && !lock.sheetReady ? <p class="outage">{STATUS.sheetFailed}</p> : null}
      {remindFailed && !user?.remindersOn ? <p class="outage">{STATUS.remindersFailed}</p> : null}
    </div>
  );
}

// --- delivery band

function DeliveryBlock({ lock }: { lock: Lock }): JSX.Element {
  const [days, setDays] = useState<DeliveryDay[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useStore(room, (s) => s.drawn?.seq ?? 0);
  const asked = useRef(0);

  useEffect(() => {
    if (lock.state !== "locked") return;
    const mark = ++asked.current;
    void call<{ days: DeliveryDay[] }>("GET", `/api/locks/${lock.id}/delivery-days`).then((r) => {
      if (mark === asked.current && r.ok) setDays(r.data.days);
    });
  }, [lock.id, lock.state, lock.waitingFor, lock.waitPosition, seq]);

  // a chosen cell that closes or fills clears with the matching status
  useEffect(() => {
    if (!chosen || !days) return;
    const day = days.find((d) => d.date === chosen);
    if (!day) return;
    if (day.state === "closed") {
      setChosen(null);
      announce(STATUS.dayClosed, RANK.other);
    }
  }, [days, chosen]);
  const wasOpen = useRef<string | null>(null);
  useEffect(() => {
    const day = days?.find((d) => d.date === chosen);
    if (chosen && day?.state === "full" && wasOpen.current === chosen) {
      setChosen(null);
      announce(STATUS.dayFull, RANK.other);
    }
    wasOpen.current = chosen && day?.state === "open" ? chosen : null;
  }, [days, chosen]);

  if (lock.state === "delivery_set" && lock.deliveryDate) {
    return <p class="lede">{shortDate(lock.deliveryDate)}</p>;
  }
  if (lock.state !== "locked") return <></>;

  const day = days?.find((d) => d.date === chosen);
  const waitingHere = lock.waitingFor !== null && lock.waitingFor === chosen;
  const labelOf = (d: DeliveryDay): string =>
    d.state === "closed" ? `${d.dayLabel}, closed` : d.state === "full" ? `${d.dayLabel}, full` : `${d.dayLabel}, ${d.placesLeft} ${d.placesLeft === 1 ? "place" : "places"} left`;

  const report = (r: { code: string | null; status: number }): void => {
    if (r.code === "delivery_day_full") announce(STATUS.dayFull, RANK.other);
    else if (r.code === "delivery_day_closed") announce(STATUS.dayClosed, RANK.other);
    else if (r.code === "delivery_day_has_places") announce(STATUS.dayHasPlaces, RANK.other);
    else if (r.status === 503) announce(STATUS.deliveryRefused, RANK.other);
    setChosen(null);
    void refreshMine();
  };

  const setDay = async (): Promise<void> => {
    if (busy || !chosen || day?.state !== "open") return;
    setBusy(true);
    announce(STATUS.deliveryPending, RANK.other);
    const r = await acting(() => call<{ lock: Lock }>("POST", `/api/locks/${lock.id}/delivery`, { date: chosen }));
    setBusy(false);
    if (r.ok) {
      applyLock(r.data.lock);
      announce(deliverySet(chosen), RANK.other);
      setChosen(null);
      void refreshMine();
    } else report(r);
  };

  const wait = async (): Promise<void> => {
    if (busy || !chosen) return;
    setBusy(true);
    announce(STATUS.joining, RANK.other);
    const r = await acting(() => call<{ lock: Lock }>("POST", `/api/locks/${lock.id}/delivery/wait`, { date: chosen }));
    setBusy(false);
    if (r.ok) {
      applyLock(r.data.lock);
      if (r.data.lock.waitPosition && r.data.lock.waitingFor) announce(inLine(r.data.lock.waitPosition, r.data.lock.waitingFor), RANK.other);
      void refreshMine();
    } else report(r);
  };

  const leave = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    const r = await acting(() => call<{ lock: Lock }>("POST", `/api/locks/${lock.id}/delivery/wait/leave`));
    setBusy(false);
    if (r.ok) {
      applyLock(r.data.lock);
      announce(STATUS.leftLine, RANK.other);
      void refreshMine();
    } else void refreshMine();
  };

  return (
    <div class="delivery-block">
      {lock.waitingFor && lock.waitPosition ? (
        <div class="row">
          <p class="lede">
            Number {lock.waitPosition} in line for {shortDate(lock.waitingFor)}.
          </p>
          <button class="btn" type="button" onClick={() => void leave()}>
            Leave the line
          </button>
        </div>
      ) : null}
      <CellGrid
        label="Delivery days"
        className="delivery"
        cells={(days ?? []).map((d) => ({ key: d.date, label: labelOf(d), disabled: d.state === "closed", selected: chosen === d.date }))}
        onChoose={(key) => setChosen(key)}
      />
      <div class="row">
        <button class="btn primary" type="button" aria-disabled={!chosen || day?.state !== "open" ? "true" : undefined} onClick={() => void setDay()}>
          Set delivery day
        </button>
        {day?.state === "full" && !waitingHere ? (
          <button class="btn" type="button" onClick={() => void wait()}>
            Wait for a place
          </button>
        ) : null}
      </div>
    </div>
  );
}

// --- ride band

function RideBand({ rides, loading }: { rides: Ride[] | null; loading: boolean }): JSX.Element {
  const booked = (rides ?? []).filter((r) => r.state === "booked").sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  const done = (rides ?? []).filter((r) => r.state === "ridden" || r.state === "no_show").sort((a, b) => b.startsAt.localeCompare(a.startsAt))[0];
  const ride = booked ?? done;
  return (
    <section class="band" role="region" aria-label="Your ride">
      <h2>Ride</h2>
      {loading ? (
        <p class="muted">Reading your ride…</p>
      ) : ride ? (
        <div class="row">
          <div class="band-numbers">
            <div class="figure">{ride.state === "booked" ? "Booked" : ride.state === "ridden" ? "Ridden" : "No-show"}</div>
            <div class="caption">
              <span>
                {modelName(ride.model)} at {hubName(ride.hub)}
              </span>
              <span>
                {ride.dayLabel}, {ride.label}
              </span>
            </div>
          </div>
          {ride.state === "booked" ? (
            <Link class="link-action" href={`/test-ride?hub=${ride.hub}&model=${ride.model}&date=${ride.startsAt.slice(0, 10)}`}>
              Change this ride
            </Link>
          ) : null}
        </div>
      ) : (
        <div class="empty">
          <p class="lede">No ride booked.</p>
          <Link class="link-action" href="/test-ride">
            Pick a slot
          </Link>
        </div>
      )}
    </section>
  );
}

// --- the page

export function Garage(): JSX.Element {
  const user = useStore(session, (s) => s.user);
  const locks = useStore(mine, (s) => s.locks);
  const rides = useStore(mine, (s) => s.rides);
  const page = useRef<HTMLElement>(null);
  const last = useRef<{ el: HTMLElement; band: string } | null>(null);

  useEffect(() => {
    setReadsRiderData(true);
    return () => setReadsRiderData(false);
  }, []);
  useEffect(() => {
    if (!user) screenNeedsSignIn();
    else if (user.role === "rider") void refreshMine();
  }, [user?.id]);

  const loading = user !== null && locks === null;
  const active = (locks ?? []).filter((l) => ACTIVE.has(l.state));
  const ended = (locks ?? []).filter((l) => !ACTIVE.has(l.state));
  const sheeted = ended[0]?.sheetReady ? ended[0] : undefined;
  const firstHub = active[0]?.hub ?? DEFAULTS.hub;
  useEffect(() => {
    follow({ hub: firstHub, model: active[0]?.model ?? DEFAULTS.model, finish: DEFAULTS.finish });
  }, [firstHub]);

  // when a server change removes the focused control, focus moves to the first action now in that band
  useEffect(() => {
    const root = page.current;
    if (!root) return;
    const onIn = (e: FocusEvent): void => {
      const el = e.target as HTMLElement;
      const band = el.closest<HTMLElement>("[data-band]");
      if (band) last.current = { el, band: band.dataset.band as string };
    };
    root.addEventListener("focusin", onIn);
    return () => root.removeEventListener("focusin", onIn);
  }, []);
  useEffect(() => {
    const l = last.current;
    if (!l || l.el.isConnected || document.activeElement !== document.body) return;
    const band = page.current?.querySelector<HTMLElement>(`[data-band="${l.band}"]`);
    const next = band?.querySelector<HTMLElement>("a[href], button:not([disabled])");
    last.current = null;
    next?.focus();
  });

  if (user && user.role !== "rider") {
    return (
      <main class="work">
        <h1 class="lede">The Garage is for riders.</h1>
        <Link class="link-action" href="/showroom">
          Back to the showroom
        </Link>
      </main>
    );
  }

  return (
    <main class="work" ref={page}>
      <h1 class="lede">{statementOf(locks ?? [])}</h1>
      <div class="bands">
        <section class="band" role="region" aria-label="Your lock" data-band="lock">
          <h2>Lock</h2>
          {loading ? (
            <p class="muted">Reading your lock…</p>
          ) : active.length > 0 ? (
            active.map((l) => <LockBlock key={l.id} lock={l} />)
          ) : (
            <div class="empty">
              <p class="lede">Nothing is held for you yet.</p>
              <Link class="link-action" href="/showroom">
                Start the build
              </Link>
              {sheeted ? (
                <a class="btn" href={`/api/locks/${sheeted.id}/sheet`} download>
                  Download price sheet
                </a>
              ) : null}
            </div>
          )}
        </section>
        <RideBand rides={rides} loading={user !== null && rides === null} />
        <section class="band" role="region" aria-label="Your delivery" data-band="delivery">
          <h2>Delivery</h2>
          {loading ? (
            <p class="muted">Reading your delivery…</p>
          ) : active.length > 0 ? (
            active.map((l) => <DeliveryBlock key={l.id} lock={l} />)
          ) : (
            <div class="empty">
              <p class="lede">Lock a price to choose a day.</p>
              <Link class="link-action" href="/showroom">
                Start the build
              </Link>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
