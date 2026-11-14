import type { Evaluation } from '../../shared/types.ts';
import { M12 } from '../../shared/messages.ts';
import { h } from '../lib/dom.ts';
import { countTo } from './count.ts';
import { KeyedList } from './keyed.ts';

// `#trial-values`: one line for every calculated field, hidden ones too, as the server's trial worked them out.

interface Line { key: string; label: string; text: string }

interface TrialValues { element: HTMLElement; show: (evaluation: Evaluation) => void }

export function trialValues(): TrialValues {
  const element = h('div', { id: 'trial-values' });
  const lines = new KeyedList<Line>(element, {
    key: (line) => line.key,
    create: (line) => h('p', { 'data-key': line.key }, h('span', { class: 'values-label' }, M12(line.label, '')), h('span', { class: 'lit-count' })),
    update: (item, line) => {
      const label = item.querySelector('.values-label');
      if (label) label.textContent = M12(line.label, '');
      const figure = item.querySelector<HTMLElement>('.lit-count');
      if (figure && figure.dataset['final'] !== line.text) countTo(figure, line.text);
    },
  });
  return {
    element,
    show: (evaluation) => lines.render(
      evaluation.pages.flatMap((page) => page.questions)
        .flatMap((question) => {
          const value = evaluation.values[question.key];
          return value ? [{ key: question.key, label: question.label, text: value.text }] : [];
        }),
    ),
  };
}
