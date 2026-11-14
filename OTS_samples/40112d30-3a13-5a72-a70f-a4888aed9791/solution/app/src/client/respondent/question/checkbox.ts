import type { AnswerValue, EvalQuestion, StructureQuestion } from '../../../shared/types.ts';
import { asList } from './answers.ts';
import type { Field, FieldEnv } from './field.ts';
import { optionRow } from './options.ts';
import { controlId, createShell } from './shell.ts';

/** A checkbox question is a group of native checkboxes; every change commits the ticked values. */
export function checkboxField(item: EvalQuestion, spec: StructureQuestion, answer: AnswerValue | undefined, env: FieldEnv): Field {
  const shell = createShell(item, 'legend', 'group');
  const ticked = new Set(asList(answer));
  const boxes = (spec.options ?? []).map((option) => {
    const { row, input } = optionRow('checkbox', controlId(item.key), option, ticked.has(option.value));
    input.addEventListener('change', () => {
      const values = boxes.filter((box) => box.checked).map((box) => box.value);
      env.commit(item.key, values.length > 0 ? values : null);
    });
    shell.root.append(row);
    return input;
  });
  shell.relabel(item.label, item.help);
  return {
    key: item.key,
    element: shell.root,
    update: (next) => shell.relabel(next.label, next.help),
    showError: shell.showError,
    clearError: shell.clearError,
    focusTarget: () => boxes.find((box) => box.checked) ?? boxes[0] ?? shell.root,
  };
}
