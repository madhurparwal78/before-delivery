// Booking detail (`/bookings/<pnr>`): passengers, coach plan, queue lanes, e-tickets, refunds and cancellation.
// Only a reply with a newer version is painted; each painted change plays the Chart drop once, in PNR order.
import { Download } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { Booking, CancellationQuote, CancellationResult, CoachPlanBody, PassengerStatus, TicketKind } from "../../shared/api";
import { formatInr, istTime, longDate } from "../../shared/format";
import { Chip } from "../components/Chip";
import { CoachPlan } from "../components/CoachPlan";
import { Modal } from "../components/Modal";
import { useRibbon } from "../components/Shell";
import { ApiFailure, api, newIdempotencyKey } from "../lib/api";
import {
  type Change, LANE_MS, MORPH_MS, STAGGER_MS, batchMessage, changesBetween, countDelays, countSteps, mergeChanges, snapshot, travel, wait,
} from "../lib/chartDrop";
import { type ServerClock, istTimestamp, readClock } from "../lib/clock";
import { useLayout, useReducedMotion } from "../lib/media";
import { historyState, navigate, useLocation } from "../lib/router";
import { useSession } from "../lib/session";
import { useStationNames } from "../lib/stations";
import { QUOTA_LABEL } from "./Search";

const POLL_MS = 20_000;
const KIND_LABEL: Record<TicketKind, string> = { booked: "as booked", cancellation: "after cancellation", chart: "after chart" };
const BAND_LABEL: Record<string, string> = {
  flat: "Flat charge",
  quarter: "25% deduction",
  half: "50% deduction",
  tatkal_confirmed: "Confirmed Tatkal, no refund",
  clerkage: "Clerkage",
  party_clerkage: "Part-confirmed party, clerkage",
  rac_after_chart: "RAC after chart, clerkage",
  after_chart: "After chart, no refund",
  chart_full: "Not confirmed at chart",
  no_fare: "Child, no fare",
};
const isQueue = (s: PassengerStatus): boolean => ["GNWL", "RLWL", "PQWL", "TQWL"].includes(s.status);
const isFinal = (s: PassengerStatus): boolean => s.status === "CAN" || s.status === "CHART_NOT_CONFIRMED";
const memoryKey = (pnr: string): string => `pakka:shown:${pnr}`;

function recall(pnr: string): PassengerStatus[] | null {
  const raw = localStorage.getItem(memoryKey(pnr));
  return raw ? (JSON.parse(raw) as PassengerStatus[]) : null;
}

function remember(pnr: string, statuses: PassengerStatus[]): void {
  localStorage.setItem(memoryKey(pnr), JSON.stringify(statuses));
}

function previewLine(p: CancellationQuote["passengers"][number]): string {
  const band = BAND_LABEL[p.band] ?? p.band;
  const deduction = p.gst_paise > 0
    ? `deduction ${formatInr(p.deduction_paise)} incl. GST ${formatInr(p.gst_paise)}`
    : `deduction ${formatInr(p.deduction_paise)}`;
  return `Passenger ${p.number}: ${band}, ${deduction}, refund ${formatInr(p.refund_paise)}`;
}

async function download(pnr: string, version: number, onProblem: (text: string) => void): Promise<void> {
  const response = await fetch(`/api/bookings/${pnr}/tickets/${version}`, { credentials: "same-origin" }).catch(() => null);
  if (!response || !response.ok) {
    onProblem("E-tickets can't be downloaded right now. Try again in a few minutes.");
    return;
  }
  onProblem("");
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = `e-ticket-${pnr}-v${version}.pdf`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function BookingDetail({ pnr }: { pnr: string }) {
  const { account } = useSession();
  const { path } = useLocation();
  const layout = useLayout();
  const reduced = useReducedMotion();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [missing, setMissing] = useState(false);
  const [shown, setShown] = useState<PassengerStatus[]>([]);
  const [counting, setCounting] = useState<Record<number, string>>({});
  const [striking, setStriking] = useState<number[]>([]);
  const [plan, setPlan] = useState<CoachPlanBody | null>(null);
  const [coach, setCoach] = useState("");
  const [updates, setUpdates] = useState("");
  const [whatChanged, setWhatChanged] = useState<string[]>([]);
  const [bookingResult] = useState(historyState().booked === pnr ? `Booked. PNR ${pnr}. E-ticket saved. Email copy queued.` : "");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [ticks, setTicks] = useState<number[]>([]);
  const [quote, setQuote] = useState<CancellationQuote | null>(null);
  const [cancelResult, setCancelResult] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [ticketProblem, setTicketProblem] = useState("");
  const [inspected, setInspected] = useState("");

  const painted = useRef(0);
  const target = useRef<PassengerStatus[] | null>(null);
  const shownRef = useRef<PassengerStatus[]>([]);
  const queue = useRef<Change[][]>([]);
  const playing = useRef(false);
  const held = useRef<Change[]>([]);
  const heldPlan = useRef<CoachPlanBody | null>(null);
  const dialogOpen = useRef(false);
  const coachRef = useRef("");
  const bookingRef = useRef<Booking | null>(null);
  const clock = useRef<ServerClock | null>(null);
  const lastRefresh = useRef<number | null>(null);
  const quoteSeq = useRef(0);
  const quotedFor = useRef("");
  const cancelButton = useRef<HTMLButtonElement>(null);
  const keepButton = useRef<HTMLButtonElement>(null);
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  coachRef.current = coach;

  useEffect(() => {
    if (account === null) navigate(`/signin?next=${encodeURIComponent(path)}`, { replace: true });
  }, [account, path]);

  const setOne = (n: number, status: PassengerStatus): void => {
    flushSync(() => {
      setShown((list) => {
        const next = list.map((s, i) => (i === n - 1 ? status : s));
        shownRef.current = next;
        return next;
      });
    });
  };

  const playOne = async (change: Change): Promise<void> => {
    const n = change.number;
    const steps = countSteps(change);
    const delays = countDelays(steps.length);
    for (const [i, label] of steps.entries()) {
      await wait(delays[i] ?? 0);
      setCounting((c) => ({ ...c, [n]: label }));
    }
    const chip = snapshot(document.querySelector(`[data-chip="lane-${n}"]`) ?? document.querySelector(`[data-chip="passenger-${n}"]`));
    flushSync(() => setCounting((c) => Object.fromEntries(Object.entries(c).filter(([k]) => Number(k) !== n))));
    if (change.to.status === "RAC" && isQueue(change.from)) {
      setOne(n, change.to);
      travel(chip, document.querySelector(`[data-chip="lane-${n}"]`), LANE_MS, true);
      await wait(LANE_MS);
    } else if (change.to.status === "CNF") {
      if (change.to.coach && change.to.coach !== coachRef.current) flushSync(() => setCoach(change.to.coach ?? ""));
      setOne(n, change.to);
      const cell = document.querySelector(`[aria-label^="Berth ${change.to.coach} ${change.to.berth} "]`);
      travel(chip, cell, MORPH_MS, false);
      await wait(MORPH_MS);
    } else {
      setOne(n, change.to);
      if (isFinal(change.to)) {
        setStriking((s) => [...s, n]);
        await wait(200);
      }
    }
  };

  const playBatch = async (changes: Change[]): Promise<void> => {
    setUpdates(batchMessage(changes));
    if (reducedRef.current) {
      flushSync(() => {
        setShown((list) => {
          const next = list.map((s, i) => changes.find((c) => c.number === i + 1)?.to ?? s);
          shownRef.current = next;
          return next;
        });
        setWhatChanged(batchMessage(changes).split("\n"));
      });
    } else {
      for (const change of changes) {
        await playOne(change);
        await wait(STAGGER_MS);
      }
    }
    remember(pnr, shownRef.current);
  };

  const enqueue = (changes: Change[]): void => {
    queue.current.push(changes);
    if (playing.current) return;
    playing.current = true;
    void (async () => {
      for (let next = queue.current.shift(); next; next = queue.current.shift()) await playBatch(next);
      playing.current = false;
    })();
  };

  const loadPlan = useCallback(
    async (body: Booking): Promise<void> => {
      const fresh = await api<CoachPlanBody>(
        `/api/trains/${body.train.number}/runs/${body.run_date}/coaches?class=${body.class}&from=${body.from}&to=${body.to}`,
      ).catch(() => null);
      if (!fresh) return;
      if (dialogOpen.current) heldPlan.current = fresh;
      else setPlan(fresh);
      setCoach((c) => c || (fresh.coaches[0]?.coach ?? ""));
    },
    [],
  );

  const paint = useCallback(
    (body: Booking): void => {
      if (body.version <= painted.current) return;
      painted.current = body.version;
      bookingRef.current = body;
      setBooking(body);
      void loadPlan(body);
      const next = body.passengers.map((p) => p.current_status);
      const before = target.current;
      target.current = next;
      if (!before) {
        const remembered = recall(pnr);
        const start = remembered && remembered.length === next.length ? remembered : next;
        shownRef.current = start;
        setShown(start);
        const changes = changesBetween(start, next);
        if (changes.length) enqueue(changes);
        else remember(pnr, next);
        return;
      }
      const changes = changesBetween(before, next);
      if (!changes.length) return;
      if (dialogOpen.current) held.current = mergeChanges(held.current, changes);
      else enqueue(changes);
    },
    [pnr, loadPlan],
  );

  useEffect(() => {
    if (!account) return;
    let timer: number | undefined;
    let live = true;
    const refresh = async (): Promise<void> => {
      try {
        const body = await api<Booking>(`/api/bookings/${pnr}`);
        if (!live) return;
        lastRefresh.current = clock.current?.now() ?? null;
        paint(body);
      } catch (error) {
        if (!live) return;
        if (error instanceof ApiFailure && error.status === 404) setMissing(true);
        else if (lastRefresh.current !== null) {
          setUpdates(`Can't reach Pakka right now. Showing status from ${istTime(istTimestamp(lastRefresh.current))} IST.`);
        }
      }
    };
    const schedule = (): void => {
      timer = window.setTimeout(async () => {
        const latest = bookingRef.current;
        if (latest && latest.state === "journey_complete" && !latest.refunds.some((r) => r.status === "pending")) return;
        await refresh();
        if (live) schedule();
      }, POLL_MS);
    };
    void (async () => {
      clock.current = await readClock().catch(() => null);
      await refresh();
      if (live) schedule();
    })();
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [account, pnr, paint]);

  const cancellable = (booking?.passengers ?? []).filter((p) => !isFinal(p.current_status) && booking?.state !== "journey_complete");
  const tickedKey = ticks.map((n) => `${n}:${booking?.passengers[n - 1]?.current_status.label}`).join(",");

  useEffect(() => {
    if (!cancelOpen) return;
    const stillCancellable = ticks.filter((n) => cancellable.some((p) => p.number === n));
    if (stillCancellable.length !== ticks.length) {
      const focused = document.activeElement?.getAttribute("data-tick");
      setTicks(stillCancellable);
      if (focused && !stillCancellable.includes(Number(focused))) keepButton.current?.focus();
      return;
    }
    if (quotedFor.current === tickedKey) return;
    quotedFor.current = tickedKey;
    const mine = ++quoteSeq.current;
    if (!ticks.length) {
      setQuote(null);
      return;
    }
    api<CancellationQuote>(`/api/bookings/${pnr}/cancellation-quote`, { method: "POST", body: { passengers: ticks } }).then(
      (q) => mine === quoteSeq.current && setQuote(q),
      () => undefined,
    );
  });

  const openCancel = (): void => {
    dialogOpen.current = true;
    quotedFor.current = "";
    setTicks([]);
    setQuote(null);
    setCancelOpen(true);
  };

  const closeCancel = (): void => {
    dialogOpen.current = false;
    setCancelOpen(false);
    if (heldPlan.current) {
      setPlan(heldPlan.current);
      heldPlan.current = null;
    }
    const changes = held.current;
    held.current = [];
    if (changes.length) enqueue(changes);
  };

  const confirmCancel = async (): Promise<void> => {
    if (!ticks.length || cancelling) return;
    setCancelling(true);
    setCancelResult("Cancelling");
    try {
      const result = await api<CancellationResult>(`/api/bookings/${pnr}/cancellations`, {
        method: "POST",
        body: { passengers: ticks },
        idempotencyKey: newIdempotencyKey(),
      });
      closeCancel();
      paint(result.booking);
      const refund = result.cancellation.refund_paise;
      setCancelResult(refund > 0 ? `Cancelled. Refund of ${formatInr(refund)} recorded.` : "Cancelled. No refund is due.");
    } catch (error) {
      const code = error instanceof ApiFailure ? error.code : "";
      setCancelResult(
        code === "already_cancelled"
          ? "That passenger is already cancelled."
          : code === "journey_complete"
            ? "This journey is complete. It can no longer be cancelled."
            : "Can't reach Pakka right now. Nothing was cancelled.",
      );
    } finally {
      setCancelling(false);
    }
  };

  const stationName = useStationNames();
  useRibbon(
    booking
      ? [
          { code: booking.from, name: stationName(booking.from), at: booking.departure_at, end: true },
          { code: booking.to, name: stationName(booking.to), at: booking.arrival_at, end: true },
        ]
      : [],
  );

  if (missing) {
    return (
      <section className="panel stack">
        <h1>Booking not found</h1>
        <p>There is no booking with this PNR on your account.</p>
      </section>
    );
  }
  if (!account || !booking) return <p className="muted">Loading booking</p>;

  const statusOf = (n: number): PassengerStatus | undefined => shown[n - 1];
  const chipFor = (n: number, where: "lane" | "passenger") => {
    const s = statusOf(n);
    if (!s) return null;
    const label = counting[n] ?? s.label;
    return (
      <span data-chip={`${where}-${n}`}>
        <Chip status={s.status} label={label} striking={striking.includes(n)} />
      </span>
    );
  };
  const chartRefund = booking.refunds.find((r) => r.reason === "chart");
  const shownCoach = coach || plan?.coaches[0]?.coach || "";

  const passengersColumn = (
    <section className="panel stack" aria-labelledby="passengers-title">
      <h2 id="passengers-title">Passengers</h2>
      <ul className="plain" aria-label="Passengers">
        {booking.passengers.map((p) => {
          const s = statusOf(p.number);
          return (
            <li key={p.number} className="passenger">
              {chipFor(p.number, "passenger")}{" "}
              <span className="who">
                <strong>{`Passenger ${p.number}`}</strong>{" "}
                <span className="small">{`${p.name}, ${p.age}`}</span>
              </span>
              {s?.status === "CHART_NOT_CONFIRMED" ? (
                <>
                  {" "}
                  <span className="note">{`Not confirmed — refund ${chartRefund?.status === "issued" ? "issued" : "pending"}`}</span>
                </>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );

  const planColumn = (
    <section className="panel stack" aria-labelledby="plan-title">
      <h2 id="plan-title">Coach plan</h2>
      {reduced && whatChanged.length ? (
        <section aria-label="What changed" className="notice">
          <ul className="plain">
            {whatChanged.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {plan ? (
        <CoachPlan
          coaches={plan.coaches}
          vertical={layout === "phone"}
          selected={shownCoach}
          onSelect={setCoach}
          mark={(c, berth) => {
            const own = shown.flatMap((s, i) => (s.coach === c && s.berth === berth ? [{ n: i + 1, s }] : []));
            return {
              ownCnf: own.some((o) => o.s.status === "CNF"),
              ownRac: own.filter((o) => o.s.status === "RAC").length,
              tags: own.map((o) => `${o.s.status === "CNF" ? "CNF" : "RAC"} passenger ${o.n}`),
            };
          }}
          onActivate={(c, berth) => setInspected(`Berth ${c} ${berth} selected`)}
          reveal={(() => {
            const own = shown.find((s) => s.coach === shownCoach && s.berth !== null);
            return own?.coach && own.berth ? { coach: own.coach, berth: own.berth } : undefined;
          })()}
        />
      ) : (
        <p className={`small muted plan-pending${layout === "phone" ? " vertical" : ""}`}>Coach plan loading</p>
      )}
      <p className="small muted" aria-live="polite">{inspected || "Your passengers' berths are filled green; RAC places are drawn as halves."}</p>
    </section>
  );

  const queueColumn = (
    <section className="panel stack col-queue" aria-label="Queue">
      <h2>Queue</h2>
      <div className="lanes">
        <section className="lane" aria-label="WL lane">
          <h3>WL LANE</h3>
          <div className="lane-chips">{booking.passengers.filter((p) => statusOf(p.number) && isQueue(statusOf(p.number) as PassengerStatus)).map((p) => <span key={p.number}>{chipFor(p.number, "lane")}</span>)}</div>
          {shown.some(isQueue) ? null : <p className="small muted">No passenger on a waiting list</p>}
        </section>
        <section className="lane" aria-label="RAC lane">
          <h3>RAC LANE</h3>
          <div className="lane-chips">{booking.passengers.filter((p) => statusOf(p.number)?.status === "RAC").map((p) => <span key={p.number}>{chipFor(p.number, "lane")}</span>)}</div>
          {shown.some((s) => s.status === "RAC") ? null : <p className="small muted">No passenger on RAC</p>}
        </section>
      </div>
    </section>
  );

  const recordsColumn = (
    <section className="panel stack col-wide" aria-labelledby="records-title">
      <h2 id="records-title">E-tickets and refunds</h2>
      <div role="alert" aria-label="Ticket problem" className="alert-region">
        {ticketProblem}
      </div>
      <ul className="plain tickets" aria-label="E-tickets">
        {booking.tickets.map((t) => (
          <li key={t.version}>
            <a
              href={`/api/bookings/${pnr}/tickets/${t.version}`}
              onClick={(e) => {
                e.preventDefault();
                void download(pnr, t.version, setTicketProblem);
              }}
            >
              <Download size={16} strokeWidth={1.75} aria-hidden="true" />
              {`Download e-ticket v${t.version} (${KIND_LABEL[t.kind]})`}
            </a>
            <span className="small muted mono">{`${istTime(t.created_at)} IST, ${longDate(t.created_at)}`}</span>
          </li>
        ))}
      </ul>
      <ul className="plain refunds" aria-label="Refunds">
        {booking.refunds.map((r) => (
          <li key={r.number}>
            <span className="money">{formatInr(r.refund_paise)}</span>
            <span className="small muted">{r.reason === "chart" ? "Not confirmed at chart" : "Cancellation"}</span>
            <span className={`refund-state${r.status === "issued" ? " issued" : ""}`}>{r.status === "issued" ? "Refund issued" : "Refund pending"}</span>
          </li>
        ))}
      </ul>
      {booking.refunds.length === 0 ? <p className="small muted">No refunds on this PNR.</p> : null}
    </section>
  );

  return (
    <div className="stack">
      <section className="panel stack" aria-labelledby="pnr-title">
        <div className="panel-title">
          <h1 id="pnr-title">{`PNR ${pnr}`}</h1>
          <span className="kicker">{`${booking.class} · ${QUOTA_LABEL[booking.quota]}`}</span>
        </div>
        <div className="journey">
          <p>
            <strong>{`${booking.train.number} ${booking.train.name}`}</strong>
            {` · ${booking.from} → ${booking.to} · run of ${longDate(booking.run_date)}`}
          </p>
          <p className="small">
            Departs <time>{istTime(booking.departure_at)} IST</time>, {longDate(booking.departure_at)} · arrives{" "}
            <time>{istTime(booking.arrival_at)} IST</time>, {longDate(booking.arrival_at)}
          </p>
          {booking.chart_prepared ? (
            <div className="chart-block">
              <span className="stamp" aria-hidden="true">CHART PREPARED</span>
              <h2>Chart prepared</h2>
              <p>Statuses are final. Berths no longer move.</p>
            </div>
          ) : (
            <p className="small">{`Chart at ${istTime(booking.chart_at)} IST, ${longDate(booking.chart_at)}`}</p>
          )}
        </div>
        <p className="status-line strong" role="status" aria-label="Booking result">{bookingResult}</p>
        <p className="status-line strong" role="status" aria-label="PNR updates" style={{ whiteSpace: "pre-line" }}>
          {updates}
        </p>
        <p className="status-line strong" role="status" aria-label="Cancellation result">{cancelResult}</p>
        {cancellable.length ? (
          <div>
            <button ref={cancelButton} type="button" className="button" onClick={openCancel}>
              Cancel passengers
            </button>
          </div>
        ) : null}
      </section>
      <div className={`detail ${layout}`}>
        {passengersColumn}
        {planColumn}
        {queueColumn}
        {recordsColumn}
      </div>
      <Modal open={cancelOpen} label="Cancel passengers" onClose={closeCancel} opener={cancelButton}>
        <h2>Cancel passengers</h2>
        <p className="small">Tick who is not travelling. The refund below is quoted now, on the business clock.</p>
        <div className="stack">
          {cancellable.map((p) => (
            <div key={p.number} className="row">
              <label className="check">
                <input
                  type="checkbox"
                  data-tick={p.number}
                  checked={ticks.includes(p.number)}
                  aria-describedby={`tick-${p.number}`}
                  onChange={(e) => setTicks((t) => (e.target.checked ? [...t, p.number].sort((a, b) => a - b) : t.filter((x) => x !== p.number)))}
                />
                {`Passenger ${p.number}`}
              </label>
              <span id={`tick-${p.number}`} className="small muted">{`${p.name} · ${p.current_status.label}`}</span>
            </div>
          ))}
        </div>
        <ul className="plain preview" aria-label="Refund preview">
          {(quote?.passengers ?? []).filter((q) => ticks.includes(q.number)).map((q) => (
            <li key={q.number}>{previewLine(q)}</li>
          ))}
        </ul>
        <div className="actions">
          <button ref={keepButton} type="button" className="button" onClick={closeCancel}>
            Keep booking
          </button>
          <button type="button" className="button primary" disabled={!ticks.length || !quote || cancelling} onClick={() => void confirmCancel()}>
            {`Cancel and refund ${formatInr(quote?.refund_paise ?? 0)}`}
          </button>
        </div>
      </Modal>
    </div>
  );
}
