import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type {
  AvailabilityResponse,
  AvailabilitySlot,
  BookingReceipt,
  HoldResponse,
  HostLiveEvent,
  PlanResponse,
  TonightResponse,
} from "../../shared/api.js";
import { addDays, formatDayLabel, guestsLabel } from "../../shared/calendar.js";
import { formatEuros } from "../../shared/euros.js";
import { get, post, request } from "../api.js";
import { useAnnouncer } from "../announce.js";
import { DateField, FieldError, PartySize, TextField } from "../components/Fields.js";
import { FloorPlan } from "../components/FloorPlan.js";
import { geometryFor } from "../components/geometry.js";
import { CountdownRing } from "../components/HeldMarks.js";
import { OneSentence, Page } from "../components/Shell.js";
import { depositParagraph, PAYMENT_FAILED } from "../copy.js";
import { useLiveEvents } from "../liveEvents.js";
import { navigate, rewriteUrl, useLocation } from "../router.js";
import { formatMinutesSeconds, secondsLeft } from "../serverClock.js";
import { useDependencyStatus } from "../status.js";
import { useFloor, useRules } from "../reference.js";
import { bookUrl, choiceKey, readChoice, type Choice } from "./bookingChoice.js";
import { guestRooms, STATUS_WORDS } from "./planItems.js";

interface LiveHold {
  holdId: string;
  targetId: string;
  partySize: number;
  depositCents: number;
  expiresAt: string;
  time: string;
  choiceKey: string;
}

const LOCAL_ZONE = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const LOCAL_DAY = new Intl.DateTimeFormat("en-GB", { weekday: "short", year: "numeric", month: "2-digit", day: "2-digit" });

/** `20:30 (15:30 your time)` when the browser's zone differs from Lisbon; the day is added when it differs too. */
function slotLabel(slot: AvailabilitySlot, date: string): string {
  const start = new Date(slot.starts_at);
  const local = LOCAL_ZONE.format(start);
  const localDay = LOCAL_DAY.formatToParts(start);
  const part = (type: string): string => localDay.find((candidate) => candidate.type === type)?.value ?? "";
  const sameDay = `${part("year")}-${part("month")}-${part("day")}` === date;
  const hint = local === slot.time && sameDay ? "" : sameDay ? ` (${local} your time)` : ` (${local} ${part("weekday")} your time)`;
  const tail = slot.bookable
    ? `, ${slot.covers_free} covers free${slot.eligible_tables === 0 ? ", waitlist only" : ""}`
    : ", too late to book online";
  return `${slot.time}${hint}${tail}`;
}

function SlotList({
  slots,
  date,
  chosen,
  onChoose,
}: {
  slots: AvailabilitySlot[];
  date: string;
  chosen: string | null;
  onChoose: (time: string) => void;
}) {
  const nodes = useRef(new Map<string, HTMLElement>());
  const [stop, setStop] = useState<string | null>(null);
  const tabbable = stop ?? chosen ?? slots.find((slot) => slot.bookable)?.time ?? slots[0]?.time ?? null;

  const move = (from: string, to: number | "first" | "last"): void => {
    const index = slots.findIndex((slot) => slot.time === from);
    const target = to === "first" ? 0 : to === "last" ? slots.length - 1 : Math.min(slots.length - 1, Math.max(0, index + to));
    const next = slots[target];
    if (next !== undefined) {
      setStop(next.time);
      nodes.current.get(next.time)?.focus();
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>, slot: AvailabilitySlot): void => {
    const keys: Record<string, number | "first" | "last"> = { ArrowDown: 1, ArrowUp: -1, Home: "first", End: "last" };
    const step = keys[event.key];
    if (step !== undefined) {
      event.preventDefault();
      move(slot.time, step);
    } else if ((event.key === "Enter" || event.key === " ") && slot.bookable) {
      event.preventDefault();
      onChoose(slot.time);
    }
  };

  return (
    <div role="listbox" aria-label="Times" className="slots">
      {slots.map((slot) => (
        <div
          key={slot.time}
          role="option"
          aria-selected={chosen === slot.time}
          aria-disabled={!slot.bookable}
          tabIndex={tabbable === slot.time ? 0 : -1}
          className="slot-row"
          ref={(node) => {
            if (node === null) nodes.current.delete(slot.time);
            else nodes.current.set(slot.time, node);
          }}
          onFocus={() => setStop(slot.time)}
          onClick={() => slot.bookable && onChoose(slot.time)}
          onKeyDown={(event) => onKeyDown(event, slot)}
        >
          {chosen === slot.time && <span className="swipe" aria-hidden="true" />}
          <span>{slotLabel(slot, date)}</span>
        </div>
      ))}
    </div>
  );
}

function useSecondsLeft(expiresAt: string | null): number | null {
  const [, tick] = useState(0);
  useEffect(() => {
    if (expiresAt === null) return undefined;
    const timer = window.setInterval(() => tick((count) => count + 1), 250);
    return () => window.clearInterval(timer);
  }, [expiresAt]);
  return expiresAt === null ? null : secondsLeft(expiresAt);
}

export function BookingPage() {
  const location = useLocation();
  const rules = useRules();
  const floor = useFloor();
  const status = useDependencyStatus();
  const { messages, announce } = useAnnouncer(1);

  const [today, setToday] = useState<string | null>(null);
  const [availability, setAvailability] = useState<{ key: string; body: AvailabilityResponse } | null>(null);
  const [plan, setPlan] = useState<{ key: string; body: PlanResponse } | { key: string; failed: true } | null>(null);
  const [version, setVersion] = useState(0);
  const [localTaken, setLocalTaken] = useState<string[]>([]);

  const [hold, setHold] = useState<LiveHold | null>(null);
  const [pendingTable, setPendingTable] = useState<string | null>(null);
  const [everHeld, setEverHeld] = useState(false);
  const [endedTable, setEndedTable] = useState<string | null>(null);
  const [lastDeposit, setLastDeposit] = useState(0);
  const [focusRequest, setFocusRequest] = useState<{ id: string; nonce: number } | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    void get<TonightResponse>("/api/tonight").then((outcome) => outcome.ok && setToday(outcome.body.date));
  }, []);

  const horizon = rules?.booking_horizon_days ?? 30;
  const choice: Choice | null = useMemo(
    () => (today === null || rules === null ? null : readChoice(location.search, today, horizon, rules.slot_times)),
    [location.search, today, rules, horizon],
  );
  const key = choice === null ? null : choiceKey(choice);

  // Opening the address with defaults applied rewrites it in place, without a history entry.
  useEffect(() => {
    if (choice === null) return;
    const written = new URLSearchParams(window.location.search);
    const same = written.get("party") === String(choice.party) && written.get("date") === choice.date && written.get("time") === choice.time;
    if (!same) rewriteUrl(bookUrl(choice));
  }, [choice]);

  const holdRef = useRef<LiveHold | null>(null);
  holdRef.current = hold;
  const confirmedRef = useRef(false);
  const endedRef = useRef<string | null>(null);
  const keyRef = useRef<string | null>(null);
  keyRef.current = key;
  const latestAvailability = useRef(0);
  const latestPlan = useRef(0);

  // ---- releasing ----
  /** Frees the live hold. Refused with 503 holds_paused, the hold stays shown and nothing else happens. */
  const releaseLive = useCallback(
    async (announceIt: boolean): Promise<boolean> => {
      const current = holdRef.current;
      if (current === null) return true;
      const outcome = await request<null>(`/api/holds/${current.holdId}`, { method: "DELETE" });
      if (!outcome.ok && outcome.failure.code === "holds_paused") return false;
      setHold(null);
      endedRef.current = null;
      setEndedTable(null);
      if (announceIt) announce(`Table ${current.targetId} released.`);
      return true;
    },
    [announce],
  );

  /** A hold from another choice (Back or Forward) is released before the new plan is requested. */
  const blocked = hold !== null && key !== null && hold.choiceKey !== key;
  useEffect(() => {
    if (blocked) void releaseLive(true).then((released) => !released && setHold(null));
  }, [blocked, releaseLive]);

  // The unload sends a release that survives it; leaving the page by navigation does too.
  useEffect(() => {
    const send = (): void => {
      const current = holdRef.current;
      if (current !== null && !confirmedRef.current) void request<null>(`/api/holds/${current.holdId}`, { method: "DELETE", keepalive: true });
    };
    window.addEventListener("pagehide", send);
    return () => {
      window.removeEventListener("pagehide", send);
      send();
    };
  }, []);

  // ---- slots and plan ----
  const timeChosen = choice?.time ?? null;
  useEffect(() => {
    if (choice === null || blocked) return;
    const wanted = `${choice.date}|${choice.party}`;
    latestAvailability.current += 1;
    const ticket = latestAvailability.current;
    void get<AvailabilityResponse>(`/api/availability?date=${choice.date}&party=${choice.party}`).then((outcome) => {
      if (!outcome.ok || ticket !== latestAvailability.current) return;
      setAvailability({ key: wanted, body: outcome.body });
      const slot = outcome.body.slots.find((candidate) => candidate.time === timeChosen);
      if (timeChosen !== null && (slot === undefined || !slot.bookable)) {
        navigate(bookUrl({ ...choice, time: null }), { replace: true });
      }
    });
  }, [choice?.date, choice?.party, timeChosen, blocked, version]);

  useEffect(() => {
    if (choice === null || choice.time === null || blocked) return;
    const wanted = choiceKey(choice);
    latestPlan.current += 1;
    const ticket = latestPlan.current;
    void get<PlanResponse>(`/api/plan?date=${choice.date}&time=${choice.time}&party=${choice.party}`).then((outcome) => {
      if (ticket !== latestPlan.current) return;
      setLocalTaken([]);
      setPlan(outcome.ok ? { key: wanted, body: outcome.body } : { key: wanted, failed: true });
    });
  }, [key, blocked, version]);

  // ---- live updates ----
  const refresh = useCallback(() => setVersion((count) => count + 1), []);
  const watchHold = useCallback(async (): Promise<void> => {
    const current = holdRef.current;
    if (current === null) return;
    const outcome = await get<HoldResponse>(`/api/holds/${current.holdId}`);
    if (outcome.ok && outcome.body.status !== "live") endHold(current);
  }, []);
  const onEvent = useCallback(
    (event: HostLiveEvent): void => {
      const current = holdRef.current;
      // This page's own hold is already drawn; rereading the plan for it would only nudge the countdown's clock.
      const own = event.type === "hold.created" && current !== null && current.time === event.time && event.table_ids.join("+") === current.targetId;
      if (!own) refresh();
      if (event.type === "hold.expired" && current !== null && current.time === event.time && current.targetId.split("+").some((id) => event.table_ids.includes(id))) {
        void watchHold();
      }
    },
    [refresh, watchHold],
  );
  useLiveEvents(choice === null ? null : `/api/floor/events?date=${choice.date}`, onEvent, () => {
    refresh();
    void watchHold();
  });
  useEffect(() => {
    if (status.holdsPaused) refresh();
  }, [status.checks, status.holdsPaused, refresh]);

  // ---- the hold ending ----
  const left = useSecondsLeft(hold?.expiresAt ?? null);
  const countdownEnded = hold !== null && left === 0;
  const markEnded = useCallback(
    (tableId: string): void => {
      if (endedRef.current === tableId) return;
      endedRef.current = tableId;
      setEndedTable(tableId);
      announce(`Your hold on table ${tableId} has ended.`);
    },
    [announce],
  );
  const endHold = (ended: LiveHold): void => {
    if (holdRef.current?.holdId !== ended.holdId) return;
    markEnded(ended.targetId);
    setHold(null);
    refresh();
  };
  useEffect(() => {
    if (!countdownEnded || hold === null) return undefined;
    markEnded(hold.targetId);
    const poll = window.setInterval(() => void watchHold(), 1000);
    return () => window.clearInterval(poll);
  }, [countdownEnded, hold, watchHold, markEnded]);

  // ---- choosing ----
  const changeChoice = async (next: Choice): Promise<void> => {
    if (choice === null || choiceKey(next) === choiceKey(choice)) return;
    if (hold !== null && !(await releaseLive(true))) return;
    navigate(bookUrl(next));
  };

  const chooseTable = async (target: { id: string; statusWord: string }): Promise<void> => {
    if (choice === null || choice.time === null) return;
    if (target.statusWord !== STATUS_WORDS.fits) {
      announce(`Table ${target.id}: ${target.statusWord}`);
      return;
    }
    if (pendingTable !== null) return;
    if (hold !== null && !(await releaseLive(false))) return;
    setPendingTable(target.id);
    endedRef.current = null;
    setEndedTable(null);
    announce(`Holding table ${target.id}...`);
    const requested = key;
    const outcome = await post<HoldResponse>("/api/holds", { date: choice.date, time: choice.time, party_size: choice.party, table_id: target.id });
    setPendingTable(null);
    if (outcome.ok) {
      const granted: LiveHold = {
        holdId: outcome.body.hold_id,
        targetId: outcome.body.table_id,
        partySize: outcome.body.party_size,
        depositCents: outcome.body.deposit_cents,
        expiresAt: outcome.body.expires_at,
        time: outcome.body.time,
        choiceKey: requested ?? "",
      };
      if (keyRef.current !== requested) {
        void request<null>(`/api/holds/${granted.holdId}`, { method: "DELETE" });
        return;
      }
      if (granted.depositCents !== lastDeposit) setAccepted(false);
      setLastDeposit(granted.depositCents);
      setHold(granted);
      setEverHeld(true);
      setErrors({});
      setProblem(null);
      announce(`Table ${granted.targetId} is held for you.`);
      return;
    }
    const { code } = outcome.failure;
    if (code === "table_taken") {
      setLocalTaken((current) => [...current, target.id]);
      announce(`Table ${target.id} was just taken. Pick another table.`);
    } else if (code === "table_not_for_party") {
      announce("That table isn't set for your party. Pick an outlined table.");
    } else if (code === "slot_not_bookable") {
      announce("That time can't be booked online any more. Pick another time.");
      refresh();
    }
  };

  const releaseButton = async (): Promise<void> => {
    const current = hold;
    if (current !== null && (await releaseLive(true))) setFocusRequest({ id: current.targetId, nonce: Date.now() });
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (hold === null || countdownEnded || confirming) return;
    setConfirming(true);
    setErrors({});
    setProblem(null);
    const current = hold;
    const outcome = await post<BookingReceipt>(
      `/api/holds/${current.holdId}/confirm`,
      { name, email, ...(phone === "" ? {} : { phone }), ...(current.depositCents > 0 ? { accept_deposit: accepted } : {}) },
      { keyed: true },
    );
    setConfirming(false);
    if (outcome.ok) {
      confirmedRef.current = true;
      navigate(new URL(outcome.body.manage_url).pathname);
      return;
    }
    const failure = outcome.failure;
    if (failure.code === "validation_failed") {
      setErrors(failure.fields);
      announce(Object.values(failure.fields).join(" "));
      const firstInvalid = ["name", "email", "phone", "accept_deposit"].find((field) => failure.fields[field] !== undefined);
      if (firstInvalid !== undefined) document.getElementById(`field-${firstInvalid}`)?.focus();
    } else if (failure.code === "payment_failed") {
      setProblem(PAYMENT_FAILED);
      announce(PAYMENT_FAILED);
    } else if (failure.code === "hold_expired" || failure.code === "table_taken" || failure.code === "hold_closed") {
      endHold(current);
    }
  };

  // ---- drawing ----
  const rooms = useMemo(() => {
    if (floor === null || plan === null || !("body" in plan) || plan.key !== key) return [];
    const taken = new Set(localTaken);
    const adjusted: PlanResponse = {
      ...plan.body,
      tables: plan.body.tables.map((table) => (taken.has(table.table_id) ? { ...table, status: "taken" } : table)),
      pairs: plan.body.pairs.map((pair) => (taken.has(pair.pair_id) ? { ...pair, status: "taken" } : pair)),
    };
    const maxSeats = (id: string): number =>
      floor.rooms.flatMap((room) => room.tables).find((table) => table.table_id === id)?.max_seats ??
      floor.joinable_pairs.find((pair) => pair.pair_id === id)?.max_seats ?? 2;
    return guestRooms(
      floor,
      adjusted,
      hold === null ? null : { targetId: hold.targetId, partySize: hold.partySize },
      (id, isHeld) =>
        isHeld && hold !== null && rules !== null
          ? {
              ring: <CountdownRing geometry={geometryFor(maxSeats(id))} expiresAt={hold.expiresAt} lifetimeSeconds={rules.hold_seconds} label="Hold time remaining" />,
              note: `Held for ${formatMinutesSeconds(left ?? 0)}`,
            }
          : {},
    );
  }, [floor, plan, key, localTaken, hold, rules, left]);

  if (choice === null) return <OneSentence>Laying out the room...</OneSentence>;

  const slots = availability?.key === `${choice.date}|${choice.party}` ? availability.body.slots : null;
  const firstFit = rooms.flatMap((room) => room.items).find((item) => item.statusWord === STATUS_WORDS.fits)?.id ?? null;
  const summary = `${formatDayLabel(choice.date)} · ${choice.time === null ? "" : `${choice.time} · `}${guestsLabel(choice.party)}`;
  const deposit = hold?.depositCents ?? lastDeposit;
  const live = hold !== null && !countdownEnded;
  const joinTime = choice.time ?? null;
  const waitlistLink = `/waitlist?date=${choice.date}&party=${choice.party}&earliest=${joinTime ?? rules?.slot_times[0] ?? "18:00"}&latest=${joinTime ?? rules?.slot_times.at(-1) ?? "22:00"}`;
  const maxDate = today === null ? choice.date : addDays(today, horizon);

  return (
    <Page summary={summary} live={{ label: "Booking updates", messages }}>
      <div className="regions">
        <section className="region region-find" aria-labelledby="find-title">
          <h2 id="find-title">Find a time</h2>
          <PartySize value={choice.party} onChange={(party) => void changeChoice({ ...choice, party })} />
          <DateField value={choice.date} min={today ?? choice.date} max={maxDate} onChange={(date) => void changeChoice({ ...choice, date })} />
          {slots === null ? (
            // As tall as the list it stands for, so the plan below does not jump when the times arrive.
            <p className="note" style={{ minHeight: `calc(${rules?.slot_times.length ?? 0} * var(--touch))`, marginBottom: 0 }}>
              Finding times...
            </p>
          ) : (
            <SlotList slots={slots} date={choice.date} chosen={choice.time} onChoose={(time) => void changeChoice({ ...choice, time })} />
          )}
        </section>

        <section className="region region-plan" aria-labelledby="plan-title">
          <h2 id="plan-title">Floor plan</h2>
          {choice.time === null ? (
            <p className="note">Pick a time to see which tables fit your party.</p>
          ) : plan !== null && "failed" in plan && plan.key === key ? (
            <p className="note">We couldn&apos;t load the floor plan. Refresh to try again.</p>
          ) : rooms.length === 0 ? (
            <p className="note">Laying out the room...</p>
          ) : (
            <FloorPlan label="Tables" rooms={rooms} firstStop={firstFit} focusRequest={focusRequest} onChoose={(item) => void chooseTable(item)} />
          )}
        </section>

        {everHeld && (
          <section className="region region-table" aria-labelledby="table-title">
            <h2 id="table-title">Your table</h2>
            <form onSubmit={(event) => void submit(event)} noValidate>
              {hold !== null && (
                <div className="summary-lines">
                  <p>
                    Table {hold.targetId} · party of {hold.partySize}
                  </p>
                  <div className="actions">
                    <button type="button" className="button" onClick={() => void releaseButton()}>
                      Release table
                    </button>
                  </div>
                </div>
              )}
              {endedTable !== null && (
                <p className="notice">
                  <span>Your hold on table {endedTable} has ended.</span>
                </p>
              )}
              <TextField id="field-name" label="Name" value={name} onChange={setName} error={errors["name"]} autoComplete="name" />
              <TextField id="field-email" label="Email" type="email" value={email} onChange={setEmail} error={errors["email"]} autoComplete="email" />
              <TextField id="field-phone" label="Phone (optional)" value={phone} onChange={setPhone} error={errors["phone"]} autoComplete="tel" />
              {deposit > 0 && (
                <>
                  <p className="note">{depositParagraph(deposit, rules?.deposit_cents_per_cover ?? 1500)}</p>
                  <div className="checkbox-row">
                    <input
                      id="field-accept_deposit"
                      type="checkbox"
                      checked={accepted}
                      aria-invalid={errors["accept_deposit"] === undefined ? undefined : true}
                      onChange={(event) => setAccepted(event.target.checked)}
                    />
                    <label htmlFor="field-accept_deposit">I accept the €{formatEuros(deposit)} deposit and the refund rule above</label>
                  </div>
                  {errors["accept_deposit"] !== undefined && <FieldError id="deposit-error">{errors["accept_deposit"]}</FieldError>}
                </>
              )}
              {problem !== null && <p className="notice">{problem}</p>}
              <button type="submit" className="button button-lime" disabled={!live} aria-disabled={confirming}>
                {confirming ? "Booking..." : deposit > 0 ? `Pay €${formatEuros(deposit)} and book` : "Book table"}
              </button>
            </form>
          </section>
        )}

        <div className="region-wait">
          <a
            href={waitlistLink}
            className="button"
            onClick={(event) => {
              event.preventDefault();
              navigate(waitlistLink);
            }}
          >
            Join the waitlist
          </a>
        </div>
      </div>
    </Page>
  );
}
