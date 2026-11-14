import type { Evaluation, EvalQuestion } from '../../../shared/types.ts';
import { h } from '../../lib/dom.ts';
import type { Field } from './field.ts';
import { createShell, labelId } from './shell.ts';

const calculationId = (key: string): string => `calc-${key}`;

/** A calculated field is an `output` showing the text the server sent; it never announces by itself. */
export function calculatedField(item: EvalQuestion, evaluation: Evaluation): Field {
  const shell = createShell(item, 'text');
  const output = h('output', { id: calculationId(item.key), class: 'figures', 'aria-live': 'off', 'aria-labelledby': labelId(item.key) });
  const show = (current: Evaluation): void => {
    output.textContent = current.values[item.key]?.text ?? '';
  };
  show(evaluation);
  shell.bind(output);
  shell.relabel(item.label, item.help);
  shell.root.append(output);
  return {
    key: item.key,
    element: shell.root,
    update: (next, current) => {
      shell.relabel(next.label, next.help);
      show(current);
    },
    showError: shell.showError,
    clearError: shell.clearError,
    focusTarget: () => output,
  };
}
