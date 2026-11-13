import {
  getJson,
  postJson,
  type ApiErrorBody,
  type DayCell,
  type DayDetail,
  type MonthState,
  type Rolling,
} from '../api.js';
import { COPY, DAY_STATE_LABELS } from '../copy.js';
import { button, el, navigate, setStatus, statusRegion, wireInternalLink } from '../dom.js';
import {
  applyQueueToCells,
  cacheDay,
  cachedDay,
  enqueue,
  markWriteFailedOffline,
  offline,
  onConnectionChange,
  queueCount,
  sendQueue,
} from '../offline.js';
import {
  addNoteButton,
  downloadCopyLink,
  refreshConnectionGates,
  signButton,
  type DayActionTargets,
} from '../ui/day-actions.js';
import { createWatchGrid, type CellChange } from '../ui/watch-grid.js';
import type { Page, PageContext } from '../main.js';

const DAY_MS = 86_400_000;

function shipDateShift(shipDate: string, days: number): string {
  const base = Date.parse(`${shipDate}T00:00:00Z`);
  return new Date(base + days * DAY_MS).toISOString().slice(0, 10);
}

/** Reads the vessel's offset from a server cell, so an instant can be shown in ship's time. */
function offsetMinutesFromCell(cell: DayCell | undefined): number {
  if (cell === undefined) return 0;
  const utc = Date.parse(cell.start_utc);
  const reading = Date.parse(`${cell.start_utc.slice(0, 10)}T${cell.ship_time}:00Z`);
  let difference = Math.round((reading - utc) / 60_000);
  while (difference > 840) difference -= 1440;
  while (difference < -720) difference += 1440;
  return difference;
}

function shipTimeOf(instant: string, offsetMinutes: number): string {
  const shifted = new Date(Date.parse(instant) + offsetMinutes * 60_000);
  return `${shifted.toISOString().slice(0, 10)} ${shifted.toISOString().slice(11, 16)}`;
}

export async function renderLog(context: PageContext): Promise<Page> {
  const me = context.me;
  if (me === null || me.role !== 'crew') {
    return { element: el('div', { class: 'page' }, [el('h1', { text: COPY.pageUnknown })]) };
  }
  const crewId = me.id;
  const requested = context.query.get('date');
  const shipDate =
    requested !== null && /^\d{4}-\d{2}-\d{2}$/.test(requested)
      ? requested
      : (me.today_ship_date ?? new Date().toISOString().slice(0, 10));

  const heading = el('h1', { text: `Your rest log` });
  const dateLine = el('p', { class: 'ship-date-line' });
  const connection = statusRegion('Connection', 'banner');
  const sync = statusRegion('Sync status');
  const dayStatus = statusRegion('Day status');
  const monthStatus = statusRegion('Month status');
  const dayLine = el('p', { class: 'day-line' });
  const totals = el('div', { 'aria-label': 'Rolling totals', role: 'region', class: 'pane totals' }, [
    el('h2', { class: 'pane-label', text: 'Rolling totals' }),
  ]);
  const total24 = el('p', { class: 'figure' });
  const total168 = el('p', { class: 'figure' });
  totals.append(total24, total168);
  const hint = el('p', { class: 'hint' });
  const notices = el('div', { class: 'notices' });
  const noteList = el('ul', { class: 'plain-list' });
  const monthActions = el('div', { class: 'actions' });
  const grid = createWatchGrid();

  let day: DayDetail | null = null;
  let month: MonthState | null = null;

  const targets: DayActionTargets = {
    crewId,
    role: 'crew',
    shipDate: () => shipDate,
    month: () => shipDate.slice(0, 7),
    dayStatus,
    monthStatus,
    feedback: context.feedback,
    refresh: async () => {
      await loadDay(true);
    },
  };

  const previous = button("Previous ship's day");
  previous.addEventListener('click', () => {
    navigate(`/log?date=${shipDateShift(shipDate, -1)}`);
  });
  const next = button("Next ship's day");
  next.addEventListener('click', () => {
    navigate(`/log?date=${shipDateShift(shipDate, 1)}`);
  });
  const voyageLink = wireInternalLink(
    el('a', { href: `/voyage/${me.vessel_id ?? ''}/${crewId}` }, ['My voyage']),
  );
  const sign = signButton(targets);
  const addNote = addNoteButton(targets);

  function paintConnection(): void {
    setStatus(connection, offline() ? COPY.connection(queueCount()) : '');
    refreshConnectionGates();
  }

  function paintDay(detail: DayDetail, keepDayStatus: boolean): void {
    day = detail;
    const cells = applyQueueToCells(detail);
    grid.setCells(cells, detail.can_edit);
    dateLine.textContent = COPY.recordPaneLine(detail.ship_date, detail.ship_date.slice(0, 7));
    if (!keepDayStatus) {
      setStatus(dayStatus, DAY_STATE_LABELS[detail.state] ?? '');
    }
    const offsetMinutes = offsetMinutesFromCell(detail.cells[detail.cells.length - 1]);
    dayLine.textContent =
      detail.state === 'open'
        ? COPY.openDayLine(shipTimeOf(detail.closes_at_utc, offsetMinutes))
        : COPY.closedDayLine;
    hint.textContent = cells.some((cell) => cell.state === 'short_break')
      ? COPY.shortBreakHint
      : '';
    const noticeNodes: HTMLElement[] = [];
    for (const event of detail.events) {
      if (!event.mismatch) continue;
      noticeNodes.push(
        el('div', { class: 'notice mismatch' }, [
          el('p', { text: COPY.recordMismatch }),
          addNoteButton(targets, {
            label: 'Add a note to this mismatch',
            eventId: event.id,
          }),
        ]),
      );
    }
    for (const entry of detail.entries) {
      if (!entry.late) continue;
      noticeNodes.push(
        el('div', { class: 'notice late' }, [
          el('span', { class: 'badge', text: COPY.lateEntry }),
          el('span', {
            text: ` ${entry.start_utc} to ${entry.end_utc}, ${entry.kind}, received ${entry.received_at_utc}`,
          }),
        ]),
      );
    }
    notices.replaceChildren(...noticeNodes);
    noteList.replaceChildren(
      ...detail.notes.map((note) =>
        el('li', {
          text: `${note.created_at_utc}, ${
            note.author_role === 'owner_master' ? 'owner-master' : 'crew member'
          }: ${note.text}`,
        }),
      ),
    );
    sign.hidden = false;
    refreshConnectionGates();
  }

  async function loadRolling(): Promise<void> {
    const result = await getJson<Rolling>(`/api/crew/${crewId}/rolling`);
    if (!result.ok) return;
    total24.textContent = COPY.restIn24(result.body.rest_hours_24);
    total168.textContent = COPY.restIn168(result.body.rest_hours_168);
  }

  async function loadMonth(): Promise<void> {
    const result = await getJson<MonthState>(`/api/crew/${crewId}/months/${shipDate.slice(0, 7)}`);
    if (!result.ok) return;
    month = result.body;
    setStatus(monthStatus, month.label);
    monthActions.replaceChildren(
      ...(month.state === 'sealed' ? [downloadCopyLink(targets)] : []),
    );
    refreshConnectionGates();
  }

  /** Keeps the shown day and the two before it on the phone, so they open again offline. */
  async function cacheNearbyDays(): Promise<void> {
    for (const back of [1, 2]) {
      const date = shipDateShift(shipDate, -back);
      const result = await getJson<DayDetail>(`/api/crew/${crewId}/days/${date}`);
      if (result.ok) cacheDay(crewId, result.body);
    }
  }

  async function loadDay(keepDayStatus = false): Promise<void> {
    const result = await getJson<DayDetail>(`/api/crew/${crewId}/days/${shipDate}`);
    if (result.ok) {
      cacheDay(crewId, result.body);
      paintDay(result.body, keepDayStatus);
      await loadRolling();
      await loadMonth();
      paintConnection();
      void cacheNearbyDays();
      return;
    }
    const cached = cachedDay(crewId, shipDate);
    if (cached !== null) {
      paintDay(cached, keepDayStatus);
      paintConnection();
      return;
    }
    if (!result.networkFailure) setStatus(dayStatus, COPY.somethingWrong);
    paintConnection();
  }

  async function saveChange(change: CellChange): Promise<void> {
    const entry = {
      entry_key: `${crewId}-${change.cell.start_utc}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
      start_utc: change.cell.start_utc,
      end_utc: new Date(Date.parse(change.cell.start_utc) + 1_800_000)
        .toISOString()
        .replace(/\.\d+Z$/, 'Z'),
      kind: change.kind,
      ship_date: shipDate,
    };
    if (offline()) {
      enqueue(entry);
      setStatus(sync, COPY.queued);
      paintConnection();
      if (day !== null) cacheDay(crewId, day);
      return;
    }
    setStatus(sync, COPY.saving);
    const result = await postJson<ApiErrorBody>('/api/watch-entries', {
      entry_key: entry.entry_key,
      start_utc: entry.start_utc,
      end_utc: entry.end_utc,
      kind: entry.kind,
    });
    if (result.ok) {
      setStatus(sync, COPY.saved);
      await loadDay();
      return;
    }
    if (result.networkFailure) {
      enqueue(entry);
      markWriteFailedOffline();
      setStatus(sync, COPY.queued);
      paintConnection();
      return;
    }
    if (result.body.error === 'day_closed' || result.body.error === 'month_sealed') {
      setStatus(sync, COPY.dayClosedSave);
      await loadDay();
      return;
    }
    setStatus(sync, COPY.somethingWrong);
    await loadDay(true);
  }

  grid.onChange((changes) => {
    void (async () => {
      for (const change of changes) await saveChange(change);
    })();
  });

  async function flushQueue(): Promise<void> {
    if (offline() || queueCount() === 0) return;
    setStatus(sync, COPY.syncing);
    const report = await sendQueue();
    if (report === null) {
      paintConnection();
      return;
    }
    setStatus(
      sync,
      COPY.synced(report.synced) + (report.late > 0 ? COPY.syncedLate(report.late) : ''),
    );
    paintConnection();
    await loadDay(true);
  }

  onConnectionChange(paintConnection);
  const onOnline = (): void => {
    paintConnection();
    void flushQueue();
  };
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', paintConnection);

  const refreshTimer = window.setInterval(() => {
    void loadDay();
    void flushQueue();
  }, 20_000);

  paintConnection();
  await loadDay();
  void flushQueue();

  const element = el('div', { class: 'page log' }, [
    heading,
    el('div', { class: 'log-nav' }, [previous, next, voyageLink]),
    dateLine,
    connection,
    el('div', { class: 'log-grid' }, [
      el('div', { class: 'pane' }, [
        el('h2', { class: 'pane-label', text: "Ship's day" }),
        dayStatus,
        dayLine,
        grid.element,
        hint,
        sync,
        el('div', { class: 'actions' }, [sign, addNote]),
        notices,
        el('h3', { class: 'small-label', text: 'Notes' }),
        noteList,
      ]),
      el('div', { class: 'side' }, [
        totals,
        el('div', { class: 'pane' }, [
          el('h2', { class: 'pane-label', text: 'Month' }),
          monthStatus,
          monthActions,
        ]),
      ]),
    ]),
  ]);

  return {
    element,
    stop: () => {
      window.clearInterval(refreshTimer);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', paintConnection);
      grid.stop();
    },
  };
}
