import { append, clear, h } from './dom.js';
import { bus } from './bus.js';
import { state } from './state.js';
import { openWorkloadDay } from './dialogs.js';
import { formatHours } from '../shared/hours.js';
import { addDays, longDate, shortDate } from '../shared/dates.js';

export function renderWorkload(container: HTMLElement): void {
  clear(container);
  const workload = state.workload;
  if (!workload) return;

  const previous = h('button', {
    type: 'button',
    text: 'Previous two weeks',
    'data-focus-key': 'wl-prev',
  });
  const next = h('button', { type: 'button', text: 'Next two weeks', 'data-focus-key': 'wl-next' });
  previous.addEventListener('click', () => {
    state.workloadFrom = addDays(state.workloadFrom, -14);
    bus.reloadWorkload();
  });
  next.addEventListener('click', () => {
    state.workloadFrom = addDays(state.workloadFrom, 14);
    bus.reloadWorkload();
  });

  const grid = h('div', { role: 'grid', 'aria-label': 'Workload', class: 'grid workload' });
  grid.appendChild(
    h('div', { role: 'row', class: 'grid-head' }, [
      h('div', { role: 'columnheader', text: 'Person' }),
      ...workload.days.map((date) => h('div', { role: 'columnheader', text: shortDate(date) })),
      h('div', { role: 'columnheader', text: 'Over-allocated days' }),
    ]),
  );

  const active = state.activeWorkloadCell;
  workload.people.forEach((person, personIndex) => {
    const row = h('div', { role: 'row', class: 'grid-row' }, [
      h('div', { role: 'rowheader', text: person.name, class: 'person' }),
    ]);
    person.days.forEach((day, dayIndex) => {
      const isActive = active.person === personIndex && active.day === dayIndex;
      const label =
        `${person.name}, ${longDate(day.date)}: ${formatHours(day.hours)} of ${formatHours(person.capacity)} hours` +
        (day.over ? ', over-allocated' : '');
      const cell = h('div', {
        role: 'gridcell',
        class: `cell day-cell${day.over ? ' over' : ''}`,
        'data-date': day.date,
        'data-hours': formatHours(day.hours),
        'data-over': day.over ? 'true' : 'false',
        'aria-label': label,
        tabindex: isActive ? '0' : '-1',
        'data-focus-key': `wl:${personIndex}:${dayIndex}`,
        'data-person': String(personIndex),
        'data-day': String(dayIndex),
        text: day.hours === 0 ? '' : formatHours(day.hours),
      });
      row.appendChild(cell);
    });
    row.appendChild(h('div', { role: 'gridcell', class: 'cell over-count', text: String(person.overDays) }));
    grid.appendChild(row);
  });

  grid.addEventListener('keydown', (event) => {
    const cell = (event.target as HTMLElement).closest<HTMLElement>('.day-cell');
    if (!cell) return;
    const personIndex = Number(cell.dataset.person);
    const dayIndex = Number(cell.dataset.day);
    const people = workload.people.length;
    const days = workload.days.length;
    if (event.key === 'Enter') {
      event.preventDefault();
      openWorkloadDay(workload.people[personIndex], workload.people[personIndex].days[dayIndex], cell);
      return;
    }
    const steps: Record<string, [number, number]> = {
      ArrowRight: [0, 1],
      ArrowLeft: [0, -1],
      ArrowDown: [1, 0],
      ArrowUp: [-1, 0],
    };
    const step = steps[event.key];
    if (!step) return;
    event.preventDefault();
    state.activeWorkloadCell = {
      person: Math.min(Math.max(personIndex + step[0], 0), people - 1),
      day: Math.min(Math.max(dayIndex + step[1], 0), days - 1),
    };
    bus.update();
  });

  grid.addEventListener('click', (event) => {
    const cell = (event.target as HTMLElement).closest<HTMLElement>('.day-cell');
    if (!cell) return;
    state.activeWorkloadCell = { person: Number(cell.dataset.person), day: Number(cell.dataset.day) };
    bus.update();
    document
      .querySelector<HTMLElement>(
        `[data-focus-key="wl:${state.activeWorkloadCell.person}:${state.activeWorkloadCell.day}"]`,
      )
      ?.focus();
  });

  append(container, [
    h('div', { class: 'row' }, [previous, next]),
    h('div', { class: 'grid-region', 'data-scroll': '' }, [grid]),
  ]);
}
