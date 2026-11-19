// The Book screen: rail, a stack of Burner Dials, the ticket spike, cancel and repeat-weekly dialogs.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ApiErrorBody, Availability, Balances, Booking, Me, Sector } from "../../shared/api.ts";
import { SANITATION_BUFFER_MINUTES, hoursToQuarters, nextOpenDate, type Quarters } from "../../shared/rules.ts";
import { addDays, elapsedQuarters, formatWall, parseWall, wallClock, weekdayOf, type IsoDate } from "../../shared/time.ts";
import { hoursText, quartersText } from "../../shared/format.ts";
import { api, errorCopy, serverNow, DROPPED } from "../api.ts";
import { reloadsPaused } from "../session.ts";
import { useSites } from "../useSites.ts";
import { Rail, type StationFilter } from "../Rail.tsx";
import { Spike, spikeOrder } from "../Spike.tsx";
import { BurnerDial, type DialActions, type DialStation } from "../dial/BurnerDial.tsx";
import type { ClaimWindow } from "../dial/footprint.ts";
import { ActionButton, Dialog, Status, StatusRegion, useLatestRequest, useReducedMotion, useStatusRegion, type Say } from "../ui.tsx";
import { CancellationOutcome, HOLD_ERRORS, HOLD_EXPIRED, TICKET_CHANGED, certificateCopy, memberCancelled } from "../copy.tsx";

const RELOAD_MS = 15_000;
const EXPIRY_RECHECK_MS = 5000;

interface RepeatState {
  station: DialStation;
  window: ClaimWindow;
}

interface Subject {
  siteId: string;
  date: IsoDate;
  filter: StationFilter;
}

interface Drawn {
  subject: Subject;
  stations: DialStation[];
}

export function Book({ me }: { me: Me }): ReactNode {
  const member = me.member;
  const reduced = useReducedMotion();
  const sites = useSites();
  const [subject, setSubject] = useState<Subject | null>(null);
  const subjectRef = useRef<Subject | null>(null);
  const [drawn, setDrawn] = useState<Drawn | null>(null);
  const [busy, setBusy] = useState(true);
  const [subjectStamp, setSubjectStamp] = useState(0);
  const [reloadStamp, setReloadStamp] = useState(0);
  const [seriesBooked, setSeriesBooked] = useState<Record<string, number>>({});
  const [tickets, setTickets] = useState<Booking[]>([]);
  const [available, setAvailable] = useState<Quarters>(hoursToQuarters(member?.available_hours ?? 0));
  const [status, say] = useStatusRegion();
  const [cancelling, setCancelling] = useState<Booking | null>(null);
  const [repeat, setRepeat] = useState<RepeatState | null>(null);
  const [expiredOnScreen, setExpiredOnScreen] = useState<Set<string>>(new Set());
  const ticketElements = useRef(new Map<string, HTMLLIElement>());
  const placed = useRef<string[]>([]);
  const beginLoad = useLatestRequest();
  const subjectChanged = useRef(false);
  const [timerRestart, setTimerRestart] = useState(0);
  const balanceStamp = useRef(0);
  const focusTicketId = useRef<string | null>(null);
  const repeatOpener = useRef<HTMLElement | null>(null);

  const site = sites.find((s) => s.id === subject?.siteId);
  const timeZone = site?.time_zone ?? "UTC";

  const applyBalances = useCallback((balances: Balances) => {
    balanceStamp.current += 1;
    setAvailable(hoursToQuarters(balances.available_hours));
  }, []);

  /** An availability request: each one makes every earlier one stale. */
  const loadDials = useCallback(async (requested: Subject) => {
    const isLatest = beginLoad();
    setTimerRestart((n) => n + 1);
    const result = await api<Availability>(`/api/sites/${requested.siteId}/availability?date=${requested.date}`);
    if (!isLatest() || !result.ok) return;
    setBusy(false);
    const stations = result.data.stations.filter((s) => requested.filter === "all" || s.kind === requested.filter);
    setDrawn({ subject: requested, stations });
    setReloadStamp((n) => n + 1);
    if (subjectChanged.current) {
      subjectChanged.current = false;
      setSubjectStamp((n) => n + 1);
    }
  }, [beginLoad]);

  const reloadDials = useCallback(() => {
    if (subjectRef.current) void loadDials(subjectRef.current);
  }, [loadDials]);

  const changeSubject = useCallback(
    (next: Subject) => {
      subjectRef.current = next;
      subjectChanged.current = true;
      setSubject(next);
      setBusy(true);
      void loadDials(next);
    },
    [loadDials],
  );

  const refreshBalances = useCallback(async () => {
    const stamp = balanceStamp.current;
    const result = await api<{ balances: Balances }>("/api/me/ledger");
    if (result.ok && stamp === balanceStamp.current) applyBalances(result.data.balances);
  }, [applyBalances]);

  // The date field starts on the home site's next open date, from the site clock the server reports.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || sites.length === 0) return;
    started.current = true;
    const home = sites.find((s) => s.id === member?.home_site_id) ?? sites[0];
    if (!home) return;
    const minutes = Number(home.local_now.slice(11, 13)) * 60 + Number(home.local_now.slice(14, 16));
    changeSubject({ siteId: home.id, date: nextOpenDate(home.local_date, minutes), filter: "all" });
  }, [sites, member?.home_site_id, changeSubject]);

  useEffect(() => {
    void api<{ bookings: Booking[] }>("/api/bookings").then((result) => {
      if (result.ok) setTickets(spikeOrder(result.data.bookings, placed.current));
    });
    void refreshBalances();
  }, [refreshBalances]);

  // The next reload comes 15 seconds after the latest dial load.
  useEffect(() => {
    const id = setTimeout(() => {
      if (reloadsPaused()) setTimerRestart((n) => n + 1);
      else reloadDials();
    }, RELOAD_MS);
    return () => clearTimeout(id);
  }, [timerRestart, reloadDials]);

  const spikeNew = (made: Booking[]): void => {
    const ids = made.map((b) => b.id);
    placed.current = [...ids, ...placed.current.filter((id) => !ids.includes(id))];
    setTickets((list) => spikeOrder([...made, ...list.filter((b) => !ids.includes(b.id))], placed.current));
  };

  const replaceTicket = useCallback((booking: Booking) => {
    setTickets((list) => spikeOrder(list.map((b) => (b.id === booking.id ? booking : b)), placed.current));
  }, []);

  /** A 409 means someone else changed the booking first: re-request it and the ledger, redraw only that ticket. */
  const followServer = useCallback(
    async (bookingId: string) => {
      const [fresh, ledger] = await Promise.all([
        api<{ booking: Booking }>(`/api/bookings/${bookingId}`),
        api<{ balances: Balances }>("/api/me/ledger"),
      ]);
      if (fresh.ok) replaceTicket(fresh.data.booking);
      if (ledger.ok) applyBalances(ledger.data.balances);
      afterDraw(() => ticketElements.current.get(bookingId)?.focus());
    },
    [replaceTicket, applyBalances],
  );

  // When a hold's countdown reaches zero the dial reloads and the expiry is announced; the ticket follows the server.
  const watchExpired = useCallback(
    (bookingId: string) => {
      const check = async (): Promise<void> => {
        const fresh = reloadsPaused() ? null : await api<{ booking: Booking }>(`/api/bookings/${bookingId}`);
        if (fresh?.ok) replaceTicket(fresh.data.booking);
        if (fresh?.ok && fresh.data.booking.status !== "held") void refreshBalances();
        else setTimeout(() => void check(), EXPIRY_RECHECK_MS);
      };
      void check();
    },
    [replaceTicket, refreshBalances],
  );

  useEffect(() => {
    const id = setInterval(() => {
      if (reloadsPaused()) return;
      const now = serverNow();
      const due = tickets.filter((b) => b.status === "held" && !expiredOnScreen.has(b.id) && Date.parse(b.hold_expires_at ?? "") <= now);
      if (due.length === 0) return;
      setExpiredOnScreen((previous) => new Set([...previous, ...due.map((b) => b.id)]));
      say(HOLD_EXPIRED, "error");
      reloadDials();
      for (const b of due) watchExpired(b.id);
    }, 1000);
    return () => clearInterval(id);
  }, [tickets, expiredOnScreen, reloadDials, say, watchExpired]);

  const drawOwnHold = (booking: Booking, kind: DialStation["kind"]): void => {
    setDrawn((current) => {
      if (!current || current.subject.date !== booking.date) return current;
      const bufferEnd = Math.min(1440, (parseWall(booking.end) ?? 0) + SANITATION_BUFFER_MINUTES[kind]);
      const added: Sector[] = [
        { kind: "own_held", start: booking.start, end: booking.end, booking_id: booking.id },
        { kind: "buffer", start: booking.end, end: formatWall(bufferEnd), booking_id: booking.id },
      ];
      return {
        ...current,
        stations: current.stations.map((st) => (st.id === booking.station_id ? { ...st, sectors: [...st.sectors, ...added] } : st)),
      };
    });
  };

  const actions: DialActions = useMemo(
    () => ({
      holdPending: (w) => say(`Holding ${formatWall(w.start)}–${formatWall(w.end)}…`),
      sendHold: async (station, date, w, key) => {
        const result = await api<{ booking: Booking; balances: Balances }>("/api/bookings", {
          method: "POST",
          body: { station_id: station.id, date, start: formatWall(w.start), end: formatWall(w.end) },
          idempotencyKey: key,
        });
        if (result.ok) {
          return {
            outcome: "held" as const,
            apply: () => {
              const booking = result.data.booking;
              spikeNew([booking]);
              applyBalances(result.data.balances);
              drawOwnHold(booking, station.kind);
              const zone = sites.find((s) => s.id === booking.site_id)?.time_zone ?? timeZone;
              const expires = formatWall(wallClock(Date.parse(booking.hold_expires_at ?? ""), zone).minutes);
              say(`Held ${station.name} ${booking.start}–${booking.end}. Confirm before ${expires} site time.`);
              reloadDials();
            },
          };
        }
        if (result.error === null || result.error.code === "idempotency_in_progress" || result.status === 401) {
          return { outcome: "not_final" as const, error: result.error };
        }
        const error: ApiErrorBody["error"] = result.error;
        return {
          outcome: "refused" as const,
          error,
          apply: () => {
            say(error.code === "certificate_expired" ? certificateCopy(date) : errorCopy(result, HOLD_ERRORS), "error");
            reloadDials();
            void refreshBalances();
          },
        };
      },
      holdNotFinal: (error) => {
        if (error === null) say(DROPPED, "error");
        else if (error.code === "idempotency_in_progress") say(HOLD_ERRORS.idempotency_in_progress ?? "", "error");
      },
      confirm: async (booking) => {
        say("Confirming…");
        const result = await api<{ booking: Booking; balances: Balances }>(`/api/bookings/${booking.id}/confirm`, { method: "POST" });
        if (!result.ok) {
          const code = result.error?.code;
          if (code === "hold_expired" || code === "invalid_transition") {
            say(code === "hold_expired" ? HOLD_EXPIRED : TICKET_CHANGED, "error");
            reloadDials();
            await followServer(booking.id);
            return false;
          }
          say(code === "certificate_expired" ? certificateCopy(booking.date) : errorCopy(result, {}), "error");
          return false;
        }
        const confirmed = result.data.booking;
        replaceTicket(confirmed);
        applyBalances(result.data.balances);
        setDrawn((current) =>
          current && {
            ...current,
            stations: current.stations.map((st) => ({
              ...st,
              sectors: st.sectors.map((s) => (s.booking_id === confirmed.id && s.kind === "own_held" ? { ...s, kind: "own_confirmed" } : s)),
            })),
          },
        );
        say(`Confirmed ${confirmed.station_name} ${confirmed.date} ${confirmed.start}–${confirmed.end}. ${hoursText(result.data.balances.available_hours)} pack hours left.`);
        afterDraw(() => ticketElements.current.get(confirmed.id)?.focus());
        reloadDials();
        return true;
      },
      release: async (booking) => {
        say("Releasing…");
        const result = await api<{ booking: Booking; refunded_hours: number; balances: Balances }>(`/api/bookings/${booking.id}/cancel`, { method: "POST" });
        if (!result.ok) {
          say(errorCopy(result, { invalid_transition: TICKET_CHANGED }), "error");
          if (result.error?.code === "invalid_transition") {
            reloadDials();
            await followServer(booking.id);
          }
          return;
        }
        replaceTicket(result.data.booking);
        applyBalances(result.data.balances);
        say(`Hold released. ${hoursText(result.data.refunded_hours)} pack hours returned.`);
        reloadDials();
      },
      repeat: (station, w, opener) => {
        repeatOpener.current = opener;
        setRepeat({ station, window: w });
      },
      slotTaken: () => say(HOLD_ERRORS.slot_taken ?? "", "error"),
    }),
    [sites, timeZone, say, reloadDials, applyBalances, replaceTicket, followServer, refreshBalances],
  );

  const holdFor = (station: DialStation, date: IsoDate): Booking | null =>
    tickets.find((b) => b.status === "held" && b.station_id === station.id && b.date === date && !expiredOnScreen.has(b.id)) ?? null;

  const stations = drawn?.stations ?? [];

  return (
    <div className="screen book">
      {sites.length > 0 && subject && (
        <Rail
          sites={sites}
          siteId={subject.siteId}
          onSite={(id) => {
            const next = sites.find((s) => s.id === id);
            if (!next) return;
            const minutes = Number(next.local_now.slice(11, 13)) * 60 + Number(next.local_now.slice(14, 16));
            changeSubject({ ...subject, siteId: id, date: nextOpenDate(next.local_date, minutes) });
          }}
          date={subject.date}
          onDate={(date) => changeSubject({ ...subject, date })}
          filter={subject.filter}
          onFilter={(filter) => changeSubject({ ...subject, filter })}
        />
      )}
      <div className="book-grid">
        <section className="dials" aria-labelledby="dials-title">
          <h1 id="dials-title" className="screen-title">
            Book
          </h1>
          <Status name="Booking status" message={status} />
          <div className="dial-list">
            {drawn &&
              stations.map((station) => (
                <BurnerDial
                  key={station.id}
                  station={station}
                  date={drawn.subject.date}
                  timeZone={sites.find((s) => s.id === drawn.subject.siteId)?.time_zone ?? timeZone}
                  available={available}
                  hold={holdFor(station, drawn.subject.date)}
                  reduced={reduced}
                  busy={busy}
                  subjectStamp={subjectStamp}
                  reloadStamp={reloadStamp}
                  seriesStamp={seriesBooked[station.id] ?? 0}
                  actions={actions}
                />
              ))}
          </div>
        </section>
        <Spike
          tickets={tickets}
          sites={sites}
          userId={me.user.id}
          onCancel={setCancelling}
          ticketRef={(id, element) => {
            if (element) ticketElements.current.set(id, element);
            else ticketElements.current.delete(id);
          }}
        />
      </div>
      {cancelling && (
        <CancelDialog
          booking={cancelling}
          onClose={() => setCancelling(null)}
          returnFocus={() => {
            const id = focusTicketId.current;
            focusTicketId.current = null;
            return id ? (ticketElements.current.get(id) ?? null) : null;
          }}
          onDone={(result) => {
            replaceTicket(result.booking);
            applyBalances(result.balances);
            focusTicketId.current = result.booking.id;
            reloadDials();
          }}
          onChangedElsewhere={async (booking) => {
            focusTicketId.current = booking.id;
            reloadDials();
            await followServer(booking.id);
          }}
          say={say}
        />
      )}
      {repeat && subject && (
        <RepeatDialog
          state={repeat}
          date={drawn?.subject.date ?? subject.date}
          timeZone={timeZone}
          available={available}
          returnFocus={() => repeatOpener.current}
          onClose={() => setRepeat(null)}
          onBooked={(list, balances) => {
            spikeNew(list);
            applyBalances(balances);
            setSeriesBooked((now) => ({ ...now, [repeat.station.id]: (now[repeat.station.id] ?? 0) + 1 }));
            reloadDials();
          }}
          say={say}
        />
      )}
    </div>
  );
}

/** Focus lands after React has drawn the answer. */
function afterDraw(work: () => void): void {
  const channel = new MessageChannel();
  channel.port1.onmessage = () => {
    channel.port1.close();
    work();
  };
  channel.port2.postMessage(null);
}

interface CancelResult {
  booking: Booking;
  refunded_hours: number;
  forfeited_hours: number;
  balances: Balances;
}

function CancelDialog({
  booking,
  onClose,
  returnFocus,
  onDone,
  onChangedElsewhere,
  say,
}: {
  booking: Booking;
  onClose: () => void;
  returnFocus: () => HTMLElement | null;
  onDone: (result: CancelResult) => void;
  onChangedElsewhere: (booking: Booking) => Promise<void>;
  say: Say;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title={`Cancel booking ${booking.reference}`} onClose={onClose} returnFocus={returnFocus} interruptible>
      {(close) => (
        <>
          <CancellationOutcome booking={booking} />
          <div className="dialog-actions">
            <ActionButton
              pending={busy}
              className="button button-primary"
              onPress={async () => {
                setBusy(true);
                say("Cancelling…");
                const result = await api<CancelResult>(`/api/bookings/${booking.id}/cancel`, { method: "POST", resumable: true });
                setBusy(false);
                if (result.ok) {
                  say(memberCancelled(hoursToQuarters(result.data.refunded_hours), hoursToQuarters(result.data.forfeited_hours)));
                  onDone(result.data);
                  close();
                  return;
                }
                say(errorCopy(result, { invalid_transition: TICKET_CHANGED }), "error");
                if (result.error?.code === "invalid_transition") {
                  await onChangedElsewhere(booking);
                  close();
                }
              }}
            >
              Confirm cancellation
            </ActionButton>
            <button type="button" className="button" onClick={close}>
              Keep booking
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}

const SERIES_ERRORS: Record<string, string> = {
  cutoff: HOLD_ERRORS.cutoff ?? "",
  insufficient_hours: HOLD_ERRORS.insufficient_hours ?? "",
  validation: HOLD_ERRORS.validation ?? "",
};

const MIN_WEEKS = 2;
const MAX_WEEKS = 12;
const START_WEEKS = 4;

/** Every occurrence of the window on this date's weekday, with its elapsed hours in the site's zone. */
function occurrences(date: IsoDate, w: ClaimWindow, weeks: number, timeZone: string): { date: IsoDate; quarters: Quarters }[] {
  return Array.from({ length: weeks }, (_, k) => {
    const on = addDays(date, 7 * k);
    return { date: on, quarters: elapsedQuarters(on, w.start, w.end, timeZone) };
  });
}

function RepeatDialog({
  state,
  date,
  timeZone,
  available,
  returnFocus,
  onClose,
  onBooked,
  say,
}: {
  state: RepeatState;
  date: IsoDate;
  timeZone: string;
  available: Quarters;
  returnFocus: () => HTMLElement | null;
  onClose: () => void;
  onBooked: (bookings: Booking[], balances: Balances) => void;
  say: Say;
}): ReactNode {
  const [weeks, setWeeks] = useState(START_WEEKS);
  const [typed, setTyped] = useState(String(START_WEEKS));
  const [refused, setRefused] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [written, setWritten] = useState<{ total: Quarters; weeks: number; after: Quarters } | null>(null);
  const { start, end } = state.window;
  const list = useMemo(() => occurrences(date, state.window, weeks, timeZone), [date, state.window, weeks, timeZone]);
  const total = list.reduce((sum, o) => sum + o.quarters, 0);
  const fits = total <= available;
  useEffect(() => {
    setWritten({ total, weeks, after: available - total });
  }, [total, weeks, available]);
  const setFromKeys = (next: number): void => {
    const value = Math.min(MAX_WEEKS, Math.max(MIN_WEEKS, Math.trunc(next)));
    setWeeks(value);
    setTyped(String(value));
  };
  return (
    <Dialog title="Repeat weekly" onClose={onClose} returnFocus={returnFocus}>
      {(close) => (
        <>
          <p className="dialog-text">
            Every {weekdayOf(date)} <span className="mono">{formatWall(start)}–{formatWall(end)}</span>
          </p>
          <div className="field">
            <label htmlFor="series-weeks">Number of weeks</label>
            <input
              id="series-weeks"
              data-autofocus
              type="number"
              min={MIN_WEEKS}
              max={MAX_WEEKS}
              step={1}
              value={typed}
              onChange={(event) => {
                const raw = event.target.value;
                const value = Number(raw);
                if (raw === "" || !Number.isInteger(value) || (value < MIN_WEEKS && raw === "1")) {
                  // A partly typed value: the bound replaces it when focus leaves, unless the next key completes it.
                  setTyped(raw);
                  if (raw === "1") setWeeks(MIN_WEEKS);
                  return;
                }
                setFromKeys(value);
              }}
              onBlur={() => setFromKeys(Number(typed) || MIN_WEEKS)}
            />
          </div>
          <ul aria-label="Occurrences" role="list" className="occurrences">
            {list.map((o) => (
              <li key={o.date} className="mono">
                {o.date} {formatWall(start)}–{formatWall(end)} · {quartersText(o.quarters)} h
              </li>
            ))}
          </ul>
          <StatusRegion name="Series total" className="series-total">
            {written && (
              <>
                <span className="series-line">
                  Uses <span className="mono">{quartersText(written.total)}</span> pack hours
                </span>{" "}
                {written.after >= 0 ? (
                  <span className="series-line">
                    Pack hours after this series <span className="mono">{quartersText(written.after)}</span>
                  </span>
                ) : (
                  <span className="series-line series-short">Not enough pack hours for {written.weeks} weeks.</span>
                )}
              </>
            )}
          </StatusRegion>
          {refused && <p className="dialog-error">{refused}</p>}
          <div className="dialog-actions">
            <ActionButton
              pending={busy || !fits}
              className="button button-primary"
              onPress={async () => {
                setBusy(true);
                say(`Booking ${weeks} weeks…`);
                const result = await api<{ bookings: Booking[]; balances: Balances }>("/api/recurring-series", {
                  method: "POST",
                  body: { station_id: state.station.id, first_date: date, start: formatWall(start), end: formatWall(end), weeks },
                });
                setBusy(false);
                if (result.ok) {
                  say(`Booked ${weeks} weekly slots. ${hoursText(result.data.balances.available_hours)} pack hours left.`);
                  onBooked(result.data.bookings, result.data.balances);
                  close();
                  return;
                }
                const dates = (result.error?.dates ?? []).join(", ");
                const code = result.error?.code;
                const copy =
                  code === "series_conflict"
                    ? `Some weeks are taken: ${dates}. Nothing was booked.`
                    : code === "certificate_expired"
                      ? `Your insurance doesn't cover: ${dates}. Nothing was booked.`
                      : errorCopy(result, SERIES_ERRORS);
                say(copy, "error");
                setRefused(copy);
              }}
            >
              Book series
            </ActionButton>
            <button type="button" className="button" onClick={close}>
              Close
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}
