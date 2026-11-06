import { type KeyboardEvent, type PointerEvent, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { call, type ErrorBody, idempotencyKey } from "../api";
import { Dialog } from "../Dialog";
import { addDays, dollars, hoursText } from "../format";
import { Icon, icons } from "../icons";
import { replaceAddress } from "../router";
import { ServicesContext, useSession } from "../session";
import type { Booking, Hold, Invoice, Kitchen, Loom, MemberSummary, Pack, Quote, RateCard, SeriesQuote } from "../types";
import { FloorPlan } from "./FloorPlan";
import { cellId, Grid } from "./Grid";
import { COLUMNS, type Brush, cellViews, clock, formatSel, keyOf, minutesOf, parseSel, type Pos, rectOf, selectedCells } from "./model";
import { type HoldTiming, QuoteRail } from "./QuoteRail";

const isDate = (value: string | null): value is string => value !== null && /^\d{4}-\d{2}-\d{2}$/.test(value);

function useReducedMotion(): boolean {
  const query = useMemo(() => window.matchMedia("(prefers-reduced-motion: reduce)"), []);
  const [reduced, setReduced] = useState(query.matches);
  useEffect(() => {
    const change = (): void => setReduced(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, [query]);
  return reduced;
}

interface Held {
  hold: Hold;
  /** Device clock when the hold arrived; with server_now and expires_at it drives the countdown. */
  receivedAt: number;
}

const LEGEND = [
  { kind: "selected", label: "Selected", icon: icons.paintbrush },
  { kind: "held", label: "Held", icon: icons.clock },
  { kind: "booked", label: "Booked", icon: icons.check },
  { kind: "taken", label: "Taken", icon: icons.lock },
  { kind: "conflict", label: "Conflict", icon: icons.cross },
  { kind: "papers", label: "Papers", icon: icons.warningFile },
];

export function LoomScreen() {
  const { user, kitchen } = useSession();
  const { paused } = useContext(ServicesContext);
  const operator = user.role === "operator";
  const reduced = useReducedMotion();
  const initial = useMemo(() => new URL(window.location.href).searchParams, []);

  const [date, setDate] = useState(() => {
    const asked = initial.get("date");
    return isDate(asked) ? asked : kitchen.today;
  });
  const [filter, setFilter] = useState<string[] | null>(() => {
    const ids = (initial.get("stations") ?? "").split(",").filter((id) => kitchen.stations.some((s) => s.id === id));
    return ids.length > 0 ? ids : null;
  });
  const stations = useMemo(() => (filter ? kitchen.stations.filter((s) => filter.includes(s.id)) : kitchen.stations), [filter, kitchen.stations]);
  const [members, setMembers] = useState<MemberSummary[]>([]);
  const [memberId, setMemberId] = useState<string | null>(user.member_id);
  const [loom, setLoom] = useState<Loom | null>(null);
  const [brush, setBrush] = useState<Brush | null>(() => parseSel(stations, initial.get("sel")));
  const [focus, setFocus] = useState<Pos>(() => {
    const restored = parseSel(stations, initial.get("sel"));
    return restored ? { row: rectOf(restored).top, col: rectOf(restored).left } : { row: 0, col: 0 };
  });
  const [held, setHeld] = useState<Held | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteVersion, setQuoteVersion] = useState(0);
  const [pricing, setPricing] = useState(false);
  const [pricingFailed, setPricingFailed] = useState(false);
  const [usePack, setUsePack] = useState(false);
  const [pack, setPack] = useState<Pack | null>(null);
  const [lost, setLost] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState<"hold" | "release" | "confirm" | "series" | null>(null);
  const [dialog, setDialog] = useState<"confirm" | "stations" | "repeat" | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [windowHours, setWindowHours] = useState<number | null>(null);
  const [focusGrid, setFocusGrid] = useState(false);

  const gridRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const shiftAnchor = useRef<Pos | null>(null);
  const quoteSeq = useRef(0);

  const member = members.find((m) => m.id === memberId);
  const business = operator ? member?.business : undefined;
  const memberEmail = operator ? member?.contact_email : user.email;
  const holdLive = held !== null && held.hold.state === "held";

  // ---- data ------------------------------------------------------------------------------------

  const loadLoom = useCallback(async () => {
    const query = new URLSearchParams({ date });
    if (operator && memberId) query.set("member_id", memberId);
    const result = await call<Loom>("GET", `/api/kitchens/${kitchen.id}/loom?${query.toString()}`);
    if (result.ok) {
      setLoom(result.data);
      setLost(new Set());
    }
  }, [date, operator, memberId, kitchen.id]);

  const loadPack = useCallback(async () => {
    if (!memberId) return;
    const result = await call<Pack>("GET", `/api/members/${memberId}/pack`);
    if (result.ok) setPack(result.data);
  }, [memberId]);

  useEffect(() => {
    if (!operator) return;
    void (async () => {
      const result = await call<{ members: MemberSummary[] }>("GET", `/api/kitchens/${kitchen.id}/members`);
      if (!result.ok) return;
      const sorted = [...result.data.members].sort((a, b) => a.business.localeCompare(b.business));
      setMembers(sorted);
      setMemberId((current) => current ?? sorted[0]?.id ?? null);
    })();
  }, [operator, kitchen.id]);

  useEffect(() => {
    if (operator && !memberId) return undefined;
    void loadLoom();
    const timer = window.setInterval(() => void loadLoom(), 15_000);
    return () => window.clearInterval(timer);
  }, [loadLoom, operator, memberId]);

  useEffect(() => {
    void loadPack();
  }, [loadPack]);

  useEffect(() => {
    const holdId = initial.get("hold");
    if (!holdId) return;
    void (async () => {
      const result = await call<{ hold: Hold }>("GET", `/api/holds/${encodeURIComponent(holdId)}`);
      if (result.ok && result.data.hold.state === "held") setHeld({ hold: result.data.hold, receivedAt: Date.now() });
    })();
  }, [initial]);

  // The cancellation window shown in the confirm dialog: the card in force for operators, and for
  // members the window stored on their latest booking priced on the same card.
  useEffect(() => {
    const cardId = held?.hold.quote.rate_card_id;
    if (!cardId) return;
    void (async () => {
      if (operator) {
        const result = await call<{ rate_cards: RateCard[] }>("GET", `/api/kitchens/${kitchen.id}/rate-cards`);
        if (result.ok) setWindowHours(result.data.rate_cards.find((c) => c.id === cardId)?.cancellation_window_hours ?? null);
        return;
      }
      const result = await call<{ bookings: Booking[] }>("GET", "/api/bookings");
      if (result.ok) setWindowHours(result.data.bookings.find((b) => b.rate_card_id === cardId)?.cancellation_window_hours ?? null);
    })();
  }, [held?.hold.quote.rate_card_id, operator, kitchen.id]);

  // ---- what the grid shows ------------------------------------------------------------------------

  const views = useMemo(
    () => cellViews(stations, loom, operator, brush, held?.hold ?? null, business, lost),
    [stations, loom, operator, brush, held, business, lost],
  );
  const brushCells = useMemo(() => selectedCells(stations, views), [stations, views]);
  const brushHasPapers = useMemo(() => views.some((row) => row.some((v) => v.kind === "papers")) && brush !== null && loom?.papers === true, [views, brush, loom]);
  const brushClean = useMemo(() => {
    if (!brush) return false;
    const r = rectOf(brush);
    return views.slice(r.top, r.bottom + 1).every((row) => row.slice(r.left, r.right + 1).every((v) => v.kind === "selected"));
  }, [brush, views]);

  const lit = useMemo(() => {
    const on = new Set(brushCells.map((c) => c.station_id));
    if (held && held.hold.date === date && !brush) {
      for (const c of held.hold.cells) if (!lost.has(keyOf(c.station_id, c.start))) on.add(c.station_id);
    }
    return on;
  }, [brushCells, held, date, brush, lost]);

  const papersCopy = operator
    ? `${business ?? "This member"}'s papers do not cover ${date}.`
    : `Your papers do not cover ${date}. Upload a current insurance certificate and food-handler card to book this day.`;

  useEffect(() => {
    if (brush && brushHasPapers) setStatus(papersCopy);
  }, [brush, brushHasPapers, papersCopy]);

  // ---- the quote ----------------------------------------------------------------------------------

  // The quote re-runs when the brushed cells' contents change (cellsSignature), not their identity.
  const cellsSignature = brushCells.map((c) => keyOf(c.station_id, c.start)).join(",");
  useEffect(() => {
    const seq = ++quoteSeq.current;
    const land = (next: Quote | null, failed = false): void => {
      if (seq !== quoteSeq.current) return;
      setPricing(false);
      setPricingFailed(failed);
      if (!failed) setQuote(next);
      setQuoteVersion((v) => v + 1);
    };
    if (brush) {
      if (brushCells.length === 0) {
        land(null);
        return undefined;
      }
      setPricing(true);
      const timer = window.setTimeout(() => {
        void (async () => {
          const result = await call<{ quote: Quote }>("POST", "/api/quotes", {
            date,
            cells: brushCells,
            use_pack: usePack,
            ...(operator && memberId ? { member_id: memberId } : {}),
          });
          land(result.ok ? result.data.quote : null, !result.ok);
        })();
      }, 60);
      return () => window.clearTimeout(timer);
    }
    if (held && holdLive) {
      if (!usePack) {
        land(held.hold.quote);
        return undefined;
      }
      setPricing(true);
      void (async () => {
        const result = await call<{ hold: Hold }>("GET", `/api/holds/${held.hold.id}?use_pack=true`);
        land(result.ok ? result.data.hold.quote : null, !result.ok);
      })();
      return undefined;
    }
    land(null);
    return undefined;
  }, [cellsSignature, usePack, held, holdLive, brush === null, date, memberId, operator]);

  // ---- countdown -----------------------------------------------------------------------------------

  useEffect(() => {
    if (!holdLive) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [holdLive]);

  const timing: HoldTiming | null = useMemo(() => {
    if (!held || !holdLive) return null;
    const span = (Date.parse(held.hold.expires_at) - Date.parse(held.hold.server_now)) / 1000;
    return {
      secondsLeft: Math.max(0, Math.round(span - (now - held.receivedAt) / 1000)),
      totalSeconds: kitchen.hold_seconds,
      expiresLocal: held.hold.expires_local,
    };
  }, [held, holdLive, now, kitchen.hold_seconds]);

  useEffect(() => {
    if (!held || !timing || timing.secondsLeft > 0) return;
    void (async () => {
      const result = await call<{ hold: Hold }>("GET", `/api/holds/${held.hold.id}`);
      if (!result.ok || result.data.hold.state !== "held") {
        setHeld(null);
        void loadLoom();
      }
    })();
  }, [held, timing, loadLoom]);

  // ---- address --------------------------------------------------------------------------------------

  useEffect(() => {
    const parts = [`date=${date}`];
    if (filter) parts.push(`stations=${filter.join(",")}`);
    const sel = brush ? formatSel(stations, brush) : null;
    if (sel) parts.push(`sel=${sel}`);
    else if (held && holdLive) parts.push(`hold=${held.hold.id}`);
    replaceAddress(`/loom?${parts.join("&")}`);
  }, [date, filter, brush, stations, held, holdLive]);

  // ---- focus ---------------------------------------------------------------------------------------

  useEffect(() => {
    const grid = gridRef.current;
    if (grid && grid.contains(document.activeElement)) document.getElementById(cellId(focus.row, focus.col))?.focus();
  }, [focus]);

  useEffect(() => {
    if (!focusGrid) return;
    setFocusGrid(false);
    document.getElementById(cellId(focus.row, focus.col))?.focus();
  }, [focusGrid, focus]);

  // ---- actions ---------------------------------------------------------------------------------------

  const memberBody = operator && memberId ? { member_id: memberId } : {};

  const holdFailure = (error: ErrorBody): string => {
    if (error.error === "same_day_closed") return `Same-day booking closed at ${loom?.same_day_cutoff ?? kitchen.same_day_cutoff} kitchen time.`;
    if (error.error === "cell_in_past") return "Some of those cells have already started. Brush a later block.";
    if (error.error === "compliance_blocked") return papersCopy;
    return error.message;
  };

  const placeHold = (): void => {
    if (!brush || busy === "hold") return;
    if (brushCells.length === 0) {
      setStatus("Nothing free to hold in that brush.");
      return;
    }
    const cells = brushCells;
    const earlier = held && holdLive ? held.hold.id : null;
    setBusy("hold");
    setStatus("Placing hold…");
    void (async () => {
      if (earlier) await call("DELETE", `/api/holds/${earlier}`);
      const result = await call<{ hold: Hold; taken: { station_id: string; start: string }[] }>("POST", "/api/holds", {
        date,
        cells,
        ...memberBody,
      });
      setBusy(null);
      if (result.ok) {
        const { hold, taken } = result.data;
        setLost(new Set(taken.map((c) => keyOf(c.station_id, c.start))));
        setHeld({ hold, receivedAt: Date.now() });
        setBrush(null);
        setStatus(
          `Held ${hold.cells.length} cells until ${hold.expires_local} kitchen time.` +
            (taken.length > 0 ? ` ${taken.length} cells were just taken by another booking.` : ""),
        );
        void loadLoom();
        return;
      }
      if (earlier) setHeld(null);
      if (result.error.error === "cells_taken") {
        setLost(new Set((result.error.taken ?? []).map((c) => keyOf(c.station_id, c.start))));
        setBrush(null);
        setStatus("Those cells were just taken. Nothing was held.");
        void loadLoom();
        return;
      }
      setStatus(holdFailure(result.error));
    })();
  };

  const clearBrush = (): void => {
    setBrush(null);
    shiftAnchor.current = null;
  };

  const releaseHold = (): void => {
    if (!held) return;
    setBusy("release");
    setStatus("Releasing…");
    void (async () => {
      const result = await call("DELETE", `/api/holds/${held.hold.id}`);
      setBusy(null);
      setHeld(null);
      setStatus(result.ok ? "Hold released." : "This hold is no longer active.");
      void loadLoom();
    })();
  };

  const confirmCopy = (error: ErrorBody, expiresLocal: string): string => {
    switch (error.error) {
      case "hold_expired":
      case "hold_not_active":
        return `Your hold expired at ${expiresLocal} kitchen time. Brush the block again.`;
      case "quote_changed": {
        const fresh = error.quote;
        const total = typeof fresh === "object" && fresh !== null && "total" in fresh && typeof fresh.total === "string" ? fresh.total : "";
        return `The price is now ${total} because your month-to-date hours changed. Check the quote and confirm again.`;
      }
      case "validation":
        return error.errors?.use_pack ? "No pack hours left." : error.message;
      case "compliance_blocked":
        return papersCopy;
      case "billing_unavailable":
        return "Billing is unreachable, so nothing was booked and your hold was released. Try again once billing is back.";
      case "mail_unavailable":
        return "Email is unreachable, so nothing was booked and your hold was released. Try again shortly.";
      default:
        return error.message;
    }
  };

  const confirm = (): void => {
    if (!held || !quote) return;
    const hold = held.hold;
    setBusy("confirm");
    setStatus("Confirming…");
    void (async () => {
      const result = await call<{ booking: Booking; invoice: Invoice }>(
        "POST",
        `/api/holds/${hold.id}/confirm`,
        { use_pack: usePack, quoted_total_cents: quote.total_cents },
        { "Idempotency-Key": idempotencyKey() },
      );
      setBusy(null);
      setDialog(null);
      if (result.ok) {
        setHeld(null);
        setStatus(`Booking ${result.data.booking.ref} confirmed. Confirmation sent to ${memberEmail ?? ""}.`);
        setFocusGrid(true);
        void loadLoom();
        void loadPack();
        return;
      }
      setStatus(confirmCopy(result.error, hold.expires_local));
      if (result.error.error === "quote_changed") {
        const fresh = await call<{ hold: Hold }>("GET", `/api/holds/${hold.id}${usePack ? "?use_pack=true" : ""}`);
        if (fresh.ok) {
          setQuote(fresh.data.hold.quote);
          setQuoteVersion((v) => v + 1);
        }
        return;
      }
      if (result.error.error !== "validation") {
        setHeld(null);
        void loadLoom();
      }
    })();
  };

  // ---- pointer, touch and keyboard brushing -------------------------------------------------------------

  const posFromPoint = (x: number, y: number): Pos | null => {
    const origin = document.getElementById(cellId(0, 0))?.getBoundingClientRect();
    if (!origin) return null;
    const col = Math.floor((x - origin.left) / origin.width);
    const row = Math.floor((y - origin.top) / origin.height);
    return { row: Math.max(0, Math.min(stations.length - 1, row)), col: Math.max(0, Math.min(COLUMNS.length - 1, col)) };
  };

  const posOf = (target: EventTarget): Pos | null => {
    if (!(target instanceof HTMLElement)) return null;
    const cell = target.closest<HTMLElement>(".cell");
    if (!cell) return null;
    return { row: Number(cell.dataset.row), col: Number(cell.dataset.col) };
  };

  const placeRef = useRef(placeHold);
  placeRef.current = placeHold;

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    const pos = posOf(event.target);
    if (!pos || event.button !== 0 || event.pointerType === "touch") return;
    event.preventDefault();
    dragging.current = true;
    setBrush({ anchor: pos, end: pos });
    setFocus(pos);
    document.getElementById(cellId(pos.row, pos.col))?.focus({ preventScroll: true });
    const move = (e: globalThis.PointerEvent): void => {
      const next = posFromPoint(e.clientX, e.clientY);
      if (!next) return;
      setBrush((b) => (b && (b.end.row !== next.row || b.end.col !== next.col) ? { anchor: b.anchor, end: next } : b));
    };
    const up = (): void => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      dragging.current = false;
      setReleaseTick((t) => t + 1);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  };

  // A release places the hold after the last move has rendered, so it holds the final brush.
  const [releaseTick, setReleaseTick] = useState(0);
  useEffect(() => {
    if (releaseTick > 0) placeRef.current();
  }, [releaseTick]);

  const onPointerUp = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.pointerType !== "touch") return;
    const pos = posOf(event.target);
    if (!pos) return;
    setFocus(pos);
    setBrush((b) => (b ? { anchor: b.anchor, end: pos } : { anchor: pos, end: pos }));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Shift") {
      shiftAnchor.current ??= focus;
      return;
    }
    const moves: Record<string, (p: Pos) => Pos> = {
      ArrowLeft: (p) => ({ row: p.row, col: Math.max(0, p.col - 1) }),
      ArrowRight: (p) => ({ row: p.row, col: Math.min(COLUMNS.length - 1, p.col + 1) }),
      ArrowUp: (p) => ({ row: Math.max(0, p.row - 1), col: p.col }),
      ArrowDown: (p) => ({ row: Math.min(stations.length - 1, p.row + 1), col: p.col }),
      Home: (p) => ({ row: p.row, col: 0 }),
      End: (p) => ({ row: p.row, col: COLUMNS.length - 1 }),
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      const next = move(focus);
      if (event.shiftKey) {
        const anchor = shiftAnchor.current ?? focus;
        shiftAnchor.current = anchor;
        setBrush({ anchor, end: next });
      }
      setFocus(next);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      placeHold();
    } else if (event.key === "Escape" && brush) {
      event.preventDefault();
      clearBrush();
    }
  };

  useEffect(() => {
    const up = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Shift") shiftAnchor.current = null;
    };
    window.addEventListener("keyup", up);
    return () => window.removeEventListener("keyup", up);
  }, []);

  // ---- weekly series ----------------------------------------------------------------------------------

  const block = useMemo(() => {
    let rect = brush && brushClean ? rectOf(brush) : null;
    if (!brush && held && holdLive && held.hold.date === date) {
      const rows = new Set(held.hold.cells.map((c) => stations.findIndex((s) => s.id === c.station_id)));
      const cols = new Set(held.hold.cells.map((c) => COLUMNS.indexOf(c.start)));
      const top = Math.min(...rows);
      const bottom = Math.max(...rows);
      const left = Math.min(...cols);
      const right = Math.max(...cols);
      if (top >= 0 && left >= 0 && (bottom - top + 1) * (right - left + 1) === held.hold.cells.length) rect = { top, bottom, left, right };
    }
    if (!rect) return null;
    const start = COLUMNS[rect.left] ?? "04:00";
    return {
      station_ids: stations.slice(rect.top, rect.bottom + 1).map((s) => s.id),
      start,
      end: clock(minutesOf(start) + 15 * (rect.right - rect.left + 1)),
    };
  }, [brush, brushClean, held, holdLive, date, stations]);

  // ---- render ---------------------------------------------------------------------------------------

  const billingOrMailDown = paused.has("confirm_booking");
  const seriesPaused = paused.has("create_series");
  const balance = pack?.balance_quarters ?? 0;

  return (
    <div className="loom-screen">
      <FloorPlan stations={kitchen.stations} lit={lit} />
      <div className="loom-body">
        <section className="loom-main" aria-labelledby="loom-title">
          <div className="loom-toolbar">
            <h1 id="loom-title" className="sr-only">
              Loom
            </h1>
            <div className="date-controls">
              <button type="button" className="icon-button" aria-label="Previous day" onClick={() => { setDate((d) => addDays(d, -1)); clearBrush(); }}>
                ‹
              </button>
              <label className="field inline">
                <span>Kitchen date</span>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => {
                    if (isDate(e.target.value)) {
                      setDate(e.target.value);
                      clearBrush();
                    }
                  }}
                />
              </label>
              <button type="button" className="icon-button" aria-label="Next day" onClick={() => { setDate((d) => addDays(d, 1)); clearBrush(); }}>
                ›
              </button>
              <button type="button" className="ghost" onClick={() => { setDate(loom?.today ?? kitchen.today); clearBrush(); }}>
                Today
              </button>
            </div>
            <button type="button" className="ghost" onClick={() => setDialog("stations")}>
              Stations
            </button>
            {operator && (
              <label className="field inline">
                <span>Book for member</span>
                <select
                  value={memberId ?? ""}
                  onChange={(e) => {
                    setMemberId(e.target.value);
                    clearBrush();
                    setUsePack(false);
                  }}
                >
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.business}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div className="loom-head">
            <p className="loom-date">
              <span className="num">{date}</span> <span className="muted">Kitchen time · {kitchen.timezone}</span>
            </p>
            <ul aria-label="Loom legend" className="legend">
              {LEGEND.map((item) => (
                <li key={item.kind}>
                  <span className={`swatch k-${item.kind}`} aria-hidden="true">
                    <Icon node={item.icon} size={12} />
                  </span>
                  {item.label}
                </li>
              ))}
            </ul>
          </div>
          <p role="status" aria-label="Loom status" className="loom-status">
            {status}
          </p>
          <div className="loom-frame">
            <Grid
              stations={stations}
              views={views}
              focus={focus}
              gridRef={gridRef}
              onKeyDown={onKeyDown}
              onPointerDown={onPointerDown}
              onPointerUp={onPointerUp}
            />
          </div>
        </section>
        <QuoteRail
          quote={quote}
          version={quoteVersion}
          pricing={pricing}
          failed={pricingFailed}
          reduced={reduced}
          timing={timing}
          sheetOpen={sheetOpen}
          onToggleSheet={() => setSheetOpen((o) => !o)}
        >
          <label className="check">
            <input type="checkbox" checked={usePack} disabled={balance === 0} onChange={(e) => setUsePack(e.target.checked)} />
            <span>Use pack hours ({hoursText(balance)} h left)</span>
          </label>
          <div className="rail-actions">
            <button type="button" className="primary" disabled={!brush || busy === "hold"} onClick={placeHold}>
              Place hold
            </button>
            <button type="button" className="ghost" disabled={!brush} onClick={clearBrush}>
              Clear brush
            </button>
            <button
              type="button"
              className="primary"
              disabled={!holdLive || busy !== null || pricing || billingOrMailDown}
              onClick={() => setDialog("confirm")}
            >
              Confirm booking
            </button>
            <button type="button" className="ghost" disabled={!holdLive || busy !== null} onClick={releaseHold}>
              Release hold
            </button>
            <span className="tooltip-anchor">
              <button
                type="button"
                className="ghost"
                aria-disabled={!block || seriesPaused}
                aria-describedby={!block ? "repeat-hint" : undefined}
                onClick={() => {
                  if (block && !seriesPaused) setDialog("repeat");
                }}
              >
                Repeat weekly
              </button>
              {!block && (
                <span id="repeat-hint" role="tooltip" className="tooltip">
                  Repeat weekly needs one unbroken block.
                </span>
              )}
            </span>
          </div>
        </QuoteRail>
      </div>

      <Dialog title="Confirm booking" open={dialog === "confirm"} onClose={() => setDialog(null)} initialFocus="[data-autofocus]">
        {held && (
          <div className="dialog-body">
            <dl className="summary">
              <dt>Date</dt>
              <dd className="num">{held.hold.date}</dd>
              <dt>Stations and times</dt>
              <dd>
                {stationTimes(held.hold, kitchen.stations).map((t) => (
                  <span key={t} className="num block">
                    {t}
                  </span>
                ))}
              </dd>
              <dt>Cancellation window</dt>
              <dd>{windowHours === null ? "As set on the rate card in force" : `${windowHours} hours before the start`}</dd>
            </dl>
            <ul className="quote-lines" aria-label="Booking lines">
              {(quote?.lines ?? []).map((l) => (
                <li key={`${l.station_id}-${l.tier}-${l.paid_by}`}>
                  <span className="line-station">{l.station}</span>
                  <span className="num">tier {l.tier}</span>
                  <span className="num">{l.hours} h</span>
                  <span className="num amount">{l.paid_by === "pack" ? "pack" : dollars(l.amount_cents)}</span>
                </li>
              ))}
            </ul>
            <p className="dialog-total">
              Total <span className="num">{quote?.total ?? "$0.00"}</span>
            </p>
            <label className="check">
              <input type="checkbox" checked={usePack} disabled={balance === 0} onChange={(e) => setUsePack(e.target.checked)} />
              <span>Use pack hours ({hoursText(balance)} h left)</span>
            </label>
            <div className="dialog-actions">
              <button type="button" className="primary" data-autofocus disabled={busy === "confirm" || pricing} onClick={confirm}>
                Confirm
              </button>
              <button type="button" className="ghost" onClick={() => setDialog(null)}>
                Back
              </button>
            </div>
          </div>
        )}
      </Dialog>

      <StationsDialog
        open={dialog === "stations"}
        chosen={stations.map((s) => s.id)}
        all={kitchen.stations}
        onClose={() => setDialog(null)}
        onApply={(ids) => {
          setFilter(ids.length === kitchen.stations.length ? null : ids);
          clearBrush();
          setFocus({ row: 0, col: 0 });
          setDialog(null);
        }}
      />

      <RepeatDialog
        open={dialog === "repeat"}
        block={block}
        date={date}
        usePack={usePack}
        memberBody={memberBody}
        paused={seriesPaused}
        onClose={() => setDialog(null)}
        onDone={(message, booked) => {
          setDialog(null);
          setStatus(message);
          if (booked) {
            setBrush(null);
            setHeld(null);
            void loadLoom();
            void loadPack();
          }
        }}
      />
    </div>
  );
}

function stationTimes(hold: Hold, stations: Kitchen["stations"]): string[] {
  return stations
    .map((s) => {
      const starts = hold.cells.filter((c) => c.station_id === s.id).map((c) => minutesOf(c.start));
      if (starts.length === 0) return "";
      return `${s.name} ${clock(Math.min(...starts))}–${clock(Math.max(...starts) + 15)}`;
    })
    .filter((t) => t !== "");
}

function StationsDialog({
  open,
  chosen,
  all,
  onClose,
  onApply,
}: {
  open: boolean;
  chosen: string[];
  all: Kitchen["stations"];
  onClose: () => void;
  onApply: (ids: string[]) => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set(chosen));
  // The choice resets each time the dialog opens.
  useEffect(() => {
    if (open) setPicked(new Set(chosen));
  }, [open]);
  return (
    <Dialog title="Choose stations" open={open} onClose={onClose}>
      <div className="dialog-body">
        <div className="station-choices">
          {all.map((s) => (
            <label key={s.id} className="check">
              <input
                type="checkbox"
                checked={picked.has(s.id)}
                onChange={(e) => {
                  const next = new Set(picked);
                  if (e.target.checked) next.add(s.id);
                  else next.delete(s.id);
                  setPicked(next);
                }}
              />
              <span>{s.name}</span>
            </label>
          ))}
        </div>
        <div className="dialog-actions">
          <button type="button" className="primary" disabled={picked.size === 0} onClick={() => onApply(all.filter((s) => picked.has(s.id)).map((s) => s.id))}>
            Apply
          </button>
          <button type="button" className="ghost" onClick={onClose}>
            Back
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function RepeatDialog({
  open,
  block,
  date,
  usePack,
  memberBody,
  paused,
  onClose,
  onDone,
}: {
  open: boolean;
  block: { station_ids: string[]; start: string; end: string } | null;
  date: string;
  usePack: boolean;
  memberBody: { member_id?: string };
  paused: boolean;
  onClose: () => void;
  onDone: (message: string, booked: boolean) => void;
}) {
  const [weeks, setWeeks] = useState("4");
  const [preview, setPreview] = useState<SeriesQuote | null>(null);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const count = Number(weeks);
  const valid = Number.isInteger(count) && count >= 2 && count <= 12;
  const body = block ? { ...block, first_date: date, weeks: count, use_pack: usePack, ...memberBody } : null;
  // The preview re-runs when the request body's contents change (bodyKey), not its identity.
  const bodyKey = JSON.stringify(body);

  useEffect(() => {
    if (!open || !body || !valid) {
      setPreview(null);
      return;
    }
    let alive = true;
    void (async () => {
      const result = await call<SeriesQuote>("POST", "/api/series/quote", body);
      if (!alive) return;
      if (result.ok) {
        setPreview(result.data);
        setProblem("");
      } else {
        setPreview(null);
        setProblem(seriesCopy(result.error));
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, bodyKey, valid]);

  const book = (): void => {
    if (!body || !preview) return;
    setBusy(true);
    void (async () => {
      const result = await call<{ bookings: Booking[] }>(
        "POST",
        "/api/series",
        { ...body, quoted_total_cents: preview.total_cents },
        { "Idempotency-Key": idempotencyKey() },
      );
      setBusy(false);
      if (result.ok) {
        const dates = result.data.bookings.map((b) => b.date).sort();
        onDone(`Booked ${dates.length} weekly slots, ${dates[0] ?? ""} to ${dates.at(-1) ?? ""}.`, true);
      } else {
        onDone(seriesCopy(result.error), false);
      }
    })();
  };

  return (
    <Dialog title="Repeat weekly" open={open} onClose={onClose}>
      <div className="dialog-body">
        <label className="field">
          <span>Weeks</span>
          <input type="number" min={2} max={12} step={1} value={weeks} onChange={(e) => setWeeks(e.target.value)} />
        </label>
        {preview && (
          <ul className="series-weeks">
            {preview.occurrences.map((o) => (
              <li key={o.date}>
                <span className="num">{o.date}</span>
                <span className="num amount">{o.quote.total}</span>
              </li>
            ))}
            <li className="series-total">
              <span>Series total</span>
              <span className="num amount">{preview.total}</span>
            </li>
          </ul>
        )}
        {problem && <p className="error-text">{problem}</p>}
        <div className="dialog-actions">
          <button type="button" className="primary" disabled={!preview || busy || paused} onClick={book}>
            {busy ? "Booking series…" : "Book series"}
          </button>
          <button type="button" className="ghost" onClick={onClose}>
            Back
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function seriesCopy(error: ErrorBody): string {
  if (error.error === "series_conflict") return `These weeks are already taken: ${(error.dates ?? []).join(", ")}. Nothing was booked.`;
  if (error.error === "billing_unavailable") {
    return "Billing is unreachable, so nothing was booked and your hold was released. Try again once billing is back.";
  }
  if (error.error === "mail_unavailable") return "Email is unreachable, so nothing was booked and your hold was released. Try again shortly.";
  if (error.error === "quote_changed") {
    const fresh = error.quote;
    const total = typeof fresh === "object" && fresh !== null && "total" in fresh && typeof fresh.total === "string" ? fresh.total : "";
    return `The price is now ${total} because your month-to-date hours changed. Check the quote and confirm again.`;
  }
  if (error.error === "compliance_blocked") return "Your papers do not cover every week of this series.";
  if (error.error === "same_day_closed") return "Same-day booking is closed for the first week.";
  if (error.error === "cell_in_past") return "Some of those cells have already started. Brush a later block.";
  return error.message;
}
