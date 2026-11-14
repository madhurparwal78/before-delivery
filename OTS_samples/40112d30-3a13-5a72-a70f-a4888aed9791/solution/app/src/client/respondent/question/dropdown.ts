import type { AnswerValue, EvalQuestion, StructureQuestion } from '../../../shared/types.ts';
import { h } from '../../lib/dom.ts';
import { asText } from './answers.ts';
import type { Field, FieldEnv } from './field.ts';
import { controlId, createShell } from './shell.ts';

/** A dropdown is a native select with an empty first option; each change commits. */
export function dropdownField(item: EvalQuestion, spec: StructureQuestion, answer: AnswerValue | undefined, env: FieldEnv): Field {
  const shell = createShell(item, 'label');
  const control = h('select', { id: controlId(item.key) },
    h('option', { value: '' }),
    (spec.options ?? []).map((option) => h('option', { value: option.value }, option.label)));
  control.value = asText(answer);
  if (spec.required) control.setAttribute('aria-required', 'true');
  control.addEventListener('change', () => env.commit(item.key, control.value === '' ? null : control.value));
  shell.bind(control);
  shell.relabel(item.label, item.help);
  shell.root.append(control);
  return {
    key: item.key,
    element: shell.root,
    update: (next) => shell.relabel(next.label, next.help),
    showError: shell.showError,
    clearError: shell.clearError,
    focusTarget: () => control,
  };
}
