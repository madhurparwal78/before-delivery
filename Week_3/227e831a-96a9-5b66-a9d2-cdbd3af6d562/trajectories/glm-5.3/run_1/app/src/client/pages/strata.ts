import { el, prefersReducedMotion } from '../dom.js';
import { formatWeight } from '../../domain/format.js';
import type { DisplayUnit } from '../../domain/types.js';

/**
 * Pack Strata: one band per category with base weight, stacked in category
 * order, scaled to the goal, with worn and consumable side columns on the
 * same scale and a capped over-goal stack with a chevron.
 */

export interface StrataData {
  readonly categories: readonly { category: string; baseGrams: number }[];
  readonly baseGrams: number;
  readonly wornGrams: number;
  readonly consumableGrams: number;
  readonly goalGrams: number;
}

const CATEGORY_ORDER = ['Shelter', 'Sleep', 'Pack', 'Kitchen', 'Water', 'Clothing', 'Electronics', 'Essentials', 'Hygiene', 'Food'];

/** A band's height: round(grams × H / goal), half-up, on exact integers. */
function bandHeight(baseGrams: number, height: number, goalGrams: number): number {
  if (goalGrams <= 0) return 0;
  const numerator = baseGrams * height;
  // Half-up of numerator/goalGrams: floor((2·n + d) / (2·d)).
  return Math.floor((2 * numerator + goalGrams) / (2 * goalGrams));
}

/** The column: bands stacked from the bottom in category order. */
export function renderStrata(data: StrataData, unit: DisplayUnit, phone: boolean, expanded: boolean): HTMLElement {
  const height = phone ? 360 : 480;
  const cap = height * 1.25;
  const column = el('div', { class: `strata-column${phone ? ' phone' : ''}`, role: 'group', 'aria-label': 'Pack Strata' });
  column.style.height = `${height}px`;

  if (expanded) {
    const stack = el('div', { class: 'strata-stack' });
    const list = el('div', { role: 'list', 'aria-label': 'Base weight by category' });
    let used = 0;
    for (const category of CATEGORY_ORDER) {
      const entry = data.categories.find((candidate) => candidate.category === category);
      if (entry === undefined || entry.baseGrams <= 0) continue;
      const rawHeight = bandHeight(entry.baseGrams, height, data.goalGrams);
      const clipped = Math.min(rawHeight, Math.max(0, cap - used));
      used += clipped;
      // A band's share of base weight, half-up to a whole percent.
      const share = data.baseGrams > 0 ? Math.floor((2 * entry.baseGrams * 100 + data.baseGrams) / (2 * data.baseGrams)) : 0;
      const band = el('div', {
        class: 'strata-band',
        role: 'listitem',
        tabindex: '0',
        'aria-label': `${category}: ${formatWeight(entry.baseGrams, unit)}, ${share}% of base weight`,
      });
      band.style.height = `${clipped}px`;
      band.style.background = bandColor(category);
      list.append(band);
    }
    stack.append(...Array.from(list.children));
    const goalLine = el('div', { class: 'goal-line' });
    goalLine.style.bottom = `${18 + height}px`;
    column.append(stack, goalLine);

    // Over-goal chevron with the excess.
    if (data.baseGrams > data.goalGrams) {
      const excess = data.baseGrams - data.goalGrams;
      const chevron = el('div', { class: 'over-chevron', role: 'img', 'aria-label': `Over goal by ${formatWeight(excess, unit)}`, text: '▲' });
      chevron.style.bottom = `${18 + Math.min(cap, bandHeight(data.baseGrams, height, data.goalGrams))}px`;
      column.append(chevron);
    }

    // Side columns on the same scale and cap.
    const wornHeight = Math.min(cap, bandHeight(data.wornGrams, height, data.goalGrams));
    const consumableHeight = Math.min(cap, bandHeight(data.consumableGrams, height, data.goalGrams));
    const worn = el('div', { class: 'side-column worn-col', role: 'img', 'aria-label': `Worn ${formatWeight(data.wornGrams, unit)}` });
    worn.style.height = `${wornHeight}px`;
    const consumable = el('div', { class: 'side-column consumable-col', role: 'img', 'aria-label': `Consumable ${formatWeight(data.consumableGrams, unit)}` });
    consumable.style.height = `${consumableHeight}px`;
    column.append(worn, consumable);
  }
  return column;
}

function bandColor(category: string): string {
  const palette: Record<string, string> = {
    Shelter: '#4a6b4f',
    Sleep: '#5d7f63',
    Pack: '#6f8f73',
    Kitchen: '#829f85',
    Water: '#95af97',
    Clothing: '#a8bfa9',
    Electronics: '#8ba07d',
    Essentials: '#7a9271',
    Hygiene: '#69846a',
    Food: '#57775f',
  };
  return palette[category] ?? '#4a6b4f';
}

/** The chip that flies from a closet row to its band during a pack. */
export function flyingChip(name: string, unitWeightGrams: number, unit: DisplayUnit, from: DOMRect, to: DOMRect): HTMLElement {
  const chip = el('div', { class: 'chip', role: 'img', 'aria-label': `Moving ${name}, ${formatWeight(unitWeightGrams, unit)}`, text: name });
  chip.style.position = 'fixed';
  chip.style.left = `${from.left}px`;
  chip.style.top = `${from.top}px`;
  chip.style.zIndex = '50';
  chip.style.background = 'var(--moss)';
  chip.style.color = 'var(--ground)';
  chip.style.padding = '0.1rem 0.35rem';
  chip.style.fontSize = '0.8rem';
  chip.style.fontFamily = 'var(--sans)';
  chip.style.pointerEvents = 'none';
  document.body.append(chip);
  const dx = to.left - from.left;
  const dy = to.top - from.top;
  chip.style.transition = 'none';
  if (!prefersReducedMotion()) {
    requestAnimationFrame(() => {
      chip.style.transition = 'transform 0.34s cubic-bezier(0.3, 0.6, 0.2, 1)';
      chip.style.transform = `translate(${dx}px, ${dy}px)`;
    });
  } else {
    chip.style.transform = `translate(${dx}px, ${dy}px)`;
  }
  return chip;
}
