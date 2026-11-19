import { append, clear, h, svg } from './dom.js';
import { bus } from './bus.js';
import { canEdit, state } from './state.js';
import { DAY_WIDTH } from './motion.js';
import { barDescription } from './sentences.js';
import { openAddLinkDialog, openProgressSheet, openTaskDetails } from './dialogs.js';
import {
  ActionFailure,
  calendar,
  endForDuration,
  moveItem,
  refuseViewer,
  resizeFromStart,
  resizeItem,
  shiftWorkingDays,
} from './actions.js';
import { sendSelection } from './live.js';
import { dayOfWeek, fromIso, longDate, shortDate, toIso } from '../shared/dates.js';
import type { Item, Project } from '../shared/types.js';

export const ROW_HEIGHT = 44;

function mondayOfDay(day: number): number {
  const dow = dayOfWeek(day);
  return day - (dow === 0 ? 6 : dow - 1);
}

export interface ChartRange {
  first: number;
  last: number;
}

export function chartRange(project: Project): ChartRange | null {
  const starts = project.items.map((item) => item.start).filter((start): start is string => start !== null);
  if (starts.length === 0 || project.finish === null) return null;
  const earliest = Math.min(...starts.map(fromIso));
  return { first: mondayOfDay(earliest) - 7, last: mondayOfDay(fromIso(project.finish)) + 20 };
}

function focusableBars(project: Project): Item[] {
  return project.items.filter((item) => item.kind !== 'group');
}

function requested(item: Item): { start: string; end: string; duration: number } {
  return (
    state.preview.get(item.id) ?? { start: item.start!, end: item.end!, duration: item.duration }
  );
}

function placement(item: Item): { start: string; end: string } | null {
  const preview = state.preview.get(item.id);
  if (preview) return preview;
  if (item.start === null || item.end === null) return null;
  return { start: item.start, end: item.end };
}

function selectedBy(itemId: string): string | null {
  const names = state.presence
    .filter((person) => person.selected === itemId && person.userId !== state.me?.id)
    .map((person) => person.name)
    .sort();
  return names.length > 0 ? names.join(', ') : null;
}

/* ------------------------------------------------------------------ drag */

interface Drag {
  item: Item;
  mode: 'move' | 'start' | 'end';
  originX: number;
  started: boolean;
  bar: HTMLElement;
  result: { start: string; end: string };
}

let drag: Drag | null = null;

function snapped(item: Item, mode: Drag['mode'], offset: number): { start: string; end: string } {
  const cal = calendar();
  const startDay = fromIso(item.start!);
  const endDay = fromIso(item.end!);
  if (mode === 'move') {
    const moved = cal.nextWorkingDay(startDay + offset);
    const start = toIso(moved);
    return { start, end: item.kind === 'milestone' ? start : endForDuration(start, item.duration) };
  }
  if (mode === 'end') {
    let day = cal.prevWorkingDay(endDay + offset);
    if (day < startDay) day = startDay;
    return { start: item.start!, end: toIso(day) };
  }
  let day = cal.nextWorkingDay(startDay + offset);
  if (day > endDay) day = endDay;
  return { start: toIso(day), end: item.end! };
}

function endDrag(): void {
  drag = null;
  const tip = document.getElementById('drag-tip');
  if (tip) tip.textContent = '';
}

function beginDrag(item: Item, mode: Drag['mode'], bar: HTMLElement, event: PointerEvent): void {
  if (item.kind === 'group' || refuseViewer()) return;
  bar.setPointerCapture(event.pointerId);
  drag = {
    item,
    mode,
    originX: event.clientX,
    started: false,
    bar,
    result: { start: item.start!, end: item.end! },
  };
}

function moveDrag(event: PointerEvent, range: ChartRange): void {
  if (!drag) return;
  const dx = event.clientX - drag.originX;
  if (!drag.started && Math.abs(dx) < 4) return;
  drag.started = true;
  drag.result = snapped(drag.item, drag.mode, Math.round(dx / DAY_WIDTH));
  const left = (fromIso(drag.result.start) - range.first) * DAY_WIDTH;
  const width = (fromIso(drag.result.end) - fromIso(drag.result.start) + 1) * DAY_WIDTH;
  drag.bar.style.left = `${left}px`;
  drag.bar.style.width = `${width}px`;
  const tip = document.getElementById('drag-tip');
  if (tip) tip.textContent = `${longDate(drag.result.start)} - ${longDate(drag.result.end)}`;
}

function finishDrag(): void {
  if (!drag) return;
  const { item, mode, started, result } = drag;
  endDrag();
  if (!started) return;
  const cal = calendar();
  const duration = cal.indexOfIso(result.end) - cal.indexOfIso(result.start) + 1;
  state.preview.set(item.id, { ...result, duration: item.kind === 'milestone' ? 0 : duration });
  const work =
    mode === 'move'
      ? moveItem(item, result.start)
      : mode === 'end'
        ? resizeItem(item, duration)
        : resizeFromStart(item, result.start, duration);
  void work.catch((error: ActionFailure) => bus.setAlert(error.text));
}

/* ----------------------------------------------------------------- chart */

function barElement(item: Item, range: ChartRange, row: number, focusable: boolean): HTMLElement {
  const place = placement(item)!;
  const left = (fromIso(place.start) - range.first) * DAY_WIDTH;
  const width = (fromIso(place.end) - fromIso(place.start) + 1) * DAY_WIDTH;
  const describedBy = `desc-${item.id}`;
  const marks = selectedBy(item.id);

  const bar = h('div', {
    class: `bar kind-${item.kind}${item.critical ? ' critical' : ''}`,
    'data-item-id': item.id,
    'data-kind': item.kind,
    'data-start': item.start ?? '',
    'data-end': item.end ?? '',
    'data-duration': String(item.duration),
    'data-percent': String(item.percent),
    'data-critical': item.critical ? 'true' : 'false',
    'data-late': item.late ? 'true' : 'false',
    'data-shifted': state.shifted.has(item.id) ? 'true' : null,
    'data-dimmed': state.highlightCritical && !item.critical ? 'true' : null,
    'data-selected-by': marks,
    'data-variance': item.kind !== 'group' && item.baseline ? String(item.baseline.variance) : null,
    'data-baseline-start': item.kind !== 'group' && item.baseline ? item.baseline.start : null,
    'data-baseline-end': item.kind !== 'group' && item.baseline ? item.baseline.end : null,
    'data-focus-key': `bar:${item.id}`,
    role: item.kind === 'group' ? 'img' : 'button',
    'aria-label': item.name,
    'aria-describedby': describedBy,
    'aria-busy': state.busy.has(item.id) ? 'true' : null,
    'aria-disabled': item.kind !== 'group' && !canEdit() ? 'true' : null,
    tabindex: item.kind === 'group' ? null : focusable ? '0' : '-1',
    style: `left:${left}px;width:${width}px;top:${row * ROW_HEIGHT + 10}px`,
  });
  bar.appendChild(h('span', { class: 'visually-hidden', id: describedBy, text: barDescription(item, state.project!) }));
  if (item.kind === 'task' && item.percent > 0) {
    bar.appendChild(h('span', { class: 'fill', style: `width:${item.percent}%` }));
  }
  if (item.kind === 'task') {
    bar.appendChild(h('span', { class: 'handle start', 'data-handle': 'start' }));
    bar.appendChild(h('span', { class: 'handle end', 'data-handle': 'end' }));
  }
  if (marks) bar.appendChild(h('span', { class: 'selected-mark', text: marks }));
  if (item.late) bar.appendChild(h('span', { class: 'late-mark', text: 'Late' }));
  return bar;
}

function linkPath(
  link: Project['links'][number],
  range: ChartRange,
  rowOf: Map<string, number>,
  items: Map<string, Item>,
): SVGElement | null {
  const from = items.get(link.from);
  const to = items.get(link.to);
  if (!from || !to || !from.start || !to.start) return null;
  const column = (iso: string): number => (fromIso(iso) - range.first) * DAY_WIDTH;
  const fromX =
    link.type === 'FS' || link.type === 'FF' ? column(from.end!) + DAY_WIDTH : column(from.start);
  const toX = link.type === 'FS' || link.type === 'SS' ? column(to.start) : column(to.end!) + DAY_WIDTH;
  const fromY = rowOf.get(from.id)! * ROW_HEIGHT + ROW_HEIGHT / 2;
  const toY = rowOf.get(to.id)! * ROW_HEIGHT + ROW_HEIGHT / 2;
  const mid = fromX + 10;
  return svg('path', {
    d: `M ${fromX} ${fromY} H ${mid} V ${toY} H ${toX}`,
    class: `link${link.critical ? ' critical' : ''}`,
    'data-link-id': link.id,
    'data-from': link.from,
    'data-to': link.to,
    'data-type': link.type,
    'data-lag': String(link.lag),
    'data-critical': link.critical ? 'true' : 'false',
    fill: 'none',
  });
}

function renderChart(container: HTMLElement, project: Project, range: ChartRange): void {
  const dayCount = range.last - range.first + 1;
  const holidayNames = new Map(project.holidays.map((holiday) => [holiday.date, holiday.name]));
  const cal = calendar();

  const names = h('div', { class: 'names' }, [h('div', { class: 'names-head' })]);
  project.items.forEach((item) => {
    names.appendChild(
      h('div', {
        class: `name-row${item.group ? ' indented' : ''} kind-${item.kind}`,
        text: item.name,
      }),
    );
  });

  const header = h('div', { class: 'day-header' });
  for (let offset = 0; offset < dayCount; offset += 1) {
    const day = range.first + offset;
    const iso = toIso(day);
    const working = cal.isWorkingDay(day);
    const holiday = holidayNames.get(iso);
    header.appendChild(
      h(
        'div',
        {
          class: `day${working ? '' : ' off'}${mondayOfDay(day) % 14 === 0 ? ' band' : ''}`,
          'data-day': iso,
          'data-working': working ? 'true' : 'false',
          'data-holiday': holiday ?? null,
          style: `width:${DAY_WIDTH}px`,
        },
        [h('span', { class: 'day-number', text: String(fromIso(iso) && Number(iso.slice(8, 10))) }),
         holiday ? h('span', { class: 'holiday-name', text: holiday }) : null],
      ),
    );
  }

  const bars = h('div', { class: 'bars', style: `height:${project.items.length * ROW_HEIGHT}px` });
  const rowOf = new Map(project.items.map((item, index) => [item.id, index]));
  const itemsById = new Map(project.items.map((item) => [item.id, item]));
  const focusable = focusableBars(project);
  const focusedId =
    focusable.find((item) => item.id === state.focusedBarId)?.id ?? focusable[0]?.id ?? null;

  for (let offset = 0; offset < dayCount; offset += 1) {
    const day = range.first + offset;
    if (cal.isWorkingDay(day)) continue;
    bars.appendChild(
      h('div', {
        class: 'off-column',
        style: `left:${offset * DAY_WIDTH}px;width:${DAY_WIDTH}px`,
      }),
    );
  }

  if (state.showBaseline) {
    for (const item of project.items) {
      if (item.kind === 'group' || !item.baseline) continue;
      const left = (fromIso(item.baseline.start) - range.first) * DAY_WIDTH;
      const width = (fromIso(item.baseline.end) - fromIso(item.baseline.start) + 1) * DAY_WIDTH;
      bars.appendChild(
        h('div', {
          class: 'baseline-bar',
          'data-baseline-bar': '',
          'data-item-id': item.id,
          'data-start': item.baseline.start,
          'data-end': item.baseline.end,
          style: `left:${left}px;width:${width}px;top:${rowOf.get(item.id)! * ROW_HEIGHT + 32}px`,
        }),
      );
    }
  }

  const connectors = svg('svg', {
    class: 'connectors',
    width: dayCount * DAY_WIDTH,
    height: project.items.length * ROW_HEIGHT,
    'aria-hidden': 'true',
  });
  for (const link of project.links) {
    const path = linkPath(link, range, rowOf, itemsById);
    if (path) connectors.appendChild(path);
  }
  bars.appendChild(connectors as unknown as HTMLElement);

  for (const item of project.items) {
    if (!placement(item)) continue;
    const bar = barElement(item, range, rowOf.get(item.id)!, item.id === focusedId);
    bars.appendChild(bar);
    if (item.kind !== 'group' && item.float !== null && item.float > 0 && !item.critical) {
      const place = placement(item)!;
      bars.appendChild(
        h('div', {
          class: 'float-tail',
          style:
            `left:${(fromIso(place.end) - range.first + 1) * DAY_WIDTH}px;` +
            `width:${item.float * DAY_WIDTH}px;top:${rowOf.get(item.id)! * ROW_HEIGHT + 20}px`,
        }),
      );
    }
  }

  const todayDay = fromIso(state.config.today);
  if (todayDay >= range.first && todayDay <= range.last) {
    bars.appendChild(
      h('div', {
        id: 'today-line',
        'data-date': state.config.today,
        style: `left:${(todayDay - range.first) * DAY_WIDTH}px`,
      }),
    );
  }
  bars.appendChild(
    h('div', {
      id: 'finish-marker',
      'data-date': project.finish!,
      style: `left:${(fromIso(project.finish!) - range.first + 1) * DAY_WIDTH}px`,
    }),
  );

  const inner = h('div', { class: 'chart-inner', style: `width:${dayCount * DAY_WIDTH}px` }, [
    header,
    bars,
  ]);
  const region = h(
    'div',
    { class: 'chart-region', role: 'region', 'aria-label': 'Chart', 'data-scroll': '' },
    [inner, h('div', { id: 'drag-tip' })],
  );

  region.addEventListener('focusin', (event) => {
    const bar = (event.target as HTMLElement).closest<HTMLElement>('[data-item-id]');
    if (bar?.dataset.itemId) {
      state.focusedBarId = bar.dataset.itemId;
      sendSelection(bar.dataset.itemId);
    }
  });
  // A redraw momentarily takes the focused bar out of the page, so the mark is dropped only
  // once focus has settled somewhere outside the chart.
  region.addEventListener('focusout', () => {
    window.setTimeout(() => {
      if (!document.activeElement?.closest('.chart-region')) sendSelection(null);
    }, 0);
  });

  bars.addEventListener('pointerdown', (event) => {
    const target = event.target as HTMLElement;
    const bar = target.closest<HTMLElement>('.bar');
    if (!bar?.dataset.itemId) return;
    const item = itemsById.get(bar.dataset.itemId)!;
    bar.focus();
    const handle = target.dataset.handle;
    beginDrag(item, handle === 'start' ? 'start' : handle === 'end' ? 'end' : 'move', bar, event);
  });
  bars.addEventListener('pointermove', (event) => moveDrag(event, range));
  bars.addEventListener('pointerup', () => finishDrag());
  bars.addEventListener('pointercancel', () => endDrag());
  bars.addEventListener('keydown', (event) => {
    const bar = (event.target as HTMLElement).closest<HTMLElement>('.bar');
    if (!bar?.dataset.itemId) return;
    handleBarKey(event, itemsById.get(bar.dataset.itemId)!, focusable, bar);
  });

  append(container, [h('div', { class: 'gantt' }, [names, region])]);
}

function handleBarKey(event: KeyboardEvent, item: Item, focusable: Item[], bar: HTMLElement): void {
  const index = focusable.findIndex((entry) => entry.id === item.id);
  if (event.key === 'ArrowDown' && !event.shiftKey) {
    event.preventDefault();
    const next = focusable[Math.min(index + 1, focusable.length - 1)];
    document.querySelector<HTMLElement>(`[data-item-id="${next.id}"]`)?.focus();
    return;
  }
  if (event.key === 'ArrowUp' && !event.shiftKey) {
    event.preventDefault();
    const next = focusable[Math.max(index - 1, 0)];
    document.querySelector<HTMLElement>(`[data-item-id="${next.id}"]`)?.focus();
    return;
  }
  if (event.key === 'Escape' && drag) {
    event.preventDefault();
    endDrag();
    bus.update();
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    openTaskDetails(item, bar);
    return;
  }
  if (event.key === 'l' || event.key === 'L') {
    event.preventDefault();
    if (refuseViewer()) return;
    openAddLinkDialog(item, bar);
    return;
  }
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  bus.setAlert(null);
  if (refuseViewer()) return;

  const forward = event.key === 'ArrowRight';
  const base = requested(item);
  if (event.shiftKey) {
    if (item.kind === 'milestone') return;
    const duration = base.duration + (forward ? 1 : -1);
    if (duration >= 1) {
      state.preview.set(item.id, {
        start: base.start,
        end: endForDuration(base.start, duration),
        duration,
      });
    }
    void resizeItem(item, duration).catch((error: ActionFailure) => bus.setAlert(error.text));
    return;
  }
  const start = shiftWorkingDays(base.start, forward ? 1 : -1);
  state.preview.set(item.id, {
    start,
    end: item.kind === 'milestone' ? start : endForDuration(start, base.duration),
    duration: base.duration,
  });
  void moveItem(item, start).catch((error: ActionFailure) => bus.setAlert(error.text));
}

/* -------------------------------------------------------------- timeline */

function renderTimeline(container: HTMLElement, project: Project): void {
  const list = h('ul', { role: 'list', 'aria-label': 'Timeline', class: 'timeline' });
  for (const item of project.items) {
    const card = h('li', { role: 'listitem', class: 'card', 'data-item-id': item.id });
    const dates =
      item.start === null
        ? ''
        : item.kind === 'milestone'
          ? shortDate(item.start)
          : `${shortDate(item.start)} - ${shortDate(item.end!)}`;
    append(card, [
      h('h2', { text: item.name, class: 'card-name' }),
      dates === '' ? null : h('p', { class: 'card-dates', text: dates }),
      h('p', { class: 'card-percent', text: `${item.percent}% complete` }),
      item.critical ? h('p', { class: 'card-flag', text: 'Critical' }) : null,
      item.late ? h('p', { class: 'card-flag', text: 'Late' }) : null,
    ]);
    if (item.kind === 'task') {
      const button = h('button', {
        type: 'button',
        text: `Update progress for ${item.name}`,
        'data-focus-key': `progress:${item.id}`,
      });
      button.addEventListener('click', () => openProgressSheet(item, button));
      card.appendChild(button);
    }
    list.appendChild(card);
  }
  container.appendChild(list);
}

export function isPhone(): boolean {
  return window.innerWidth < 768;
}

export function renderGantt(container: HTMLElement): void {
  clear(container);
  const project = state.project!;
  if (project.items.length === 0) {
    const button = h('button', { type: 'button', text: 'Open the list', class: 'primary' });
    button.addEventListener('click', () => {
      state.view = 'list';
      bus.update();
    });
    append(container, [
      h('p', { class: 'empty', text: 'No tasks yet. Add the first task in the list.' }),
      button,
    ]);
    return;
  }
  if (isPhone()) {
    renderTimeline(container, project);
    return;
  }
  const range = chartRange(project);
  if (range) renderChart(container, project, range);
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && drag) {
    endDrag();
    bus.update();
  }
});
