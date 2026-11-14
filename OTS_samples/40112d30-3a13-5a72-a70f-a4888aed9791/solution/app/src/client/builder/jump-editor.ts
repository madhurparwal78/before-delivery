import type { Jump, Page } from '../../shared/types.ts';
import { h, replaceChildren } from '../lib/dom.ts';
import { CONTROL_NAMES } from './control-names.ts';
import { onEnter, selectField, textField } from './field.ts';
import { refused, type Editor, type EditorEnv } from './editor.ts';

// The jumps of the selected page, in the order they are tried. One jump is open for editing at a time.

export function jumpEditor(env: EditorEnv, key: string): Editor {
  const { store, sync } = env.context;
  const rev = (): number => store.rev;
  let editing: number | 'new' | null = null;
  const list = h('ul', { class: 'item-list' });
  const add = h('button', { type: 'button' }, 'Add jump');
  const name = textField({ name: 'Jump name', rev });
  const when = textField({ name: CONTROL_NAMES.jumps, rev });
  const to = selectField('Jump to', [], () => undefined);
  const save = h('button', { type: 'button' }, 'Save jump');
  const remove = h('button', { type: 'button' }, 'Remove jump');
  const form = h('div', { class: 'item-editor', hidden: true }, name.element, when.element, to.element, h('div', { class: 'item-actions' }, save, remove));
  const page = (): Page | undefined => store.draft.pages.find((candidate) => candidate.key === key);
  const jumps = (): Jump[] => page()?.jumps ?? [];

  function open(next: number | 'new'): void {
    editing = next;
    const jump = next === 'new' ? undefined : jumps()[next];
    name.clean();
    when.clean();
    name.input.value = jump?.name ?? '';
    when.input.value = jump?.when ?? '';
    to.select.selectedIndex = 0;
    show();
    name.input.focus();
  }

  async function write(next: Jump[], opened: number | null, box: HTMLElement): Promise<void> {
    env.errors.clear();
    const outcome = await sync.send({ op: 'set', key, field: 'jumps', value: next, base_rev: store.rev });
    if (!outcome.ok) return refused(env, outcome.refusal, box);
    editing = opened;
    name.clean();
    when.clean();
    show();
  }

  add.addEventListener('click', () => open('new'));
  save.addEventListener('click', () => {
    const jump: Jump = { name: name.value(), when: when.value(), to: to.select.value };
    const next = jumps().slice();
    if (editing === 'new' || editing === null) next.push(jump);
    else next[editing] = jump;
    void write(next, editing === 'new' || editing === null ? next.length - 1 : editing, when.input);
  });
  remove.addEventListener('click', () => {
    const at = editing;
    void write(jumps().filter((_, index) => index !== at), null, remove);
  });
  for (const field of [name, when]) onEnter(field.input, () => save.click());

  function show(): void {
    const later = store.draft.pages.slice(store.draft.pages.findIndex((candidate) => candidate.key === key) + 1);
    const kept = to.select.value;
    to.setChoices(later.map((candidate) => ({ value: candidate.key, label: candidate.title })));
    to.show(kept);
    replaceChildren(list, jumps().map((jump, index) => {
      const button = h('button', { type: 'button', 'aria-pressed': String(editing === index) }, jump.name || jump.to);
      button.addEventListener('click', () => open(index));
      return h('li', {}, button);
    }));
    form.hidden = editing === null;
    remove.hidden = editing === 'new';
    if (editing !== null && editing !== 'new') {
      const jump = jumps()[editing];
      name.show(jump?.name ?? '');
      when.show(jump?.when ?? '');
      to.show(jump?.to ?? kept);
    }
  }
  show();
  return { element: h('div', { class: 'editor' }, list, add, form), show };
}
