import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Cell, Hold, LoomView, MemberSummary, Quote, SeriesOccurrence } from '../../shared/types';
import { formatAmount } from '../../shared/format';
import { ApiFailure, api, newIdempotencyKey } from '../api';
import type { Session } from '../app';
import { useCoarsePointer, useInterval, useNarrow, useReducedMotion, useServerCountdown } from '../hooks';
import { replaceSearch, useLocation } from '../router';
import { useServices } from '../services';
import { Check, ChevronLeft, ChevronRight, Clock, FileWarning, Lock, Paintbrush, X } from '../ui/icons';
import { Dialog } from '../ui/Dialog';
import { FloorPlan } from './FloorPlan';
import { LoomGrid, type GridCallbacks } from './LoomGrid';
import { QuoteRail } from './QuoteRail';
import {
  COLUMNS,
  LEGEND,
  RUN_LABEL,
  brushBox,
  columnOfStart,
  columnStart,
  markRuns,
  type Brush,
  type CellInfo,
  type CellState,
} from './model';

function cellKey(stationId: string, start: string): string {
  return `${stationId}@${start}`;
}

function legendIcon(state: CellState): ReactNode {
  switch (state) {
    case 'selected':
      return <Paintbrush size={13} aria-hidden="true" />;
    case 'held':
      return <Clock size={13} aria-hidden="true" />;
    case 'booked':
      return <Check size={13} aria-hidden="true" />;
    case 'taken':
      return <Lock size={13} aria-hidden="true" />;
    case 'conflict':
      return <X size={13} aria-hidden="true" />;
    default:
      return <FileWarning size={13} aria-hidden="true" />;
  }
}

interface AddressState {
  date: string | null;
  stations: string[] | null;
  sel: { top: string; bottom: string; start: string; end: string } | null;
  hold: string | null;
}

function readAddress(search: string): AddressState {
  const params = new URLSearchParams(search);
  const date = params.get('date');
  const stations = params.get('stations');
  const sel = params.get('sel');
  let parsed: AddressState['sel'] = null;
  if (sel) {
    const match = /^([^.]+)\.\.([^@]+)@(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(sel);
    if (match) parsed = { top: match[1], bottom: match[2], start: match[3], end: match[4] };
  }
  return {
    date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    stations: stations ? stations.split(',').filter(Boolean) : null,
    sel: parsed,
    hold: params.get('hold'),
  };
}

export function LoomScreen({ session }: { session: Session }): ReactNode {
  const { kitchen, user } = session;
  const location = useLocation();
  const reduced = useReducedMotion();
  const touch = useCoarsePointer();
  const narrow = useNarrow();
  const services = useServices();

  const initial = useRef(readAddress(window.location.search));
  const [date, setDate] = useState(initial.current.date ?? kitchen.today);
  const [chosen, setChosen] = useState<string[]>(
    initial.current.stations ?? kitchen.stations.map((station) => station.id),
  );
  const [members, setMembers] = useState<MemberSummary[]>([]);
  const [memberId, setMemberId] = useState<string | null>(user.member_id);
  const [loom, setLoom] = useState<LoomView | null>(null);
  const [brush, setBrush] = useState<Brush | null>(null);
  const [hold, setHold] = useState<Hold | null>(null);
  const [lost, setLost] = useState<Set<string>>(new Set());
  const [settling, setSettling] = useState<Set<string>>(new Set());
  const [quote, setQuote] = useState<Quote | null>(null);
  const [pricing, setPricing] = useState(false);
  const [pricingFailed, setPricingFailed] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [usePack, setUsePack] = useState(false);
  const [packQuarters, setPackQuarters] = useState(0);
  const [status, setStatus] = useState('');
  const [statusIsError, setStatusIsError] = useState(false);
  const [focusRow, setFocusRow] = useState(0);
  const [focusCol, setFocusCol] = useState(0);
  const [hover, setHover] = useState<{ row: number; col: number } | null>(null);
  const [stationsDialog, setStationsDialog] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState(false);
  const [repeatDialog, setRepeatDialog] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [busy, setBusy] = useState(false);

  const dragging = useRef(false);
  const keyAnchor = useRef<{ row: number; col: number } | null>(null);
  const announceTimer = useRef<number | null>(null);

  const operator = user.role === 'operator';
  const stations = useMemo(
    () => kitchen.stations.filter((station) => chosen.includes(station.id)),
    [kitchen.stations, chosen],
  );

  /* ---- loading ---- */

  useEffect(() => {
    if (!operator) return;
    void api
      .members(kitchen.id)
      .then(({ members: found }) => {
        setMembers(found);
        setMemberId((current) => current ?? found[0]?.id ?? null);
      })
      .catch(() => undefined);
  }, [kitchen.id, operator]);

  const reloadLoom = useCallback(() => {
    void api
      .loom(kitchen.id, date, operator ? memberId : null)
      .then(setLoom)
      .catch(() => undefined);
  }, [kitchen.id, date, memberId, operator]);

  useEffect(reloadLoom, [reloadLoom]);
  useInterval(reloadLoom, 15000);

  const reloadPack = useCallback(() => {
    if (!memberId) return;
    void api
      .member(memberId)
      .then(({ member }) => setPackQuarters(member.pack_balance_quarters))
      .catch(() => undefined);
  }, [memberId]);

  useEffect(reloadPack, [reloadPack]);

  /* ---- restore a hold from the address ---- */

  useEffect(() => {
    const holdId = initial.current.hold;
    if (!holdId) return;
    void api
      .hold(holdId)
      .then(({ hold: found }) => {
        if (found.state === 'held') setHold(found);
      })
      .catch(() => undefined);
  }, []);

  /* ---- restore a brush from the address ---- */

  useEffect(() => {
    const sel = initial.current.sel;
    if (!sel) return;
    const top = kitchen.stations.findIndex((station) => station.id === sel.top);
    const bottom = kitchen.stations.findIndex((station) => station.id === sel.bottom);
    const startCol = columnOfStart(sel.start);
    const endCol = columnOfStart(sel.end) - 1;
    if (top < 0 || bottom < 0 || startCol < 0 || endCol < startCol || endCol >= COLUMNS) return;
    const rowOf = (id: string): number => stations.findIndex((station) => station.id === id);
    const topRow = rowOf(sel.top);
    const bottomRow = rowOf(sel.bottom);
    if (topRow < 0 || bottomRow < 0) return;
    setBrush({ anchorRow: topRow, anchorCol: startCol, row: bottomRow, col: endCol });
    setFocusRow(topRow);
    setFocusCol(startCol);
  }, [kitchen.stations, stations]);

  /* ---- the address carries the date, the stations and the pending brush ---- */

  useEffect(() => {
    const params = new URLSearchParams();
    params.set('date', date);
    if (chosen.length !== kitchen.stations.length) params.set('stations', chosen.join(','));
    if (hold && hold.state === 'held') {
      params.set('hold', hold.id);
    } else if (brush) {
      const box = brushBox(brush);
      const top = stations[box.top];
      const bottom = stations[box.bottom];
      if (top && bottom) {
        params.set(
          'sel',
          `${top.id}..${bottom.id}@${columnStart(box.left)}-${box.right + 1 >= COLUMNS ? '24:00' : columnStart(box.right + 1)}`,
        );
      }
    }
    replaceSearch(`?${params.toString()}`);
  }, [date, chosen, brush, hold, stations, kitchen.stations.length]);

  useEffect(() => {
    const address = readAddress(location.search);
    if (address.date && address.date !== date) setDate(address.date);
  }, [location.search]);

  /* ---- cell states ---- */

  const occupancy = useMemo(() => {
    const map = new Map<string, LoomView['cells'][number]>();
    for (const cell of loom ? loom.cells : []) map.set(cellKey(cell.station_id, cell.start), cell);
    return map;
  }, [loom]);

  const papersDay = loom !== null && loom.papers;

  const rows = useMemo(() => {
    const box = brush ? brushBox(brush) : null;
    return stations.map((station, rowIndex) => {
      const row: CellInfo[] = [];
      for (let col = 0; col < COLUMNS; col += 1) {
        const key = cellKey(station.id, columnStart(col));
        const occupied = occupancy.get(key);
        const info: CellInfo = { state: 'free' };
        if (occupied) {
          info.state = occupied.state;
          if (occupied.business !== undefined) info.business = occupied.business;
          if (occupied.hold_id !== undefined) info.holdId = occupied.hold_id;
          if (occupied.expires_at !== undefined) info.expiresAt = occupied.expires_at;
        } else if (lost.has(key)) {
          info.state = 'taken';
        } else if (papersDay) {
          info.state = 'papers';
        }
        if (
          box &&
          rowIndex >= box.top &&
          rowIndex <= box.bottom &&
          col >= box.left &&
          col <= box.right
        ) {
          if (info.state === 'free') info.state = 'selected';
          else if (info.state !== 'papers') info.state = 'conflict';
        }
        if (settling.has(key) && info.state === 'booked') info.settling = true;
        row.push(info);
      }
      markRuns(row, operator);
      return row;
    });
  }, [stations, occupancy, brush, lost, papersDay, settling, operator]);

  const selectedCells = useMemo(() => {
    const cells: Cell[] = [];
    rows.forEach((row, rowIndex) => {
      const station = stations[rowIndex];
      row.forEach((info, col) => {
        if (info.state === 'selected') cells.push({ station_id: station.id, start: columnStart(col) });
      });
    });
    return cells;
  }, [rows, stations]);

  const brushHasPapers = useMemo(
    () => brush !== null && rows.some((row) => row.some((info) => info.state === 'papers')) && papersDay,
    [brush, rows, papersDay],
  );

  const heldCells: Cell[] = useMemo(() => (hold ? hold.cells : []), [hold]);
  const quoteCells = hold ? heldCells : selectedCells;

  const litStations = useMemo(() => {
    const lit = new Set<string>();
    rows.forEach((row, rowIndex) => {
      if (row.some((info) => info.state === 'selected' || info.state === 'held')) {
        lit.add(stations[rowIndex].id);
      }
    });
    return lit;
  }, [rows, stations]);

  /* ---- the rail asks the server for a quote and counts to it ---- */

  const cellsSignature = quoteCells.map((cell) => `${cell.station_id}@${cell.start}`).join('|');

  useEffect(() => {
    if (quoteCells.length === 0) {
      setQuote(null);
      setPricing(false);
      setPricingFailed(false);
      setAnnouncement('');
      return;
    }
    setPricing(true);
    setPricingFailed(false);
    const timer = window.setTimeout(() => {
      void api
        .quote({ date, cells: quoteCells, use_pack: usePack, member_id: operator ? memberId : null })
        .then(({ quote: priced }) => {
          setQuote(priced);
          setPricing(false);
          if (announceTimer.current !== null) window.clearTimeout(announceTimer.current);
          const say = (): void => {
            const steps = priced.tier_steps_crossed
              .map((tier) => ` Crosses into tier ${tier}.`)
              .join('');
            setAnnouncement(`Total $${formatAmount(priced.total_cents)} for ${priced.hours} hours.${steps}`);
          };
          if (reduced) say();
          else announceTimer.current = window.setTimeout(say, 340);
        })
        .catch(() => {
          setPricing(false);
          setPricingFailed(true);
        });
    }, 110);
    return () => window.clearTimeout(timer);
  }, [cellsSignature, usePack, date, memberId, operator, reduced]);

  /* ---- hold countdown from the server's clock ---- */

  const secondsLeft = useServerCountdown(
    hold && hold.state === 'held' ? hold.expires_at : null,
    hold ? hold.server_now : null,
  );

  useEffect(() => {
    if (hold && secondsLeft === 0) {
      setHold(null);
      setStatus('This hold is no longer active.');
      setStatusIsError(true);
      reloadLoom();
    }
  }, [secondsLeft, hold, reloadLoom]);

  /* ---- brushing ---- */

  const say = (message: string, isError = false): void => {
    setStatus(message);
    setStatusIsError(isError);
  };

  const beginBrush = useCallback(
    (row: number, col: number) => {
      if (hold && hold.state === 'held') {
        const previous = hold.id;
        setHold(null);
        void api.releaseHold(previous).catch(() => undefined);
      }
      setLost(new Set());
      setBrush({ anchorRow: row, anchorCol: col, row, col });
      setFocusRow(row);
      setFocusCol(col);
      keyAnchor.current = null;
    },
    [hold],
  );

  useEffect(() => {
    if (!brushHasPapers || loom === null) return;
    const business = members.find((member) => member.id === memberId)?.business ?? 'This member';
    say(
      operator
        ? `${business}'s papers do not cover ${date}.`
        : `Your papers do not cover ${date}. Upload a current insurance certificate and food-handler card to book this day.`,
      true,
    );
  }, [brushHasPapers, date, loom, members, memberId, operator]);

  const extend = useCallback((row: number, col: number) => {
    setBrush((current) =>
      current === null
        ? current
        : { ...current, row: Math.max(0, row), col: Math.min(COLUMNS - 1, Math.max(0, col)) },
    );
    setFocusRow(row);
    setFocusCol(col);
  }, []);

  const placeHold = useCallback(() => {
    if (selectedCells.length === 0) {
      if (brushHasPapers) return;
      say('Nothing free to hold in that brush.', true);
      return;
    }
    setPlacing(true);
    say('Placing hold…');
    const asked = selectedCells;
    void api
      .placeHold({ date, cells: asked, member_id: operator ? memberId : null })
      .then(({ hold: placed, taken }) => {
        setBrush(null);
        setHold(placed);
        if (taken.length > 0) {
          setLost(new Set(taken.map((cell) => cellKey(cell.station_id, cell.start))));
          say(
            `Held ${placed.cells.length} cells until ${placed.expires_local} kitchen time. ${taken.length} cells were just taken by another booking.`,
          );
        } else {
          setLost(new Set());
          say(`Held ${placed.cells.length} cells until ${placed.expires_local} kitchen time.`);
        }
        reloadLoom();
      })
      .catch((failure: unknown) => {
        if (!(failure instanceof ApiFailure)) {
          say('Nothing was held. Try again.', true);
          return;
        }
        const body = failure.body;
        if (body.error === 'cells_taken') {
          setLost(new Set((body.taken ?? []).map((cell) => cellKey(cell.station_id, cell.start))));
          setBrush(null);
          say('Those cells were just taken. Nothing was held.', true);
        } else if (body.error === 'same_day_closed') {
          say(`Same-day booking closed at ${kitchen.same_day_cutoff} kitchen time.`, true);
        } else if (body.error === 'cell_in_past') {
          say('Some of those cells have already started. Brush a later block.', true);
        } else if (body.error === 'compliance_blocked') {
          const business = members.find((member) => member.id === memberId)?.business ?? 'This member';
          say(
            operator
              ? `${business}'s papers do not cover ${date}.`
              : `Your papers do not cover ${date}. Upload a current insurance certificate and food-handler card to book this day.`,
            true,
          );
        } else {
          say(body.message, true);
        }
        reloadLoom();
      })
      .finally(() => setPlacing(false));
  }, [selectedCells, brushHasPapers, date, memberId, operator, reloadLoom, kitchen.same_day_cutoff, members]);

  const clearBrush = useCallback(() => {
    setBrush(null);
    keyAnchor.current = null;
  }, []);

  const releaseHold = useCallback(() => {
    if (!hold) return;
    say('Releasing…');
    setBusy(true);
    void api
      .releaseHold(hold.id)
      .then(() => {
        setHold(null);
        say('Hold released.');
        reloadLoom();
      })
      .catch(() => say('This hold is no longer active.', true))
      .finally(() => setBusy(false));
  }, [hold, reloadLoom]);

  /* ---- pointer brushing ---- */

  useEffect(() => {
    if (touch) return;
    const onUp = (): void => {
      if (!dragging.current) return;
      dragging.current = false;
      placeHold();
    };
    const onMove = (event: PointerEvent): void => {
      if (!dragging.current) return;
      const frame = document.querySelector<HTMLElement>('.loom-frame .grid');
      const header = document.querySelector<HTMLElement>('.loom-frame .rowhead');
      if (!frame || !header) return;
      const box = frame.getBoundingClientRect();
      const headWidth = header.getBoundingClientRect().width;
      const first = document.querySelector<HTMLElement>('.loom-frame .cell');
      if (!first) return;
      const size = first.getBoundingClientRect();
      const col = Math.floor((event.clientX - box.left - headWidth) / size.width);
      const row = Math.floor((event.clientY - box.top - 26) / size.height);
      extend(
        Math.min(Math.max(row, 0), stations.length - 1),
        Math.min(Math.max(col, 0), COLUMNS - 1),
      );
    };
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointermove', onMove);
    return () => {
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointermove', onMove);
    };
  }, [touch, placeHold, extend, stations.length]);

  const callbacks: GridCallbacks = {
    onPointerDownCell: (row, col) => {
      dragging.current = true;
      beginBrush(row, col);
    },
    onPointerEnterCell: (row, col) => {
      if (dragging.current) extend(row, col);
    },
    onTapCell: (row, col) => {
      if (brush === null) beginBrush(row, col);
      else extend(row, col);
    },
    onHover: (row, col) => setHover({ row, col }),
    onHoverOut: () => setHover(null),
    onKeyDown: (event) => {
      const key = event.key;
      const move = (row: number, col: number): void => {
        event.preventDefault();
        const nextRow = Math.min(Math.max(row, 0), stations.length - 1);
        const nextCol = Math.min(Math.max(col, 0), COLUMNS - 1);
        if (event.shiftKey) {
          if (keyAnchor.current === null) {
            keyAnchor.current = { row: focusRow, col: focusCol };
            if (hold && hold.state === 'held') {
              const previous = hold.id;
              setHold(null);
              void api.releaseHold(previous).catch(() => undefined);
            }
            setLost(new Set());
          }
          const anchor = keyAnchor.current;
          setBrush({
            anchorRow: anchor.row,
            anchorCol: anchor.col,
            row: nextRow,
            col: nextCol,
          });
        }
        setFocusRow(nextRow);
        setFocusCol(nextCol);
      };
      if (key === 'ArrowRight') move(focusRow, focusCol + 1);
      else if (key === 'ArrowLeft') move(focusRow, focusCol - 1);
      else if (key === 'ArrowDown') move(focusRow + 1, focusCol);
      else if (key === 'ArrowUp') move(focusRow - 1, focusCol);
      else if (key === 'Home') move(focusRow, 0);
      else if (key === 'End') move(focusRow, COLUMNS - 1);
      else if (key === ' ') {
        event.preventDefault();
        beginBrush(focusRow, focusCol);
        keyAnchor.current = { row: focusRow, col: focusCol };
      } else if (key === 'Enter') {
        event.preventDefault();
        if (brush === null) {
          beginBrush(focusRow, focusCol);
          keyAnchor.current = { row: focusRow, col: focusCol };
        } else {
          placeHold();
        }
      } else if (key === 'Escape') {
        event.preventDefault();
        clearBrush();
      }
    },
  };

  /* ---- confirming ---- */

  const confirmBooking = useCallback(() => {
    if (!hold || !quote) return;
    setBusy(true);
    say('Confirming…');
    const key = newIdempotencyKey();
    void api
      .confirmHold(hold.id, usePack, quote.total_cents, key)
      .then(({ booking }) => {
        setConfirmDialog(false);
        setHold(null);
        setSettling(new Set(booking.cells.map((cell) => cellKey(cell.station_id, cell.start))));
        window.setTimeout(() => setSettling(new Set()), 700);
        const email = members.find((member) => member.id === memberId)?.contact_email ?? user.email;
        say(`Booking ${booking.ref} confirmed. Confirmation sent to ${email}.`);
        reloadLoom();
        reloadPack();
      })
      .catch((failure: unknown) => {
        if (!(failure instanceof ApiFailure)) {
          say('Nothing was booked. Try again.', true);
          return;
        }
        const body = failure.body;
        if (body.error === 'hold_expired') {
          say(
            `Your hold expired at ${hold.expires_local} kitchen time. Brush the block again.`,
            true,
          );
          setHold(null);
        } else if (body.error === 'quote_changed' && body.quote) {
          setQuote(body.quote);
          say(
            `The price is now $${formatAmount(body.quote.total_cents)} because your month-to-date hours changed. Check the quote and confirm again.`,
            true,
          );
        } else if (body.error === 'validation' && failure.field('use_pack')) {
          say('No pack hours left.', true);
        } else if (body.error === 'billing_unavailable') {
          setHold(null);
          say(
            'Billing is unreachable, so nothing was booked and your hold was released. Try again once billing is back.',
            true,
          );
        } else if (body.error === 'mail_unavailable') {
          setHold(null);
          say(
            'Email is unreachable, so nothing was booked and your hold was released. Try again shortly.',
            true,
          );
        } else {
          say(body.message, true);
        }
        setConfirmDialog(false);
        reloadLoom();
      })
      .finally(() => setBusy(false));
  }, [hold, quote, usePack, members, memberId, user.email, reloadLoom, reloadPack]);

  /* ---- repeat weekly ---- */

  const block = useMemo(() => {
    const cells = hold ? heldCells : selectedCells;
    if (cells.length === 0) return null;
    const columns = [...new Set(cells.map((cell) => columnOfStart(cell.start)))].sort((a, b) => a - b);
    const stationIds = [...new Set(cells.map((cell) => cell.station_id))];
    const contiguous = columns.every((value, index) => index === 0 || value === columns[index - 1] + 1);
    if (!contiguous) return null;
    if (cells.length !== columns.length * stationIds.length) return null;
    const ordered = kitchen.stations
      .filter((station) => stationIds.includes(station.id))
      .map((station) => station.id);
    return {
      station_ids: ordered,
      start: columnStart(columns[0]),
      end: columns[columns.length - 1] + 1 >= COLUMNS ? '24:00' : columnStart(columns[columns.length - 1] + 1),
    };
  }, [hold, heldCells, selectedCells, kitchen.stations]);

  const hasConflict = rows.some((row) => row.some((info) => info.state === 'conflict'));
  const repeatDisabled = block === null || hasConflict;

  const confirmPaused = services.paused('confirm_booking');
  const seriesPaused = services.paused('create_series');

  const totalForBar = quote ? quote.total_cents : 0;

  return (
    <div className="loom-screen">
      <FloorPlan stations={stations} lit={litStations} />

      <div className="loom-body">
        <div className="loom-main">
          <div className="loom-controls">
            <div>
              <label htmlFor="loom-date">Kitchen date</label>
              <input
                id="loom-date"
                type="date"
                value={date}
                onChange={(event) => {
                  setDate(event.target.value);
                  setBrush(null);
                  setHold(null);
                }}
              />
            </div>
            <button type="button" aria-label="Previous day" onClick={() => shiftDate(-1)}>
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <button type="button" aria-label="Next day" onClick={() => shiftDate(1)}>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
            <button type="button" onClick={() => setDate(kitchen.today)}>
              Today
            </button>
            <button type="button" onClick={() => setStationsDialog(true)}>
              Stations
            </button>
            {operator && (
              <div>
                <label htmlFor="book-for">Book for member</label>
                <select
                  id="book-for"
                  value={memberId ?? ''}
                  onChange={(event) => setMemberId(event.target.value)}
                >
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.business}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="loom-head">
            <span className="date">{date}</span>
            <span>Kitchen time · {kitchen.timezone}</span>
            <span
              role="status"
              aria-label="Loom status"
              className={`status-line${statusIsError ? ' error' : ''}`}
            >
              {status}
            </span>
          </div>

          <LoomGrid
            stations={stations}
            rows={rows}
            focusRow={focusRow}
            focusCol={focusCol}
            hover={hover}
            holdFraction={
              secondsLeft === null ? 0 : Math.max(0, Math.min(1, secondsLeft / kitchen.hold_seconds))
            }
            touch={touch}
            callbacks={callbacks}
          />

          <ul className="legend" aria-label="Loom legend">
            {LEGEND.map((entry) => (
              <li key={entry.state}>
                <span className={`swatch ${entry.state}`} aria-hidden="true" />
                {legendIcon(entry.state)}
                <span>{entry.title}</span>
                <span className="sr-only">{RUN_LABEL[entry.state]}</span>
              </li>
            ))}
          </ul>
        </div>

        <aside
          className={`rail${railOpen ? ' open' : ''}`}
          aria-label="Quote"
        >
          {narrow && railOpen && (
            <button type="button" onClick={() => setRailOpen(false)}>
              Hide quote
            </button>
          )}
          <QuoteRail
            quote={quote}
            pricing={pricing}
            pricingFailed={pricingFailed}
            announcement={announcement}
            usePack={usePack}
            onUsePack={setUsePack}
            packQuartersLeft={packQuarters}
            canUsePack={packQuarters > 0}
            holdSecondsLeft={secondsLeft}
            holdSeconds={kitchen.hold_seconds}
            heldUntil={hold && hold.state === 'held' ? hold.expires_local : null}
            reducedMotion={reduced}
            hasBrush={brush !== null}
            placing={placing}
            onPlaceHold={placeHold}
            onClearBrush={clearBrush}
            onConfirm={() => setConfirmDialog(true)}
            onRelease={releaseHold}
            onRepeatWeekly={() => setRepeatDialog(true)}
            confirmDisabled={busy || confirmPaused}
            repeatDisabled={repeatDisabled || seriesPaused}
            repeatHint={repeatDisabled ? 'Repeat weekly needs one unbroken block.' : null}
          />
        </aside>
      </div>

      {narrow && (
        <div className="quote-bar">
          <span className="bar-total">${formatAmount(totalForBar)}</span>
          <button type="button" onClick={() => setRailOpen(true)}>
            Show quote
          </button>
        </div>
      )}

      {stationsDialog && (
        <Dialog title="Choose stations" onClose={() => setStationsDialog(false)}>
          {kitchen.stations.map((station) => (
            <label className="checkrow" key={station.id}>
              <input
                type="checkbox"
                checked={chosen.includes(station.id)}
                onChange={(event) =>
                  setChosen((current) =>
                    event.target.checked
                      ? [...current, station.id]
                      : current.filter((id) => id !== station.id),
                  )
                }
              />
              <span>{station.name}</span>
            </label>
          ))}
          <div className="actions">
            <button
              type="button"
              className="primary"
              onClick={() => {
                setBrush(null);
                setStationsDialog(false);
              }}
            >
              Apply
            </button>
          </div>
        </Dialog>
      )}

      {confirmDialog && hold && (
        <ConfirmDialog
          date={date}
          quote={quote}
          cells={heldCells}
          stations={kitchen.stations}
          windowHours={kitchen.cancellation_window_hours}
          usePack={usePack}
          onUsePack={setUsePack}
          busy={busy}
          paused={confirmPaused}
          onConfirm={confirmBooking}
          onClose={() => setConfirmDialog(false)}
        />
      )}

      {repeatDialog && block && (
        <RepeatDialog
          date={date}
          block={block}
          usePack={usePack}
          memberId={operator ? memberId : null}
          paused={seriesPaused}
          onClose={() => setRepeatDialog(false)}
          onBooked={(message) => {
            setRepeatDialog(false);
            setBrush(null);
            setHold(null);
            say(message);
            reloadLoom();
            reloadPack();
          }}
          onFailed={(message) => say(message, true)}
          holdId={hold && hold.state === 'held' ? hold.id : null}
        />
      )}
    </div>
  );

  function shiftDate(days: number): void {
    const moved = new Date(`${date}T00:00:00Z`);
    moved.setUTCDate(moved.getUTCDate() + days);
    setDate(moved.toISOString().slice(0, 10));
    setBrush(null);
    setHold(null);
  }
}

function ConfirmDialog({
  date,
  quote,
  cells,
  stations,
  windowHours,
  usePack,
  onUsePack,
  busy,
  paused,
  onConfirm,
  onClose,
}: {
  date: string;
  quote: Quote | null;
  cells: Cell[];
  stations: { id: string; name: string }[];
  windowHours: number;
  usePack: boolean;
  onUsePack: (value: boolean) => void;
  busy: boolean;
  paused: boolean;
  onConfirm: () => void;
  onClose: () => void;
}): ReactNode {
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => confirmRef.current?.focus(), []);

  const blocks = useMemo(() => {
    const byStation = new Map<string, number[]>();
    for (const cell of cells) {
      const column = columnOfStart(cell.start);
      const list = byStation.get(cell.station_id);
      if (list) list.push(column);
      else byStation.set(cell.station_id, [column]);
    }
    return stations
      .filter((station) => byStation.has(station.id))
      .map((station) => {
        const columns = (byStation.get(station.id) ?? []).sort((a, b) => a - b);
        return {
          name: station.name,
          start: columnStart(columns[0]),
          end:
            columns[columns.length - 1] + 1 >= COLUMNS
              ? '24:00'
              : columnStart(columns[columns.length - 1] + 1),
        };
      });
  }, [cells, stations]);

  return (
    <Dialog title="Confirm booking" onClose={onClose}>
      <p className="num">{date} · kitchen time</p>
      <ul className="summary-list">
        {blocks.map((block) => (
          <li key={block.name}>
            <span>{block.name}</span>
            <span className="num">
              {block.start}–{block.end}
            </span>
          </li>
        ))}
        {(quote ? quote.lines : []).map((line, index) => (
          <li key={`line-${index}`}>
            <span>
              {line.station} · tier {line.tier} · {line.hours} h
            </span>
            <span>{line.paid_by === 'pack' ? 'pack' : `$${formatAmount(line.amount_cents)}`}</span>
          </li>
        ))}
        <li>
          <strong>Total</strong>
          <strong className="num">${formatAmount(quote ? quote.total_cents : 0)}</strong>
        </li>
      </ul>
      <p>Cancellation window: {windowHours} hours.</p>
      <label className="checkrow">
        <input
          type="checkbox"
          checked={usePack}
          onChange={(event) => onUsePack(event.target.checked)}
        />
        <span>Use pack hours</span>
      </label>
      <div className="actions">
        <button type="button" onClick={onClose}>
          Back
        </button>
        <button
          type="button"
          className="primary"
          ref={confirmRef}
          disabled={busy || paused || quote === null}
          onClick={onConfirm}
        >
          Confirm
        </button>
      </div>
    </Dialog>
  );
}

function RepeatDialog({
  date,
  block,
  usePack,
  memberId,
  paused,
  holdId,
  onClose,
  onBooked,
  onFailed,
}: {
  date: string;
  block: { station_ids: string[]; start: string; end: string };
  usePack: boolean;
  memberId: string | null;
  paused: boolean;
  holdId: string | null;
  onClose: () => void;
  onBooked: (message: string) => void;
  onFailed: (message: string) => void;
}): ReactNode {
  const [weeks, setWeeks] = useState(4);
  const [occurrences, setOccurrences] = useState<SeriesOccurrence[]>([]);
  const [total, setTotal] = useState(0);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (weeks < 2 || weeks > 12) return;
    setNote('');
    void api
      .seriesQuote({
        station_ids: block.station_ids,
        start: block.start,
        end: block.end,
        first_date: date,
        weeks,
        use_pack: usePack,
        member_id: memberId,
      })
      .then((result) => {
        setOccurrences(result.occurrences);
        setTotal(result.total_cents);
      })
      .catch((failure: unknown) => {
        setOccurrences([]);
        setTotal(0);
        if (failure instanceof ApiFailure && failure.body.error === 'series_conflict') {
          setNote(
            `These weeks are already taken: ${(failure.body.dates ?? []).join(', ')}. Nothing was booked.`,
          );
        } else if (failure instanceof ApiFailure) {
          setNote(failure.message);
        }
      });
  }, [weeks, block.start, block.end, block.station_ids, date, usePack, memberId]);

  const bookSeries = (): void => {
    setBusy(true);
    const run = (): Promise<void> =>
      api
        .createSeries(
          {
            station_ids: block.station_ids,
            start: block.start,
            end: block.end,
            first_date: date,
            weeks,
            use_pack: usePack,
            quoted_total_cents: total,
            member_id: memberId,
          },
          newIdempotencyKey(),
        )
        .then(async ({ bookings }) => {
          if (holdId !== null) await api.releaseHold(holdId).catch(() => undefined);
          onBooked(
            `Booked ${bookings.length} weekly slots, ${bookings[0].date} to ${bookings[bookings.length - 1].date}.`,
          );
        })
        .catch((failure: unknown) => {
          if (failure instanceof ApiFailure && failure.body.error === 'series_conflict') {
            onFailed(
              `These weeks are already taken: ${(failure.body.dates ?? []).join(', ')}. Nothing was booked.`,
            );
          } else if (failure instanceof ApiFailure && failure.body.error === 'billing_unavailable') {
            onFailed(
              'Billing is unreachable, so nothing was booked and your hold was released. Try again once billing is back.',
            );
          } else if (failure instanceof ApiFailure && failure.body.error === 'mail_unavailable') {
            onFailed(
              'Email is unreachable, so nothing was booked and your hold was released. Try again shortly.',
            );
          } else if (failure instanceof ApiFailure) {
            onFailed(failure.message);
          }
          onClose();
        })
        .finally(() => setBusy(false));

    void run();
  };

  return (
    <Dialog title="Repeat weekly" onClose={onClose}>
      <div className="field">
        <label htmlFor="repeat-weeks">Weeks</label>
        <input
          id="repeat-weeks"
          type="number"
          min={2}
          max={12}
          value={weeks}
          onChange={(event) => setWeeks(Number(event.target.value))}
        />
      </div>
      <ul className="summary-list">
        {occurrences.map((occurrence) => (
          <li key={occurrence.date}>
            <span className="num">{occurrence.date}</span>
            <span className="num">${formatAmount(occurrence.quote.total_cents)}</span>
          </li>
        ))}
        <li>
          <strong>Series total</strong>
          <strong className="num">${formatAmount(total)}</strong>
        </li>
      </ul>
      <p className="status-line error">{note}</p>
      <div className="actions">
        <button type="button" onClick={onClose}>
          Back
        </button>
        <button
          type="button"
          className="primary"
          disabled={busy || paused || occurrences.length === 0}
          onClick={bookSeries}
        >
          Book series
        </button>
      </div>
    </Dialog>
  );
}
