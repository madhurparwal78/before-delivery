import type { AnswerValue, EvalQuestion, StructureQuestion } from '../../../shared/types.ts';
import { h } from '../../lib/dom.ts';
import { asText } from './answers.ts';
import type { Field, FieldEnv } from './field.ts';
import { controlId, createShell } from './shell.ts';

const DEFAULT_MIN = 1;
const DEFAULT_MAX = 5;

/** Where a key takes the person, as an index into the numbers, or null when the key does nothing here. */
function destination(event: KeyboardEvent, from: number, numbers: number[]): number | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  const last = numbers.length - 1;
  switch (event.key) {
    case 'ArrowRight':
    case 'ArrowUp': return Math.min(from + 1, last);
    case 'ArrowLeft':
    case 'ArrowDown': return Math.max(from - 1, 0);
    case 'Home': return 0;
    case 'End': return last;
    default: {
      const index = /^[0-9]$/.test(event.key) ? numbers.indexOf(Number(event.key)) : -1;
      return index < 0 ? null : index;
    }
  }
}

/** A scale is one radio group: arrows, Home, End and digits choose a number without wrapping, and selection follows focus. */
export function scaleField(item: EvalQuestion, spec: StructureQuestion, answer: AnswerValue | undefined, env: FieldEnv): Field {
  const shell = createShell(item, 'legend', 'radiogroup');
  const low = Number(spec.min ?? DEFAULT_MIN);
  const high = Number(spec.max ?? DEFAULT_MAX);
  const numbers = Array.from({ length: high - low + 1 }, (_, index) => low + index);
  let committed = asText(answer);

  const choose = (input: HTMLInputElement): void => {
    input.checked = true;
    if (input.value === committed) return;
    committed = input.value;
    env.commit(item.key, input.value);
  };
  const inputs = numbers.map((number) => {
    const input = h('input', { type: 'radio', name: controlId(item.key), value: String(number) });
    input.checked = input.value === committed;
    input.addEventListener('change', () => choose(input));
    return input;
  });
  const track = h('div', { class: 'scale-track' },
    inputs.map((input) => h('label', { class: 'scale-option' }, input, h('span', {}, input.value))));
  track.addEventListener('keydown', (event) => {
    const target = destination(event, inputs.findIndex((input) => input === event.target), numbers);
    const input = target === null ? undefined : inputs[target];
    if (!input) return;
    event.preventDefault();
    input.focus();
    choose(input);
  });

  const ends = [
    spec.min_label ? h('span', { id: `scale-low-${item.key}` }, spec.min_label) : null,
    spec.max_label ? h('span', { id: `scale-high-${item.key}`, class: 'scale-high' }, spec.max_label) : null,
  ];
  shell.root.append(track, h('div', { class: 'scale-ends' }, ends));
  shell.describeWith(...ends.flatMap((end) => (end ? [end.id] : [])));
  if (spec.required) shell.root.setAttribute('aria-required', 'true');
  shell.relabel(item.label, item.help);
  return {
    key: item.key,
    element: shell.root,
    update: (next) => shell.relabel(next.label, next.help),
    showError: shell.showError,
    clearError: shell.clearError,
    focusTarget: () => inputs.find((input) => input.checked) ?? inputs[0] ?? shell.root,
  };
}
