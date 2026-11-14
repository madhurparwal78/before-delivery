import type { Question } from '../../shared/types.ts';
import { h } from '../lib/dom.ts';
import { CONTROL_NAMES } from './control-names.ts';
import { checkField, onEnter, textField } from './field.ts';
import { refused, type Editor, type EditorEnv } from './editor.ts';

// A calculated field's formula and how its value is shown. `Save formula` commits the group, formula first.

const orNothing = (text: string): string | null => (text === '' ? null : text);
const wholeNumber = (text: string): number | string | null => (text.trim() === '' ? null : /^\d+$/.test(text.trim()) ? Number(text) : text.trim());

export function formulaEditor(env: EditorEnv, key: string): Editor {
  const { store, sync } = env.context;
  const rev = (): number => store.rev;
  const formula = textField({ name: CONTROL_NAMES.formula, rev, onInput: () => env.errors.clear() });
  const places = textField({ name: CONTROL_NAMES.places, rev });
  const prefix = textField({ name: CONTROL_NAMES.prefix, rev });
  const suffix = textField({ name: CONTROL_NAMES.suffix, rev });
  const hidden = checkField(CONTROL_NAMES.hidden, () => undefined);
  const save = h('button', { type: 'button' }, 'Save formula');
  const current = (): Question | undefined => store.questions().find((question) => question.key === key);

  save.addEventListener('click', () => {
    void (async () => {
      env.errors.clear();
      const edits: [string, unknown, unknown][] = [
        ['formula', formula.value(), current()?.formula ?? ''],
        ['places', wholeNumber(places.value()), current()?.places ?? null],
        ['prefix', orNothing(prefix.value()), current()?.prefix ?? null],
        ['suffix', orNothing(suffix.value()), current()?.suffix ?? null],
        ['hidden', hidden.input.checked, current()?.hidden === true],
      ];
      for (const [field, value, before] of edits) {
        if (value === before) continue;
        const outcome = await sync.send({ op: 'set', key, field, value, base_rev: store.rev });
        if (!outcome.ok) return refused(env, outcome.refusal, formula.input);
      }
      for (const box of [formula, places, prefix, suffix]) box.clean();
      show();
    })();
  });
  for (const field of [formula, places, prefix, suffix]) onEnter(field.input, () => save.click());

  function show(): void {
    const question = current();
    formula.show(question?.formula ?? '');
    places.show(question?.places === undefined ? '' : String(question.places));
    prefix.show(question?.prefix ?? '');
    suffix.show(question?.suffix ?? '');
    hidden.show(question?.hidden === true);
  }
  show();
  return { element: h('div', { class: 'editor' }, formula.element, places.element, prefix.element, suffix.element, hidden.element, save), show };
}
