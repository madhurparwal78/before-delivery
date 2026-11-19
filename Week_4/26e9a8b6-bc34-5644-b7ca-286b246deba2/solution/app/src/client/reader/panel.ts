import { readingProgress, stepCounter } from '../../shared/copy';
import { fieldColours } from '../../shared/pose';
import type { Phase, Question, ReadingStep } from '../../shared/types';
import { h, replace } from '../dom';
import { Figure, costFormat } from '../figures';
import { Status } from '../status';
import type { Currency } from '../../shared/types';

export const phaseNames: Record<Phase, string> = {
  open_up: 'Open up', take_out: 'Take out', fit_new: 'Fit new', close_up: 'Close up', test_it: 'Test it',
};

/** The pinned step panel: a solid block in the current step's phase colour with its text, questions and step links. */
export class Panel {
  readonly element: HTMLElement;
  readonly counter = new Status('Step counter', 'step-counter');
  readonly progress = new Status('Reading progress', 'sr-only');
  readonly cost: Figure;
  readonly notice = h('p', { class: 'panel-notice' });
  readonly parts = h('ol', { 'aria-label': 'Parts', class: 'parts-list' });
  private readonly phase = h('p', { class: 'phase-name' });
  private readonly title = h('h2', { class: 'step-title' });
  private readonly text = h('p', { class: 'step-text' });
  private readonly questions = h('ul', { 'aria-label': 'Questions on this step', class: 'question-list' });
  private readonly nav = h('nav', { 'aria-label': 'Steps', class: 'step-links' });
  private allQuestions: Question[] = [];
  private step = 1;

  constructor(private readonly steps: readonly ReadingStep[], currency: Currency, private readonly onLink: (step: number) => void, hrefFor: (step: number) => string) {
    const costValue = h('span', { class: 'cost-value', 'aria-hidden': 'true' });
    this.cost = new Figure(costValue, costFormat(currency), 'parts-cost');
    this.element = h('section', { class: 'panel' },
      h('div', { class: 'panel-figures' }, this.counter.element, h('p', { class: 'cost' }, h('span', { class: 'cost-label' }, 'Parts so far '), costValue)),
      this.progress.element, this.notice, this.nav, this.phase, this.title, this.text, this.questions);
    replace(this.nav, ...steps.map((s) => {
      const link = h('a', { href: hrefFor(s.number), 'aria-label': `Step ${s.number}: ${s.title}`, class: 'step-link' }, String(s.number));
      link.addEventListener('click', (event) => {
        event.preventDefault();
        this.onLink(s.number);
      });
      return link;
    }));
  }

  /** Swaps the panel to a step at once: colours, text, counter, spoken progress and the numbered parts. */
  show(n: number, partLabels: string[]): void {
    const step = this.steps[n - 1]!;
    this.step = n;
    const colours = fieldColours[step.phase];
    document.documentElement.style.setProperty('--panel-field', colours.field);
    document.documentElement.style.setProperty('--panel-text', colours.text);
    this.element.dataset.phase = step.phase;
    this.phase.textContent = phaseNames[step.phase];
    this.title.textContent = step.title;
    this.text.textContent = step.text;
    this.counter.set(stepCounter(n, this.steps.length));
    this.progress.set(readingProgress(n, this.steps.length, step.title, step.parts_cost_text));
    replace(this.parts, ...partLabels.map((label) => h('li', {}, label)));
    for (const link of this.nav.querySelectorAll('a')) {
      if (link.textContent === String(n)) link.setAttribute('aria-current', 'step');
      else link.removeAttribute('aria-current');
    }
    this.renderQuestions();
  }

  setQuestions(questions: Question[]): void {
    this.allQuestions = questions;
    this.renderQuestions();
  }

  private renderQuestions(): void {
    replace(this.questions, ...this.allQuestions.filter((q) => q.step === this.step).map((q) =>
      h('li', { class: 'question' },
        h('p', { class: 'question-text' }, q.text),
        h('p', { class: 'question-by' }, q.asked_by),
        q.answer ? h('p', { class: 'answer-text' }, q.answer.text) : null,
        q.answer ? h('p', { class: 'question-by' }, q.answer.answered_by) : null)));
  }
}
