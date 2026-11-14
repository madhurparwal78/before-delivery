import type { AnswerValue, EvalQuestion, StructureQuestion } from '../../../shared/types.ts';
import { h } from '../../lib/dom.ts';
import { asText } from './answers.ts';
import type { Field, FieldEnv } from './field.ts';
import { controlId, createShell } from './shell.ts';
import { wireTypedBox } from './typed-box.ts';

/** Short text, long text and number: one textbox. A number is a text box too, so a wrong entry reaches the page's checks. */
export function textField(item: EvalQuestion, spec: StructureQuestion, answer: AnswerValue | undefined, env: FieldEnv): Field {
  const shell = createShell(item, 'label');
  const id = controlId(item.key);
  const control = spec.type === 'long_text'
    ? h('textarea', { id, rows: 4 })
    : h('input', { id, type: 'text', autocomplete: 'off', inputmode: spec.type === 'number' ? 'decimal' : null });
  control.value = asText(answer);
  if (spec.required) control.setAttribute('aria-required', 'true');
  const box = wireTypedBox(control, item.key, env);
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
    flush: box.commit,
  };
}
