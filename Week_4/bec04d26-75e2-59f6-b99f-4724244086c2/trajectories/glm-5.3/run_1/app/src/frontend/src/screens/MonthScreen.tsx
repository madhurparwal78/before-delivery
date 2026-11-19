import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../lib/api';
import type { MeJson, ReturnsEnvelope, ReturnJson } from '../../../shared/types';
import { TopBar } from '../components/TopBar';
import { EmptyTile } from '../components/Tile';
import { statusLabel, dateLine, MONTH_NAMES } from '../lib/design';
import type { Session } from '../lib/session';
import { useLiveEvents } from '../lib/live';

interface Props {
  me: MeJson;
  route: { path: string; query: Record<string, string>; navigate: (path: string) => void };
  announce: (line: string) => void;
  service: { mailUp: boolean; pdfUp: boolean };
}

interface DayCell {
  date: string;
  weekday: number;
  returns: ReturnJson[];
  inMonth: boolean;
}

const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function MonthScreen({ me, route, announce, service }: Props): React.ReactNode {
  const monthParam = route.path.startsWith('/month/') ? route.path.slice('/month/'.length) : '';
  const valid = /^\d{4}-(0[1-9]|1[0-2])$/.test(monthParam) ? monthParam : defaultMonth(me.now);
  const [envelope, setEnvelope] = useState<ReturnsEnvelope | null>(null);
  const [focusDate, setFocusDate] = useState<string | null>(null);
  const [openDate, setOpenDate] = useState<string | null>(null);
  const session: Session = { me, signOut: async () => {} };
  const gridRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setEnvelope(await api.returns(`?month=${valid}`));
  }, [valid]);

  useEffect(() => {
    void load();
  }, [load]);

  // The App carries every live announcement; the grid only refreshes its data.
  useLiveEvents(() => {
    void load();
  });

  const [year, month] = valid.split('-').map(Number);
  const days = buildDays(year, month, envelope?.returns ?? []);

  const todayLocal = centralToday(me.now);
  const initialDate = days.find((d) => d.date === todayLocal && d.inMonth)?.date
    ?? days.find((d) => d.inMonth)?.date ?? valid + '-01';

  // A new month starts fresh: today's cell if the month holds it, otherwise
  // the same day number the grid left, clamped to the month's last day.
  useEffect(() => {
    setFocusDate((current) => {
      if (current === null) return initialDate;
      const dayNumber = Number(current.slice(8));
      const [tYear, tMonth] = valid.split('-').map(Number);
      const lastDay = new Date(Date.UTC(tYear, tMonth, 0)).getUTCDate();
      return `${valid}-${String(Math.min(dayNumber, lastDay)).padStart(2, '0')}`;
    });
  }, [valid]);

  const moveMonth = (delta: number) => {
    const nextMonth = month + delta;
    const target = nextMonth === 0
      ? `${year - 1}-12`
      : nextMonth === 13
        ? `${year + 1}-01`
        : `${year}-${String(nextMonth).padStart(2, '0')}`;
    setOpenDate(null);
    // The month-change effect carries the day number over, clamped to the target.
    route.navigate(`/month/${target}`);
  };

  const onGridKey = (event: React.KeyboardEvent) => {
    if (focusDate === null) return;
    const [y, m, d] = focusDate.split('-').map(Number);
    const cell = days.find((day) => day.date === focusDate);
    if (cell === undefined) return;
    const cellDate = new Date(Date.UTC(y, m - 1, d));
    let handled = true;
    switch (event.key) {
      case 'ArrowLeft': {
        const previous = new Date(cellDate);
        previous.setUTCDate(previous.getUTCDate() - 1);
        setFocusOrMonth(previous);
        break;
      }
      case 'ArrowRight': {
        const next = new Date(cellDate);
        next.setUTCDate(next.getUTCDate() + 1);
        setFocusOrMonth(next);
        break;
      }
      case 'ArrowUp': {
        const previous = new Date(cellDate);
        previous.setUTCDate(previous.getUTCDate() - 7);
        setFocusOrMonth(previous);
        break;
      }
      case 'ArrowDown': {
        const next = new Date(cellDate);
        next.setUTCDate(next.getUTCDate() + 7);
        setFocusOrMonth(next);
        break;
      }
      case 'Home': {
        // Monday of the focused week, or the month's first day where the month cuts the week.
        const offset = (cellDate.getUTCDay() + 6) % 7;
        const monday = new Date(cellDate);
        monday.setUTCDate(monday.getUTCDate() - offset);
        const mondayCell = days.find((day) => day.date === isoOf(monday));
        setFocusDate(mondayCell !== undefined && mondayCell.inMonth ? mondayCell.date : firstOfMonth(y, m));
        break;
      }
      case 'End': {
        // Sunday of the focused week, or the month's last day where the month cuts the week.
        const offset = (cellDate.getUTCDay() + 6) % 7;
        const sunday = new Date(cellDate);
        sunday.setUTCDate(sunday.getUTCDate() + (6 - offset));
        const sundayCell = days.find((day) => day.date === isoOf(sunday));
        setFocusDate(sundayCell !== undefined && sundayCell.inMonth ? sundayCell.date : lastOfMonth(y, m));
        break;
      }
      case 'PageUp': {
        moveMonth(-1);
        break;
      }
      case 'PageDown': {
        moveMonth(1);
        break;
      }
      case 'Enter': {
        if (cell.returns.length > 0) {
          setOpenDate((current) => (current === cell.date ? null : cell.date));
          announce(bandLine(cell.date, cell.returns.length));
        }
        break;
      }
      case 'Escape': {
        setOpenDate(null);
        break;
      }
      default:
        handled = false;
    }
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  const setFocusOrMonth = (date: Date) => {
    const iso = isoOf(date);
    const cell = days.find((day) => day.date === iso);
    if (cell !== undefined && cell.inMonth) {
      setFocusDate(iso);
      return;
    }
    // Arrows past the first or last day of the month change month,
    // landing on the same day number clamped to the target month's last day.
    const dayNumber = Number(iso.slice(8));
    if (iso < firstOfMonth(year, month)) {
      const previous = month === 1
        ? `${year - 1}-12`
        : `${year}-${String(month - 1).padStart(2, '0')}`;
      const [pY, pM] = previous.split('-').map(Number);
      const lastDay = new Date(Date.UTC(pY, pM, 0)).getUTCDate();
      route.navigate(`/month/${previous}`);
      setFocusDate(`${previous}-${String(Math.min(dayNumber, lastDay)).padStart(2, '0')}`);
    } else {
      const next = month === 12
        ? `${year + 1}-01`
        : `${year}-${String(month + 1).padStart(2, '0')}`;
      const [nY, nM] = next.split('-').map(Number);
      const lastDay = new Date(Date.UTC(nY, nM, 0)).getUTCDate();
      route.navigate(`/month/${next}`);
      setFocusDate(`${next}-${String(Math.min(dayNumber, lastDay)).padStart(2, '0')}`);
    }
  };

  const openDay = openDate;
  const openCell = days.find((day) => day.date === openDay) ?? null;
  const stateCodes = [...new Set((envelope?.returns ?? []).map((r) => r.state))].sort();
  const monthLabel = `${MONTH_NAMES[month - 1]} ${year}`;

  return (
    <>
      <TopBar session={session} route={route} />
      {service.mailUp && service.pdfUp ? null : (
        <div role="region" aria-label="Service notice" className="service-notice">
          {!service.mailUp ? <p className="banner">Reminders are waiting: mail can&#39;t be reached right now.</p> : null}
          {!service.pdfUp ? <p className="banner">Packets are waiting: the PDF service can&#39;t be reached right now.</p> : null}
        </div>
      )}
      <main className="page month-page">
        <h1 className="page-title">Due dates by month</h1>
        <div className="month-header">
          <button type="button" className="button button-secondary" onClick={() => moveMonth(-1)}>Previous month</button>
          <h2>{monthLabel}</h2>
          <button type="button" className="button button-secondary" onClick={() => moveMonth(1)}>Next month</button>
        </div>
        <div className="counts">
          <p role="status" aria-label="Overdue count">{envelope?.counts.overdue ?? 0} overdue</p>
          <p role="status" aria-label="Awaiting approval count">{envelope?.counts.awaiting_approval ?? 0} awaiting approval</p>
        </div>
        <div
          ref={gridRef}
          role="grid"
          aria-label="Due dates"
          className="month-grid"
          tabIndex={0}
          onKeyDown={onGridKey}
          data-month={valid}
        >
          <div role="row" className="month-weekdays">
            {WEEKDAY_SHORT.map((name) => (
              <span role="columnheader" key={name} className="month-weekday">{name}</span>
            ))}
          </div>
          {weeksOf(days).map((week, weekIndex) => (
            <div role="row" className="month-week" key={weekIndex}>
              {week.map((cell, cellIndex) => {
                if (cell === null) {
                  return <div key={cellIndex} className="month-cell-slot" />;
                }
                const isFocus = cell.date === (focusDate ?? initialDate);
                return (
                  <div key={cellIndex} className="month-cell-slot">
                    <div
                      role="gridcell"
                      tabIndex={-1}
                      data-date={cell.date}
                      data-count={cell.returns.length}
                      aria-selected={isFocus}
                      className={`month-cell ${cell.inMonth ? '' : 'month-cell-out'} ${isFocus ? 'month-cell-focus' : ''}`}
                      onClick={() => {
                        if (cell.returns.length === 0) return;
                        setOpenDate((current) => (current === cell.date ? null : cell.date));
                        announce(bandLine(cell.date, cell.returns.length));
                      }}
                    >
                      <span className="month-day-number">{Number(cell.date.slice(8))}</span>
                      {cell.returns.map((ret) => (
                        <span
                          key={ret.id}
                          className={`month-chip chip-${chipColour(stateCodes, ret.state)}`}
                          data-return-id={ret.id}
                          data-status={ret.status}
                          data-overdue={String(ret.overdue)}
                          data-due-at={ret.due_at}
                          data-state={ret.state}
                          data-version={ret.version}
                          data-rate={ret.edition.rate}
                          data-edition={ret.edition.effective_date}
                        >
                          {ret.state} · {statusLabel(ret.status)}{ret.overdue ? ' · Overdue' : ''}
                          {ret.carried_from !== null ? <span className="carried">Carried from {dateLine(ret.carried_from)}</span> : null}
                        </span>
                      ))}
                      {ghostsFor(days, cell).map((ghost) => (
                        <span key={ghost.id} className="month-ghost" data-ghost-for={ghost.id}>
                          Carried from {dateLine(ghost.carried)}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        {envelope !== null && envelope.returns.length === 0 ? (
          <EmptyTile sentence="No returns due this month." />
        ) : null}
        {openCell !== null && openCell.returns.length > 0 ? (
          <MeridianBand
            date={openCell.date}
            returns={openCell.returns}
            nowISO={me.now}
            onClose={() => {
              setOpenDate(null);
              gridRef.current?.focus();
            }}
          />
        ) : null}
      </main>
    </>
  );
}

function ghostsFor(days: DayCell[], cell: DayCell): Array<{ id: string; carried: string }> {
  const ghosts: Array<{ id: string; carried: string }> = [];
  for (const day of days) {
    for (const ret of day.returns) {
      if (ret.carried_from === cell.date) ghosts.push({ id: ret.id, carried: day.date });
    }
  }
  return ghosts;
}

function bandLine(date: string, count: number): string {
  return `${count} ${count === 1 ? 'return' : 'returns'} due ${dateLine(date)}`;
}

function chipColour(stateCodes: string[], state: string): 'orange' | 'green' | 'yellow' | 'black' {
  const index = stateCodes.indexOf(state);
  const rotation = ['orange', 'green', 'yellow', 'black'] as const;
  return rotation[Math.max(0, index) % 4];
}

function defaultMonth(nowISO: string): string {
  const now = new Date(nowISO);
  const central = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  return `${central.getFullYear()}-${String(central.getMonth() + 1).padStart(2, '0')}`;
}

function centralToday(nowISO: string): string {
  const now = new Date(nowISO);
  const central = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  return `${central.getFullYear()}-${String(central.getMonth() + 1).padStart(2, '0')}-${String(central.getDate()).padStart(2, '0')}`;
}

function isoOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function firstOfMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

function lastOfMonth(year: number, month: number): string {
  const date = new Date(Date.UTC(year, month, 0));
  return isoOf(date);
}

function buildDays(year: number, month: number, returns: ReturnJson[]): DayCell[] {
  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const leading = (firstOfMonth.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const days: DayCell[] = [];
  const byDate = new Map<string, ReturnJson[]>();
  for (const ret of returns) {
    const list = byDate.get(ret.due_date) ?? [];
    list.push(ret);
    byDate.set(ret.due_date, list);
  }
  for (let i = 0; i < leading; i++) {
    const date = new Date(firstOfMonth);
    date.setUTCDate(date.getUTCDate() - (leading - i));
    days.push({ date: isoOf(date), weekday: (firstOfMonth.getUTCDay() + 6 - (leading - i) + 7) % 7, returns: [], inMonth: false });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dt = new Date(Date.UTC(year, month - 1, day));
    days.push({
      date,
      weekday: (dt.getUTCDay() + 6) % 7,
      returns: (byDate.get(date) ?? []).slice().sort(compareReturns),
      inMonth: true,
    });
  }
  const trailing = (7 - (days.length % 7)) % 7;
  for (let i = 1; i <= trailing; i++) {
    const date = new Date(Date.UTC(year, month, i));
    days.push({ date: isoOf(date), weekday: (date.getUTCDay() + 6) % 7, returns: [], inMonth: false });
  }
  return days;
}

export function compareReturns(a: ReturnJson, b: ReturnJson): number {
  if (a.due_at !== b.due_at) return a.due_at < b.due_at ? -1 : 1;
  if (a.state !== b.state) return a.state < b.state ? -1 : 1;
  if (a.client.name !== b.client.name) return a.client.name < b.client.name ? -1 : 1;
  return a.id < b.id ? -1 : 1;
}

function weeksOf(days: DayCell[]): Array<Array<DayCell | null>> {
  const weeks: Array<Array<DayCell | null>> = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }
  return weeks;
}

import { MeridianBand } from '../components/MeridianBand';
