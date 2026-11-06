import { api, ApiCallError } from '../api.js';
import { copy } from '../copy.js';
import { clear, el, prefersReducedMotion, setText, svg } from '../dom.js';
import { formatDate, shortDate } from '../format.js';
import { saveDueDate } from '../issueactions.js';
import { createIssueList } from '../issuelist.js';
import { navigate, type Route } from '../router.js';
import { notFoundSheet, titleBlock, type ModuleContext, type ModuleHandle } from '../shell.js';
import { onStreamEvent } from '../stream.js';
import { state, subscribe } from '../store.js';
import type { Cycle, CycleDay, Issue } from '../../shared/types.js';

const FOLD_DELAY = 200;
const FOLD_MS = 330;

export function cycleModule(context: ModuleContext): ModuleHandle {
  let cycle: Cycle | null = null;
  let issues: Issue[] = [];
  let wantedNumber: number | null = null;
  let unfoldedDate: string | null = null;
  let calendarStamp = stampOf();
  const pending = new Set<string>();
  const timers: number[] = [];

  const list = createIssueList({
    label: 'Cycle issues',
    onOpen: (issue, row) => {
      navigate(`/issues/${issue.key}`);
      void row;
    },
  });
  context.list.append(list.element);
  list.attachShortcuts(context.list);

  const previous = el('button', { type: 'button', text: 'Previous cycle' });
  const next = el('button', { type: 'button', text: 'Next cycle' });
  const heading = el('h1', { class: 'display', 'data-detail-title': 'true' });
  const range = el('p', { class: 'cycle-range mono' });
  const todayLine = el('p', { class: 'today-line mono' });
  const counter = el('p', { class: 'cycle-length mono', role: 'status', 'aria-label': 'Cycle length' });
  const unplaced = el('div', { class: 'tray', role: 'group', 'aria-label': 'Unplaced' });
  const ribbon = el('div', { class: 'ribbon', role: 'region', 'aria-label': 'Cycle ribbon' });
  const burndown = svg('svg', {
    class: 'burndown',
    role: 'img',
    'aria-label': 'Burndown',
    preserveAspectRatio: 'none',
  });
  const burndownValues = el('ul', { class: 'burndown-values', 'aria-label': 'Burndown values' });
  const header = el('div', { class: 'cycle-header' }, [
    heading,
    range,
    todayLine,
    counter,
    el('div', { class: 'cycle-nav' }, [previous, next]),
  ]);
  const block = titleBlock('Cycle', 'Planning', '');
  const sheet = el('div', { class: 'sheet cycle-sheet' }, [
    block,
    header,
    unplaced,
    ribbon,
    el('div', { class: 'burndown-wrap' }, [burndown, burndownValues]),
  ]);
  context.detail.append(sheet);

  previous.addEventListener('click', () => {
    if (cycle !== null && cycle.number > 1) navigate(`/cycle/${cycle.number - 1}`);
  });
  next.addEventListener('click', () => {
    if (cycle !== null) navigate(`/cycle/${cycle.number + 1}`);
  });

  function stampOf(): string {
    const workspace = state.workspace;
    if (workspace === null) return '';
    return JSON.stringify([
      workspace.time_zone,
      workspace.working_weekdays,
      workspace.holidays,
      workspace.cycle_anchor,
    ]);
  }

  async function load(number: number | null, options: { replay: boolean }): Promise<void> {
    const path = number === null ? '/api/cycles/current' : `/api/cycles/${number}`;
    try {
      const [loaded, loadedIssues] = await Promise.all([
        api<Cycle>('GET', path),
        api<{ issues: Issue[] }>('GET', `/api/issues?cycle=${number === null ? 'current' : number}`),
      ]);
      cycle = loaded;
      issues = loadedIssues.issues;
      list.setIssues(issues);
      renderCycle(options.replay);
    } catch (error) {
      if (error instanceof ApiCallError && error.code === 'not_found') {
        cycle = null;
        clear(context.detail);
        context.detail.append(notFoundSheet());
      }
    }
  }

  function renderCycle(replay: boolean): void {
    const loaded = cycle;
    if (loaded === null) return;
    setText(heading, copy.cycleHeading(loaded.number));
    const blockName = block.querySelector('.tb-name');
    const blockState = block.querySelector('.tb-state');
    const blockDate = block.querySelector('.tb-date');
    if (blockName !== null) setText(blockName, copy.cycleHeading(loaded.number));
    if (blockState !== null) {
      setText(blockState, loaded.is_finished ? 'Finished' : loaded.is_current ? 'Current' : 'Ahead');
    }
    if (blockDate !== null) setText(blockDate, formatDate(loaded.last_working_date));
    setText(
      range,
      `${formatDate(loaded.first_working_date)} to ${formatDate(loaded.last_working_date)}`,
    );
    const workspace = state.workspace;
    setText(todayLine, workspace === null ? '' : copy.todayLine(formatDate(workspace.today)));
    previous.toggleAttribute('disabled', loaded.number <= 1);
    header.classList.toggle('current', loaded.is_current);
    renderRibbon(loaded, replay);
    renderBurndown(loaded);
  }

  function renderRibbon(loaded: Cycle, replay: boolean): void {
    clear(ribbon);
    clear(unplaced);
    const reduced = prefersReducedMotion();
    const folding = replay && !reduced;
    ribbon.classList.toggle('folded', !folding);
    setText(counter, folding ? copy.calendarDays(loaded.calendar_days) : copy.workingDays);

    for (const day of loaded.days) {
      ribbon.append(day.counted ? workingColumn(day) : creaseColumn(day));
    }
    for (const issue of issues) {
      const chip = chipFor(issue);
      const column = issue.due_date === null ? null : ribbon.querySelector(`[data-date="${issue.due_date}"]`);
      if (column === null) unplaced.append(chip);
      else column.querySelector('.chips')?.append(chip);
    }
    if (folding) {
      timers.push(
        window.setTimeout(() => {
          ribbon.classList.add('folded');
          timers.push(
            window.setTimeout(() => {
              setText(counter, copy.workingDays);
              placeBurndown();
            }, FOLD_MS),
          );
        }, FOLD_DELAY),
      );
    }
    requestAnimationFrame(placeBurndown);
  }

  function workingColumn(day: CycleDay): HTMLElement {
    const column = el('div', {
      class: 'column working',
      role: 'group',
      'aria-label': formatDate(day.date),
      'data-date': day.date,
    });
    column.append(el('span', { class: 'column-date mono', text: shortDate(day.date) }));
    if (day.clock_change !== null) {
      column.append(
        el('span', {
          class: 'clock-change',
          text: day.clock_change === 'forward' ? copy.clocksForward : copy.clocksBack,
        }),
      );
    }
    column.append(el('div', { class: 'chips' }));
    return column;
  }

  function creaseColumn(day: CycleDay): HTMLElement {
    const column = el('div', { class: 'column crease-column', 'data-date': day.date });
    const crease = el('button', {
      type: 'button',
      class: 'crease',
      'aria-label': copy.creaseName(formatDate(day.date)),
      'aria-expanded': 'false',
      'data-crease': day.date,
    });
    crease.append(el('span', { class: 'crease-date mono', text: shortDate(day.date) }));
    const details = el('div', { class: 'crease-details' }, [
      el('span', { text: copy.notCounted }),
      el('span', { text: day.reason ?? '' }),
    ]);
    if (day.clock_change !== null) {
      details.append(
        el('span', { text: day.clock_change === 'forward' ? copy.clocksForward : copy.clocksBack }),
      );
    }
    crease.addEventListener('click', () => {
      toggleCrease(day.date);
    });
    crease.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggleCrease(day.date);
      }
    });
    crease.addEventListener('blur', () => {
      if (unfoldedDate === day.date) {
        window.setTimeout(() => {
          if (unfoldedDate === day.date && !column.contains(document.activeElement)) fold();
        }, 0);
      }
    });
    column.append(crease, details, el('div', { class: 'chips' }));
    return column;
  }

  function toggleCrease(date: string): void {
    if (unfoldedDate === date) {
      fold();
      return;
    }
    fold();
    unfoldedDate = date;
    const column = ribbon.querySelector<HTMLElement>(`.crease-column[data-date="${date}"]`);
    column?.classList.add('open');
    column?.querySelector('.crease')?.setAttribute('aria-expanded', 'true');
    window.setTimeout(placeBurndown, prefersReducedMotion() ? 0 : 200);
  }

  function fold(): void {
    if (unfoldedDate === null) return;
    const column = ribbon.querySelector<HTMLElement>(`.crease-column[data-date="${unfoldedDate}"]`);
    column?.classList.remove('open');
    column?.querySelector('.crease')?.setAttribute('aria-expanded', 'false');
    unfoldedDate = null;
    window.setTimeout(placeBurndown, prefersReducedMotion() ? 0 : 200);
  }

  function chipFor(issue: Issue): HTMLElement {
    const chip = el('button', {
      type: 'button',
      class: 'chip mono',
      'data-chip': issue.key,
      'aria-label':
        issue.due_date === null ? copy.chipNoDate(issue.key) : copy.chipName(issue.key, formatDate(issue.due_date)),
      text: issue.key,
    });
    attachDragging(chip, issue);
    return chip;
  }

  function workingDates(): string[] {
    return (cycle?.days ?? []).filter((day) => day.counted).map((day) => day.date);
  }

  function attachDragging(chip: HTMLElement, issue: Issue): void {
    let dragging = false;
    let holdTimer = 0;
    let startX = 0;
    let startY = 0;

    const begin = (): void => {
      dragging = true;
      chip.classList.add('dragging');
    };

    const onMove = (event: PointerEvent): void => {
      const moved = Math.hypot(event.clientX - startX, event.clientY - startY);
      if (!dragging) {
        if (moved > 10) window.clearTimeout(holdTimer);
        return;
      }
      event.preventDefault();
    };

    const onUp = (event: PointerEvent): void => {
      window.clearTimeout(holdTimer);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (!dragging) return;
      dragging = false;
      chip.classList.remove('dragging');
      const moved = Math.hypot(event.clientX - startX, event.clientY - startY);
      if (moved <= 4) return;
      const target = document
        .elementsFromPoint(event.clientX, event.clientY)
        .find((node) => node instanceof HTMLElement && node.dataset.date !== undefined) as HTMLElement | undefined;
      if (target?.dataset.date === undefined) return;
      void moveChip(chip, issue, target.dataset.date);
    };

    chip.addEventListener('pointerdown', (event) => {
      startX = event.clientX;
      startY = event.clientY;
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
      if (event.pointerType === 'touch') holdTimer = window.setTimeout(begin, 400);
      else begin();
    });

    chip.addEventListener('keydown', (event) => {
      if (!event.shiftKey) return;
      const dates = workingDates();
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();
        const currentIndex = issue.due_date === null ? -1 : dates.indexOf(issue.due_date);
        const target =
          currentIndex === -1
            ? dates[0]
            : dates[Math.min(Math.max(currentIndex + (event.key === 'ArrowRight' ? 1 : -1), 0), dates.length - 1)];
        if (target !== undefined) void moveChip(chip, issue, target);
      }
    });
  }

  /** A chip moves at once and goes back to where it was when the save fails. */
  async function moveChip(chip: HTMLElement, issue: Issue, date: string): Promise<void> {
    const origin = chip.parentElement;
    const target = ribbon.querySelector<HTMLElement>(`[data-date="${date}"] .chips`);
    if (target === null) return;
    target.append(chip);
    chip.focus();
    pending.add(issue.key);
    const result = await saveDueDate(issue.key, date);
    pending.delete(issue.key);
    if (!result.ok || result.date === null) {
      origin?.append(chip);
      chip.focus();
      return;
    }
    issue.due_date = result.date;
    const settled = ribbon.querySelector<HTMLElement>(`[data-date="${result.date}"] .chips`);
    if (settled !== null) settled.append(chip);
    chip.setAttribute('aria-label', copy.chipName(issue.key, formatDate(result.date)));
    chip.focus();
  }

  function renderBurndown(loaded: Cycle): void {
    clear(burndownValues);
    for (const entry of loaded.burndown) {
      burndownValues.append(
        el('li', { class: 'mono', text: copy.burndownEntry(formatDate(entry.date), entry.open) }),
      );
    }
    placeBurndown();
  }

  /** Each circle stays centred on its working-day column, folded or unfolded. */
  function placeBurndown(): void {
    const loaded = cycle;
    if (loaded === null) return;
    const box = ribbon.getBoundingClientRect();
    const width = Math.max(box.width, 1);
    const height = 120;
    clear(burndown);
    burndown.setAttribute('viewBox', `0 0 ${width} ${height}`);
    burndown.setAttribute('width', String(width));
    burndown.setAttribute('height', String(height));
    const maxOpen = Math.max(1, ...loaded.burndown.map((entry) => entry.open));
    const points: { x: number; y: number }[] = [];
    for (const entry of loaded.burndown) {
      const column = ribbon.querySelector<HTMLElement>(`[data-date="${entry.date}"]`);
      if (column === null) continue;
      const columnBox = column.getBoundingClientRect();
      const x = columnBox.left - box.left + columnBox.width / 2;
      const y = height - 10 - (entry.open / maxOpen) * (height - 20);
      points.push({ x, y });
    }
    if (points.length > 1) {
      burndown.append(
        svg('polyline', {
          points: points.map((point) => `${point.x},${point.y}`).join(' '),
          fill: 'none',
          stroke: 'currentColor',
          'stroke-width': 1,
        }),
      );
    }
    for (const point of points) {
      burndown.append(svg('circle', { cx: point.x, cy: point.y, r: 3, fill: 'currentColor' }));
    }
  }

  const onResize = (): void => placeBurndown();
  window.addEventListener('resize', onResize);
  ribbon.addEventListener('transitionend', placeBurndown);

  const unsubscribeStore = subscribe((keys) => {
    if (!keys.has('workspace')) return;
    const workspace = state.workspace;
    if (workspace !== null) setText(todayLine, copy.todayLine(formatDate(workspace.today)));
    const stamp = stampOf();
    if (stamp !== calendarStamp) {
      calendarStamp = stamp;
      void load(wantedNumber, { replay: false });
    }
  });

  const unsubscribeStream = onStreamEvent((event) => {
    if (event.name === 'reset' || (event.name === 'revoked' && event.data.scope === 'project')) {
      void load(wantedNumber, { replay: false });
      return;
    }
    if (event.name !== 'issue') return;
    const issue = event.data as unknown as Issue;
    if (pending.has(issue.key)) return;
    const loaded = cycle;
    const mine = issues.some((entry) => entry.key === issue.key);
    if (loaded !== null && mine && issue.cycle_number === loaded.number) {
      issues = issues.map((entry) => (entry.key === issue.key ? issue : entry));
      list.patch(issue);
      renderRibbon(loaded, false);
      renderBurndown(loaded);
      return;
    }
    void load(wantedNumber, { replay: false });
  });

  return {
    id: 'cycle',
    firstPane: 'detail',
    route(route: Route) {
      if (!context.detail.contains(sheet)) {
        clear(context.detail);
        context.detail.append(sheet);
      }
      const param = route.segments[1];
      if (route.segments.length > 2 || (param !== undefined && !/^\d+$/.test(param))) {
        clear(context.detail);
        context.detail.append(notFoundSheet());
        return;
      }
      const number = param === undefined ? null : Number(param);
      wantedNumber = number;
      unfoldedDate = null;
      void load(number, { replay: true });
    },
    destroy() {
      for (const timer of timers) window.clearTimeout(timer);
      window.removeEventListener('resize', onResize);
      unsubscribeStore();
      unsubscribeStream();
      list.destroy();
      clear(context.list);
      clear(context.detail);
    },
  };
}
