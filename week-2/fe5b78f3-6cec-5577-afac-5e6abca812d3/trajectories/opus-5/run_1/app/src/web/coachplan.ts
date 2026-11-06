import type { BerthCell, CoachPlan } from './api';
import { clear, h, svg } from './dom';
import { BERTH_STATE_TAG, POOL_LABEL, POSITION_WORD } from './format';

const CELL = 44;
const GAP = 1;
const TOP_STRIP = 20;
const BAYS = 9;
const BERTHS_PER_BAY = 8;

export interface BerthAnnotation {
  /** Extra name tags such as `preferred by passenger 2` or `CNF passenger 1`. */
  readonly tags: readonly string[];
  /** Set when this booking's own passenger holds the berth or an RAC place on it. */
  readonly hold: 'CNF' | 'RAC' | null;
}

export interface CoachPlanOptions {
  readonly vertical: boolean;
  readonly annotations: ReadonlyMap<string, BerthAnnotation>;
  readonly onPick: ((coach: string, cell: BerthCell) => void) | null;
  readonly note: boolean;
}

export function berthKey(coach: string, berth: number): string {
  return `${coach}/${berth}`;
}

/** The sleeper coach plan: nine bays of eight berths, drawn procedurally. */
export class CoachPlanView {
  readonly element: HTMLElement;
  private coaches: readonly CoachPlan[] = [];
  private selected = '';
  private focusedBerth = new Map<string, number>();
  private options: CoachPlanOptions;
  private readonly tablist: HTMLElement;
  private readonly body: HTMLElement;

  constructor(options: CoachPlanOptions) {
    this.options = options;
    this.tablist = h('div', { role: 'tablist', 'aria-label': 'Coaches', class: 'tablist' });
    this.body = h('div');
    this.element = h('div', { class: 'plan-wrap' }, [
      this.tablist,
      this.body,
      options.note
        ? h('p', { class: 'plan-note' }, [
          'Preferences guide allotment. The exact berth is allotted when you pay.',
        ])
        : null,
    ]);
  }

  setOptions(options: CoachPlanOptions): void {
    this.options = options;
    this.render();
  }

  setCoaches(coaches: readonly CoachPlan[], keepSelection = true): void {
    this.coaches = coaches;
    if (!keepSelection || !coaches.some((coach) => coach.coach === this.selected)) {
      this.selected = coaches[0]?.coach ?? '';
    }
    this.render();
  }

  get selectedCoach(): string {
    return this.selected;
  }

  showCoach(coach: string): void {
    if (!this.coaches.some((entry) => entry.coach === coach)) return;
    this.selected = coach;
    this.render();
  }

  focusBerth(coach: string, berth: number): void {
    this.showCoach(coach);
    this.focusedBerth.set(coach, berth);
    this.render();
    this.currentButton()?.focus();
  }

  private currentButton(): HTMLButtonElement | null {
    return this.body.querySelector<HTMLButtonElement>('button[tabindex="0"]');
  }

  private render(): void {
    clear(this.tablist);
    for (const coach of this.coaches) {
      const selected = coach.coach === this.selected;
      const tab = h('button', {
        type: 'button',
        role: 'tab',
        class: 'tab',
        'aria-selected': selected ? 'true' : 'false',
        tabindex: selected ? '0' : '-1',
      }, [coach.coach]);
      tab.addEventListener('click', () => {
        this.selected = coach.coach;
        this.render();
      });
      this.tablist.appendChild(tab);
    }

    clear(this.body);
    const plan = this.coaches.find((coach) => coach.coach === this.selected);
    if (plan === undefined) return;
    const vertical = this.options.vertical;
    const focused = this.focusedBerth.get(plan.coach) ?? 1;
    const grid = h('div', { class: 'plan__grid' });
    for (const cell of orderedCells(plan.berths, vertical)) {
      grid.appendChild(this.berthButton(plan.coach, cell, cell.berth === focused));
    }
    const frame = h('div', {
      class: `plan plan--${vertical ? 'v' : 'h'}`,
      role: 'group',
      'aria-label': `Coach plan ${plan.coach}`,
    }, [this.drawing(plan.coach, vertical), grid]);
    frame.addEventListener('keydown', (event) => this.onKeyDown(event, plan));
    this.body.appendChild(frame);
  }

  private drawing(coach: string, vertical: boolean): SVGElement {
    const children: SVGElement[] = [
      svg('line', {
        x1: 0, y1: TOP_STRIP - 6, x2: '100%', y2: TOP_STRIP - 6, stroke: 'var(--rule)',
      }),
      svg('text', {
        x: 4, y: 12, class: 'mono', 'font-size': 11, fill: 'var(--ink)', 'font-weight': 700,
      }, [coach]),
    ];
    for (let bay = 1; bay <= BAYS; bay += 1) {
      const offset = (bay - 1) * (CELL + GAP);
      children.push(svg('text', {
        x: vertical ? 4 : 42 + offset + CELL / 2,
        y: vertical ? TOP_STRIP + offset + CELL / 2 : 12,
        'font-size': 9,
        fill: 'var(--ink-soft)',
        'text-anchor': 'middle',
      }, [String(bay)]));
    }
    if (!vertical) {
      children.push(svg('line', {
        x1: 0,
        y1: TOP_STRIP + 6 * (CELL + GAP) - 1,
        x2: '100%',
        y2: TOP_STRIP + 6 * (CELL + GAP) - 1,
        stroke: 'var(--rule)',
        'stroke-dasharray': '3 3',
      }));
    }
    return svg('svg', { class: 'plan__drawing', 'aria-hidden': 'true' }, children);
  }

  private berthButton(coach: string, cell: BerthCell, focused: boolean): HTMLButtonElement {
    const annotation = this.options.annotations.get(berthKey(coach, cell.berth));
    const tags = [POOL_LABEL[cell.quota] ?? cell.quota, BERTH_STATE_TAG[cell.state]];
    for (const tag of annotation?.tags ?? []) tags.push(tag);
    const name = `Berth ${coach} ${cell.berth} ${POSITION_WORD[cell.type]}, ${tags.join(', ')}`;
    const classes = ['berth', annotation?.hold === 'CNF' ? 'berth--cnf' : stateClass(cell)];
    if (annotation?.hold != null) classes.push('berth--mine');
    const button = h('button', {
      type: 'button',
      class: classes.join(' '),
      'aria-label': name,
      tabindex: focused ? '0' : '-1',
      'data-berth': String(cell.berth),
      'data-coach': coach,
    }, [
      h('span', { class: 'berth__no', 'aria-hidden': 'true' }, [String(cell.berth)]),
      h('span', { class: 'berth__pos', 'aria-hidden': 'true' }, [cell.type]),
      annotation?.hold === 'CNF'
        ? h('span', { class: 'berth__stamp', 'aria-hidden': 'true' }, ['CNF'])
        : null,
    ]);
    button.addEventListener('focus', () => {
      this.focusedBerth.set(coach, cell.berth);
      for (const other of this.body.querySelectorAll('button[data-berth]')) {
        other.setAttribute('tabindex', other === button ? '0' : '-1');
      }
    });
    button.addEventListener('click', () => this.options.onPick?.(coach, cell));
    return button;
  }

  private onKeyDown(event: KeyboardEvent, plan: CoachPlan): void {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement) || target.dataset.berth === undefined) return;
    const berth = Number(target.dataset.berth);
    const bay = Math.ceil(berth / BERTHS_PER_BAY);
    const within = berth - (bay - 1) * BERTHS_PER_BAY;
    const vertical = this.options.vertical;
    let next: number | null = null;

    const stepBay = (delta: number): number | null => {
      const target2 = bay + delta;
      return target2 >= 1 && target2 <= BAYS ? (target2 - 1) * BERTHS_PER_BAY + within : null;
    };
    const stepWithin = (delta: number): number | null => {
      const target2 = within + delta;
      return target2 >= 1 && target2 <= BERTHS_PER_BAY
        ? (bay - 1) * BERTHS_PER_BAY + target2
        : null;
    };

    switch (event.key) {
      case 'ArrowLeft':
        next = vertical ? stepWithin(-1) : stepBay(-1);
        break;
      case 'ArrowRight':
        next = vertical ? stepWithin(1) : stepBay(1);
        break;
      case 'ArrowUp':
        next = vertical ? stepBay(-1) : stepWithin(-1);
        break;
      case 'ArrowDown':
        next = vertical ? stepBay(1) : stepWithin(1);
        break;
      case 'Home':
        next = within;
        break;
      case 'End':
        next = (BAYS - 1) * BERTHS_PER_BAY + within;
        break;
      case 'PageUp':
      case 'PageDown': {
        event.preventDefault();
        const index = this.coaches.findIndex((coach) => coach.coach === plan.coach);
        const target2 = index + (event.key === 'PageUp' ? -1 : 1);
        if (target2 < 0 || target2 >= this.coaches.length) return;
        this.focusBerth(this.coaches[target2].coach, berth);
        return;
      }
      case 'Enter':
      case ' ': {
        event.preventDefault();
        const cell = plan.berths.find((entry) => entry.berth === berth);
        if (cell !== undefined) this.options.onPick?.(plan.coach, cell);
        return;
      }
      default:
        return;
    }
    event.preventDefault();
    if (next === null) return;
    const button = this.body.querySelector<HTMLButtonElement>(`button[data-berth="${next}"]`);
    button?.focus();
  }
}

function stateClass(cell: BerthCell): string {
  switch (cell.state) {
    case 'free':
      return 'berth--free';
    case 'taken':
      return 'berth--taken';
    case 'rac_free':
      return 'berth--free';
    case 'rac_one_free':
      return 'berth--rac';
    default:
      return 'berth--rac-full';
  }
}

/**
 * Horizontal: each bay is a column, filled down the bay order. Vertical: each bay is a row.
 * Both walk the same bay order, so the DOM order matches the drawing.
 */
function orderedCells(berths: readonly BerthCell[], vertical: boolean): BerthCell[] {
  const byNumber = [...berths].sort((a, b) => a.berth - b.berth);
  if (vertical) return byNumber;
  const columns: BerthCell[] = [];
  for (let bay = 1; bay <= BAYS; bay += 1) {
    for (let within = 1; within <= BERTHS_PER_BAY; within += 1) {
      const cell = byNumber[(bay - 1) * BERTHS_PER_BAY + within - 1];
      if (cell !== undefined) columns.push(cell);
    }
  }
  return columns;
}

export function annotateBooking(
  passengers: readonly {
    number: number;
    current_status: { status: string; coach: string | null; berth: number | null };
  }[],
): Map<string, BerthAnnotation> {
  const map = new Map<string, BerthAnnotation>();
  for (const passenger of passengers) {
    const status = passenger.current_status;
    if (status.coach === null || status.berth === null) continue;
    if (status.status !== 'CNF' && status.status !== 'RAC') continue;
    const key = berthKey(status.coach, status.berth);
    const existing = map.get(key);
    map.set(key, {
      tags: [...(existing?.tags ?? []), `${status.status} passenger ${passenger.number}`],
      hold: existing?.hold === 'CNF' ? 'CNF' : (status.status as 'CNF' | 'RAC'),
    });
  }
  return map;
}
