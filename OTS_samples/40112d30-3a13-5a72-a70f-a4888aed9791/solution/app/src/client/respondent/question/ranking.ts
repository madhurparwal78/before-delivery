import type { AnswerValue, ChoiceOption, EvalQuestion, StructureQuestion } from '../../../shared/types.ts';
import { M38, M39, M40, M41 } from '../../../shared/messages.ts';
import { h, svg } from '../../lib/dom.ts';
import { announce } from '../../lib/live.ts';
import { isLocked } from '../locking.ts';
import { asList } from './answers.ts';
import type { Field, FieldEnv } from './field.ts';
import { enableDrag } from './ranking-drag.ts';
import { createShell, labelId } from './shell.ts';

const arrow = (up: boolean): SVGSVGElement =>
  svg('svg', { viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': 'true', focusable: 'false', class: 'icon' },
    svg('path', { d: up ? 'M3 10.5 8 5.5l5 5' : 'M3 5.5l5 5 5-5', fill: 'none', stroke: 'currentColor', 'stroke-width': 2 }));

/** The options in the order the respondent last set, or in the form's order when no order was set yet. */
function inOrder(options: ChoiceOption[], answer: AnswerValue | undefined): ChoiceOption[] {
  const order = asList(answer);
  if (order.length !== options.length) return options;
  return order.flatMap((value) => options.filter((option) => option.value === value));
}

/**
 * A ranking is a list of items. Space picks one up, the arrows move it, Space drops it and Escape puts it back; the
 * Move buttons and dragging move it too. Only a drop, a button press or a drag release commits the order.
 */
export function rankingField(item: EvalQuestion, spec: StructureQuestion, answer: AnswerValue | undefined, env: FieldEnv): Field {
  const shell = createShell(item, 'text');
  const list = h('ul', { class: 'rank-list', 'aria-labelledby': labelId(item.key) });
  let pickedFrom = -1;

  const items = (): HTMLElement[] => [...list.children].filter((child): child is HTMLElement => child instanceof HTMLElement);
  const nameOf = (entry: HTMLElement): string => entry.getAttribute('data-label') ?? '';
  const order = (): string[] => items().map((entry) => entry.getAttribute('data-value') ?? '');

  function renumber(): void {
    const all = items();
    all.forEach((entry, index) => {
      entry.setAttribute('aria-posinset', String(index + 1));
      entry.setAttribute('aria-setsize', String(all.length));
      entry.querySelector('[data-move="up"]')?.setAttribute('aria-disabled', String(index === 0));
      entry.querySelector('[data-move="down"]')?.setAttribute('aria-disabled', String(index === all.length - 1));
    });
  }

  /** Moves an item one place; false when it is already at that end. */
  function shift(entry: HTMLElement, step: -1 | 1): boolean {
    const target = step < 0 ? entry.previousElementSibling : entry.nextElementSibling;
    if (!target) return false;
    if (step < 0) list.insertBefore(entry, target);
    else list.insertBefore(entry, target.nextElementSibling);
    renumber();
    return true;
  }

  const positionOf = (entry: HTMLElement): number => items().indexOf(entry) + 1;
  const commitOrder = (): void => env.commit(item.key, order());

  function drop(entry: HTMLElement): void {
    pickedFrom = -1;
    entry.removeAttribute('data-grabbed');
    commitOrder();
    announce(M40(nameOf(entry), positionOf(entry), items().length));
  }

  function putBack(entry: HTMLElement): void {
    const others = items().filter((other) => other !== entry);
    list.insertBefore(entry, others[pickedFrom] ?? null);
    pickedFrom = -1;
    entry.removeAttribute('data-grabbed');
    renumber();
    announce(M41(nameOf(entry), positionOf(entry), items().length));
  }

  function onItemKey(entry: HTMLElement, event: KeyboardEvent): void {
    if (event.target !== entry || isLocked(entry)) return;
    const grabbed = entry.getAttribute('data-grabbed') === 'true';
    if (event.key === ' ') {
      event.preventDefault();
      if (grabbed) {
        drop(entry);
        return;
      }
      pickedFrom = items().indexOf(entry);
      entry.setAttribute('data-grabbed', 'true');
      announce(M39(nameOf(entry), positionOf(entry), items().length));
    } else if (grabbed && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      putBack(entry);
      entry.focus();
    } else if (grabbed && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      if (!shift(entry, event.key === 'ArrowUp' ? -1 : 1)) return;
      entry.focus();
      announce(M38(nameOf(entry), positionOf(entry), items().length));
    }
  }

  function moveButton(entry: HTMLElement, option: ChoiceOption, direction: 'up' | 'down'): HTMLButtonElement {
    const button = h('button', { type: 'button', class: 'rank-move', 'data-move': direction, 'aria-label': `Move ${option.label} ${direction}` }, arrow(direction === 'up'));
    button.addEventListener('click', () => {
      if (button.getAttribute('aria-disabled') === 'true' || !shift(entry, direction === 'up' ? -1 : 1)) return;
      button.focus();
      commitOrder();
      announce(M38(option.label, positionOf(entry), items().length));
    });
    return button;
  }

  for (const option of inOrder(spec.options ?? [], answer)) {
    const entry = h('li', { class: 'rank-item', tabindex: '0', 'data-value': option.value, 'data-label': option.label });
    entry.append(
      h('span', { class: 'rank-label' }, option.label),
      h('span', { class: 'rank-moves' }, moveButton(entry, option, 'up'), moveButton(entry, option, 'down')));
    entry.addEventListener('keydown', (event) => onItemKey(entry, event));
    enableDrag(entry, list, (_, to) => {
      renumber();
      commitOrder();
      announce(M38(option.label, to + 1, items().length));
    });
    list.append(entry);
  }
  renumber();

  shell.bind(list);
  shell.relabel(item.label, item.help);
  shell.root.append(list);
  return {
    key: item.key,
    element: shell.root,
    update: (next) => shell.relabel(next.label, next.help),
    showError: shell.showError,
    clearError: shell.clearError,
    focusTarget: () => items()[0] ?? list,
  };
}
