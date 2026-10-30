import { addDays, type LocalDate } from '../../domain/calendar.js';
import type { Lane, LanesResponse, Span } from '../../shared/api.js';
import { openDay, shortDate, SPAN_WORDS } from '../format.js';
import { element, type Child } from './dom.js';

const WINDOW_DAYS = 28;

export interface SelectedRange {
  readonly start: LocalDate;
  readonly end: LocalDate;
}

function spanCovering(spans: readonly Span[], date: LocalDate): Span | null {
  for (const span of spans) {
    if (span.start_date <= date && date <= span.end_date) return span;
  }
  return null;
}

function fillClass(span: Span): string {
  return `fill-${span.status}`;
}

/** One 28-day strip of day cells, starting at the window's first day. */
function strip(
  lane: Lane,
  from: LocalDate,
  range: SelectedRange | null,
  compact: boolean,
): HTMLElement {
  const cells: Child[] = [];
  for (let offset = 0; offset < WINDOW_DAYS; offset += 1) {
    const date = addDays(from, offset);
    const classes = ['cell'];
    if (offset % 7 === 0) classes.push('marker');
    const children: Child[] = [];
    if (!openDay(date)) {
      classes.push('cell-closed');
      children.push(element('span', { class: 'sr-only' }, ['closed']));
    } else {
      const span = spanCovering(lane.spans, date);
      if (span !== null) {
        const inRange =
          range !== null && lane.busy_for_range === true && range.start <= date && date <= range.end;
        classes.push(inRange ? 'fill-held' : fillClass(span));
      }
    }
    cells.push(element('span', { class: classes.join(' '), 'data-date': date }, children));
  }
  return element('div', { class: `strip${compact ? ' compact' : ''}` }, cells);
}

function summaryLine(span: Span): HTMLElement {
  const parts = [
    `${SPAN_WORDS[span.status]} ${shortDate(span.start_date)}\u2013${shortDate(span.end_date)}`,
  ];
  parts.push(`\u00b7 back ${span.back_on === null ? 'not yet known' : shortDate(span.back_on)}`);
  if (span.borrower !== undefined) parts.push(`\u00b7 ${span.borrower.name}`);
  else if (span.mine) parts.push('\u00b7 yours');
  return element('div', { class: 'lane-summary' }, [parts.join(' ')]);
}

function dateMarkers(from: LocalDate): HTMLElement {
  const labels: Child[] = [];
  for (let offset = 0; offset < WINDOW_DAYS; offset += 7) {
    labels.push(element('span', {}, [shortDate(addDays(from, offset))]));
  }
  return element('div', { class: 'strip-dates', 'aria-hidden': 'true' }, labels);
}

/** The lanes region: one group per unit, in lane order. */
export function renderLanes(lanes: LanesResponse, range: SelectedRange | null): HTMLElement {
  const container = element('div', { class: 'lanes' });
  for (const lane of lanes.lanes) {
    const group = element('div', { class: 'lane', role: 'group', 'aria-label': `Unit ${lane.label}` }, [
      element('div', { class: 'lane-label' }, [`Unit ${lane.label}`]),
      strip(lane, lanes.from, range, false),
      dateMarkers(lanes.from),
    ]);
    if (lane.spans.length === 0) {
      group.appendChild(element('div', { class: 'lane-summary' }, ['Free for the whole window']));
    } else {
      for (const span of lane.spans) group.appendChild(summaryLine(span));
    }
    container.appendChild(group);
  }
  return container;
}

/** A small preview of an item's lanes for today, shown on the catalogue card. */
export function renderLanePreview(lanes: LanesResponse): HTMLElement {
  const container = element('div', { class: 'lane-preview' });
  for (const lane of lanes.lanes) {
    container.appendChild(element('span', { class: 'sr-only' }, [`Unit ${lane.label}`]));
    container.appendChild(strip(lane, lanes.from, null, true));
  }
  return container;
}
