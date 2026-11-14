import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Booking, call, messageOf } from "../api";
import { type Countdown, countdownFrom, setServerNow } from "../clock";
import { FieldBand } from "../components/Feedback";
import { Halo } from "../components/Halo";
import { ChevronLeftIcon, ChevronRightIcon } from "../components/Icons";
import { type CellInfo, SlotDialog } from "../components/SlotDialog";
import { type SlotDraft, clearDraft, readDraft } from "../draft";
import { addDays, clubTime, clubToday, validDay } from "../format";
import { navigate, useLocation } from "../router";
import { serverNow } from "../clock";
import { useSession } from "../session";

interface GridCell {
  court: number;
  start: string;
  start_utc: string;
  state: "free" | "held" | "booked" | "match" | "lesson" | "past";
  mine: boolean;
  booking_id: string | null;
  match_id: string | null;
  players: number | null;
}

interface GridAnswer {
  server_now: string;
  days: { date: string; cells: GridCell[] }[];
}

const courts = [1, 2, 3, 4, 5, 6, 7];
const refreshMs = 10_000;
const dateMessage = "Use a date like 2027-03-28.";

function stateWord(cell: GridCell): string {
  switch (cell.state) {
    case "free":
      return "Free";
    case "held":
      return cell.mine ? "Your hold" : "Held";
    case "booked":
      return cell.mine ? "Your booking" : "Booked";
    case "match":
      return "Open match";
    case "lesson":
      return "Lesson";
    default:
      return "Past";
  }
}

const cellKey = (court: number, startUtc: string) => `${court}|${startUtc}`;

/** The `cell` query, `<n>-<HH:MM>`; anything else is ignored. */
function askedCell(text: string | null): { court: number; time: string } | null {
  const found = text ? /^([1-7])-(\d{2}:\d{2})$/.exec(text) : null;
  return found ? { court: Number(found[1]), time: found[2] } : null;
}

const narrowQuery = "(width <= 799px)";

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia(narrowQuery).matches);
  useEffect(() => {
    const query = window.matchMedia(narrowQuery);
    const update = () => setNarrow(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return narrow;
}

export function Courts() {
  const session = useSession();
  const { search } = useLocation();
  const asked = search.get("day");
  const askedValid = asked !== null && validDay(asked);
  const day = askedValid ? asked : session.state === "loading" ? null : clubToday(serverNow());
  const [dateText, setDateText] = useState(day ?? "");
  const [dateError, setDateError] = useState(asked !== null && !askedValid ? dateMessage : "");
  const [grid, setGrid] = useState<GridAnswer | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [open, setOpen] = useState<CellInfo | null>(null);
  const [restored, setRestored] = useState<SlotDraft | null>(null);
  const cellQuery = search.get("cell");
  const placed = useRef<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [countdowns, setCountdowns] = useState<Record<string, Countdown>>({});
  const refs = useRef(new Map<string, HTMLElement>());
  const wantFocus = useRef<string | null>(null);
  const latest = useRef(0);

  useEffect(() => {
    setDateText(day ?? "");
    setDateError(asked !== null && !askedValid ? dateMessage : "");
    setGrid(null);
  }, [day, asked, askedValid]);

  const holds = useMemo(
    () => ({
      countdowns,
      track: (booking: Booking) => {
        if (booking.remaining_ms === null || !booking.expires_at) return;
        const next = countdownFrom(booking.remaining_ms, booking.created_at, booking.expires_at);
        setCountdowns((current) => ({ ...current, [booking.id]: next }));
      },
      drop: (id: string) =>
        setCountdowns((current) => {
          if (!(id in current)) return current;
          const { [id]: _gone, ...rest } = current;
          return rest;
        }),
    }),
    [countdowns],
  );

  const load = useCallback(async () => {
    if (!day) return;
    const ticket = ++latest.current;
    try {
      const answer = await call<GridAnswer>(`/api/grid?from=${day}`);
      if (ticket !== latest.current) return;
      setServerNow(answer.server_now);
      setGrid(answer);
      setFailed(null);
      const mine = new Set(answer.days.flatMap((d) => d.cells).filter((c) => c.mine && c.state === "held" && c.booking_id).map((c) => c.booking_id as string));
      const fresh = await Promise.all([...mine].map((id) => call<Booking>(`/api/bookings/${id}`).catch(() => null)));
      if (ticket !== latest.current) return;
      setCountdowns((current) => {
        const next: Record<string, Countdown> = {};
        for (const booking of fresh) {
          if (booking && booking.status === "held" && booking.remaining_ms !== null && booking.expires_at) {
            next[booking.id] = countdownFrom(booking.remaining_ms, booking.created_at, booking.expires_at);
          }
        }
        for (const id of Object.keys(current)) if (mine.has(id) && !(id in next) && fresh.every((b) => b?.id !== id)) next[id] = current[id];
        return next;
      });
    } catch (error) {
      if (ticket === latest.current) setFailed(messageOf(error));
    }
  }, [day]);

  useEffect(() => {
    if (!day) return;
    void load();
    const timer = window.setInterval(() => void load(), refreshMs);
    return () => window.clearInterval(timer);
  }, [day, load]);

  const cells = grid?.days[0]?.cells ?? [];
  const rows = useMemo(() => {
    const byStart = new Map<string, GridCell[]>();
    for (const cell of cells) byStart.set(cell.start_utc, [...(byStart.get(cell.start_utc) ?? []), cell]);
    return [...byStart.entries()].map(([startUtc, row]) => ({ startUtc, time: clubTime(row[0].start), cells: [...row].sort((a, b) => a.court - b.court) }));
  }, [cells]);

  // A hold's halo rings its first cell only, so the held cell and the dialog badge carry one ring each.
  const haloCells = useMemo(() => {
    const first = new Map<string, string>();
    for (const row of rows) for (const cell of row.cells) if (cell.booking_id && !first.has(cell.booking_id)) first.set(cell.booking_id, cellKey(cell.court, cell.start_utc));
    return new Set(first.values());
  }, [rows]);
  const narrow = useNarrow();

  const firstFree = useMemo(() => {
    const free = cells.find((c) => c.state === "free") ?? cells[0];
    return free ? cellKey(free.court, free.start_utc) : null;
  }, [cells]);
  const tabStop = focusKey && refs.current.has(focusKey) ? focusKey : firstFree;

  // Once the day's grid is in, `cell` reopens the dialog a person left when their session ended (only for that same
  // person), or else just moves grid focus to that cell. Either happens once per address.
  useEffect(() => {
    if (!day || !grid || session.state !== "signed-in" || grid.days[0]?.date !== day) return;
    const address = `${day}|${cellQuery ?? ""}`;
    if (placed.current === address) return;
    placed.current = address;
    const target = askedCell(cellQuery);
    const found = target ? cells.find((c) => c.court === target.court && clubTime(c.start) === target.time) : undefined;
    if (!target || !found) return;
    const draft = readDraft();
    clearDraft();
    const key = cellKey(found.court, found.start_utc);
    setFocusKey(key);
    if (draft && draft.username === session.me.username && draft.day === day && draft.court === target.court && draft.time === target.time) {
      refs.current.get(key)?.focus({ preventScroll: true });
      setRestored(draft);
      setOpen({ court: found.court, start: found.start, state: found.state, mine: found.mine, bookingId: found.booking_id });
    } else {
      wantFocus.current = key;
    }
  }, [day, grid, cells, cellQuery, session]);

  useEffect(() => {
    if (wantFocus.current) {
      refs.current.get(wantFocus.current)?.focus({ preventScroll: false });
      wantFocus.current = null;
    }
  });

  const go = (to: string) => navigate(`/courts?day=${to}`);

  const commitDate = () => {
    if (validDay(dateText)) {
      setDateError("");
      go(dateText);
    } else {
      setDateError(dateMessage);
    }
  };

  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[role=gridcell]");
    if (!target) return;
    const court = Number(target.dataset.court);
    const rowIndex = rows.findIndex((r) => r.startUtc === target.dataset.start);
    let nextCourt = court;
    let nextRow = rowIndex;
    switch (event.key) {
      case "ArrowUp":
        nextRow = Math.max(0, rowIndex - 1);
        break;
      case "ArrowDown":
        nextRow = Math.min(rows.length - 1, rowIndex + 1);
        break;
      case "ArrowLeft":
        nextCourt = Math.max(1, court - 1);
        break;
      case "ArrowRight":
        nextCourt = Math.min(courts.length, court + 1);
        break;
      case "Home":
        nextCourt = 1;
        break;
      case "End":
        nextCourt = courts.length;
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        target.click();
        return;
      default:
        return;
    }
    event.preventDefault();
    const key = cellKey(nextCourt, rows[nextRow].startUtc);
    setFocusKey(key);
    refs.current.get(key)?.focus();
  };

  const openCell = (cell: GridCell) =>
    setOpen({ court: cell.court, start: cell.start, state: cell.state, mine: cell.mine, bookingId: cell.booking_id });

  const closeDialog = () => {
    setOpen(null);
    setRestored(null);
  };

  return (
    <div className="page">
      <div className="column">
        <h1 className="page__title">Courts</h1>
        <div className="day-bar">
          <button type="button" className="pill pill--outline" aria-label="Previous day" disabled={!day} onClick={() => day && go(addDays(day, -1))}>
            <ChevronLeftIcon size={18} />
          </button>
          <div className="day-bar__date">
            <input
              type="text"
              inputMode="numeric"
              aria-label="Date"
              aria-describedby={dateError ? "date-error" : undefined}
              aria-invalid={dateError ? true : undefined}
              value={dateText}
              maxLength={10}
              onChange={(e) => setDateText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && commitDate()}
              onBlur={() => dateText !== day && validDay(dateText) && commitDate()}
            />
          </div>
          <button type="button" className="pill pill--outline" aria-label="Next day" disabled={!day} onClick={() => day && go(addDays(day, 1))}>
            <ChevronRightIcon size={18} />
          </button>
        </div>
        {dateError && <FieldBand id="date-error">{dateError}</FieldBand>}
        {failed && !grid && (
          <p role="alert" className="error-band">
            {failed}
          </p>
        )}

        {/* The grid scrolls sideways only in the narrow layout, and only then is its box a tab stop of its own. */}
        <div className="grid-scroll" tabIndex={narrow ? 0 : undefined}>
          <div className="grid" role="grid" aria-label="Court schedule" onKeyDown={move}>
            <div role="row" className="grid__row grid__row--head">
              <div role="columnheader" aria-label="Time" className="grid__time" />
              {courts.map((court) => (
                <div role="columnheader" key={court} className="grid__court">
                  Court {court}
                </div>
              ))}
            </div>
            {rows.map((row) => (
              <div role="row" className="grid__row" key={row.startUtc}>
                <div role="rowheader" className="grid__time">
                  {row.time}
                </div>
                {row.cells.map((cell) => {
                  const key = cellKey(cell.court, cell.start_utc);
                  const word = stateWord(cell);
                  const countdown = cell.state === "held" && cell.mine && cell.booking_id && haloCells.has(key) ? countdowns[cell.booking_id] : undefined;
                  return (
                    <div
                      role="gridcell"
                      key={key}
                      ref={(element) => {
                        if (element) refs.current.set(key, element);
                        else refs.current.delete(key);
                      }}
                      tabIndex={tabStop === key ? 0 : -1}
                      aria-label={`Court ${cell.court}, ${row.time}, ${word}`}
                      className={`cell cell--${cell.state}${cell.mine ? " cell--mine" : ""}`}
                      data-court={cell.court}
                      data-start={cell.start_utc}
                      onFocus={() => setFocusKey(key)}
                      onClick={() => openCell(cell)}
                    >
                      {countdown && <Halo countdown={countdown} shape="cell" />}
                      <span className="cell__word" aria-hidden="true">
                        {word}
                      </span>
                      {cell.state === "match" && cell.players !== null && (
                        <span className="cell__dots" aria-hidden="true">
                          {Array.from({ length: cell.players }, (_, i) => (
                            <i key={i} />
                          ))}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        {!grid && !failed && <p className="muted">Loading the schedule…</p>}
      </div>

      {open && session.state === "signed-in" && (
        <SlotDialog
          cell={open}
          day={day ?? ""}
          draft={restored}
          me={session.me}
          holds={holds}
          onClose={closeDialog}
          onChanged={() => void load()}
        />
      )}
    </div>
  );
}
