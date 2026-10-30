// The Dial screen: day bar, Service Dial with the floor plan, and the "Selected instant" rail.
import { ChevronLeft, ChevronRight, Crosshair } from "lucide-preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { DialDay, DialStation, Hold, Policy, Tenant, User } from "../../shared/api";
import { BOOK_AHEAD_DAYS, DAY_MINUTES, DIAL_PAST_DAYS, STEP_MINUTES } from "../../shared/kitchen";
import { addDays, daysBetween, hhmm, isKitchenDate } from "../../shared/time";
import { api, useServerNow } from "../api";
import { act } from "../feedback";
import { FloorPlan } from "../dial/FloorPlan";
import { HoldPanel, type HoldEnd } from "../dial/HoldPanel";
import { PlaceHoldDialog, TimeListbox } from "../dial/PlaceHoldDialog";
import { Ring } from "../dial/Ring";
import { placeHold } from "../dial/holds";
import { STATE_WORDS, clampMinute, isFullBlock, openCount, stationStateAt, type StationState, type TileKind } from "../dial/model";
import { useReducedMotion } from "../store";
import { Eyebrow, PendingLine } from "../ui/parts";

type LoadMode = "first" | "now" | "change" | "background";

export function DialScreen({ user }: { user: User }) {
  const reduced = useReducedMotion();
  const now = useServerNow(1000);
  const [day, setDay] = useState<DialDay | null>(null);
  const [minute, setMinute] = useState(0);
  const [direction, setDirection] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [hold, setHold] = useState<Hold | null>(null);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  const [loads, setLoads] = useState(0);
  const [dialogOpener, setDialogOpener] = useState<HTMLElement | null | undefined>(undefined);
  const [preset, setPreset] = useState<{ start: number; end: number } | null>(null);
  const requested = useRef<string | null>(null);
  const minuteRef = useRef(minute);
  minuteRef.current = minute;
  const dialBox = useRef<HTMLDivElement>(null);
  const isOperator = user.role === "operator";

  const load = useCallback(async (target: string | null, mode: LoadMode): Promise<void> => {
    requested.current = target;
    const outcome = await act(
      {
        pending: mode === "background" ? undefined : "Loading the day…",
        source: "day",
        error: () => "Couldn't load the day. Retrying in 30 seconds.",
      },
      () => api<DialDay>("GET", target ? `/api/dial?date=${target}` : "/api/dial"),
    );
    if (!outcome.ok) return;
    const value = outcome.value;
    if (requested.current !== null && requested.current !== value.date) return;
    requested.current = value.date;
    setDay(value);
    setLoads((n) => n + 1);
    if (mode === "first" || mode === "now") {
      const step = Math.floor((value.now_minute ?? 0) / STEP_MINUTES) * STEP_MINUTES;
      setDirection(step >= minuteRef.current ? 1 : -1);
      setMinute(step);
    }
  }, []);

  const refresh = useCallback(() => void load(requested.current, "background"), [load]);

  useEffect(() => {
    void load(null, "first");
    const timer = setInterval(() => void load(requested.current, "background"), 30_000);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!isOperator) return;
    void act({}, () => api<{ tenants: Tenant[] }>("GET", "/api/tenants")).then((outcome) => {
      if (outcome.ok) setTenants(outcome.value.tenants.filter((t) => t.status === "active"));
    });
  }, [isOperator]);

  useEffect(() => {
    if (!hold) return;
    void act({}, () => api<{ current: Policy }>("GET", "/api/cancellation-policy")).then((outcome) => {
      if (outcome.ok) setPolicy(outcome.value.current);
    });
  }, [hold?.ref]);

  const turnTo = useCallback((next: number) => {
    const value = clampMinute(next);
    setDirection(value >= minuteRef.current ? 1 : -1);
    setMinute(value);
  }, []);

  useEffect(() => {
    const box = dialBox.current;
    if (!box) return;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      if (event.deltaY === 0) return;
      turnTo(minuteRef.current + (event.deltaY > 0 ? STEP_MINUTES : -STEP_MINUTES));
    };
    box.addEventListener("wheel", onWheel, { passive: false });
    return () => box.removeEventListener("wheel", onWheel);
  }, [turnTo]);

  const stations = day?.stations ?? [];
  const today = day?.today ?? null;
  const date = day?.date ?? null;
  const minDate = today ? addDays(today, -DIAL_PAST_DAYS) : null;
  const maxDate = today ? addDays(today, BOOK_AHEAD_DAYS) : null;

  const changeDay = (target: string): void => {
    if (!today || !minDate || !maxDate) return;
    if (daysBetween(minDate, target) < 0 || daysBetween(target, maxDate) < 0) return;
    void load(target, "change");
  };
  const shiftDay = (days: number): void => {
    const base = requested.current ?? date;
    if (base) changeDay(addDays(base, days));
  };

  const selectedStation = stations.find((s) => s.id === selected) ?? null;
  const selectedState = selectedStation ? stationStateAt(selectedStation, minute) : null;
  const open = openCount(stations, minute);
  const valueText = `${hhmm(minute)}, ${open} of ${stations.length} open`;
  const canHold = selectedState?.kind === "free" && minute < DAY_MINUTES;

  const select = (stationId: string): void => {
    setSelected(stationId);
    const station = stations.find((s) => s.id === stationId);
    const state = station ? stationStateAt(station, minute) : null;
    if (state && state.kind === "held" && isFullBlock(state.block) && state.block.hold_ref !== hold?.ref) {
      const ref = state.block.hold_ref;
      void act({ error: () => false }, () => api<Hold>("GET", `/api/holds/${encodeURIComponent(ref)}`)).then((outcome) => {
        if (outcome.ok) setHold(outcome.value);
      });
    }
  };

  const placed = (value: Hold): void => {
    setHold(value);
    refresh();
  };

  const onArc = async (start: number, end: number): Promise<boolean> => {
    if (!selectedStation || !date) return false;
    if (isOperator) {
      // The operator books for a tenant, so the drawn times finish in the dialog where the tenant is chosen.
      setPreset({ start, end });
      setDialogOpener(dialBox.current?.querySelector<HTMLElement>("[role=slider]") ?? null);
      return false;
    }
    const outcome = await placeHold(
      {
        station_id: selectedStation.id,
        date,
        start_local: hhmm(start),
        end_local: hhmm(end),
        weeks: 1,
        notes: "",
      },
      selectedStation.name,
    );
    if (outcome.ok) placed(outcome.value);
    return outcome.ok;
  };

  const onHoldEnd = (_end: HoldEnd): void => {
    setHold(null);
    refresh();
  };

  const holdStation = hold ? stations.find((s) => s.id === hold.station_id) : null;

  return (
    <div class="dial-screen">
      <div class="dial-column">
        <div class="daybar">
          <h1 class="screen-title">Dial</h1>
          <div class="day-controls">
            <button
              type="button"
              class="btn btn-icon"
              aria-label="Previous day"
              disabled={!date || date === minDate}
              onClick={() => shiftDay(-1)}
            >
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
            <label class="day-field">
              <span class="day-label">Day</span>
              <input
                type="date"
                class="mono"
                value={date ?? ""}
                min={minDate ?? undefined}
                max={maxDate ?? undefined}
                onChange={(e) => {
                  const value = e.currentTarget.value;
                  if (isKitchenDate(value) && value !== date) changeDay(value);
                }}
              />
            </label>
            <button
              type="button"
              class="btn btn-icon"
              aria-label="Next day"
              disabled={!date || date === maxDate}
              onClick={() => shiftDay(1)}
            >
              <ChevronRight size={18} aria-hidden="true" />
            </button>
            <button type="button" class="btn" onClick={() => void load(null, "now")}>
              <Crosshair size={16} aria-hidden="true" />
              Now
            </button>
          </div>
        </div>
        <div class="dial" ref={dialBox}>
          {day && (
            <>
              <Ring
                value={minute}
                valueText={valueText}
                reduced={reduced}
                onChange={turnTo}
                canDraw={canHold}
                onArc={onArc}
                blocks={selectedStation?.blocks ?? []}
                resetKey={`${date}|${selected}|${loads}`}
              />
              <FloorPlan
                stations={stations}
                minute={minute}
                selected={selected}
                onSelect={select}
                reduced={reduced}
                now={now}
                readoutTime={hhmm(minute)}
                readoutOpen={open}
                readoutTotal={stations.length}
                direction={direction}
              />
            </>
          )}
        </div>
      </div>
      <div class="rail-column">
        <section class="rail" aria-label="Selected instant">
          <PendingLine />
          <Eyebrow n={1} label="Selected instant" />
          <header class="rail-head">
            <h2>Selected instant</h2>
            <p class="mono rail-instant">
              {date ?? "—"} {hhmm(minute)}
            </p>
          </header>
          <ol class="rail-rows">
            {stations.map((station, index) => (
              <RailRow
                key={station.id}
                index={index}
                station={station}
                state={stationStateAt(station, minute)}
                selected={station.id === selected}
              />
            ))}
          </ol>
          {selectedStation && selectedState && (
            <RailDetail station={selectedStation} state={selectedState} user={user} />
          )}
          <div class="rail-actions">
            <button
              type="button"
              class="btn btn-primary"
              disabled={!canHold}
              onClick={(e) => {
                setPreset(null);
                setDialogOpener(e.currentTarget);
              }}
            >
              Hold this station
            </button>
            {!canHold && (
              <p class="hold-hint">
                {selectedStation ? `${selectedStation.name} isn't free at ${hhmm(minute)}.` : "Select a free station on the plan or in the list."}
              </p>
            )}
          </div>
          {reduced && <TimeListbox value={minute} onChoose={turnTo} />}
          {hold && (
            <HoldPanel
              key={hold.ref}
              hold={hold}
              stationName={holdStation?.name ?? hold.station_id}
              policy={policy}
              now={now}
              onEnd={onHoldEnd}
            />
          )}
        </section>
        <PatternKey />
      </div>
      {dialogOpener !== undefined && selectedStation && date && (
        <PlaceHoldDialog
          stationId={selectedStation.id}
          stationName={selectedStation.name}
          date={date}
          minute={minute}
          preset={preset}
          tenants={isOperator ? (tenants ?? []) : null}
          opener={dialogOpener}
          onPlaced={placed}
          onClose={() => setDialogOpener(undefined)}
        />
      )}
    </div>
  );
}

const KEY_NOTES: Record<TileKind, string> = {
  free: "Open tile, fine hatching",
  booked: "Solid ink fill",
  held: "Teal dots with the countdown",
  cleaning: "Stripes, the 30 minutes after a block",
};

/** The key to the four station patterns, which stay distinct without colour. */
function PatternKey() {
  return (
    <div class="pattern-key">
      <Eyebrow n={2} label="Pattern key" />
      <ul class="key-rows" aria-label="Pattern key">
        {(Object.keys(STATE_WORDS) as TileKind[]).map((kind) => (
          <li key={kind} class="key-row">
            <span class={`key-swatch face-${kind}`} aria-hidden="true" />
            <span class="key-word">{STATE_WORDS[kind]}</span>
            <span class="key-note">{KEY_NOTES[kind]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function untilText(state: StationState): string | null {
  return state.until === null ? null : `until ${hhmm(state.until)}`;
}

function RailRow({ index, station, state, selected }: { index: number; station: DialStation; state: StationState; selected: boolean }) {
  const until = untilText(state);
  return (
    <li class={`rail-row rail-${state.kind}${selected ? " rail-selected" : ""}`}>
      <span class="row-num mono">{String(index + 1).padStart(2, "0")}</span>
      <span class="rail-name">{station.name}</span>
      <span class="rail-state">
        <span class={`state-chip chip-${state.kind}`} aria-hidden="true" />
        {STATE_WORDS[state.kind]}
      </span>
      {isFullBlock(state.block) && <span class="rail-tenant">{state.block.tenant_name}</span>}
      {until && <span class="rail-until mono">{until}</span>}
    </li>
  );
}

function RailDetail({ station, state, user }: { station: DialStation; state: StationState; user: User }) {
  const block = state.block;
  return (
    <div class="rail-detail">
      <p class="rail-label">{station.name}</p>
      {state.kind === "free" && (
        <p>{state.until === null ? "Free for the rest of the day." : `Free until ${hhmm(state.until)}.`}</p>
      )}
      {state.kind === "cleaning" && <p>Cleaning until {hhmm(state.until ?? DAY_MINUTES)}.</p>}
      {state.kind !== "free" && state.kind !== "cleaning" && !isFullBlock(block) && (
        <p>
          Booked until <span class="mono">{hhmm(state.until ?? DAY_MINUTES)}</span>
        </p>
      )}
      {isFullBlock(block) && (
        <dl class="detail-list">
          {user.role === "operator" && (
            <>
              <dt>Business</dt>
              <dd>{block.tenant_name}</dd>
              <dt>Contact</dt>
              <dd>{block.contact_email}</dd>
            </>
          )}
          <dt>Ref</dt>
          <dd class="mono">{block.ref}</dd>
          <dt>Time</dt>
          <dd class="mono">
            {hhmm(block.start_minute)}–{hhmm(block.end_minute)}
          </dd>
          <dt>Notes</dt>
          <dd>{block.notes || "—"}</dd>
        </dl>
      )}
    </div>
  );
}
