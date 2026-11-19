import { addDays } from '../shared/dates';
import { formatMoney } from '../shared/money';
import { notices, pendingTexts } from '../shared/notices';
import { call } from './api';
import { loadDesk, render, state } from './app';
import { prefersReducedMotion } from './dom';
import { regionNames, setMessage } from './regions';
import { CloseResult } from './types';

const NIGHT_MS = 330;
const STAMP_STEP_MS = 100;
const STAMP_MAX_MS = 1500;
const COUNT_MS = 500;
const COUNT_STEPS = 10;
const SLIDE_MS = 330;
const TICK = 'tick';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function stampCells(result: CloseResult): void {
  const posted = new Map(result.rows.map((row) => [row.roomId, formatMoney(row.postedCents)]));
  const rows = [...document.querySelectorAll<HTMLElement>('.timeline .trow[data-room-id]')];
  rows.forEach((row, index) => {
    const roomId = row.getAttribute('data-room-id');
    const cell = row.querySelector<HTMLElement>(
      `[role="gridcell"][data-date="${result.businessDate}"]`,
    );
    if (!roomId || !cell) return;
    window.setTimeout(() => {
      const stamp = posted.get(roomId) ?? TICK;
      cell.setAttribute('data-stamp', stamp);
      cell.classList.add('stamped');
      const label = cell.querySelector('.stamp');
      if (label) label.textContent = stamp;
      else cell.append(Object.assign(document.createElement('span'), { className: 'stamp', textContent: stamp }));
    }, Math.min(index * STAMP_STEP_MS, STAMP_MAX_MS));
  });
}

interface CountedFigure {
  name: string;
  target: string;
  at: (fraction: number) => string;
}

function countedFigures(result: CloseResult): CountedFigure[] {
  const figures = result.figures;
  const money = (text: string) => (fraction: number): string => {
    const cents = Number.parseFloat(text.replace(/[$,]/g, '')) * 100;
    return Number.isFinite(cents) ? formatMoney(Math.round(cents * fraction)) : text;
  };
  const percent = (text: string) => (fraction: number): string => {
    const value = Number.parseFloat(text.replace('%', ''));
    return Number.isFinite(value) ? `${(value * fraction).toFixed(1)}%` : text;
  };
  return [
    {
      name: 'Tally rooms sold',
      target: String(figures.roomsSold),
      at: (fraction) => String(Math.round(figures.roomsSold * fraction)),
    },
    {
      name: 'Tally room revenue',
      target: formatMoney(figures.roomRevenueCents),
      at: (fraction) => formatMoney(Math.round(figures.roomRevenueCents * fraction)),
    },
    { name: 'Tally occupancy', target: figures.occupancy, at: percent(figures.occupancy) },
    {
      name: 'Tally average daily rate',
      target: figures.averageDailyRate,
      at: money(figures.averageDailyRate),
    },
    {
      name: 'Tally revenue per available room',
      target: figures.revenuePerAvailableRoom,
      at: money(figures.revenuePerAvailableRoom),
    },
  ];
}

async function countTally(result: CloseResult): Promise<void> {
  const rail = document.querySelector<HTMLElement>('[aria-label="Tally rail"]');
  const figures = countedFigures(result);
  if (rail) rail.setAttribute('aria-busy', 'true');
  for (let step = 1; step <= COUNT_STEPS; step += 1) {
    const fraction = step / COUNT_STEPS;
    for (const figure of figures) {
      setMessage(figure.name, step === COUNT_STEPS ? figure.target : figure.at(fraction));
    }
    await wait(COUNT_MS / COUNT_STEPS);
  }
  setMessage('Tally date', `Last closed night ${result.businessDate}`);
  if (rail) rail.removeAttribute('aria-busy');
}

async function playSweep(result: CloseResult): Promise<void> {
  state.ground = 'night';
  state.closePhase = 'night';
  render();
  await wait(NIGHT_MS);

  state.closePhase = 'stamping';
  render();
  stampCells(result);
  const stampingMs = Math.min(
    (state.timeline ? state.timeline.rooms.length : 0) * STAMP_STEP_MS,
    STAMP_MAX_MS,
  );
  await wait(Math.max(0, stampingMs - COUNT_MS));
  await countTally(result);

  state.closePhase = 'slide';
  render();
  await advanceToNewDate();
  await wait(SLIDE_MS);

  state.closePhase = 'idle';
  state.ground = 'day';
  render();
}

async function advanceToNewDate(): Promise<void> {
  if (state.windowStart !== null) state.windowStart = addDays(state.windowStart, 1);
  state.currentDate = null;
  await loadDesk();
  if (state.desk) state.currentDate = state.desk.hotel.businessDate;
  render();
}

/** Moves a screen that did not run the close straight to the committed end state. */
export async function showCloseEndState(businessDate: string): Promise<void> {
  state.closePhase = 'idle';
  state.ground = 'day';
  if (state.windowStart !== null) state.windowStart = addDays(businessDate, -1);
  state.currentDate = businessDate;
  await loadDesk();
  if (state.desk) state.closeResult = state.desk.lastClose;
  state.closeResultShown = true;
  render();
}

let sweeping = false;

/** True while this screen is playing its own sweep, so its own pushed change is left alone. */
export function sweepIsRunning(): boolean {
  return sweeping;
}

export async function runClose(trigger: HTMLButtonElement): Promise<void> {
  if (sweeping || trigger.getAttribute('aria-busy') === 'true') return;
  if (!state.desk) return;
  trigger.setAttribute('aria-busy', 'true');
  sweeping = true;
  setMessage(regionNames.closeStatus, pendingTexts.runClose);
  const result = await call<CloseResult>('/api/close', {
    method: 'POST',
    body: { businessDate: state.desk.hotel.businessDate },
  });
  trigger.removeAttribute('aria-busy');

  if (!result.data) {
    state.blockers = result.blockers ?? [];
    setMessage(
      regionNames.closeStatus,
      result.error ?? Object.values(result.fieldErrors ?? {})[0] ?? 'Not found.',
    );
    render();
    focusFirstBlockedRow();
    sweeping = false;
    return;
  }

  state.blockers = [];
  state.closeResult = result.data;
  state.closeResultShown = true;
  setMessage(
    regionNames.closeStatus,
    notices.closeDone(result.data.businessDate, result.data.roomsCharged, result.data.noShows),
  );
  const owner = state.user !== null && state.user.role === 'owner';
  if (prefersReducedMotion() || !owner || state.layout === 'phone') {
    await advanceToNewDate();
    sweeping = false;
    return;
  }
  await playSweep(result.data);
  sweeping = false;
}

function focusFirstBlockedRow(): void {
  if (state.blockers.length === 0) return;
  const first = state.blockers[0];
  const header = document.querySelector<HTMLElement>(
    `.trow[data-room-id="${first.roomId}"] [role="rowheader"]`,
  );
  if (!header) return;
  header.setAttribute('tabindex', '-1');
  header.focus();
}
