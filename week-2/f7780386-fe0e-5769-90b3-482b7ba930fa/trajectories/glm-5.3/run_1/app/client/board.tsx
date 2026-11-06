// The line board: paint the line with a pointer or the keyboard, see
// conflicts and cost, place holds, watch the ticket rail and the drawer.

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useSession, useFeedback } from './app';
import { getBoard, getMe, getBooking, postHold, patchHold, deleteHold, confirmHold, cancelBooking } from './api';
import { costSplit, clockFromMinutes, minutesFromClock, durationText, hoursText } from '../shared/rules';
import { longDate, shortDate, addDays, clockFromInstant, countdownText } from './format';
import type { BoardResponse, AnySegment, Booking } from '../shared/types';

const OPENS = 5 * 60;
const CLOSES = 24 * 60;
const CELL = 15;
const CELLS = (CLOSES - OPENS) / CELL; // 76 cells from 05:00 to 24:00
const HOUR_LABELS = 19; // 05:00 .. 23:00
const NAME_COL = 168;
const NAME_COL_NARROW = 108;
const nameColWidth = () => (typeof window !== 'undefined' && window.innerWidth <= 900 ? NAME_COL_NARROW : NAME_COL);
const CELL_W = 20;
const ROW_H = 44;

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The band lifts and travels up into its slot in the rail over about a third
 * of a second, arriving as a paper ticket. Reduced motion skips the flight. */
function flightToRail(
  bandRect: { left: number; top: number; width: number; height: number },
  stationName: string,
  start: string,
  end: string,
): void {
  const ghost = document.createElement('div');
  ghost.className = 'ticket hold flight-ghost';
  ghost.innerHTML = `<span class="station">${stationName}</span><span class="times num">${start}–${end}</span>`;
  ghost.style.left = `${bandRect.left}px`;
  ghost.style.top = `${bandRect.top}px`;
  ghost.style.width = `${bandRect.width}px`;
  ghost.style.height = `${bandRect.height}px`;
  document.body.appendChild(ghost);
  const target = document.querySelector<HTMLElement>('.rail-inner');
  const tr = target ? target.getBoundingClientRect() : null;
  requestAnimationFrame(() => {
    const dx = tr ? tr.left - bandRect.left : 0;
    const dy = tr ? tr.top + 8 - bandRect.top : -80;
    ghost.style.transform = `translate(${dx}px, ${dy}px) scale(0.9)`;
    ghost.style.opacity = '0.4';
  });
  setTimeout(() => ghost.remove(), 360);
}

interface OwnSpan {
  kind: 'hold' | 'booking';
  id: string;
  start: number;
  end: number;
  tailEnd: number;
  status: string;
  payment?: string;
  expiresAt?: string;
  businessName?: string;
}

interface BoardState {
  date: string;
  today: string;
  serverNowEpoch: number;
  fetchedAtEpoch: number;
  billing: 'up' | 'down';
  stations: { id: string; name: string; segments: AnySegment[] }[];
}

function spansOf(segments: AnySegment[]): { own: OwnSpan[]; occupied: [number, number][]; names: Map<number, string> } {
  const own: OwnSpan[] = [];
  const occupied: [number, number][] = [];
  const names = new Map<number, string>();
  for (const seg of segments) {
    const start = minutesFromClock(seg.start);
    const tailEnd = minutesFromClock(seg.end);
    if (seg.kind === 'occupied') {
      occupied.push([start, tailEnd]);
    } else {
      const businessName = 'business_name' in seg ? (seg as { business_name?: string }).business_name : undefined;
      if (businessName) {
        const startIdx = Math.round((start - OPENS) / CELL);
        names.set(startIdx, businessName);
        occupied.push([start, tailEnd]);
      } else {
        own.push({
          kind: seg.kind,
          id: seg.id,
          start,
          end: minutesFromClock(seg.end),
          tailEnd,
          status: seg.status,
          payment: seg.kind === 'booking' ? seg.payment : undefined,
          expiresAt: seg.kind === 'hold' ? seg.expires_at : undefined,
        });
      }
    }
  }
  return { own, occupied, names };
}

interface PaintAnalysis {
  start: number;
  fittedEnd: number;
  tailEnd: number;
  conflicts: Map<number, 'Taken' | 'Cleaning clash'>;
  fits: boolean;
  booked: number;
  prepaid: number;
  overage: string;
}

export function BoardScreen() {
  const { user, kitchen } = useSession();
  const { setUpdates, setProblems } = useFeedback();
  const [date, setDate] = useState(kitchen.today);
  const [board, setBoard] = useState<BoardState | null>(null);
  const [balance, setBalance] = useState(0);
  const [paint, setPaint] = useState<{ stationId: string; anchor: number; end: number } | null>(null);
  const [shake, setShake] = useState(false);
  const [cursor, setCursor] = useState<{ station: number; cell: number } | null>(null);
  const [drawer, setDrawer] = useState<{ kind: 'hold' | 'booking'; id: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [askCancel, setAskCancel] = useState(false);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [nowMinutes, setNowMinutes] = useState(0);
  const restoredRef = useRef<string>('');

  const isMember = user.role === 'member';

  const fetchBoard = useCallback(async (d: string) => {
    const res = await getBoard(d);
    if (res.ok && res.body) {
      const body = res.body as BoardResponse;
      const { minutes } = clockFromInstant(body.now, body.time_zone);
      setBoard({
        date: body.date,
        today: body.today,
        serverNowEpoch: Date.parse(body.now),
        fetchedAtEpoch: Date.now(),
        billing: body.billing,
        stations: body.stations,
      });
      setNowMinutes(minutes);
      if (user.role !== 'operator') {
        const me = await getMe();
        if (me.ok && me.body && me.body.balance_minutes !== null) setBalance(me.body.balance_minutes);
      }
    }
  }, [user.role]);

  useEffect(() => {
    void fetchBoard(date);
  }, [date, fetchBoard]);

  // Board data is fetched again every 5 seconds while the board is visible.
  useEffect(() => {
    const timer = setInterval(() => void fetchBoard(date), 5000);
    return () => clearInterval(timer);
  }, [date, fetchBoard]);

  // The now line steps once per minute from the server clock kept as an
  // offset measured at each board fetch.
  useEffect(() => {
    const timer = setInterval(() => {
      if (!board) return;
      const epoch = board.serverNowEpoch + (Date.now() - board.fetchedAtEpoch);
      const { minutes } = clockFromInstant(new Date(epoch).toISOString(), kitchen.time_zone);
      setNowMinutes(minutes);
    }, 60000);
    return () => clearInterval(timer);
  }, [board, kitchen.time_zone]);

  // On the kitchen's today the board opens scrolled to the hour containing
  // now; on any other date it opens at 05:00.
  useEffect(() => {
    if (!board || !frameRef.current) return;
    if (restoredRef.current === board.date) return;
    restoredRef.current = board.date;
    if (board.date === board.today) {
      frameRef.current.scrollLeft = Math.max(0, Math.floor((nowMinutes - OPENS) / 60)) * 4 * CELL_W;
    } else {
      frameRef.current.scrollLeft = 0;
    }
  }, [board, nowMinutes]);

  // ------------------------------------------------------------------
  // Painting: the band, its tail, conflicts and cost.
  // ------------------------------------------------------------------

  const stationOf = useCallback(
    (id: string) => kitchen.stations.find((s) => s.id === id)!,
    [kitchen.stations],
  );

  const paintAnalysis = useMemo<PaintAnalysis | null>(() => {
    if (!paint || !board) return null;
    const station = board.stations.find((s) => s.id === paint.stationId);
    if (!station) return null;
    const { own, occupied } = spansOf(station.segments);
    const tailCells = stationOf(paint.stationId).cleaning_minutes / CELL;
    const start = Math.min(paint.anchor, paint.end);
    const dragEnd = Math.max(paint.anchor, paint.end);

    const cellState = (i: number): { blocked: boolean; tailClash: boolean } => {
      if (i >= CELLS) return { blocked: true, tailClash: tailCells > 0 };
      const m = OPENS + i * CELL;
      const past = board.date === board.today && m + CELL <= nowMinutes;
      const inOccupied = occupied.some(([s, e]) => m >= s && m < e);
      const inOwnBody = own.some((o) => m >= o.start && m < o.end);
      const inOwnTail = own.some((o) => m >= o.end && m < o.tailEnd);
      return { blocked: past || inOccupied || inOwnBody || inOwnTail, tailClash: inOwnTail };
    };

    // The band stops at the last cell whose span and tail both fit.
    let fittedEnd = -1;
    for (let i = start; i <= dragEnd; i++) {
      let fitsHere = !cellState(i).blocked;
      for (let t = i + 1; fitsHere && t <= i + tailCells; t++) {
        if (cellState(t).blocked) fitsHere = false;
      }
      if (!fitsHere) break;
      fittedEnd = i;
    }

    // The cells the drag or the tail would hit stay red while the pointer is
    // beyond them.
    const conflicts = new Map<number, 'Taken' | 'Cleaning clash'>();
    for (let i = fittedEnd + 1; i <= dragEnd; i++) {
      conflicts.set(i, cellState(i).tailClash ? 'Cleaning clash' : 'Taken');
    }
    const tailEnd = fittedEnd + 1 + tailCells;
    if (fittedEnd >= 0) {
      for (let t = fittedEnd + 1; t < tailEnd; t++) {
        if (cellState(t).blocked) conflicts.set(t, 'Cleaning clash');
      }
    }

    const fits = fittedEnd >= start;
    const booked = fits ? (fittedEnd - start + 1) * CELL : 0;
    const split = costSplit(balance, OPENS + start * CELL, OPENS + start * CELL + booked, stationOf(paint.stationId));
    return {
      start,
      fittedEnd,
      tailEnd,
      conflicts,
      fits,
      booked,
      prepaid: split.prepaid_minutes,
      overage: split.overage_amount,
    };
  }, [paint, board, balance, nowMinutes, stationOf]);

  const placeHold = async (startCell: number, endCell: number, stationId: string) => {
    const station = stationOf(stationId);
    const start = clockFromMinutes(OPENS + startCell * CELL);
    const end = clockFromMinutes(OPENS + (endCell + 1) * CELL);
    setUpdates('Placing hold…');
    setProblems('');
    // The band's last geometry, for the band-to-rail flight on success.
    const bandRect = bandRectBeforeFlight.current;
    const res = await postHold({ station_id: stationId, date, start, end });
    if (res.ok && res.body) {
      if (!prefersReducedMotion() && bandRect) {
        flightToRail(bandRect, station.name, start, end);
      }
      setUpdates(`Hold placed: ${station.name}, ${start}–${end}. Confirm it before the timer runs out.`);
      clearPaint();
      await fetchBoard(date);
      return;
    }
    if (res.error === 'slot_taken') {
      // The band shakes once (or a static red edge under reduced motion),
      // clears, and the Updates region names the lost station and time.
      setShake(true);
      setTimeout(
        () => {
          setShake(false);
          clearPaint();
        },
        prefersReducedMotion() ? 2000 : 400,
      );
      setUpdates(`Another member took ${station.name} at ${start}. Your hold was not placed.`);
      return;
    }
    clearPaint();
    setUpdates('');
    if (res.error === 'documents_not_current') {
      setProblems(`Your liability insurance is not approved and current for ${date}. Renew it on Documents before booking.`);
    } else if (res.status === 0) {
      setProblems('Passboard could not reach the server. Nothing changed; try again.');
    } else {
      setProblems(`That slot can't be held. ${reasonFromErrors(res.errors)}`);
    }
  };

  // ------------------------------------------------------------------
  // Pointer painting.
  // ------------------------------------------------------------------

  const holdTimer = useRef<number | null>(null);
  const painting = useRef(false);
  const paintRef = useRef(paint);
  paintRef.current = paint;
  const analysisRef = useRef(paintAnalysis);
  analysisRef.current = paintAnalysis;

  const cellFromPointer = (e: ReactPointerEvent): { stationId: string; cell: number; state: string } | null => {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const cell = el?.closest<HTMLElement>('[data-cell-index]');
    if (!cell) return null;
    return {
      stationId: cell.dataset['stationId'] ?? '',
      cell: Number(cell.dataset['cellIndex']),
      state: cell.dataset['cellState'] ?? 'free',
    };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!isMember) return;
    const info = cellFromPointer(e);
    if (!info) return;
    if (info.state !== 'free') return;
    if (e.pointerType === 'touch') {
      // A press-and-hold of about half a second starts painting, so a plain
      // swipe still scrolls the board frame.
      holdTimer.current = window.setTimeout(() => {
        painting.current = true;
        startPaint(info.stationId, info.cell);
      }, 500);
    } else {
      painting.current = true;
      startPaint(info.stationId, info.cell);
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!painting.current) return;
    const info = cellFromPointer(e);
    if (info) extendPaint(info.cell);
  };

  const endPaint = () => {
    if (holdTimer.current !== null) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    if (!painting.current) return;
    painting.current = false;
    const analysis = analysisRef.current;
    const current = paintRef.current;
    if (!analysis || !analysis.fits || !current) {
      clearPaint();
      return;
    }
    void placeHold(analysis.start, analysis.fittedEnd, current.stationId);
  };

  const startPaint = (stationId: string, cell: number) => setPaint({ stationId, anchor: cell, end: cell });
  const extendPaint = (cell: number) => setPaint((p) => (p ? { ...p, end: cell } : p));
  const clearPaint = () => setPaint(null);

  // ------------------------------------------------------------------
  // Drawer actions.
  // ------------------------------------------------------------------

  const [bookingDetail, setBookingDetail] = useState<Booking | null>(null);

  const openTicket = (kind: 'hold' | 'booking', id: string) => {
    setDrawer({ kind, id });
    setAskCancel(false);
    setBookingDetail(null);
  };

  const closeDrawer = () => setDrawer(null);

  // A booking's drawer shows its cost split, cutoff and fee from the booking
  // itself; a hold's drawer derives everything from the board and balance.
  useEffect(() => {
    if (!drawer || drawer.kind !== 'booking') return;
    let cancelled = false;
    void getBooking(drawer.id).then((res) => {
      if (!cancelled && res.ok && res.body) setBookingDetail(res.body.booking);
    });
    return () => {
      cancelled = true;
    };
  }, [drawer]);

  const confirmBooking = async () => {
    if (!drawer || drawer.kind !== 'hold') return;
    setBusy(true);
    setUpdates('Confirming booking…');
    const res = await confirmHold(drawer.id);
    setBusy(false);
    if (res.ok && res.body) {
      const b = res.body.booking;
      const base = `Booking confirmed: ${b.station_name}, ${b.date} ${b.start}–${b.end}.`;
      setUpdates(b.payment === 'payment_pending' ? `${base} Payment pending until billing records it.` : base);
      closeDrawer();
      await fetchBoard(date);
      return;
    }
    setUpdates('');
    if (res.error === 'documents_not_current') {
      setProblems(`Your liability insurance is not approved and current for ${date}. Renew it on Documents before booking.`);
      return;
    }
    if (res.error === 'slot_taken') {
      setProblems('That slot is no longer free.');
      return;
    }
    setProblems('This hold expired before it was confirmed. Paint the slot again.');
    closeDrawer();
    await fetchBoard(date);
  };

  const releaseHold = async (id?: string) => {
    const holdId = id ?? drawer?.id;
    if (!holdId) return;
    setBusy(true);
    setUpdates('Releasing hold…');
    const res = await deleteHold(holdId);
    setBusy(false);
    if (res.ok) {
      setUpdates('Hold released.');
      closeDrawer();
      await fetchBoard(date);
      return;
    }
    setUpdates('');
    setProblems(res.error === 'hold_expired' ? 'This hold has expired.' : 'This hold has expired.');
    closeDrawer();
    await fetchBoard(date);
  };

  const doCancel = async () => {
    if (!drawer || drawer.kind !== 'booking') return;
    setBusy(true);
    setUpdates('Cancelling booking…');
    const res = await cancelBooking(drawer.id);
    setBusy(false);
    if (res.ok && res.body) {
      const b = res.body.booking;
      if (b.status === 'cancelled_free') {
        setUpdates(`Booking cancelled. ${hoursText(b.prepaid_minutes)} h returned to your prepaid balance.`);
      } else {
        setUpdates(`Booking cancelled. ${hoursText(b.prepaid_minutes)} h returned; late-cancellation fee $${b.fee?.amount ?? '0.00'}.`);
      }
      closeDrawer();
      await fetchBoard(date);
      return;
    }
    setUpdates('');
    if (res.error === 'booking_started' || res.error === 'invalid_transition') {
      setProblems('This booking has already started and can no longer be cancelled.');
    } else {
      setProblems('Passboard could not reach the server. Nothing changed; try again.');
    }
  };

  const resizeHold = async (id: string, newEndCell: number) => {
    setUpdates('Updating hold…');
    const end = clockFromMinutes(OPENS + (newEndCell + 1) * CELL);
    const res = await patchHold(id, end);
    if (res.ok && res.body) {
      setUpdates(`Hold now ends at ${res.body.hold.end}.`);
      await fetchBoard(date);
      return;
    }
    setUpdates('');
    if (res.error === 'slot_taken') {
      setProblems('That change collides with another booking. The hold is unchanged.');
    } else if (res.error === 'hold_expired') {
      setProblems('This hold has expired.');
    } else {
      setProblems('Passboard could not reach the server. Nothing changed; try again.');
    }
  };

  // ------------------------------------------------------------------
  // Keyboard painting.
  // ------------------------------------------------------------------

  const ownAt = (stationIdx: number, cell: number, kind: 'hold' | 'booking'): OwnSpan | null => {
    const station = board?.stations[stationIdx];
    if (!station) return null;
    const m = OPENS + cell * CELL;
    const { own } = spansOf(station.segments);
    return own.find((o) => o.kind === kind && m >= o.start && m < o.end) ?? null;
  };

  const onGridKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!cursor) return;
    const { station, cell } = cursor;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const delta = e.key === 'ArrowRight' ? 1 : -1;
      if (e.shiftKey && isMember) {
        if (paintRef.current) {
          extendPaint(paintRef.current.end + delta);
        } else {
          const hold = ownAt(station, cell, 'hold');
          if (hold) {
            void resizeHold(hold.id, cell + delta);
            return;
          }
          const stationId = kitchen.stations[station]!.id;
          setPaint({ stationId, anchor: cell, end: cell + delta });
        }
      } else {
        clearPaint();
        setCursor({ station, cell: Math.max(0, Math.min(CELLS - 1, cell + delta)) });
      }
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      clearPaint();
      setCursor({
        station: Math.max(0, Math.min(kitchen.stations.length - 1, station + (e.key === 'ArrowDown' ? 1 : -1))),
        cell,
      });
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const analysis = analysisRef.current;
      if (analysis && analysis.fits && analysis.booked > 0 && paintRef.current) {
        void placeHold(analysis.start, analysis.fittedEnd, paintRef.current.stationId);
        return;
      }
      const hold = ownAt(station, cell, 'hold');
      if (hold) {
        openTicket('hold', hold.id);
        return;
      }
      const booking = ownAt(station, cell, 'booking');
      if (booking) openTicket('booking', booking.id);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (paintRef.current) {
        clearPaint();
        return;
      }
      if (drawer) {
        closeDrawer();
        return;
      }
      const hold = ownAt(station, cell, 'hold');
      if (hold && isMember) void releaseHold(hold.id);
    }
  };

  // ------------------------------------------------------------------
  // Rendering.
  // ------------------------------------------------------------------

  const drawerContent = useMemo<DrawerContent | null>(() => {
    if (!drawer || !board) return null;
    for (const station of board.stations) {
      const { own } = spansOf(station.segments);
      const span = own.find((o) => o.id === drawer.id && o.kind === drawer.kind);
      if (!span) continue;
      const isHold = span.kind === 'hold';
      const stationInfo = kitchen.stations.find((s) => s.id === station.id)!;
      const split = costSplit(balance, span.start, span.end, stationInfo);
      let cancelTerms: string | undefined;
      if (!isHold && bookingDetail) {
        const cutoffEpoch = Date.parse(bookingDetail.free_cancel_until);
        const nowEpoch = board.serverNowEpoch + (Date.now() - board.fetchedAtEpoch);
        if (nowEpoch <= cutoffEpoch) {
          const { date, minutes } = clockFromInstant(bookingDetail.free_cancel_until, kitchen.time_zone);
          cancelTerms = `Free cancellation until ${date} ${clockFromMinutes(minutes)}`;
        } else {
          cancelTerms = `Late-cancellation fee: $${lateFee(bookingDetail)}`;
        }
      }
      return {
        kind: span.kind,
        id: span.id,
        stationName: station.name,
        date: board.date,
        start: clockFromMinutes(span.start),
        end: clockFromMinutes(span.end),
        tailEnd: clockFromMinutes(span.tailEnd),
        prepaid: split.prepaid_minutes,
        overage: split.overage_amount,
        statusLabel: isHold
          ? 'Hold'
          : span.payment === 'payment_pending'
            ? 'Payment pending'
            : 'Confirmed',
        cancelTerms,
      };
    }
    return null;
  }, [drawer, board, balance, bookingDetail, kitchen.stations, kitchen.time_zone]);

  // Track the band's geometry for the band-to-rail flight. Runs after every
  // render but only reads the DOM while a paint is in progress.
  const bandRectBeforeFlight = useRef<{ left: number; top: number; width: number; height: number } | null>(null);
  useEffect(() => {
    if (!paint || !paintAnalysis || !board) return;
    if (board.stations.every((s) => s.id !== paint.stationId)) return;
    const cells = document.querySelectorAll<HTMLElement>(`[data-station-id="${paint.stationId}"][data-cell-index]`);
    const first = cells[paintAnalysis.start];
    const last = cells[paintAnalysis.fittedEnd];
    if (first && last) {
      const a = first.getBoundingClientRect();
      const b = last.getBoundingClientRect();
      bandRectBeforeFlight.current = { left: a.left, top: a.top, width: b.right - a.left, height: b.bottom - a.top };
    }
  });

  if (!board) {
    return (
      <>
        <h1>Line board</h1>
        <p className="hint">Loading the board…</p>
      </>
    );
  }

  const myTickets: { span: OwnSpan; stationName: string }[] = [];
  for (const station of board.stations) {
    const { own } = spansOf(station.segments);
    for (const o of own) myTickets.push({ span: o, stationName: station.name });
  }
  myTickets.sort((a, b) => a.span.start - b.span.start);

  const paintStationIdx = paint ? board.stations.findIndex((s) => s.id === paint.stationId) : -1;
  const askTerms = drawerContent?.cancelTerms;

  return (
    <>
      <div className="board-head" id="board">
        <h1>Line board</h1>
        <span className="date">{longDate(board.date)}</span>
        <button type="button" className="ghost" onClick={() => setDate(addDays(board.date, -1))}>Previous day</button>
        <button type="button" className="ghost" onClick={() => setDate(addDays(board.date, 1))}>Next day</button>
        <button type="button" className="ghost" onClick={() => setDate(board.today)}>Today</button>
      </div>
      {board.billing === 'down' && (
        <p className="billing-banner" role="status" aria-label="Billing status">
          Billing is unreachable. Bookings that need a charge are confirmed with payment pending and settle automatically.
        </p>
      )}
      <div className="rail">
        <div className="rail-inner" role="region" aria-label="My tickets">
          {myTickets.length === 0 && <span className="hint">No tickets for this day yet.</span>}
          <ul style={{ display: 'contents', listStyle: 'none', margin: 0, padding: 0 }}>
            {myTickets.map(({ span: t, stationName }) => {
              const ticketState =
                t.kind === 'hold' ? 'hold' : t.payment === 'payment_pending' ? 'payment pending' : 'confirmed';
              // A hold's ticket and frame fade out at its expiry instant; the
              // next board fetch then clears the cells.
              const expired =
                t.kind === 'hold' &&
                t.expiresAt !== undefined &&
                board.serverNowEpoch + (Date.now() - board.fetchedAtEpoch) >= Date.parse(t.expiresAt);
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    className={`ticket${t.kind === 'hold' ? ' hold' : ''}${t.payment === 'payment_pending' ? ' payment-pending' : ''}${expired ? ' fade-out' : ''}`}
                    aria-label={`Ticket ${stationName}, ${board.date} ${clockFromMinutes(t.start)}–${clockFromMinutes(t.end)}, ${ticketState}`}
                    onClick={() => openTicket(t.kind, t.id)}
                  >
                    <span className="station">{stationName}</span>
                    <span className="times num">
                      {shortDate(board.date)} {clockFromMinutes(t.start)}–{clockFromMinutes(t.end)}
                    </span>
                    {t.kind === 'hold' && t.expiresAt && (
                      <span className="countdown" role="timer" aria-label="Hold time left">
                        <Countdown
                          expiresAt={t.expiresAt}
                          serverNowEpoch={board.serverNowEpoch}
                          fetchedAtEpoch={board.fetchedAtEpoch}
                        />
                      </span>
                    )}
                    {t.payment === 'payment_pending' && <span className="statusline">Payment pending</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          {user.role !== 'operator' && (
            <span className="balance num">Prepaid {hoursText(balance)} h</span>
          )}
        </div>
      </div>

      <div className="layout">
        {drawerContent && (
          <aside className="drawer" role="complementary" aria-label="Ticket details" aria-hidden={false}>
            <h2>{drawerContent.stationName}</h2>
            <dl>
              <dt>Date</dt>
              <dd>{drawerContent.date}</dd>
              <dt>Times</dt>
              <dd>{drawerContent.start}–{drawerContent.end}</dd>
              <dt>Cleaning until</dt>
              <dd>{drawerContent.tailEnd}</dd>
              <dt>Cost</dt>
              <dd>
                {hoursText(drawerContent.prepaid)} h prepaid + ${drawerContent.overage}
              </dd>
              <dt>Status</dt>
              <dd>{drawerContent.statusLabel}</dd>
            </dl>
            {drawerContent.kind === 'hold' && (
              <div className="actions">
                <button type="button" onClick={confirmBooking} disabled={busy} autoFocus>Confirm booking</button>
                <button type="button" className="ghost" onClick={() => releaseHold()} disabled={busy}>Release hold</button>
              </div>
            )}
            {drawerContent.kind === 'booking' && !askCancel && (
              <div className="actions">
                <button type="button" onClick={() => setAskCancel(true)} autoFocus>Cancel booking</button>
              </div>
            )}
            {drawerContent.kind === 'booking' && askCancel && askTerms && (
              <div>
                <p className="fee-note">{askTerms}</p>
                <div className="actions">
                  <button type="button" onClick={doCancel} disabled={busy} autoFocus>Yes, cancel booking</button>
                  <button type="button" className="ghost" onClick={() => setAskCancel(false)} disabled={busy}>Keep booking</button>
                </div>
              </div>
            )}
            <div className="actions" style={{ marginTop: 12 }}>
              <button type="button" className="ghost" onClick={closeDrawer}>Close details</button>
            </div>
          </aside>
        )}

        <div className="board-body" style={{ flex: 1, minWidth: 0 }}>
          <div className="board-frame" ref={frameRef}>
            <div className="board-scroll">
              <div
                className="board-grid"
                role="grid"
                aria-label="Line board"
                tabIndex={0}
                onKeyDown={onGridKeyDown}
                onFocus={() => {
                  if (!cursor) {
                    const cell = board.date === board.today ? Math.max(0, Math.ceil((nowMinutes - OPENS) / CELL)) : 0;
                    setCursor({ station: 0, cell });
                  }
                }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endPaint}
                onPointerCancel={endPaint}
                onPointerLeave={endPaint}
              >
                <div className="board-row" role="row">
                  <div className="corner" />
                  {Array.from({ length: HOUR_LABELS }, (_, h) => (
                    <div key={h} className="hourlabel num" aria-hidden="true">
                      {clockFromMinutes(OPENS + h * 60)}
                    </div>
                  ))}
                </div>
                {board.stations.map((station, sIdx) => (
                  <div className="board-row" role="row" key={station.id}>
                    <BoardRow
                    station={station}
                    date={board.date}
                    today={board.today}
                    nowMinutes={nowMinutes}
                    paint={paint && paint.stationId === station.id ? paint : null}
                    paintAnalysis={paint && paint.stationId === station.id ? paintAnalysis : null}
                    shake={shake}
                    cursor={cursor && cursor.station === sIdx ? cursor : null}
                    isOperator={user.role === 'operator'}
                  />
                  </div>
                ))}
              </div>
              {board.date === board.today && (
                <div className="nowline" style={{ left: nameColWidth() + ((nowMinutes - OPENS) / CELL) * CELL_W }}>
                  <span className="nowlabel">Now {clockFromMinutes(nowMinutes)}</span>
                </div>
              )}
              {paint && paintAnalysis && paintStationIdx >= 0 && (
                <span
                  className="painttag"
                  role="status"
                  aria-label="Paint cost"
                  style={{
                    left: nameColWidth() + (paintAnalysis.fittedEnd + 1) * CELL_W + 6,
                    top: paintStationIdx * ROW_H + HOUR_ROW_H + 4,
                  }}
                >
                  <CostTagText
                    text={`${durationText(paintAnalysis.booked)} · ${hoursText(paintAnalysis.prepaid)} h prepaid + $${paintAnalysis.overage}`}
                  />
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

const HOUR_ROW_H = 28;

/** On each snap the digits that change roll upward to their new value. */
function CostTagText({ text }: { text: string }) {
  const [rolling, setRolling] = useState(false);
  const prev = useRef(text);
  useEffect(() => {
    if (prev.current !== text) {
      prev.current = text;
      setRolling(true);
      const timer = setTimeout(() => setRolling(false), 250);
      return () => clearTimeout(timer);
    }
    return;
  }, [text]);
  return <span className={rolling ? 'roll' : undefined}>{text}</span>;
}

function Countdown({ expiresAt, serverNowEpoch, fetchedAtEpoch }: { expiresAt: string; serverNowEpoch: number; fetchedAtEpoch: number }) {
  const [text, setText] = useState(() => countdownText(expiresAt, serverNowEpoch + (Date.now() - fetchedAtEpoch)));
  useEffect(() => {
    const timer = setInterval(() => {
      setText(countdownText(expiresAt, serverNowEpoch + (Date.now() - fetchedAtEpoch)));
    }, 1000);
    return () => clearInterval(timer);
  }, [expiresAt, serverNowEpoch, fetchedAtEpoch]);
  return <span>{text}</span>;
}

function BoardRow(props: {
  station: { id: string; name: string; segments: AnySegment[] };
  date: string;
  today: string;
  nowMinutes: number;
  paint: { stationId: string; anchor: number; end: number } | null;
  paintAnalysis: PaintAnalysis | null;
  shake: boolean;
  cursor: { station: number; cell: number } | null;
  isOperator: boolean;
}) {
  const { station, date, today, nowMinutes, paintAnalysis, shake, cursor } = props;
  const { own, occupied, names } = spansOf(station.segments);

  return (
    <>
      <div className="stationname" role="rowheader">{station.name}</div>
      {Array.from({ length: CELLS }, (_, i) => {
        const m = OPENS + i * CELL;
        let state = 'free';
        for (const o of own) {
          if (m >= o.start && m < o.tailEnd) {
            state = m < o.end ? (o.kind === 'hold' ? 'your hold' : 'your booking') : 'cleaning tail';
            break;
          }
        }
        if (state === 'free') {
          for (const [s, e] of occupied) {
            if (m >= s && m < e) {
              state = 'occupied';
              break;
            }
          }
        }
        if (state === 'free' && date === today && m + CELL <= nowMinutes) state = 'past';

        const painted = paintAnalysis
          ? i >= paintAnalysis.start && i <= paintAnalysis.fittedEnd && paintAnalysis.fits
            ? 'painting'
            : i > paintAnalysis.fittedEnd && i < paintAnalysis.tailEnd
              ? 'tail'
              : 'none'
          : 'none';
        const conflict = paintAnalysis?.conflicts.get(i);

        let visual = state;
        if (conflict) visual = 'conflict';
        else if (painted === 'painting') visual = 'painting';
        else if (painted === 'tail') visual = 'tail';

        const classes = ['board-cell'];
        if (visual === 'occupied') classes.push('occupied');
        if (visual === 'your booking') classes.push('own-booking');
        if (visual === 'cleaning tail' || visual === 'tail') classes.push('tail');
        if (visual === 'your hold') classes.push('hold-frame');
        if (visual === 'past') classes.push('past');
        if (visual === 'conflict') classes.push('conflict');
        if (visual === 'painting') classes.push('painting');
        if (cursor && cursor.cell === i) classes.push('cursor');
        if (shake && (visual === 'painting' || visual === 'tail' || visual === 'conflict')) {
          classes.push('band-shake');
          classes.push('band-lost');
        }

        return (
          <div
            key={i}
            className={classes.join(' ')}
            role="gridcell"
            aria-label={`${station.name}, ${clockFromMinutes(m)}, ${visual}`}
            data-cell-index={i}
            data-station-id={station.id}
            data-cell-state={state}
          >
            {visual === 'conflict' && <span className="cell-text">{conflict ?? 'Taken'}</span>}
            {names.has(i) && <span className="span-name">{names.get(i)}</span>}
          </div>
        );
      })}
    </>
  );
}

function reasonFromErrors(errors?: Record<string, string>): string {
  const code = errors ? Object.values(errors)[0] : undefined;
  switch (code) {
    case 'in_the_past':
      return 'It starts in the past.';
    case 'too_far_ahead':
      return 'Bookings open 28 days ahead.';
    case 'outside_board_hours':
      return 'The cleaning turnover must finish by 24:00.';
    default:
      return 'Pick whole 15-minute cells.';
  }
}

/** Half the booking's list price, rounded half up to the cent, as the drawer shows it. */
function lateFee(booking: Booking): string {
  const cents = Math.round(Number(booking.list_amount) * 100);
  const fee = Math.sign(cents) * Math.round(Math.abs(cents) / 2 + 1e-9);
  return (fee / 100).toFixed(2);
}

interface DrawerContent {
  kind: 'hold' | 'booking';
  id: string;
  stationName: string;
  date: string;
  start: string;
  end: string;
  tailEnd: string;
  prepaid: number;
  overage: string;
  statusLabel: string;
  cancelTerms?: string;
}
