import type { AnswerValue, EvalQuestion, StructureQuestion } from '../../../shared/types.ts';
import { asText } from './answers.ts';
import type { Field, FieldEnv } from './field.ts';
import { optionRow } from './options.ts';
import { controlId, createShell } from './shell.ts';

/** A choice is a radio group: the browser's own arrow keys and touch behaviour do the work, and each change commits. */
export function choiceField(item: EvalQuestion, spec: StructureQuestion, answer: AnswerValue | undefined, env: FieldEnv): Field {
  const shell = createShell(item, 'legend', 'radiogroup');
  const chosen = asText(answer);
  const radios = (spec.options ?? []).map((option) => {
    const { row, input } = optionRow('radio', controlId(item.key), option, option.value === chosen);
    input.addEventListener('change', () => env.commit(item.key, option.value));
    shell.root.append(row);
    return input;
  });
  if (spec.required) shell.root.setAttribute('aria-required', 'true');
  shell.relabel(item.label, item.help);
  return {
    key: item.key,
    element: shell.root,
    update: (next) => shell.relabel(next.label, next.help),
    showError: shell.showError,
    clearError: shell.clearError,
    focusTarget: () => radios.find((radio) => radio.checked) ?? radios[0] ?? shell.root,
  };
}
