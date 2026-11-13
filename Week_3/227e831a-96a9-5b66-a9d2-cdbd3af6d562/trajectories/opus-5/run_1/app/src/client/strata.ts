import { CATEGORY_ORDER, type Category } from '../shared/categories.js';
import type { Profile, TripList } from '../shared/types.js';
import { formatGrams } from '../shared/weights.js';
import { el, prefersReducedMotion } from './dom.js';

const CHIP_MS = 320;
const GROW_MS = 240;
const COUNT_MS = 400;
const STEP_GAP_MS = 30;
const OVER_GOAL_CAP = 1.25;

export interface ChipInfo {
  name: string;
  weightGrams: number;
  from: DOMRect;
  category: Category;
}

export type StrataMode = 'pack' | 'unpack' | 'change' | 'none';

interface BandTarget {
  category: Category;
  baseGrams: number;
  label: string;
}

export interface StrataHooks {
  countBase: (from: number, to: number, ms: number) => void;
  setBase: (grams: number) => void;
}

/** Pack Strata: one band per category with base weight, scaled to the goal. */
export class Strata {
  readonly region: HTMLElement;
  private readonly column: HTMLElement;
  private readonly stack: HTMLElement;
  private readonly goalLine: HTMLElement;
  private readonly chevron: HTMLElement;
  private readonly wornColumn: HTMLElement;
  private readonly consumableColumn: HTMLElement;
  private readonly bands = new Map<Category, HTMLElement>();
  private collapsed = false;
  private sequence = 0;
  private baseGrams = 0;
  private hooks: StrataHooks = { countBase: () => {}, setBase: () => {} };

  constructor() {
    this.stack = el('ul', { class: 'stack', role: 'list', 'aria-label': 'Base weight by category' });
    this.goalLine = el('div', { class: 'goal-line', role: 'img', 'aria-label': 'Goal' });
    this.chevron = el('div', { class: 'chevron', role: 'img', 'aria-label': 'Over goal' }, ['\u25b2']);
    this.wornColumn = el('div', {
      class: 'side worn',
      role: 'img',
      tabindex: '0',
      'aria-label': 'Worn',
    });
    this.consumableColumn = el('div', {
      class: 'side consumable',
      role: 'img',
      tabindex: '0',
      'aria-label': 'Consumable',
    });
    this.column = el('div', { class: 'strata-column' }, [
      el('div', { class: 'stack-holder' }, [this.stack, this.chevron]),
      this.goalLine,
      el('div', { class: 'sides' }, [this.wornColumn, this.consumableColumn]),
    ]);
    this.region = el('section', { class: 'strata', role: 'region', 'aria-label': 'Pack Strata' }, [
      this.column,
    ]);
  }

  setHooks(hooks: StrataHooks): void {
    this.hooks = hooks;
  }

  /** Below 768 px a collapsed strip has no band or side column in the page at all. */
  setCollapsed(collapsed: boolean): void {
    this.collapsed = collapsed;
    if (collapsed) this.column.remove();
    else if (!this.region.contains(this.column)) this.region.append(this.column);
  }

  private height(): number {
    return window.innerWidth >= 768 ? 480 : 360;
  }

  private pixels(grams: number, goalGrams: number): number {
    const raw = Math.round((grams * this.height()) / Math.max(goalGrams, 1));
    return Math.min(raw, Math.round(this.height() * OVER_GOAL_CAP));
  }

  render(list: TripList, profile: Profile, mode: StrataMode, chip?: ChipInfo): void {
    const totals = list.totals;
    const targets: BandTarget[] = CATEGORY_ORDER.flatMap((category) => {
      const entry = list.categories.find((candidate) => candidate.category === category);
      const baseGrams = entry?.baseGrams ?? 0;
      if (baseGrams <= 0) return [];
      const share = Math.round((baseGrams * 100) / Math.max(totals.baseGrams, 1));
      return [
        {
          category,
          baseGrams,
          label: `${category}: ${formatGrams(baseGrams, profile.unit)}, ${share}% of base weight`,
        },
      ];
    });

    this.syncBands(targets);
    this.goalLine.setAttribute('aria-label', `Goal ${totals.display.goal}`);
    this.goalLine.style.bottom = `${this.height()}px`;
    this.wornColumn.setAttribute('aria-label', `Worn ${totals.display.worn}`);
    this.consumableColumn.setAttribute('aria-label', `Consumable ${totals.display.consumable}`);
    const over = totals.baseGrams > totals.goalGrams;
    if (over) {
      this.chevron.setAttribute(
        'aria-label',
        `Over goal by ${formatGrams(totals.baseGrams - totals.goalGrams, profile.unit)}`,
      );
      if (!this.chevron.isConnected) {
        this.stack.parentElement?.append(this.chevron);
      }
    } else {
      this.chevron.remove();
    }

    const previousBase = this.baseGrams;
    this.baseGrams = totals.baseGrams;
    const token = ++this.sequence;
    const applyHeights = (animate: boolean): void => {
      const cap = Math.round(this.height() * OVER_GOAL_CAP);
      let used = 0;
      for (const target of targets) {
        const band = this.bands.get(target.category);
        if (band === undefined) continue;
        const wanted = this.pixels(target.baseGrams, totals.goalGrams);
        const allowed = Math.max(Math.min(wanted, cap - used), 0);
        used += allowed;
        band.style.transitionDuration = animate ? `${GROW_MS}ms` : '0ms';
        band.style.height = `${allowed}px`;
      }
      this.wornColumn.style.transitionDuration = animate ? `${GROW_MS}ms` : '0ms';
      this.consumableColumn.style.transitionDuration = animate ? `${GROW_MS}ms` : '0ms';
      this.wornColumn.style.height = `${this.pixels(totals.wornGrams, totals.goalGrams)}px`;
      this.consumableColumn.style.height = `${this.pixels(
        totals.consumableGrams,
        totals.goalGrams,
      )}px`;
    };

    if (prefersReducedMotion() || this.collapsed) {
      applyHeights(false);
      this.hooks.setBase(totals.baseGrams);
      return;
    }

    const count = (): void => {
      if (token !== this.sequence) return;
      this.hooks.countBase(previousBase, totals.baseGrams, COUNT_MS);
    };

    if (mode === 'pack' && chip !== undefined) {
      this.flyChip(chip, profile, 'in', () => {
        if (token !== this.sequence) return;
        applyHeights(true);
        window.setTimeout(count, GROW_MS + STEP_GAP_MS);
      });
      return;
    }
    if (mode === 'unpack' && chip !== undefined) {
      this.hooks.countBase(previousBase, totals.baseGrams, COUNT_MS);
      window.setTimeout(() => {
        if (token !== this.sequence) return;
        applyHeights(true);
        window.setTimeout(() => {
          if (token !== this.sequence) return;
          this.flyChip(chip, profile, 'out', () => {});
        }, GROW_MS + STEP_GAP_MS);
      }, COUNT_MS + STEP_GAP_MS);
      return;
    }
    applyHeights(mode !== 'none');
    if (mode === 'none') this.hooks.setBase(totals.baseGrams);
    else window.setTimeout(count, GROW_MS + STEP_GAP_MS);
  }

  private syncBands(targets: BandTarget[]): void {
    for (const [category, band] of [...this.bands]) {
      if (!targets.some((target) => target.category === category)) {
        band.remove();
        this.bands.delete(category);
      }
    }
    for (const target of targets) {
      let band = this.bands.get(target.category);
      if (band === undefined) {
        band = el(
          'li',
          {
            class: `band band-${target.category.toLowerCase()}`,
            tabindex: '0',
            'aria-label': target.label,
          },
          [el('span', { class: 'band-text', 'aria-hidden': 'true' }, [target.category])],
        );
        band.addEventListener('keydown', (event) => {
          const key = (event as KeyboardEvent).key;
          if (key !== 'ArrowUp' && key !== 'ArrowDown') return;
          event.preventDefault();
          const sibling = key === 'ArrowUp' ? band?.nextElementSibling : band?.previousElementSibling;
          (sibling as HTMLElement | null)?.focus();
        });
        band.style.height = '0px';
        this.bands.set(target.category, band);
        this.placeBand(target.category, band);
      }
      band.setAttribute('aria-label', target.label);
    }
  }

  private placeBand(category: Category, band: HTMLElement): void {
    const rank = CATEGORY_ORDER.indexOf(category);
    const later = CATEGORY_ORDER.slice(rank + 1)
      .map((candidate) => this.bands.get(candidate))
      .find((candidate) => candidate !== undefined);
    if (later === undefined) this.stack.append(band);
    else this.stack.insertBefore(band, later);
  }

  /** The chip flies between a closet row and its band, and exists only then. */
  private flyChip(
    chip: ChipInfo,
    profile: Profile,
    direction: 'in' | 'out',
    done: () => void,
  ): void {
    const band = this.bands.get(chip.category);
    const target = (band ?? this.stack).getBoundingClientRect();
    const node = el(
      'div',
      {
        class: 'chip',
        role: 'img',
        'aria-label': `Moving ${chip.name}, ${formatGrams(chip.weightGrams, profile.unit)}`,
      },
      [`${chip.name} ${formatGrams(chip.weightGrams, profile.unit)}`],
    );
    document.body.append(node);
    const from = direction === 'in' ? chip.from : target;
    const to = direction === 'in' ? target : chip.from;
    node.style.left = `${from.left}px`;
    node.style.top = `${from.top}px`;
    const animation = node.animate(
      [
        { transform: 'translate(0px, 0px)' },
        { transform: `translate(${to.left - from.left}px, ${to.top - from.top}px)` },
      ],
      { duration: CHIP_MS, easing: 'cubic-bezier(0.2, 0.9, 0.2, 1)' },
    );
    animation.addEventListener('finish', () => {
      node.remove();
      done();
    });
  }
}
