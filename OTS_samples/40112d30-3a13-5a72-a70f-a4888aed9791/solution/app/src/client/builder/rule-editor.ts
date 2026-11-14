import type { ShowRule } from '../../shared/types.ts';
import { h } from '../lib/dom.ts';
import { CONTROL_NAMES } from './control-names.ts';
import { onEnter, textField } from './field.ts';
import { refused, type Editor, type EditorEnv } from './editor.ts';

// The show rule of the selected page or question: a name and a formula. Both blank takes the rule away.

export function ruleEditor(env: EditorEnv, kind: 'page' | 'question', key: string): Editor {
  const { store, sync } = env.context;
  const rev = (): number => store.rev;
  const name = textField({ name: 'Rule name', rev });
  const when = textField({ name: CONTROL_NAMES.show_rule, rev });
  const save = h('button', { type: 'button' }, 'Save rule');
  const current = (): ShowRule | undefined =>
    (kind === 'page' ? store.draft.pages.find((page) => page.key === key) : store.questions().find((question) => question.key === key))?.show_rule;

  save.addEventListener('click', () => {
    void (async () => {
      env.errors.clear();
      const typed = { name: name.value(), when: when.value() };
      const rule = typed.name.trim() === '' && typed.when.trim() === '' ? null : typed;
      const outcome = await sync.send({ op: 'set', key, field: 'show_rule', value: rule, base_rev: store.rev });
      if (!outcome.ok) return refused(env, outcome.refusal, when.input);
      name.clean();
      when.clean();
      show();
    })();
  });
  for (const field of [name, when]) onEnter(field.input, () => save.click());

  function show(): void {
    name.show(current()?.name ?? '');
    when.show(current()?.when ?? '');
  }
  show();
  return { element: h('div', { class: 'editor' }, name.element, when.element, save), show };
}
