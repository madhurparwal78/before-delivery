import type { FormCheck } from '../../shared/types.ts';
import { h, replaceChildren } from '../lib/dom.ts';
import { setChange } from './commit.ts';
import { onEnter, textField } from './field.ts';
import { refused, type Editor, type EditorEnv } from './editor.ts';

// The checks that compare answers, for the selected question: they are stored with the form, and this question is
// their target. One check is open for editing at a time.

export function checkEditor(env: EditorEnv, key: string): Editor {
  const { store, sync } = env.context;
  const rev = (): number => store.rev;
  let editing: number | 'new' | null = null;
  const list = h('ul', { class: 'item-list' });
  const add = h('button', { type: 'button' }, 'Add check');
  const name = textField({ name: 'Check name', rev });
  const failsWhen = textField({ name: 'Fails when', rev });
  const message = textField({ name: 'Check message', rev });
  const save = h('button', { type: 'button' }, 'Save check');
  const remove = h('button', { type: 'button' }, 'Remove check');
  const form = h('div', { class: 'item-editor', hidden: true }, name.element, failsWhen.element, message.element, h('div', { class: 'item-actions' }, save, remove));
  const own = (): { check: FormCheck; index: number }[] =>
    store.draft.checks.map((check, index) => ({ check, index })).filter(({ check }) => check.target === key);
  const pageKey = (): string => store.draft.pages.find((page) => page.questions.some((question) => question.key === key))?.key ?? '';

  function open(next: number | 'new'): void {
    editing = next;
    const check = next === 'new' ? undefined : store.draft.checks[next];
    for (const [field, value] of [[name, check?.name], [failsWhen, check?.fail_when], [message, check?.message]] as const) {
      field.clean();
      field.input.value = value ?? '';
    }
    show();
    name.input.focus();
  }

  async function write(next: FormCheck[], opened: number | null, box: HTMLElement): Promise<void> {
    env.errors.clear();
    const outcome = await sync.send(setChange('form', 'checks', next, store.rev));
    if (!outcome.ok) return refused(env, outcome.refusal, box);
    editing = opened;
    for (const field of [name, failsWhen, message]) field.clean();
    show();
  }

  add.addEventListener('click', () => open('new'));
  save.addEventListener('click', () => {
    const check: FormCheck = { name: name.value(), page: pageKey(), target: key, fail_when: failsWhen.value(), message: message.value() };
    const next = store.draft.checks.slice();
    const at = editing === null || editing === 'new' ? next.length : editing;
    next[at] = check;
    void write(next, at, failsWhen.input);
  });
  remove.addEventListener('click', () => {
    const at = editing;
    void write(store.draft.checks.filter((_, index) => index !== at), null, remove);
  });
  for (const field of [name, failsWhen, message]) onEnter(field.input, () => save.click());

  function show(): void {
    replaceChildren(list, own().map(({ check, index }) => {
      const button = h('button', { type: 'button', 'aria-pressed': String(editing === index) }, check.name || check.target);
      button.addEventListener('click', () => open(index));
      return h('li', {}, button);
    }));
    form.hidden = editing === null;
    remove.hidden = editing === 'new';
    if (editing === null || editing === 'new') return;
    const check = store.draft.checks[editing];
    name.show(check?.name ?? '');
    failsWhen.show(check?.fail_when ?? '');
    message.show(check?.message ?? '');
  }
  show();
  return { element: h('div', { class: 'editor' }, list, add, form), show };
}
