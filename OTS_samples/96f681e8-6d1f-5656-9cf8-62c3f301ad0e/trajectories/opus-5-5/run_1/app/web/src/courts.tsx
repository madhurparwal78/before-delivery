import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { useSession } from "./main";
import { Countdown, Halo, HoldClock, clockFrom } from "./halo";
import {
  DRAFT_KEY,
  RequestKey,
  addDays,
  announce,
  api,
  clubTime,
  codePoints,
  dateMessage,
  errorText,
  euros,
  get,
  goSignIn,
  level,
  levelOptions,
  mmss,
  navigate,
  syncServerClock,
  todayClub,
  trapKeys,
  useInterval,
  validDate,
} from "./lib";
import { Alert, FieldError, PendingButton } from "./ui";

export type Cell = {
  court: number;
  start: string;
  start_utc: string;
  state: string;
  mine: boolean;
  booking_id: string | null;
  match_id: string | null;
  players: number | null;
};

type GridAnswer = { server_now: string; days: { date: string; cells: Cell[] }[] };

type Draft = {
  username: string;
  day: string;
  court: number;
  time: string;
  minutes: number;
  split: boolean;
  emails: string[];
  note: string;
  openMatch: boolean;
  levelMin: number;
  levelMax: number;
  bookingId: string | null;
};

const COURTS = [1, 2, 3, 4, 5, 6, 7];

/** Holds whose release has been announced on this page, so it is said once. */
const releasedAnnounced = new Set<string>();

function announceReleased(id: string) {
  if (releasedAnnounced.has(id)) return;
  releasedAnnounced.add(id);
  announce("Hold released.");
}

export function cellWord(c: Cell) {
  switch (c.state) {
    case "held":
      return c.mine ? "Your hold" : "Held";
    case "booked":
      return c.mine ? "Your booking" : "Booked";
    case "match":
      return "Open match";
    case "lesson":
      return "Lesson";
    case "past":
      return "Past";
  }
  return "Free";
}

const cellKey = (court: number, time: string) => `${court}-${time}`;

function parseCellParam(v: string | null) {
  const m = v?.match(/^([1-7])-(\d{2}:\d{2})$/);
  return m ? { court: Number(m[1]), time: m[2] } : null;
}

function readDraft(): Draft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

function Dots({ n }: { n: number }) {
  return (
    <span class="dots" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <span class={"dot" + (i < n ? " on" : "")} />
      ))}
    </span>
  );
}

export function CourtsPage({ query }: { query: URLSearchParams }) {
  const { me, club } = useSession();
  const rawDay = query.get("day");
  const dayValid = rawDay === null || validDate(rawDay);
  const [today, setToday] = useState(todayClub());
  const day = rawDay && dayValid ? rawDay : today;
  const [grid, setGrid] = useState<{ day: string; cells: Map<string, Cell>; times: string[] } | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ cell: Cell; time: string; draft: Draft | null } | null>(null);
  const [clocks, setClocks] = useState<Record<string, HoldClock>>({});
  const [overrides, setOverrides] = useState<Record<string, Partial<Cell>>>({});
  const [dateField, setDateField] = useState(rawDay ?? day);
  const tableRef = useRef<HTMLTableElement>(null);
  const moveFocus = useRef(false);
  const restored = useRef(false);
  const loadSeq = useRef(0);

  useEffect(() => setDateField(rawDay && dayValid ? rawDay : rawDay ?? day), [rawDay]);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    const a = await get<GridAnswer>(`/api/grid?from=${day}`);
    if (seq !== loadSeq.current || a.status !== 200) return;
    syncServerClock(a.data.server_now);
    setToday(todayClub());
    const cells = new Map<string, Cell>();
    const times: string[] = [];
    for (const c of a.data.days[0].cells) {
      const t = clubTime(c.start);
      if (!times.includes(t)) times.push(t);
      cells.set(cellKey(c.court, t), c);
    }
    setOverrides({});
    setGrid({ day, cells, times });
  }, [day]);

  useEffect(() => {
    setGrid(null);
    load();
  }, [load]);
  useInterval(load, 10000);

  // Track a server-timed clock for each of my live holds shown on the grid.
  useEffect(() => {
    if (!grid) return;
    for (const c of grid.cells.values()) {
      if (c.state === "held" && c.mine && c.booking_id && !clocks[c.booking_id]) syncHold(c.booking_id);
    }
  }, [grid]);

  const syncHold = useCallback(
    async (id: string) => {
      const a = await get(`/api/bookings/${id}`);
      if (a.status !== 200) return null;
      syncServerClock(a.data.server_now);
      if (a.data.status === "held") {
        setClocks((m) => ({ ...m, [id]: clockFrom(a.data.remaining_ms, club.hold_seconds * 1000) }));
      } else {
        setClocks((m) => {
          const n = { ...m };
          delete n[id];
          return n;
        });
        if (a.data.status === "released") announceReleased(id);
        load();
      }
      return a.data;
    },
    [load, club],
  );

  // First visit focus target and session-ended draft restore.
  useEffect(() => {
    if (!grid || restored.current) return;
    restored.current = true;
    const want = parseCellParam(query.get("cell"));
    const draft = readDraft();
    if (draft) sessionStorage.removeItem(DRAFT_KEY);
    if (want && grid.cells.has(cellKey(want.court, want.time))) {
      moveFocus.current = true;
      setFocusKey(cellKey(want.court, want.time));
      if (draft && me && draft.username === me.username && draft.day === day && draft.court === want.court && draft.time === want.time) {
        setDialog({ cell: grid.cells.get(cellKey(want.court, want.time))!, time: want.time, draft });
      }
    }
  }, [grid]);

  const cellAt = (k: string): Cell | undefined => {
    const c = grid?.cells.get(k);
    return c && overrides[k] ? { ...c, ...overrides[k] } : c;
  };

  const activeKey = (() => {
    if (!grid) return null;
    if (focusKey && grid.cells.has(focusKey)) return focusKey;
    for (const t of grid.times) for (const n of COURTS) if (grid.cells.get(cellKey(n, t))?.state === "free") return cellKey(n, t);
    return grid.times.length ? cellKey(1, grid.times[0]) : null;
  })();

  useLayoutEffect(() => {
    if (!moveFocus.current || !activeKey) return;
    moveFocus.current = false;
    const el = tableRef.current?.querySelector<HTMLElement>(`[data-key="${activeKey}"]`);
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeKey, focusKey]);

  const onGridKey = (e: KeyboardEvent) => {
    if (!grid || !activeKey) return;
    const [courtS, time] = [activeKey.split("-")[0], activeKey.slice(activeKey.indexOf("-") + 1)];
    let col = Number(courtS) - 1;
    let row = grid.times.indexOf(time);
    switch (e.key) {
      case "ArrowUp":
        row = Math.max(0, row - 1);
        break;
      case "ArrowDown":
        row = Math.min(grid.times.length - 1, row + 1);
        break;
      case "ArrowLeft":
        col = Math.max(0, col - 1);
        break;
      case "ArrowRight":
        col = Math.min(6, col + 1);
        break;
      case "Home":
        col = 0;
        break;
      case "End":
        col = 6;
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        openCell(activeKey);
        return;
      default:
        return;
    }
    e.preventDefault();
    moveFocus.current = true;
    setFocusKey(cellKey(col + 1, grid.times[row]));
  };

  const openCell = (k: string) => {
    const c = cellAt(k);
    if (!c) return;
    setFocusKey(k);
    setDialog({ cell: c, time: k.slice(k.indexOf("-") + 1), draft: null });
  };

  const closeDialog = () => {
    tableRef.current?.querySelector<HTMLElement>(`[data-key="${activeKey}"]`)?.focus({ preventScroll: true });
    setDialog(null);
  };

  const goDay = (d: string) => navigate(`/courts?day=${d}`);

  // The halo sits on the cell where each of my holds starts.
  const holdStarts = new Map<string, string>();
  if (grid) {
    for (const t of grid.times) {
      for (const n of COURTS) {
        const c = grid.cells.get(cellKey(n, t));
        if (c?.state === "held" && c.mine && c.booking_id && !holdStarts.has(c.booking_id)) holdStarts.set(c.booking_id, cellKey(n, t));
      }
    }
  }

  const onClock = (id: string, clock: HoldClock | null) =>
    setClocks((m) => {
      const n = { ...m };
      if (clock) n[id] = clock;
      else delete n[id];
      return n;
    });

  return (
    <div class="column page courts-page">
      <h1>Courts</h1>
      <div class="day-bar">
        <button type="button" class="pill pill-outline" onClick={() => goDay(addDays(day, -1))}>
          Previous day
        </button>
        <div class="field day-field">
          <label for="day-input">Date</label>
          <input
            id="day-input"
            type="text"
            inputMode="numeric"
            value={dateField}
            aria-invalid={!dayValid}
            aria-describedby={!dayValid ? "day-error" : undefined}
            onInput={(e) => setDateField((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                goDay(dateField.trim());
              }
            }}
          />
          {!dayValid && <FieldError id="day-error" text={dateMessage} />}
        </div>
        <button type="button" class="pill pill-outline" onClick={() => goDay(addDays(day, 1))}>
          Next day
        </button>
      </div>
      <div class="grid-scroll">
        {grid ? (
          <table role="grid" aria-label="Court schedule" class="schedule" ref={tableRef} onKeyDown={onGridKey}>
            <thead>
              <tr>
                <td class="corner" aria-hidden="true" />
                {COURTS.map((n) => (
                  <th scope="col">Court {n}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.times.map((t) => (
                <tr>
                  <th scope="row" class="time">
                    {t}
                  </th>
                  {COURTS.map((n) => {
                    const k = cellKey(n, t);
                    const c = cellAt(k);
                    if (!c) return <td class="cell cell-none" aria-hidden="true" />;
                    const word = cellWord(c);
                    const clock =
                      c.state === "held" && c.mine && c.booking_id && holdStarts.get(c.booking_id) === k
                        ? clocks[c.booking_id]
                        : undefined;
                    return (
                      <td
                        role="gridcell"
                        data-key={k}
                        tabIndex={k === activeKey ? 0 : -1}
                        aria-label={`Court ${n}, ${t}, ${word}`}
                        class={`cell cell-${c.state}${c.mine ? " mine" : ""}`}
                        onClick={() => openCell(k)}
                        onFocus={() => setFocusKey(k)}
                      >
                        <span class="cell-word" aria-hidden="true">
                          {word}
                        </span>
                        {c.state === "match" && <Dots n={c.players ?? 0} />}
                        {clock && (
                          <Halo clock={clock} shape="cell" onZero={() => c.booking_id && syncHold(c.booking_id)} />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p class="loading">Loading the schedule…</p>
        )}
      </div>
      {dialog && grid && (
        <SlotDialog
          key={`${dialog.cell.court}-${dialog.time}`}
          cell={dialog.cell}
          day={grid.day}
          time={dialog.time}
          draft={dialog.draft}
          clocks={clocks}
          onClock={onClock}
          syncHold={syncHold}
          refresh={load}
          markBooked={() =>
            setOverrides((o) => ({ ...o, [cellKey(dialog.cell.court, dialog.time)]: { state: "booked", mine: true } }))
          }
          onClose={closeDialog}
        />
      )}
    </div>
  );
}

type Mode = "form" | "held" | "paid" | "info" | "opened";

type DialogProps = {
  cell: Cell;
  day: string;
  time: string;
  draft: Draft | null;
  clocks: Record<string, HoldClock>;
  onClock: (id: string, c: HoldClock | null) => void;
  syncHold: (id: string) => Promise<any>;
  refresh: () => void;
  markBooked: () => void;
  onClose: () => void;
};

const fieldOrder = ["minutes", "co_players", "note", "level_min", "level_max"];

function SlotDialog({ cell, day, time, draft, clocks, onClock, syncHold, refresh, markBooked, onClose }: DialogProps) {
  const { me, club } = useSession();
  const myLevel = me?.level ?? 3;
  const initialMode: Mode = cell.state === "free" ? "form" : cell.state === "held" && cell.mine ? "held" : "info";
  const [mode, setMode] = useState<Mode>(draft ? (draft.bookingId ? "held" : "form") : initialMode);
  const [bookingId, setBookingId] = useState<string | null>(draft?.bookingId ?? (cell.mine ? cell.booking_id : null));
  const [minutes, setMinutes] = useState(draft?.minutes ?? 60);
  const [split, setSplit] = useState(draft?.split ?? false);
  const [emails, setEmails] = useState<string[]>(draft?.emails ?? ["", "", ""]);
  const [note, setNote] = useState(draft?.note ?? "");
  const [openMatch, setOpenMatch] = useState(draft?.openMatch ?? false);
  const [levelMin, setLevelMin] = useState(draft?.levelMin ?? Math.max(1, myLevel - 0.5));
  const [levelMax, setLevelMax] = useState(draft?.levelMax ?? Math.min(7, myLevel + 0.5));
  const [quote, setQuote] = useState<{ total_cents: number; split_cents: number[] } | null>(null);
  const [quoteError, setQuoteError] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [alert, setAlert] = useState("");
  const [pending, setPending] = useState<"" | "hold" | "pay" | "release">("");
  const [ready, setReady] = useState(!(draft?.bookingId || initialMode === "held"));
  const [paidTotal, setPaidTotal] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const focusAfter = useRef<string | null>(draft ? (draft.bookingId ? "pay" : "hold") : initialMode === "held" ? "pay" : "first");
  const quoteSeq = useRef(0);
  const holdKey = useRef(new RequestKey());
  const payKey = useRef(new RequestKey());
  const start = `${day}T${time}`;
  const clock = bookingId ? clocks[bookingId] : undefined;

  // A restored or reopened hold resumes from the server's remaining time.
  useEffect(() => {
    if (!bookingId || mode !== "held") return;
    (async () => {
      const b = await syncHold(bookingId);
      if (b && b.status !== "held") {
        setMode("form");
        setBookingId(null);
        focusAfter.current = "hold";
      }
      setReady(true);
    })();
  }, []);

  useInterval(async () => {
    if (mode !== "held" || !bookingId || pending === "pay") return;
    const b = await syncHold(bookingId);
    if (b && b.status === "released") holdEnded();
    if (b && b.status === "paid") setMode("paid");
  }, 5000);

  const holdEnded = () => {
    setBookingId(null);
    setMode("form");
    setAlert("");
    focusAfter.current = "hold";
  };

  useEffect(() => {
    if (mode !== "form") return;
    const seq = ++quoteSeq.current;
    (async () => {
      const a = await get(`/api/quote?court=${cell.court}&start=${start}&minutes=${minutes}`);
      if (seq !== quoteSeq.current) return;
      if (a.status === 200) {
        setQuote(a.data);
        setQuoteError("");
      } else {
        setQuote(null);
        setQuoteError(a.error?.errors ? Object.values(a.error.errors)[0] : errorText(a));
      }
    })();
  }, [minutes, split, mode]);

  useLayoutEffect(() => {
    const r = root.current;
    if (!ready || !focusAfter.current || !r) return;
    const target = focusAfter.current;
    focusAfter.current = null;
    const el =
      target === "first"
        ? r.querySelector<HTMLElement>("input, select, textarea, button")
        : r.querySelector<HTMLElement>(`[data-focus="${target}"]`);
    el?.focus();
  });

  const saveDraft = (id: string | null) => {
    if (!me) return;
    const d: Draft = {
      username: me.username, day, court: cell.court, time, minutes, split, emails, note, openMatch, levelMin, levelMax, bookingId: id,
    };
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    goSignIn(`/courts?day=${day}&cell=${cell.court}-${time}`);
  };

  const hold = async () => {
    if (pending) return;
    setAlert("");
    setErrors({});
    const body = openMatch
      ? { court: cell.court, start, minutes, level_min: levelMin, level_max: levelMax }
      : { court: cell.court, start, minutes, note, ...(split ? { co_players: emails } : {}) };
    const key = holdKey.current.next(body);
    setPending("hold");
    const a = await api("POST", openMatch ? "/api/matches" : "/api/holds", body, key);
    holdKey.current.settle(a.status);
    setPending("");
    if (a.status === 401) return saveDraft(null);
    if (a.status === 201) {
      if (openMatch) {
        announce("You joined the match.");
        setMode("opened");
        focusAfter.current = "close";
      } else {
        syncServerClock(a.data.server_now);
        setBookingId(a.data.id);
        onClock(a.data.id, clockFrom(a.data.remaining_ms, club.hold_seconds * 1000));
        announce(`Slot held for ${mmss(club.hold_seconds * 1000)}.`);
        setMode("held");
        focusAfter.current = "pay";
      }
      refresh();
      return;
    }
    if (a.status === 422 && a.error?.errors) {
      const errs = a.error.errors;
      setErrors(errs);
      const other = Object.entries(errs).filter(([f]) => !fieldOrder.includes(f));
      if (other.length) setAlert(other.map(([, m]) => m).join(" "));
      const first = fieldOrder.find((f) => errs[f]);
      focusAfter.current = first ? `field-${first}` : null;
      return;
    }
    setAlert(errorText(a));
    if (a.error?.code === "SLOT_TAKEN") refresh();
  };

  const pay = async () => {
    if (pending || !bookingId) return;
    setAlert("");
    const key = payKey.current.next({});
    setPending("pay");
    const a = await api("POST", `/api/bookings/${bookingId}/pay`, {}, key);
    payKey.current.settle(a.status);
    setPending("");
    if (a.status === 401) return saveDraft(bookingId);
    if (a.status === 200) {
      onClock(bookingId, null);
      markBooked();
      setPaidTotal(a.data.total_cents);
      announce("Payment received.");
      setMode("paid");
      focusAfter.current = "close";
      refresh();
      return;
    }
    setAlert(errorText(a));
    if (a.error?.code === "HOLD_EXPIRED") {
      const b = await syncHold(bookingId);
      if (!b || b.status !== "held") holdEnded();
      refresh();
    }
  };

  const release = async () => {
    if (pending || !bookingId) return;
    setAlert("");
    setPending("release");
    const a = await api("POST", `/api/bookings/${bookingId}/release`, {});
    setPending("");
    if (a.status === 401) return goSignIn();
    if (a.status === 200) {
      onClock(bookingId, null);
      announceReleased(bookingId);
      refresh();
      onClose();
      return;
    }
    setAlert(errorText(a));
  };

  const onZero = () => {
    if (bookingId) {
      syncHold(bookingId).then((b) => {
        if (!b || b.status !== "held") holdEnded();
      });
    }
  };

  const title = `Court ${cell.court} at ${time}`;
  const showHeld = mode === "held" && bookingId;
  return (
    <div class="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={root}
        role="dialog"
        aria-modal="true"
        aria-labelledby="slot-title"
        class="dialog"
        onKeyDown={(e) => trapKeys(e, root.current, onClose)}
      >
        <div class="dialog-band">
          <h2 id="slot-title">{title}</h2>
          {showHeld && (
            <div class="badge">
              {clock && <Halo clock={clock} shape="disc" onZero={onZero} />}
              <span role="timer" aria-label="Time left on hold" class="badge-digits">
                {clock ? <Countdown clock={clock} /> : "--:--"}
              </span>
            </div>
          )}
        </div>
        <div class="dialog-body">
          {mode === "form" && (
            <HoldForm
              {...{ minutes, setMinutes, split, setSplit, emails, setEmails, note, setNote, openMatch, setOpenMatch }}
              {...{ levelMin, setLevelMin, levelMax, setLevelMax, quote, quoteError, errors }}
            />
          )}
          {showHeld && (
            <p class="held-line">
              {clock ? "This slot is yours while the halo runs. Pay before it ends." : "Checking your hold…"}
            </p>
          )}
          {mode === "paid" && (
            <p class="done-line">
              <strong>Paid</strong>
              {paidTotal !== null && <> — {euros(paidTotal)} for {title}.</>}
            </p>
          )}
          {mode === "opened" && (
            <p class="done-line">
              <strong>Open match</strong> — you hold the first place. Others at your level can join from Matches.
            </p>
          )}
          {mode === "info" && <CellInfo cell={cell} />}
          <Alert text={alert} />
          <div class="dialog-actions">
            {mode === "form" && (
              <PendingButton
                class="pill pill-cobalt"
                focusKey="hold"
                pending={pending === "hold"}
                label={openMatch ? "Open match" : "Hold slot"}
                pendingLabel={openMatch ? "Opening..." : "Holding..."}
                onClick={hold}
              />
            )}
            {showHeld && (
              <>
                <PendingButton
                  class="pill pill-cobalt"
                  focusKey="pay"
                  pending={pending === "pay"}
                  label="Pay now"
                  pendingLabel="Paying..."
                  onClick={pay}
                />
                <PendingButton
                  class="pill pill-outline"
                  focusKey="release"
                  pending={pending === "release"}
                  label="Release hold"
                  pendingLabel="Releasing..."
                  onClick={release}
                />
              </>
            )}
            <button type="button" class="pill pill-outline" data-focus="close" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CellInfo({ cell }: { cell: Cell }) {
  const word = cellWord(cell);
  const lines: Record<string, string> = {
    Held: "Another player is holding this slot right now.",
    Booked: "This slot is booked.",
    "Your booking": "You have booked this slot. See My bookings for the details.",
    "Open match": `An open match with ${cell.players ?? 0} of 4 players. Join it from Matches.`,
    Lesson: "A coach has this court for a lesson.",
    Past: "This slot has already started.",
  };
  return (
    <div class="info">
      <p class="info-word">{word}</p>
      <p>{lines[word] ?? ""}</p>
      {cell.state === "match" && <Dots n={cell.players ?? 0} />}
    </div>
  );
}

type FormProps = {
  minutes: number;
  setMinutes: (n: number) => void;
  split: boolean;
  setSplit: (b: boolean) => void;
  emails: string[];
  setEmails: (e: string[]) => void;
  note: string;
  setNote: (s: string) => void;
  openMatch: boolean;
  setOpenMatch: (b: boolean) => void;
  levelMin: number;
  setLevelMin: (n: number) => void;
  levelMax: number;
  setLevelMax: (n: number) => void;
  quote: { total_cents: number; split_cents: number[] } | null;
  quoteError: string;
  errors: Record<string, string>;
};

function HoldForm(p: FormProps) {
  const e = p.errors;
  return (
    <form class="hold-form" noValidate onSubmit={(ev) => ev.preventDefault()}>
      <div role="radiogroup" aria-label="Length" class="lengths">
        {[60, 90, 120].map((m) => (
          <label class={"length" + (p.minutes === m ? " checked" : "")}>
            <input
              type="radio"
              name="length"
              value={m}
              checked={p.minutes === m}
              onChange={() => p.setMinutes(m)}
              data-focus={p.minutes === m ? "field-minutes" : undefined}
            />
            {m} minutes
          </label>
        ))}
      </div>
      {e.minutes && <FieldError text={e.minutes} />}
      <p class="price" aria-live="off">
        {p.quote ? euros(p.quote.total_cents) : p.quoteError ? "—" : "…"}
      </p>
      {p.quoteError && <FieldError text={p.quoteError} />}
      {!p.openMatch && (
        <>
          <label class="check">
            <input type="checkbox" checked={p.split} onChange={(ev) => p.setSplit((ev.target as HTMLInputElement).checked)} />
            Split four ways
          </label>
          {p.split && (
            <div class="split">
              {p.quote && (
                <ul class="split-amounts">
                  <li>You: {euros(p.quote.split_cents[0])}</li>
                  {[1, 2, 3].map((i) => (
                    <li>
                      Co-player {i}: {euros(p.quote!.split_cents[i])}
                    </li>
                  ))}
                </ul>
              )}
              <p class="guarantee-line">Your card guarantees the full price until every share is paid.</p>
              {[0, 1, 2].map((i) => (
                <div class="field">
                  <label for={`co-${i}`}>Co-player {i + 1} email</label>
                  <input
                    id={`co-${i}`}
                    type="email"
                    value={p.emails[i]}
                    data-focus={i === 0 ? "field-co_players" : undefined}
                    aria-invalid={!!e.co_players}
                    onInput={(ev) => {
                      const next = [...p.emails];
                      next[i] = (ev.target as HTMLInputElement).value;
                      p.setEmails(next);
                    }}
                  />
                </div>
              ))}
              {e.co_players && <FieldError text={e.co_players} />}
            </div>
          )}
          <div class="field">
            <label for="note">Booking note</label>
            <textarea
              id="note"
              rows={2}
              value={p.note}
              data-focus="field-note"
              aria-invalid={!!e.note}
              onInput={(ev) => p.setNote((ev.target as HTMLTextAreaElement).value)}
            />
            <span class="counter">{codePoints(p.note)}/280</span>
            {e.note && <FieldError text={e.note} />}
          </div>
        </>
      )}
      <label class="check">
        <input type="checkbox" checked={p.openMatch} onChange={(ev) => p.setOpenMatch((ev.target as HTMLInputElement).checked)} />
        Open as a match
      </label>
      {p.openMatch && (
        <div class="levels">
          <div class="field">
            <label for="lvl-min">Lowest level</label>
            <select
              id="lvl-min"
              value={String(p.levelMin)}
              data-focus="field-level_min"
              onChange={(ev) => p.setLevelMin(Number((ev.target as HTMLSelectElement).value))}
            >
              {levelOptions.map((l) => (
                <option value={String(l)}>{level(l)}</option>
              ))}
            </select>
            {e.level_min && <FieldError text={e.level_min} />}
          </div>
          <div class="field">
            <label for="lvl-max">Highest level</label>
            <select
              id="lvl-max"
              value={String(p.levelMax)}
              data-focus="field-level_max"
              onChange={(ev) => p.setLevelMax(Number((ev.target as HTMLSelectElement).value))}
            >
              {levelOptions.map((l) => (
                <option value={String(l)}>{level(l)}</option>
              ))}
            </select>
            {e.level_max && <FieldError text={e.level_max} />}
          </div>
        </div>
      )}
    </form>
  );
}
