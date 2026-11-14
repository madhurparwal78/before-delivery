import type { EvalPage, EvalQuestion, Evaluation } from '../../shared/types.ts';
import { M47 } from '../../shared/messages.ts';
import { h } from '../lib/dom.ts';
import { reducedMotion } from './count.ts';
import { KeyedList } from './keyed.ts';

// The page map: one item per page in form order, one line per question, each lit or skipped exactly as the
// server's evaluation says. An item whose state changed crossfades (`lit-fade`, 40 ms apart in path order, at
// most 12 steps of delay) and the pink marker slides to the last lit page (`lit-marker`).

const STAGGER_MS = 40;
const STAGGER_STEPS = 11;

interface PageMap { element: HTMLElement; show: (evaluation: Evaluation) => void }

interface Changing { text: HTMLElement; from: number }
interface Line extends EvalQuestion { pageState: EvalPage['state'] }

const skipLine = (skippedBy: string | null): string => (skippedBy === null ? '' : M47(skippedBy));

function setState(item: HTMLElement, state: string): void {
  item.dataset['state'] = state;
}

export function pageMap(): PageMap {
  const marker = h('div', { id: 'lit-marker', 'aria-hidden': 'true' });
  const list = h('ol', { 'aria-label': 'Page map', class: 'map-pages' });
  const element = h('div', { class: 'map' }, marker, list);
  const lines = new WeakMap<HTMLElement, KeyedList<Line>>();
  let lastLit: string | null = null;

  const pages = new KeyedList<EvalPage>(list, {
    key: (page) => page.key,
    create: (page) => {
      const item = h('li', { 'data-page': page.key }, h('div', { class: 'map-line' }, h('span', { class: 'map-text' }), h('span', { class: 'map-skip' })));
      const questions = h('ul', { class: 'map-questions' });
      item.append(questions);
      lines.set(item, new KeyedList<Line>(questions, {
        key: (question) => question.key,
        create: (question) => h('li', { 'data-question': question.key }, h('span', { class: 'map-text' }), h('span', { class: 'map-skip' })),
        update: (line, question) => {
          setState(line, question.state);
          setText(line, question.label, question.pageState === 'lit' ? skipLine(question.skipped_by) : '');
        },
      }));
      return item;
    },
    update: (item, page) => {
      setState(item, page.state);
      setText(item.querySelector(':scope > .map-line'), page.title, skipLine(page.skipped_by));
      lines.get(item)?.render(page.questions.map((question) => ({ ...question, pageState: page.state })));
    },
  });

  /** A line holds the item's text and, beside it, why it was skipped. */
  function setText(holder: Element | null, text: string, skip: string): void {
    const label = holder?.querySelector('.map-text');
    const reason = holder?.querySelector('.map-skip');
    if (label) label.textContent = text;
    if (reason) reason.textContent = skip;
  }

  /** The text of every item whose state differs from the evaluation, in path order, with how bright it is now. */
  function changing(evaluation: Evaluation): Changing[] {
    const found: Changing[] = [];
    const note = (item: Element | null | undefined, state: string): void => {
      const text = item?.querySelector<HTMLElement>(':scope > .map-line > .map-text, :scope > .map-text');
      if (item instanceof HTMLElement && text && item.dataset['state'] !== undefined && item.dataset['state'] !== state) {
        found.push({ text, from: Number(getComputedStyle(text).opacity) });
      }
    };
    for (const page of evaluation.pages) {
      const item = pages.element(page.key);
      note(item, page.state);
      for (const question of page.questions) note(item?.querySelector(`[data-question="${CSS.escape(question.key)}"]`), question.state);
    }
    return found;
  }

  function fade(changed: Changing[]): void {
    changed.forEach(({ text, from }, index) => {
      text.classList.remove('lit-changing');
      text.style.setProperty('--from', String(from));
      text.style.setProperty('--to', getComputedStyle(text).opacity);
      text.style.setProperty('--lit-delay', `${Math.min(index, STAGGER_STEPS) * STAGGER_MS}ms`);
      text.classList.add('lit-changing');
    });
  }

  function place(animate: boolean): void {
    const item = lastLit === null ? undefined : pages.element(lastLit);
    marker.hidden = item === undefined;
    if (!item) return;
    const top = `${item.offsetTop}px`;
    const before = marker.style.getPropertyValue('--marker-to');
    marker.style.height = `${item.querySelector<HTMLElement>(':scope > .map-line')?.offsetHeight ?? 0}px`;
    marker.style.setProperty('--marker-to', top);
    if (!animate || before === '' || before === top) return;
    marker.style.setProperty('--marker-from', before);
    marker.classList.remove('lit-moving');
    void marker.offsetWidth;
    marker.classList.add('lit-moving');
  }

  new ResizeObserver(() => place(false)).observe(element);

  return {
    element,
    show: (evaluation) => {
      const before = reducedMotion() ? [] : changing(evaluation);
      pages.render(evaluation.pages);
      lastLit = evaluation.pages.findLast((page) => page.state === 'lit')?.key ?? null;
      marker.dataset['page'] = lastLit ?? '';
      fade(before);
      place(!reducedMotion());
    },
  };
}
