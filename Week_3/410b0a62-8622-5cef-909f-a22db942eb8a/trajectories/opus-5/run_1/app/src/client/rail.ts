import { el, onDragToDay, prefersReducedMotion } from './dom.js';
import {
  complianceLabel,
  dataNumber,
  formatDay,
  formatDuration,
  formatMonday,
  formatTsb,
  formatTss,
  itemDurationS,
  itemTitle,
  itemTss,
  itemWorkoutId,
} from './format.js';
import { addDays, isoWeekday, mondayOfWeek } from '../domain/time.js';
import type { Item, WeekView } from '../domain/types.js';

const SLIDE_MS = 420;
const TILE_GAP = 24;
const SWIPE_MIN_PX = 40;

export interface RailCallbacks {
  onCentreChange(week: string, announceText: string): void;
  onLoadMore(edge: 'earlier' | 'later'): void;
  onLogSession(date: string): void;
  onPlan(date: string): void;
  onMove(workoutId: string, title: string, toDate: string): void;
}

export interface RailHandle {
  element: HTMLElement;
  update(weeks: WeekView[], centre: string): void;
  announceCalendar(text: string): void;
}

export function createRail(callbacks: RailCallbacks): RailHandle {
  const track = el('div', { class: 'rail-track' });
  const dots = el('div', { class: 'rail-dots' });
  const weekStatus = el('p', {
    class: 'visually-hidden',
    attrs: { role: 'status', 'aria-live': 'polite', 'aria-label': 'Week announcements' },
  });
  const calendarStatus = el('p', {
    class: 'visually-hidden',
    attrs: { role: 'status', 'aria-live': 'polite', 'aria-label': 'Calendar announcements' },
  });

  const previous = el('button', {
    class: 'pill rail-arrow',
    text: 'Previous week',
    attrs: { type: 'button' },
    on: { click: () => advance(-1) },
  });
  const next = el('button', {
    class: 'pill rail-arrow',
    text: 'Next week',
    attrs: { type: 'button' },
    on: { click: () => advance(1) },
  });
  const loadEarlier = el('button', {
    class: 'pill pill-quiet',
    text: 'Load earlier weeks',
    attrs: { type: 'button' },
    on: { click: () => callbacks.onLoadMore('earlier') },
  });
  const loadLater = el('button', {
    class: 'pill pill-quiet',
    text: 'Load later weeks',
    attrs: { type: 'button' },
    on: { click: () => callbacks.onLoadMore('later') },
  });

  const element = el('section', {
    class: 'rail',
    attrs: { role: 'region', 'aria-label': 'Week rail', tabindex: '0', 'data-moving': 'false' },
    children: [
      el('div', { class: 'rail-viewport', children: [track] }),
      el('div', {
        class: 'rail-controls',
        children: [loadEarlier, previous, dots, next, loadLater],
      }),
      weekStatus,
      calendarStatus,
    ],
  });

  let weeks: WeekView[] = [];
  let centre = '';
  let moving = 0;

  function weekAnnouncement(week: WeekView): string {
    return `Week of ${formatMonday(week.monday)}: planned ${formatTss(
      week.planned_tss,
    )}, completed ${formatTss(week.completed_tss)}, form ${formatTsb(week.tsb)}`;
  }

  function centreIndex(): number {
    return weeks.findIndex((week) => week.week === centre);
  }

  function layout(animate: boolean): void {
    const index = centreIndex();
    const tile = track.children[index] as HTMLElement | undefined;
    if (!tile) return;
    const width = tile.offsetWidth;
    const offset = element.clientWidth / 2 - (index * (width + TILE_GAP) + width / 2);
    track.style.transition = animate ? `transform ${SLIDE_MS}ms cubic-bezier(0.2, 0.9, 0.2, 1)` : 'none';
    track.style.transform = `translateX(${offset}px)`;
  }

  function advance(direction: -1 | 1): void {
    const index = centreIndex();
    const target = index + direction;
    if (target < 0 || target >= weeks.length) return;
    const week = weeks[target] as WeekView;
    centre = week.week;
    const reduced = prefersReducedMotion();
    render();
    layout(!reduced);
    if (!reduced) {
      element.setAttribute('data-moving', 'true');
      window.clearTimeout(moving);
      moving = window.setTimeout(() => element.setAttribute('data-moving', 'false'), SLIDE_MS);
    }
    weekStatus.textContent = weekAnnouncement(week);
    callbacks.onCentreChange(week.week, weekAnnouncement(week));
  }

  function goTo(week: string): void {
    const index = weeks.findIndex((candidate) => candidate.week === week);
    const current = centreIndex();
    if (index === -1 || index === current) return;
    advance(index > current ? 1 : -1);
  }

  element.addEventListener('keydown', (event) => {
    const keyboard = event as KeyboardEvent;
    if (keyboard.target !== element) return;
    if (keyboard.key === 'ArrowLeft') {
      keyboard.preventDefault();
      advance(-1);
    } else if (keyboard.key === 'ArrowRight') {
      keyboard.preventDefault();
      advance(1);
    }
  });

  let swipeStart: { x: number; y: number } | null = null;
  track.addEventListener('pointerdown', (event) => {
    const pointer = event as PointerEvent;
    if ((pointer.target as HTMLElement).closest('button, a, .calendar-item')) return;
    swipeStart = { x: pointer.clientX, y: pointer.clientY };
  });
  track.addEventListener('pointerup', (event) => {
    if (!swipeStart) return;
    const pointer = event as PointerEvent;
    const dx = pointer.clientX - swipeStart.x;
    swipeStart = null;
    if (Math.abs(dx) < SWIPE_MIN_PX) return;
    advance(dx < 0 ? 1 : -1);
  });

  window.addEventListener('resize', () => layout(false));
  new ResizeObserver(() => layout(false)).observe(element);

  let pickedUp: { workoutId: string; title: string; date: string } | null = null;

  function dayChip(date: string, items: Item[], active: boolean): HTMLElement {
    const list = el('ul', { class: 'day-items' });
    for (const item of items) {
      list.append(calendarItem(item, active));
    }
    return el('div', {
      class: 'day-chip',
      attrs: { role: 'group', 'aria-label': formatDay(date), 'data-date': date },
      children: [
        el('p', { class: 'day-label', text: formatDay(date) }),
        list,
        el('div', {
          class: 'day-actions',
          children: [
            el('button', {
              class: 'pill pill-small',
              text: `Log session on ${formatDay(date)}`,
              attrs: { type: 'button' },
              on: { click: () => callbacks.onLogSession(date) },
            }),
            el('button', {
              class: 'pill pill-small',
              text: `Plan on ${formatDay(date)}`,
              attrs: { type: 'button' },
              on: { click: () => callbacks.onPlan(date) },
            }),
          ],
        }),
      ],
    });
  }

  function calendarItem(item: Item, active: boolean): HTMLElement {
    const title = itemTitle(item);
    const movable = item.planned !== null && item.completed === null;
    const children: HTMLElement[] = [
      el('a', {
        class: 'item-link',
        text: title,
        attrs: { href: `/workouts/${itemWorkoutId(item)}` },
      }),
      el('span', { class: 'item-label', text: complianceLabel(item.compliance) }),
      el('span', {
        class: 'item-numbers',
        text: `${formatTss(itemTss(item) ?? 0)} TSS · ${formatDuration(itemDurationS(item))}`,
      }),
    ];
    if (movable && active) children.push(moveButton(item, title));
    const node = el('li', {
      class: `calendar-item compliance-${item.compliance}`,
      attrs: {
        'data-compliance': item.compliance,
        'data-planned-tss': item.planned?.planned_tss !== null && item.planned !== null
          ? dataNumber(item.planned.planned_tss as number, 1)
          : null,
        'data-completed-tss':
          item.completed?.tss !== null && item.completed !== null
            ? dataNumber(item.completed.tss as number, 1)
            : null,
        'data-tss': dataNumber(itemTss(item) ?? 0, 1),
        'data-duration-s': String(itemDurationS(item)),
        'data-sport': (item.completed ?? item.planned)?.sport ?? '',
        'data-workout-id': itemWorkoutId(item),
      },
      children,
    });
    if (movable) {
      onDragToDay(node, (date) => callbacks.onMove(item.planned?.id as string, title, date));
    }
    return node;
  }

  function moveButton(item: Item, title: string): HTMLElement {
    const button = el('button', {
      class: 'pill pill-small move-button',
      text: `Move ${title}`,
      attrs: { type: 'button' },
    });
    button.addEventListener('keydown', (event) => {
      const keyboard = event as KeyboardEvent;
      const workoutId = item.planned?.id as string;
      const monday = mondayOfWeek(centre);
      if (keyboard.key === 'Enter' || keyboard.key === ' ') {
        keyboard.preventDefault();
        if (!pickedUp) {
          pickedUp = { workoutId, title, date: item.planned?.date as string };
          calendarStatus.textContent = `Picked up ${title}. Use the arrow keys to choose a day, then press Enter to drop or Escape to cancel.`;
          return;
        }
        const target = pickedUp.date;
        pickedUp = null;
        callbacks.onMove(workoutId, title, target);
        return;
      }
      if (!pickedUp) return;
      if (keyboard.key === 'Escape') {
        keyboard.preventDefault();
        pickedUp = null;
        calendarStatus.textContent = `Move of ${title} cancelled.`;
        return;
      }
      if (keyboard.key === 'ArrowLeft' || keyboard.key === 'ArrowRight') {
        keyboard.preventDefault();
        const step = keyboard.key === 'ArrowLeft' ? -1 : 1;
        const index = isoWeekday(pickedUp.date) - 1 + step;
        if (index < 0 || index > 6) {
          calendarStatus.textContent = formatDay(pickedUp.date);
          return;
        }
        pickedUp.date = addDays(monday, index);
        calendarStatus.textContent = formatDay(pickedUp.date);
      }
    });
    return button;
  }

  function weekTile(week: WeekView): HTMLElement {
    const active = week.week === centre;
    const chips = el('div', { class: 'day-chips' });
    for (const day of week.days) chips.append(dayChip(day.date, day.items, active));
    return el('article', {
      class: `week-tile${active ? ' week-tile-active' : ''}`,
      attrs: {
        role: 'group',
        'aria-label': `Week of ${formatMonday(week.monday)}`,
        'data-week': week.week,
        'data-active': active ? 'true' : 'false',
        'data-planned-tss': dataNumber(week.planned_tss, 1),
        'data-completed-tss': dataNumber(week.completed_tss, 1),
        'data-tsb': dataNumber(week.tsb, 1),
      },
      children: [
        el('header', {
          class: 'week-head',
          children: [
            el('h3', { class: 'week-monday', text: formatMonday(week.monday) }),
            el('div', {
              class: 'week-totals',
              children: [
                el('p', { class: 'week-total', text: `Planned ${formatTss(week.planned_tss)} TSS` }),
                el('p', {
                  class: 'week-total',
                  text: `Completed ${formatTss(week.completed_tss)} TSS`,
                }),
                el('p', { class: 'pill pill-form', text: `Form ${formatTsb(week.tsb)}` }),
              ],
            }),
            el('p', {
              class: 'week-tally',
              attrs: {
                'data-count-on-target': String(week.tally['on-target']),
                'data-count-close': String(week.tally.close),
                'data-count-off-target': String(week.tally['off-target']),
                'data-count-missed': String(week.tally.missed),
                'data-count-unplanned': String(week.tally.unplanned),
                'data-count-planned': String(week.tally.planned),
              },
              text:
                `On target ${week.tally['on-target']} · Close ${week.tally.close} · ` +
                `Off target ${week.tally['off-target']} · Missed ${week.tally.missed} · ` +
                `Unplanned ${week.tally.unplanned} · Planned ${week.tally.planned}`,
            }),
          ],
        }),
        chips,
      ],
    });
  }

  function render(): void {
    element.setAttribute('data-week', centre);
    track.replaceChildren(...weeks.map((week) => weekTile(week)));
    const index = centreIndex();
    previous.toggleAttribute('disabled', index <= 0);
    next.toggleAttribute('disabled', index >= weeks.length - 1);
    dots.replaceChildren(
      ...weeks.map((week) =>
        el('button', {
          class: `rail-dot${week.week === centre ? ' rail-dot-active' : ''}`,
          attrs: {
            type: 'button',
            'aria-label': `Week of ${formatMonday(week.monday)}`,
            'aria-current': week.week === centre ? 'true' : null,
          },
          on: { click: () => goTo(week.week) },
        }),
      ),
    );
  }

  return {
    element,
    update(nextWeeks, nextCentre) {
      weeks = nextWeeks;
      centre = nextCentre;
      render();
      layout(false);
    },
    announceCalendar(text) {
      calendarStatus.textContent = text;
    },
  };
}
