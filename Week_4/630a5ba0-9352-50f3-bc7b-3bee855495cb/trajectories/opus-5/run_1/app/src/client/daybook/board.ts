import type { CalendarItemDto, DayDto, TaskDto } from '../../shared/types.js';
import { api, RequestFailed } from '../api.js';
import { announce, focusKeyOf, localToday, render, restoreFocus, state } from '../app.js';
import { animateCounter, clear, el, icon, prefersReducedMotion } from '../dom.js';
import { calendarImportSummary, importSummary, overByLabel, reasonOf } from '../copy.js';
import { openDialog } from '../dialog.js';
import { pending } from '../forms.js';
import { addDays, dayLabel, minutesOfDay, shortDayLabel } from '../../shared/time.js';
import {
  applyOptimisticMove,
  applyServerDays,
  boardDays,
  calendarItems,
  columnLabel,
  dayOf,
  findTask,
  projectedMinutes,
  refreshBoard,
  SLOT_TIMES,
  threshold,
  type DropTarget,
} from './model.js';

const SLOT_HEIGHT = 44;
const ESTIMATE_CHOICES: { minutes: number; label: string; name: string }[] = [
  { minutes: 15, label: '15m', name: '15 minutes' },
  { minutes: 30, label: '30m', name: '30 minutes' },
  { minutes: 45, label: '45m', name: '45 minutes' },
  { minutes: 60, label: '60m', name: '60 minutes' },
  { minutes: 90, label: '90m', name: '90 minutes' },
  { minutes: 120, label: '2h', name: '120 minutes' },
];

interface DragState {
  taskId: string;
  mode: 'pointer' | 'keyboard';
  target: DropTarget | null;
  columnIndex: number;
  slotIndex: number;
  floater: HTMLElement | null;
  from: DropTarget;
}

let drag: DragState | null = null;
let previousTotals = new Map<string, number>();
let suggestTimer = 0;
let addTaskValue = '';
let suggestions: { id: string; title: string; estimateMinutes: number | null }[] = [];
let highlighted = -1;

function narrow(): boolean {
  return window.matchMedia('(max-width: 620px)').matches;
}

function rerender(): void {
  const key = focusKeyOf(document.activeElement);
  void render().then(() => restoreFocus(key));
}

function snapshotTotals(): void {
  previousTotals = new Map(boardDays().map((day) => [day.date, day.plannedMinutes]));
}

function heldTask(): TaskDto | null {
  return drag ? findTask(drag.taskId) : null;
}

function isDragTarget(date: string): boolean {
  if (!drag || !drag.target) return false;
  const target = drag.target;
  if (target.kind === 'day') return target.date === date;
  if (target.kind === 'slot') return target.date === date;
  return false;
}

/* ------------------------------ waterline ------------------------------ */

function gaugeFor(day: DayDto): HTMLElement {
  const limit = threshold();
  const fillRatio = Math.min(1.2, day.plannedMinutes / limit);
  const held = heldTask();
  const showGhost = held !== null && isDragTarget(day.date) && held.dayDate !== day.date;
  const ghostRatio = showGhost ? Math.min(1.2, (held?.estimateMinutes ?? 0) / limit) : 0;
  const totalRatio = Math.min(1.2, fillRatio + ghostRatio);
  const projected = showGhost ? day.plannedMinutes + (held?.estimateMinutes ?? 0) : day.plannedMinutes;
  const over = projected - limit;

  const gauge = el('div', {
    class: 'gauge',
    role: 'meter',
    'aria-label': `Load for ${day.label}`,
    'aria-valuemin': '0',
    'aria-valuemax': String(limit * 1.2),
    'aria-valuenow': String(Math.min(day.plannedMinutes, limit * 1.2)),
    'aria-valuetext': `${day.plannedMinutes} of ${limit} minutes`,
    style: `--fill: ${fillRatio}; --ghost: ${ghostRatio}; --over-part: ${Math.max(0, totalRatio - 1)}`,
  });

  gauge.append(el('div', { class: 'gauge-fill', 'data-part': 'waterline-fill' }));
  if (showGhost) gauge.append(el('div', { class: 'gauge-ghost', 'data-part': 'waterline-ghost' }));
  if (totalRatio > 1) gauge.append(el('div', { class: 'gauge-over', 'data-part': 'waterline-overflow' }));
  gauge.append(el('div', { class: 'gauge-tidemark', 'data-part': 'tidemark' }));
  if (over > 0) {
    gauge.append(
      el('span', { class: 'gauge-over-label', 'data-part': 'over-label', text: overByLabel(over) }),
    );
  }
  return gauge;
}

/* -------------------------------- cards -------------------------------- */

function estimateGroup(task: TaskDto): HTMLElement {
  const group = el('div', { class: 'estimates', role: 'radiogroup', 'aria-label': `Estimate for ${task.title}` });
  for (const choice of ESTIMATE_CHOICES) {
    const input = el('input', {
      type: 'radio',
      name: `estimate-${task.id}`,
      'aria-label': choice.name,
      checked: task.estimateMinutes === choice.minutes,
      'data-focus-key': `estimate:${task.id}:${choice.minutes}`,
    });
    input.addEventListener('change', () => {
      void setEstimate(task, choice.minutes);
    });
    group.append(el('label', {}, [input, choice.label]));
  }
  return group;
}

function cardElement(task: TaskDto, inBacklog: boolean): HTMLElement {
  const card = el('li', {
    class: `card${task.status === 'done' ? ' is-done' : ''}${drag?.taskId === task.id ? ' is-dragging' : ''}`,
    'data-task-id': task.id,
  });

  const handle = el('button', {
    type: 'button',
    class: 'card-handle',
    'aria-label': `Move ${task.title}`,
    'data-focus-key': `move:${task.id}`,
  });
  handle.append(icon('grip-vertical'));
  handle.addEventListener('keydown', (event) => onCardKey(event, task));

  const checkbox = el('input', {
    type: 'checkbox',
    'aria-label': `Done: ${task.title}`,
    checked: task.status === 'done',
    'data-focus-key': `done:${task.id}`,
  });
  checkbox.addEventListener('change', () => {
    void setDone(task, checkbox.checked);
  });

  const secondary =
    inBacklog && task.dayDate !== null
      ? el('span', { class: 'card-secondary', text: `From ${dayLabel(task.dayDate)}` })
      : null;

  card.append(
    el('div', { class: 'card-body' }, [
      el('span', { class: 'card-title', text: task.title }),
      secondary,
    ]),
    el('div', { class: 'card-tools' }, [
      handle,
      el('span', {
        class: 'num card-estimate',
        text: task.estimateMinutes === null ? 'No estimate' : `${task.estimateMinutes}m`,
      }),
      el('label', { class: 'card-check' }, [checkbox]),
    ]),
  );

  if (state.step === 'estimate' && task.status === 'open') card.append(estimateGroup(task));

  card.addEventListener('pointerdown', (event) => onPointerDown(event, task, card));
  return card;
}

function cardList(tasks: TaskDto[], inBacklog: boolean): HTMLElement {
  return el(
    'ul',
    { class: 'card-list', role: 'list' },
    tasks.map((task) => cardElement(task, inBacklog)),
  );
}

/* ------------------------------- regions ------------------------------- */

const RITUAL_STEPS: { key: typeof state.step; word: string; numeral: string }[] = [
  { key: 'pull', word: 'Pull', numeral: '1' },
  { key: 'estimate', word: 'Estimate', numeral: '2' },
  { key: 'check', word: 'Check', numeral: '3' },
  { key: 'timebox', word: 'Timebox', numeral: '4' },
  { key: 'shutdown', word: 'Shut down', numeral: '5' },
];

function ritualRail(): HTMLElement {
  const rail = el('nav', { 'aria-label': 'Morning ritual', class: 'ritual' });
  for (const step of RITUAL_STEPS) {
    const button = el(
      'button',
      {
        type: 'button',
        'aria-current': state.step === step.key ? 'step' : null,
        'data-focus-key': `ritual:${step.key}`,
      },
      [el('span', { class: 'numeral', text: step.numeral }), step.word],
    );
    button.setAttribute('aria-label', step.word);
    button.addEventListener('click', () => {
      void activateStep(step.key, button);
    });
    rail.append(button);
  }
  return rail;
}

function addTaskBox(): HTMLElement {
  const listboxId = 'add-task-suggestions';
  const input = el('input', {
    type: 'text',
    role: 'combobox',
    'aria-label': 'Add a task',
    'aria-expanded': suggestions.length > 0 ? 'true' : 'false',
    'aria-controls': listboxId,
    'aria-autocomplete': 'list',
    autocomplete: 'off',
    placeholder: 'Add a task',
    value: addTaskValue,
    'data-focus-key': 'add-task',
  });

  const listbox = el('ul', {
    id: listboxId,
    role: 'listbox',
    'aria-label': 'Suggestions',
    class: 'suggestions',
    hidden: suggestions.length === 0,
  });
  suggestions.forEach((suggestion, index) => {
    const option = el('li', {
      role: 'option',
      'aria-selected': index === highlighted ? 'true' : 'false',
      id: `suggestion-${index}`,
      text: suggestion.title,
    });
    option.addEventListener('click', () => {
      chooseSuggestion(index);
    });
    listbox.append(option);
  });
  if (highlighted >= 0) input.setAttribute('aria-activedescendant', `suggestion-${highlighted}`);

  input.addEventListener('input', () => {
    addTaskValue = input.value;
    window.clearTimeout(suggestTimer);
    if (addTaskValue.trim().length === 0) {
      suggestions = [];
      highlighted = -1;
      renderSuggestions(listbox, input);
      return;
    }
    const query = addTaskValue.trim();
    suggestTimer = window.setTimeout(() => {
      void api
        .suggest(query)
        .then((result) => {
          suggestions = result.suggestions.slice(0, 8);
          highlighted = -1;
          renderSuggestions(listbox, input);
        })
        .catch(() => undefined);
    }, 250);
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      highlighted = suggestions.length === 0 ? -1 : (highlighted + 1) % suggestions.length;
      renderSuggestions(listbox, input);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      highlighted = suggestions.length === 0 ? -1 : (highlighted - 1 + suggestions.length) % suggestions.length;
      renderSuggestions(listbox, input);
      return;
    }
    if (event.key === 'Escape') {
      suggestions = [];
      highlighted = -1;
      renderSuggestions(listbox, input);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (highlighted >= 0) {
        chooseSuggestion(highlighted);
        return;
      }
      const title = input.value.trim();
      if (title.length === 0) return;
      window.clearTimeout(suggestTimer);
      addTaskValue = '';
      suggestions = [];
      highlighted = -1;
      void addTask(title);
    }
  });

  return el('div', { class: 'add-task' }, [input, listbox]);
}

function renderSuggestions(listbox: HTMLElement, input: HTMLElement): void {
  clear(listbox);
  listbox.hidden = suggestions.length === 0;
  input.setAttribute('aria-expanded', suggestions.length > 0 ? 'true' : 'false');
  if (highlighted >= 0) input.setAttribute('aria-activedescendant', `suggestion-${highlighted}`);
  else input.removeAttribute('aria-activedescendant');
  suggestions.forEach((suggestion, index) => {
    const option = el('li', {
      role: 'option',
      'aria-selected': index === highlighted ? 'true' : 'false',
      id: `suggestion-${index}`,
      text: suggestion.title,
    });
    option.addEventListener('click', () => chooseSuggestion(index));
    listbox.append(option);
  });
}

function chooseSuggestion(index: number): void {
  const suggestion = suggestions[index];
  if (!suggestion) return;
  suggestions = [];
  highlighted = -1;
  addTaskValue = '';
  const target = document.querySelector<HTMLElement>(`[data-focus-key="move:${suggestion.id}"]`);
  if (target) {
    target.focus();
    announce(`Found ${suggestion.title}.`);
    return;
  }
  rerender();
}

function backlogRegion(): HTMLElement {
  const board = state.board;
  const region = el('section', { role: 'region', 'aria-label': 'Backlog', class: 'backlog', 'data-drop': 'backlog' });
  const importTasks = el('button', { type: 'button', class: 'button', 'data-focus-key': 'import-tasks' }, [
    icon('upload'),
    'Import tasks',
  ]);
  importTasks.setAttribute('aria-label', 'Import tasks');
  importTasks.addEventListener('click', () => openTaskImport(importTasks));

  const importCalendar = el('button', { type: 'button', class: 'button', 'data-focus-key': 'import-calendar' }, [
    icon('calendar'),
    'Import calendar',
  ]);
  importCalendar.setAttribute('aria-label', 'Import calendar');
  importCalendar.addEventListener('click', () => openCalendarImport(importCalendar));

  const heading = el('div', { class: 'region-heading' }, [el('h2', { text: 'Backlog' })]);
  if (narrow()) {
    const toggle = el('button', { type: 'button', class: 'button button--quiet' }, [
      state.backlogOpen ? 'Hide Backlog' : 'Show Backlog',
    ]);
    toggle.addEventListener('click', () => {
      state.backlogOpen = !state.backlogOpen;
      rerender();
    });
    heading.append(toggle);
  }

  region.append(heading, addTaskBox(), el('div', { class: 'import-buttons' }, [importTasks, importCalendar]));
  if (!narrow() || state.backlogOpen) region.append(cardList(board?.backlog ?? [], true));
  region.addEventListener('pointerenter', () => setPointerTarget({ kind: 'backlog' }));
  return region;
}

function dayRegion(day: DayDto, index: number): HTMLElement {
  const region = el('section', {
    role: 'region',
    'aria-label': day.label,
    class: `day-column${isDragTarget(day.date) ? ' is-target' : ''}${state.openDay === day.date ? ' is-open' : ''}`,
    'data-drop': 'day',
    'data-date': day.date,
  });

  const heading = el('h2', {
    'aria-label': day.label,
    text: narrow() ? shortDayLabel(day.date) : day.label,
  });
  const total = el('span', { class: 'day-total num', text: `${day.plannedMinutes}m` });
  const earlier = previousTotals.get(day.date);
  if (earlier !== undefined && earlier !== day.plannedMinutes) {
    animateCounter(total, earlier, day.plannedMinutes, (value) => `${value}m`);
  }

  region.append(el('div', { class: 'day-heading' }, [heading, total]), gaugeFor(day));

  if (narrow()) {
    const show = el('button', { type: 'button', class: 'button button--quiet', 'aria-label': `Show ${day.label}` }, [
      'Show',
    ]);
    show.addEventListener('click', () => {
      state.openDay = state.openDay === day.date ? null : day.date;
      rerender();
    });
    region.append(show);
  }

  region.append(cardList(day.tasks, false));
  region.addEventListener('pointerenter', () => setPointerTarget({ kind: 'day', date: day.date }));
  void index;
  return region;
}

function daysGrid(): HTMLElement {
  return el(
    'div',
    { class: 'days' },
    boardDays().map((day, index) => dayRegion(day, index)),
  );
}

/* ---------------------------- calendar strip ---------------------------- */

function blockGeometry(startTime: string, endTime: string): { top: number; height: number } {
  const stripStart = 7 * 60;
  const start = Math.max(stripStart, minutesOfDay(startTime));
  const end = minutesOfDay(endTime) === 0 ? 20 * 60 : minutesOfDay(endTime);
  const top = ((start - stripStart) / 30) * SLOT_HEIGHT;
  const height = Math.max(SLOT_HEIGHT / 2, ((end - start) / 30) * SLOT_HEIGHT);
  return { top, height };
}

function sessionBlock(item: CalendarItemDto): HTMLElement {
  const name = `${item.title}, ${item.startTime} to ${item.endTime}`;
  const geometry = blockGeometry(item.startTime, item.endTime);
  const block = el('div', {
    class: 'block',
    role: 'button',
    tabindex: '0',
    'aria-label': name,
    'data-session-id': item.id,
    'data-focus-key': `session:${item.id}`,
    style: `top: ${geometry.top}px; height: ${geometry.height}px`,
  });
  block.append(
    el('span', { class: 'block-title', text: item.title }),
    el('span', { class: 'block-time num', text: `${item.startTime} to ${item.endTime}` }),
  );

  const remove = el('button', {
    type: 'button',
    class: 'block-remove',
    'aria-label': `Remove ${item.title} from calendar`,
    'data-focus-key': `remove-session:${item.id}`,
  });
  remove.append(icon('x'));
  remove.addEventListener('click', (event) => {
    event.stopPropagation();
    void removeSession(item);
  });
  block.append(remove);

  block.addEventListener('keydown', (event) => onSessionKey(event, item));
  block.addEventListener('pointerdown', (event) => onSessionPointerDown(event, item, block));
  return block;
}

function flatBlock(item: CalendarItemDto): HTMLElement {
  const label =
    item.kind === 'meeting'
      ? `Meeting: ${item.title}, ${item.startTime} to ${item.endTime}`
      : `${item.title}, ${item.startTime} to ${item.endTime}`;
  const geometry = blockGeometry(item.startTime, item.endTime);
  return el(
    'div',
    {
      class: `block block--${item.kind}`,
      role: 'group',
      'aria-label': label,
      style: `top: ${geometry.top}px; height: ${geometry.height}px`,
    },
    [
      el('span', { text: item.kind === 'meeting' ? `Meeting: ${item.title}` : item.title }),
      el('span', { class: 'block-time num', text: `${item.startTime} to ${item.endTime}` }),
    ],
  );
}

function calendarRegion(): HTMLElement {
  const date = state.stripDate ?? state.board?.today ?? '';
  const days = boardDays();
  const index = days.findIndex((day) => day.date === date);
  const region = el('section', { role: 'region', 'aria-label': 'Calendar', class: 'calendar' });

  const previous = el('button', { type: 'button', class: 'button', 'aria-label': 'Previous day' }, [
    icon('chevron-left'),
    'Previous day',
  ]);
  previous.disabled = index <= 0;
  previous.addEventListener('click', () => stepStripDay(-1));

  const next = el('button', { type: 'button', class: 'button', 'aria-label': 'Next day' }, [
    'Next day',
    icon('chevron-right'),
  ]);
  next.disabled = index >= days.length - 1;
  next.addEventListener('click', () => stepStripDay(1));

  region.append(
    el('div', { class: 'region-heading' }, [el('h2', { text: dayLabel(date) })]),
    el('div', { class: 'calendar-controls' }, [previous, next]),
  );
  if (state.step === 'timebox') {
    region.append(
      el('p', { class: 'card-secondary', text: 'Drop a card on a slot to timebox it on this day.' }),
    );
  }

  const strip = el('div', { class: 'strip' });
  for (const time of SLOT_TIMES) {
    const slot = el('div', {
      class: `slot${drag?.target?.kind === 'slot' && drag.target.startTime === time ? ' is-target' : ''}`,
      'data-slot': time,
      'data-drop': 'slot',
      'data-hour': time.endsWith(':00') ? 'true' : 'false',
    });
    slot.append(el('span', { class: 'slot-label num', text: time }));
    slot.addEventListener('pointerenter', () => setPointerTarget({ kind: 'slot', date, startTime: time }));
    strip.append(slot);
  }

  const blocks = el('div', { class: 'blocks' });
  for (const item of calendarItems(date)) {
    blocks.append(item.kind === 'session' ? sessionBlock(item) : flatBlock(item));
  }
  strip.append(blocks);
  region.append(strip);
  return region;
}

function stepStripDay(direction: number): void {
  const days = boardDays();
  const index = days.findIndex((day) => day.date === state.stripDate);
  const nextIndex = Math.min(days.length - 1, Math.max(0, index + direction));
  const day = days[nextIndex];
  if (!day) return;
  state.stripDate = day.date;
  if (drag && drag.target?.kind === 'slot') {
    drag.target = { kind: 'slot', date: day.date, startTime: drag.target.startTime };
  }
  rerender();
}

/* --------------------------- drag and keyboard --------------------------- */

const KEYBOARD_COLUMNS = (): DropTarget[] => [
  { kind: 'backlog' },
  ...boardDays().map((day): DropTarget => ({ kind: 'day', date: day.date })),
  { kind: 'slot', date: state.stripDate ?? '', startTime: '09:00' },
];

function targetOf(task: TaskDto): DropTarget {
  return task.dayDate === null ? { kind: 'backlog' } : { kind: 'day', date: task.dayDate };
}

function paintDragState(): void {
  for (const column of document.querySelectorAll<HTMLElement>('[data-drop="day"]')) {
    const date = column.dataset.date ?? '';
    const day = dayOf(date);
    if (!day) continue;
    column.classList.toggle('is-target', isDragTarget(date));
    const fresh = gaugeFor(day);
    const existing = column.querySelector('.gauge');
    existing?.replaceWith(fresh);
  }
  for (const slot of document.querySelectorAll<HTMLElement>('[data-drop="slot"]')) {
    const time = slot.dataset.slot ?? '';
    slot.classList.toggle(
      'is-target',
      drag?.target?.kind === 'slot' && drag.target.startTime === time,
    );
  }
  for (const card of document.querySelectorAll<HTMLElement>('[data-task-id]')) {
    card.classList.toggle('is-dragging', card.dataset.taskId === drag?.taskId);
  }
}

function setPointerTarget(target: DropTarget): void {
  if (!drag || drag.mode !== 'pointer') return;
  drag.target = target;
  paintDragState();
}

function announceKeyboardTarget(): void {
  const task = heldTask();
  if (!drag || !task || !drag.target) return;
  const target = drag.target;
  if (target.kind === 'backlog') {
    announce('Over Backlog.');
    return;
  }
  if (target.kind === 'slot') {
    announce(`Calendar slot ${target.startTime}.`);
    return;
  }
  const day = dayOf(target.date);
  if (!day) return;
  const limit = threshold();
  const projected = projectedMinutes(target.date, task);
  let copy = `Over ${day.label}: ${projected}m of ${limit}m.`;
  if (projected > limit) copy += ` Over by ${projected - limit}m.`;
  announce(copy);
}

function startKeyboardDrag(task: TaskDto): void {
  const columns = KEYBOARD_COLUMNS();
  const from = targetOf(task);
  const index = columns.findIndex(
    (candidate) =>
      candidate.kind === from.kind && (candidate.kind !== 'day' || candidate.date === (from.kind === 'day' ? from.date : '')),
  );
  const startSlot = task.session
    ? Math.max(0, SLOT_TIMES.indexOf(task.session.startTime))
    : SLOT_TIMES.indexOf('09:00');
  drag = {
    taskId: task.id,
    mode: 'keyboard',
    target: columns[Math.max(0, index)] ?? { kind: 'backlog' },
    columnIndex: Math.max(0, index),
    slotIndex: startSlot < 0 ? 0 : startSlot,
    floater: null,
    from,
  };
  paintDragState();
  announce(`Picked up ${task.title}. Use arrow keys to choose a place, Enter to drop, Escape to cancel.`);
}

function onCardKey(event: KeyboardEvent, task: TaskDto): void {
  if (event.key === ' ' || event.key === 'Spacebar') {
    event.preventDefault();
    if (drag?.mode === 'keyboard' && drag.taskId === task.id) {
      void dropHeldCard();
      return;
    }
    startKeyboardDrag(task);
    return;
  }
  if (!drag || drag.mode !== 'keyboard' || drag.taskId !== task.id) return;

  const columns = KEYBOARD_COLUMNS();
  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
    event.preventDefault();
    drag.columnIndex = Math.min(
      columns.length - 1,
      Math.max(0, drag.columnIndex + (event.key === 'ArrowRight' ? 1 : -1)),
    );
    const next = columns[drag.columnIndex]!;
    drag.target =
      next.kind === 'slot'
        ? { kind: 'slot', date: state.stripDate ?? '', startTime: SLOT_TIMES[drag.slotIndex] ?? '09:00' }
        : next;
    paintDragState();
    announceKeyboardTarget();
    return;
  }
  if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && drag.target?.kind === 'slot') {
    event.preventDefault();
    drag.slotIndex = Math.min(
      SLOT_TIMES.length - 1,
      Math.max(0, drag.slotIndex + (event.key === 'ArrowDown' ? 1 : -1)),
    );
    drag.target = {
      kind: 'slot',
      date: state.stripDate ?? '',
      startTime: SLOT_TIMES[drag.slotIndex] ?? '09:00',
    };
    paintDragState();
    announceKeyboardTarget();
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    void dropHeldCard();
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    cancelDrag(task);
  }
}

function cancelDrag(task: TaskDto): void {
  const from = drag?.from ?? targetOf(task);
  drag = null;
  paintDragState();
  announce(`Cancelled. ${task.title} stays in ${columnLabel(from)}.`);
}

function onPointerDown(event: PointerEvent, task: TaskDto, card: HTMLElement): void {
  const target = event.target;
  if (target instanceof HTMLElement && target.closest('input, label, .block-remove')) return;
  if (event.button !== 0 && event.pointerType === 'mouse') return;

  const startX = event.clientX;
  const startY = event.clientY;
  let lifted = false;
  let holdTimer = 0;

  const lift = (): void => {
    lifted = true;
    card.setPointerCapture(event.pointerId);
    drag = {
      taskId: task.id,
      mode: 'pointer',
      target: targetOf(task),
      columnIndex: 0,
      slotIndex: 0,
      floater: floaterFor(card, startX, startY),
      from: targetOf(task),
    };
    paintDragState();
  };

  if (event.pointerType === 'touch') {
    holdTimer = window.setTimeout(lift, 320);
  }

  const move = (moveEvent: PointerEvent): void => {
    const distance = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
    if (!lifted) {
      if (event.pointerType === 'touch') {
        if (distance > 12) window.clearTimeout(holdTimer);
        return;
      }
      if (distance < 5) return;
      lift();
    }
    moveEvent.preventDefault();
    if (drag?.floater) {
      drag.floater.style.left = `${moveEvent.clientX - 24}px`;
      drag.floater.style.top = `${moveEvent.clientY - 20}px`;
    }
    const under = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
    const dropZone = under instanceof Element ? under.closest<HTMLElement>('[data-drop]') : null;
    if (!dropZone) return;
    const kind = dropZone.dataset.drop;
    if (kind === 'backlog') setPointerTarget({ kind: 'backlog' });
    else if (kind === 'day') setPointerTarget({ kind: 'day', date: dropZone.dataset.date ?? '' });
    else if (kind === 'slot') {
      setPointerTarget({
        kind: 'slot',
        date: state.stripDate ?? '',
        startTime: dropZone.dataset.slot ?? '09:00',
      });
    }
  };

  const finish = (): void => {
    window.clearTimeout(holdTimer);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', abort);
    if (!lifted) return;
    void dropHeldCard();
  };

  const abort = (): void => {
    window.clearTimeout(holdTimer);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', abort);
    if (lifted) cancelDrag(task);
  };

  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', finish);
  window.addEventListener('pointercancel', abort);
}

function floaterFor(card: HTMLElement, x: number, y: number): HTMLElement {
  const floater = card.cloneNode(true) as HTMLElement;
  floater.classList.add('card-floater');
  floater.style.position = 'fixed';
  floater.style.pointerEvents = 'none';
  floater.style.zIndex = '40';
  floater.style.width = `${card.offsetWidth}px`;
  floater.style.left = `${x - 24}px`;
  floater.style.top = `${y - 20}px`;
  floater.style.opacity = '0.9';
  document.body.append(floater);
  return floater;
}

async function dropHeldCard(): Promise<void> {
  const current = drag;
  const task = heldTask();
  if (!current || !task) return;
  current.floater?.remove();
  const target = current.target;
  drag = null;
  if (!target) {
    paintDragState();
    return;
  }
  if (target.kind === 'slot') {
    await timeboxTask(task, target.date, target.startTime);
    return;
  }
  if (
    (target.kind === 'backlog' && task.dayDate === null) ||
    (target.kind === 'day' && task.dayDate === target.date)
  ) {
    paintDragState();
    return;
  }
  await moveCard(task, target);
}

/* -------------------------------- actions -------------------------------- */

function moveFailure(task: TaskDto, error: unknown, column: string): void {
  announce(`Couldn't move ${task.title}: ${reasonOf(error)}. It's back in ${column}.`);
}

async function setEstimate(task: TaskDto, minutes: number): Promise<void> {
  snapshotTotals();
  try {
    const result = await api.patchTask(task.id, { version: task.version, estimateMinutes: minutes });
    applyServerDays(result.days, result.task);
    replaceTask(result.task);
    rerender();
    announce(`${task.title}: ${minutes} minutes.`);
  } catch (error) {
    moveFailure(task, error, columnLabel(targetOf(task)));
    await refreshBoard();
    rerender();
  }
}

async function setDone(task: TaskDto, done: boolean): Promise<void> {
  snapshotTotals();
  try {
    const result = await api.patchTask(task.id, {
      version: task.version,
      status: done ? 'done' : 'open',
    });
    applyServerDays(result.days, result.task);
    replaceTask(result.task);
    rerender();
    announce(done ? `Marked ${task.title} done.` : `Reopened ${task.title}.`);
  } catch (error) {
    moveFailure(task, error, columnLabel(targetOf(task)));
    await refreshBoard();
    rerender();
  }
}

function replaceTask(fresh: TaskDto): void {
  const board = state.board;
  if (!board) return;
  const backlogIndex = board.backlog.findIndex((task) => task.id === fresh.id);
  if (backlogIndex >= 0) board.backlog[backlogIndex] = fresh;
  for (const day of board.days) {
    const index = day.tasks.findIndex((task) => task.id === fresh.id);
    if (index >= 0) day.tasks[index] = fresh;
  }
}

async function moveCard(task: TaskDto, target: DropTarget): Promise<void> {
  const previous = structuredClone(state.board);
  const from = columnLabel(targetOf(task));
  snapshotTotals();
  applyOptimisticMove(task.id, target);
  rerender();

  try {
    const result = await api.patchTask(task.id, {
      version: task.version,
      dayDate: target.kind === 'backlog' ? null : target.date,
      position: 0,
    });
    snapshotTotals();
    applyServerDays(result.days, result.task);
    replaceTask(result.task);
    await refreshCalendar();
    rerender();
    if (target.kind === 'backlog') {
      announce(`Moved ${task.title} to Backlog.`);
      return;
    }
    const day = dayOf(target.date);
    announce(
      `Moved ${task.title} to ${day?.label ?? target.date}. ${day?.label ?? target.date} is at ${day?.plannedMinutes ?? 0}m of ${threshold()}m.`,
    );
  } catch (error) {
    snapshotTotals();
    state.board = previous;
    rerender();
    markReturning(task.id);
    moveFailure(task, error, from);
  }
}

function markReturning(taskId: string): void {
  const card = document.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(taskId)}"]`);
  if (!card || prefersReducedMotion()) return;
  card.classList.add('is-returning');
  card.style.transform = 'translateY(-6px)';
  requestAnimationFrame(() => {
    card.style.transform = 'translateY(0)';
    window.setTimeout(() => card.classList.remove('is-returning'), 400);
  });
}

async function timeboxTask(task: TaskDto, date: string, startTime: string): Promise<void> {
  const previous = structuredClone(state.board);
  snapshotTotals();
  if (task.dayDate !== date) applyOptimisticMove(task.id, { kind: 'day', date });
  rerender();
  try {
    const result = await api.createSession({ taskId: task.id, date, startTime }, crypto.randomUUID());
    snapshotTotals();
    applyServerDays(result.days, result.task);
    replaceTask(result.task);
    state.stripDate = date;
    await refreshCalendar();
    rerender();
    announce(`Timeboxed ${task.title} at ${startTime}.`);
  } catch (error) {
    snapshotTotals();
    state.board = previous;
    rerender();
    markReturning(task.id);
    announce(`Couldn't timebox ${task.title}: ${reasonOf(error)}.`);
  }
}

async function refreshCalendar(): Promise<void> {
  const days = boardDays();
  const first = days[0]?.date;
  const last = days[days.length - 1]?.date;
  if (!first || !last) return;
  state.calendar = await api.calendar(first, last);
}

async function moveSession(item: CalendarItemDto, date: string, startTime: string): Promise<void> {
  try {
    const result = await api.patchSession(item.id, {
      version: item.version ?? 1,
      date,
      startTime,
    });
    snapshotTotals();
    applyServerDays(result.days, result.task);
    replaceTask(result.task);
    await refreshCalendar();
    rerender();
    announce(`Moved ${item.title} to ${startTime}.`);
  } catch (error) {
    await refreshCalendar();
    await refreshBoard();
    rerender();
    announce(`Couldn't move ${item.title}: ${reasonOf(error)}. Showing the latest time.`);
  }
}

async function removeSession(item: CalendarItemDto): Promise<void> {
  try {
    await api.deleteSession(item.id, item.version ?? 1);
    await refreshCalendar();
    await refreshBoard();
    rerender();
    announce(`Removed ${item.title} from the calendar.`);
  } catch (error) {
    await refreshCalendar();
    rerender();
    announce(`Couldn't remove ${item.title}: ${reasonOf(error)}.`);
  }
}

interface SessionDragState {
  item: CalendarItemDto;
  slotIndex: number;
}

let sessionDrag: SessionDragState | null = null;

function onSessionKey(event: KeyboardEvent, item: CalendarItemDto): void {
  if (event.key === ' ' || event.key === 'Spacebar') {
    event.preventDefault();
    if (sessionDrag && sessionDrag.item.id === item.id) {
      const slot = SLOT_TIMES[sessionDrag.slotIndex] ?? item.startTime;
      sessionDrag = null;
      void moveSession(item, state.stripDate ?? item.date, slot);
      return;
    }
    sessionDrag = { item, slotIndex: Math.max(0, SLOT_TIMES.indexOf(item.startTime)) };
    announce(`Picked up ${item.title}. Use arrow keys to choose a place, Enter to drop, Escape to cancel.`);
    return;
  }
  if (!sessionDrag || sessionDrag.item.id !== item.id) return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    sessionDrag.slotIndex = Math.min(
      SLOT_TIMES.length - 1,
      Math.max(0, sessionDrag.slotIndex + (event.key === 'ArrowDown' ? 1 : -1)),
    );
    announce(`Calendar slot ${SLOT_TIMES[sessionDrag.slotIndex]}.`);
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    const slot = SLOT_TIMES[sessionDrag.slotIndex] ?? item.startTime;
    sessionDrag = null;
    void moveSession(item, state.stripDate ?? item.date, slot);
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    sessionDrag = null;
    announce(`Cancelled. ${item.title} stays at ${item.startTime}.`);
  }
}

function onSessionPointerDown(event: PointerEvent, item: CalendarItemDto, block: HTMLElement): void {
  const origin = event.target;
  if (origin instanceof HTMLElement && origin.closest('.block-remove')) return;
  const startY = event.clientY;
  let lifted = false;
  let slot = item.startTime;

  const move = (moveEvent: PointerEvent): void => {
    if (!lifted && Math.abs(moveEvent.clientY - startY) < 5) return;
    if (!lifted) block.setPointerCapture(moveEvent.pointerId);
    lifted = true;
    moveEvent.preventDefault();
    block.style.opacity = '0.7';
    const under = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
    const zone = under instanceof Element ? under.closest<HTMLElement>('[data-slot]') : null;
    if (zone?.dataset.slot) {
      slot = zone.dataset.slot;
      for (const candidate of document.querySelectorAll<HTMLElement>('[data-slot]')) {
        candidate.classList.toggle('is-target', candidate.dataset.slot === slot);
      }
    }
  };

  const finish = (): void => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', finish);
    block.style.opacity = '';
    if (!lifted) return;
    void moveSession(item, state.stripDate ?? item.date, slot);
  };

  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', finish);
}

async function addTask(title: string): Promise<void> {
  snapshotTotals();
  try {
    const result = await api.createTask({ title });
    state.board?.backlog.unshift(result.task);
    applyServerDays(result.days);
    rerender();
    announce(`Added ${title} to the Backlog.`);
  } catch (error) {
    announce(error instanceof RequestFailed ? error.message : 'Something went wrong on our side. Nothing was changed.');
  }
}

async function activateStep(step: typeof state.step, opener: HTMLElement): Promise<void> {
  state.step = step;
  rerender();
  if (step === 'pull') {
    window.setTimeout(() => document.querySelector<HTMLElement>('[data-focus-key="add-task"]')?.focus(), 0);
    return;
  }
  if (step === 'check') {
    const over = boardDays().filter((day) => day.plannedMinutes > threshold()).length;
    announce(`${over} of 5 days are over your threshold.`);
    return;
  }
  if (step === 'shutdown') {
    await openShutdown(opener);
  }
}

/* -------------------------------- dialogs -------------------------------- */

function fileField(label: string, accept: string): { wrapper: HTMLElement; input: HTMLInputElement } {
  const id = `file-${Math.random().toString(36).slice(2, 8)}`;
  const input = el('input', { type: 'file', id, accept });
  return {
    wrapper: el('div', { class: 'field' }, [el('label', { for: id, text: label }), input]),
    input,
  };
}

function openTaskImport(opener: HTMLElement): void {
  const file = fileField('CSV export', '.csv,text/csv');
  const summary = el('p', { class: 'dialog-summary', hidden: true });
  const importButton = el('button', { type: 'button', class: 'button button--primary' }, ['Import']);
  const closeButton = el('button', { type: 'button', class: 'button' }, ['Close']);

  const handle = openDialog({
    label: 'Import tasks',
    heading: 'Import tasks',
    content: [file.wrapper, summary],
    actions: [importButton, closeButton],
    opener,
  });
  closeButton.addEventListener('click', () => handle.close());

  importButton.addEventListener('click', () => {
    const chosen = file.input.files?.[0];
    if (!chosen) {
      announce('Choose a CSV export first.');
      return;
    }
    pending(importButton, 'Importing…', 'Import');
    announce('Importing…');
    void chosen
      .text()
      .then((text) => {
        if (new TextEncoder().encode(text).length > 1_000_000) {
          throw new RequestFailed(413, {
            error: 'payload_too_large',
            message: 'That file is larger than 1,000,000 bytes.',
          });
        }
        return api.importTasks(text);
      })
      .then(async (result) => {
        const copy = importSummary(result);
        summary.hidden = false;
        summary.textContent = copy;
        announce(copy);
        pending(importButton, null, 'Import');
        await refreshBoard();
        rerenderKeepingDialog();
      })
      .catch((error: unknown) => {
        pending(importButton, null, 'Import');
        const copy = importErrorCopy(error, 'tasks');
        summary.hidden = false;
        summary.textContent = copy;
        announce(copy);
      });
  });
}

function openCalendarImport(opener: HTMLElement): void {
  const file = fileField('Calendar file (.ics)', '.ics,text/calendar');
  const summary = el('p', { class: 'dialog-summary', hidden: true });
  const importButton = el('button', { type: 'button', class: 'button button--primary' }, ['Import']);
  const closeButton = el('button', { type: 'button', class: 'button' }, ['Close']);

  const handle = openDialog({
    label: 'Import calendar',
    heading: 'Import calendar',
    content: [file.wrapper, summary],
    actions: [importButton, closeButton],
    opener,
  });
  closeButton.addEventListener('click', () => handle.close());

  importButton.addEventListener('click', () => {
    const chosen = file.input.files?.[0];
    if (!chosen) {
      announce('Choose a calendar file first.');
      return;
    }
    pending(importButton, 'Importing…', 'Import');
    announce('Importing…');
    void chosen
      .text()
      .then((text) => {
        if (new TextEncoder().encode(text).length > 1_000_000) {
          throw new RequestFailed(413, {
            error: 'payload_too_large',
            message: 'That file is larger than 1,000,000 bytes.',
          });
        }
        return api.importCalendar(text);
      })
      .then(async (result) => {
        const copy = calendarImportSummary(result);
        summary.hidden = false;
        summary.textContent = copy;
        announce(copy);
        pending(importButton, null, 'Import');
        await refreshBoard();
        rerenderKeepingDialog();
      })
      .catch((error: unknown) => {
        pending(importButton, null, 'Import');
        const copy = importErrorCopy(error, 'calendar');
        summary.hidden = false;
        summary.textContent = copy;
        announce(copy);
      });
  });
}

function importErrorCopy(error: unknown, kind: 'tasks' | 'calendar'): string {
  if (!(error instanceof RequestFailed)) return 'Something went wrong on our side. Nothing was changed.';
  if (error.status === 413) return 'That file is larger than 1,000,000 bytes.';
  if (error.code === 'not_a_task_export') {
    return "That file isn't a task export with external_id and title columns.";
  }
  if (error.code === 'too_many_rows') return 'That file has more than 2,000 rows.';
  if (error.code === 'not_a_calendar') return "That file isn't an iCalendar file.";
  void kind;
  return error.message;
}

/** Re-renders the board underneath an open dialog without disturbing the dialog. */
function rerenderKeepingDialog(): void {
  const openDialogs = [...document.querySelectorAll('dialog[open]')];
  const key = focusKeyOf(document.activeElement);
  for (const node of openDialogs) document.body.append(node);
  void render().then(() => {
    for (const node of openDialogs) document.body.append(node);
    if (openDialogs.length === 0) restoreFocus(key);
  });
}

async function openShutdown(opener: HTMLElement): Promise<void> {
  let preview;
  try {
    preview = await api.shutdownPreview();
  } catch {
    announce('Something went wrong on our side. Nothing was changed.');
    return;
  }
  const tomorrow = addDays(preview.date, 1);
  const list = (titles: { title: string }[]): HTMLElement =>
    el(
      'ul',
      { class: 'preview-list' },
      titles.map((entry) => el('li', { text: entry.title })),
    );

  const send = el('button', { type: 'button', class: 'button button--primary' }, ['Send shutdown']);
  const notYet = el('button', { type: 'button', class: 'button' }, ['Not yet']);
  const handle = openDialog({
    label: 'Shut down',
    heading: 'Shut down',
    content: [
      el('h3', { text: 'Done' }),
      list(preview.done),
      el('h3', { text: `Carry over to ${dayLabel(tomorrow)}` }),
      list(preview.carriedOver),
      el('h3', { text: 'Tomorrow starts with' }),
      el('p', {
        text: preview.tomorrowFirst
          ? `${preview.tomorrowFirst.title} at ${preview.tomorrowFirst.startTime}`
          : 'nothing scheduled',
      }),
    ],
    actions: [send, notYet],
    opener,
  });
  notYet.addEventListener('click', () => handle.close());

  send.addEventListener('click', () => {
    pending(send, 'Shutting down…', 'Send shutdown');
    announce('Shutting down…');
    void api
      .shutdown()
      .then(async (result) => {
        handle.close();
        const email = state.me?.member.email ?? '';
        const copy =
          result.digest === 'sent'
            ? `Day shut down. Digest sent to ${email}.`
            : result.digest === 'already_sent'
              ? "Day shut down. Today's digest was already sent."
              : 'Day shut down. Mail is unreachable, so your digest is queued and will send when it\u2019s back.';
        snapshotTotals();
        await refreshBoard();
        rerender();
        announce(copy);
      })
      .catch((error: unknown) => {
        pending(send, null, 'Send shutdown');
        announce(`Couldn't shut down: ${reasonOf(error)}.`);
      });
  });
}

/* ------------------------------- assembly ------------------------------- */

export async function renderDaybook(root: HTMLElement): Promise<void> {
  if (!state.board) await refreshBoard();
  const spread = el('div', { class: 'spread' }, [
    el('div', { class: 'gutter' }, [ritualRail(), backlogRegion()]),
    daysGrid(),
    calendarRegion(),
  ]);
  root.append(spread);
  previousTotals = new Map();
  layoutOpenDay();
}

/** At 375 the open day's cards sit below the row of gauges, so the row keeps its height. */
function layoutOpenDay(): void {
  const grid = document.querySelector<HTMLElement>('.days');
  if (!grid) return;
  grid.style.paddingBottom = '';
  if (!narrow() || state.openDay === null) return;
  const column = document.querySelector<HTMLElement>('.day-column.is-open');
  const list = column?.querySelector<HTMLElement>('.card-list');
  if (!column || !list) return;
  list.style.top = `${column.offsetHeight + 8}px`;
  grid.style.paddingBottom = `${list.offsetHeight + 16}px`;
}

let loopsStarted = false;

export function startDaybookLoops(): void {
  if (loopsStarted) return;
  loopsStarted = true;

  const refresh = (): void => {
    if (drag || document.querySelector('dialog[open]')) return;
    if (window.location.pathname !== '/' || !state.me || state.me.member.role === 'operator') return;
    void refreshBoard()
      .then(() => rerender())
      .catch(() => undefined);
  };

  window.addEventListener('focus', refresh);
  window.setInterval(refresh, 60_000);
  window.setInterval(() => {
    if (!state.board || !state.me) return;
    if (localToday() === state.board.today) return;
    refresh();
  }, 10_000);
}
