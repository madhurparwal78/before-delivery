import { request } from '../api';
import { el, prefersReducedMotion, setAttr, setText, svg } from '../dom';
import { icon } from '../icons';
import { Refreshes, REPORT_MS } from '../refresh';
import { announce, heading, navigate, type Screen, type ScreenContext } from '../shell';
import { kitchenToday } from '../clock';
import * as copy from '../copy';
import { addDays, formatDateLabel, formatDuration, isCalendarDate } from '../../shared/format';
import type { ReportResponse } from '../../shared/types';

const BAR_MAX_HEIGHT = 160;
const BAR_WIDTH = 56;
const BAR_DEPTH = 22;
const BAR_GROW_MS = 600;
const BAR_STAGGER_MS = 40;

interface Bar {
  node: HTMLElement;
  grow: HTMLElement;
  shape: SVGElement;
  name: HTMLElement;
  height: number;
}

export function usageBarHeight(minutes: number, maxMinutes: number): number {
  if (maxMinutes <= 0) return 0;
  return Math.floor((BAR_MAX_HEIGHT * minutes) / maxMinutes + 0.5);
}

function drawBarShape(height: number): SVGElement {
  const total = BAR_MAX_HEIGHT + BAR_DEPTH * 2;
  const node = svg('svg', {
    viewBox: `0 0 ${BAR_WIDTH + BAR_DEPTH} ${total}`,
    width: BAR_WIDTH + BAR_DEPTH,
    height: total,
    class: 'usage-bar-shape',
    'aria-hidden': 'true',
  });
  const baseY = total - BAR_DEPTH;
  const topY = baseY - height;
  const faces: ReadonlyArray<{ points: string; className: string }> = [
    {
      points: `0,${topY} ${BAR_WIDTH / 2},${topY - BAR_DEPTH} ${BAR_WIDTH + BAR_DEPTH / 2},${topY - BAR_DEPTH + BAR_DEPTH / 2} ${BAR_WIDTH},${topY + BAR_DEPTH / 2}`,
      className: 'face top',
    },
    {
      points: `0,${topY} ${BAR_WIDTH},${topY + BAR_DEPTH / 2} ${BAR_WIDTH},${baseY + BAR_DEPTH / 2} 0,${baseY}`,
      className: 'face left',
    },
    {
      points: `${BAR_WIDTH},${topY + BAR_DEPTH / 2} ${BAR_WIDTH + BAR_DEPTH / 2},${topY - BAR_DEPTH + BAR_DEPTH / 2} ${BAR_WIDTH + BAR_DEPTH / 2},${baseY - BAR_DEPTH / 2} ${BAR_WIDTH},${baseY + BAR_DEPTH / 2}`,
      className: 'face right',
    },
  ];
  for (const face of faces) {
    node.append(svg('polygon', { points: face.points, class: face.className }));
  }
  return node;
}

export async function mountReport(ctx: ScreenContext): Promise<Screen> {
  const level1 = heading('Daily usage');
  const dateGroup = el('div', {
    className: 'kitchen-date',
    attrs: { role: 'group', 'aria-label': 'Kitchen date' },
  });
  const previousButton = el('button', { text: 'Previous day', className: 'button', attrs: { type: 'button' } });
  const nextButton = el('button', { text: 'Next day', className: 'button', attrs: { type: 'button' } });
  const todayButton = el('button', { text: 'Today', className: 'button', attrs: { type: 'button' } });
  const dateText = el('p', { className: 'date-text' });
  const pending = el('p', { className: 'pending-copy' });
  previousButton.prepend(icon('chevron-left'));
  nextButton.prepend(icon('chevron-right'));
  todayButton.prepend(icon('calendar-days'));
  dateGroup.append(previousButton, nextButton, todayButton, dateText, pending);

  const figure = el('figure', {
    className: 'usage-figure',
    attrs: { role: 'figure', 'aria-label': 'Usage by station', 'aria-describedby': 'usage-description' },
  });
  const figureDescription = el('p', { className: 'usage-description', attrs: { id: 'usage-description' } });
  const bars = el('div', { className: 'usage-bars' });
  const floorLine = el('div', { className: 'usage-floor-line' });
  figure.append(bars, floorLine, figureDescription);

  const stationTable = el('table', {
    className: 'data-table',
    attrs: { 'aria-label': 'Usage by station' },
  });
  const stationHead = el('thead');
  const stationHeadRow = el('tr');
  for (const column of ['Station', 'Booked', 'Bookings']) {
    stationHeadRow.append(el('th', { text: column, attrs: { scope: 'col' } }));
  }
  stationHead.append(stationHeadRow);
  const stationBody = el('tbody');
  stationTable.append(stationHead, stationBody);

  const tenantTable = el('table', { className: 'data-table', attrs: { 'aria-label': 'Usage by tenant' } });
  const tenantHead = el('thead');
  const tenantHeadRow = el('tr');
  for (const column of ['Business', 'Booked', 'Bookings', 'No-shows']) {
    tenantHeadRow.append(el('th', { text: column, attrs: { scope: 'col' } }));
  }
  tenantHead.append(tenantHeadRow);
  const tenantBody = el('tbody');
  tenantTable.append(tenantHead, tenantBody);

  const totalLine = el('p', { className: 'total-line' });
  ctx.root.append(level1, dateGroup, figure, stationTable, tenantTable, totalLine);

  const refreshes = new Refreshes();
  const barNodes = new Map<string, Bar>();
  let shownDate: string | null = null;
  let lastTotal: number | null = null;
  let token = 0;

  const chosenDate = (query: URLSearchParams): string => {
    const raw = query.get('date');
    if (raw !== null && isCalendarDate(raw)) return raw;
    return kitchenToday();
  };

  const drawBars = (report: ReportResponse, animate: boolean): void => {
    const maxMinutes = report.stations.reduce((most, row) => Math.max(most, row.bookedMinutes), 0);
    const animations: Array<{ bar: Bar; from: number }> = [];
    for (const [index, row] of report.stations.entries()) {
      const height = usageBarHeight(row.bookedMinutes, maxMinutes);
      let bar = barNodes.get(row.stationId);
      if (bar === undefined) {
        const node = el('div', { className: 'usage-bar' });
        const grow = el('div', { className: 'usage-bar-grow' });
        const shape = drawBarShape(height);
        const name = el('p', { className: 'usage-bar-name', text: row.stationName });
        grow.append(shape);
        node.append(grow, name);
        bars.append(node);
        bar = { node, grow, shape, name, height: 0 };
        barNodes.set(row.stationId, bar);
      }
      setAttr(bar.node, 'data-station-id', row.stationId);
      setAttr(bar.node, 'data-minutes', String(row.bookedMinutes));
      setAttr(bar.node, 'data-height', String(height));
      setText(bar.name, row.stationName);
      if (bar.height !== height || bar.shape.parentElement === null) {
        const replacement = drawBarShape(height);
        bar.shape.replaceWith(replacement);
        bar.shape = replacement;
      }
      const from = bar.height === 0 || height === 0 ? 0 : bar.height / Math.max(height, 1);
      if (animate && bar.height !== height) animations.push({ bar, from: Math.min(from, 1) });
      bar.height = height;
      if (bars.children[index] !== bar.node) bars.append(bar.node);
    }
    if (!prefersReducedMotion()) {
      for (const [index, entry] of animations.entries()) {
        entry.bar.grow.animate(
          [{ transform: `scaleY(${entry.from})` }, { transform: 'scaleY(1)' }],
          {
            duration: BAR_GROW_MS,
            delay: index * BAR_STAGGER_MS,
            easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
            fill: 'none',
          },
        );
      }
    }
    setText(
      figureDescription,
      report.stations
        .map((row) => `${row.stationName}: ${formatDuration(row.bookedMinutes)}`)
        .join('; '),
    );
  };

  const drawTables = (report: ReportResponse): void => {
    stationBody.textContent = '';
    for (const row of report.stations) {
      const node = el('tr');
      node.append(el('td', { text: row.stationName }));
      node.append(el('td', { text: formatDuration(row.bookedMinutes) }));
      node.append(el('td', { text: String(row.bookingCount) }));
      stationBody.append(node);
    }
    tenantBody.textContent = '';
    for (const row of report.tenants) {
      const node = el('tr');
      node.append(el('td', { text: row.businessName }));
      node.append(el('td', { text: formatDuration(row.bookedMinutes) }));
      node.append(el('td', { text: String(row.bookingCount) }));
      node.append(el('td', { text: String(row.noShowCount) }));
      tenantBody.append(node);
    }
    setText(totalLine, copy.totalBookedLine(report.totalBookedMinutes));
  };

  const load = async (date: string, kind: 'settle' | 'refresh'): Promise<void> => {
    token += 1;
    const mine = token;
    if (kind === 'settle') {
      pending.textContent = copy.reportPending;
      setText(dateText, formatDateLabel(date));
    }
    const result = await request<ReportResponse>('GET', `/api/reports/daily?date=${date}`);
    if (mine !== token) return;
    if (kind === 'settle') pending.textContent = '';
    if (result.kind === 'stale') return;
    if (result.kind !== 'ok') {
      if (kind === 'settle' && result.kind === 'network') announce(copy.generic);
      return;
    }
    const report = result.body;
    setText(dateText, formatDateLabel(report.date));
    drawBars(report, true);
    drawTables(report);
    if (kind === 'settle') {
      announce(copy.reportSuccess(report.date, report.totalBookedMinutes));
    } else if (lastTotal !== null && lastTotal !== report.totalBookedMinutes) {
      announce(copy.reportUpdate(report.date, report.totalBookedMinutes));
    }
    lastTotal = report.totalBookedMinutes;
  };

  const settle = (query: URLSearchParams): void => {
    const raw = query.get('date');
    const date = chosenDate(query);
    if (raw === null || !isCalendarDate(raw)) {
      window.history.replaceState({}, '', `/report?date=${date}`);
    }
    if (shownDate === date && raw !== null && isCalendarDate(raw)) {
      void load(date, 'settle');
      return;
    }
    shownDate = date;
    lastTotal = null;
    void load(date, 'settle');
  };

  previousButton.addEventListener('click', () => {
    navigate(`/report?date=${addDays(shownDate ?? kitchenToday(), -1)}`);
  });
  nextButton.addEventListener('click', () => {
    navigate(`/report?date=${addDays(shownDate ?? kitchenToday(), 1)}`);
  });
  todayButton.addEventListener('click', () => {
    navigate(`/report?date=${kitchenToday()}`);
  });

  settle(ctx.query);
  refreshes.every(REPORT_MS, () => {
    if (shownDate !== null) void load(shownDate, 'refresh');
  });

  return {
    unmount: () => {
      refreshes.stop();
    },
    updateQuery: (query: URLSearchParams) => {
      settle(query);
    },
  };
}
