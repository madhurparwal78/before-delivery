import type { Question } from '../../shared/types.ts';
import { M38 } from '../../shared/messages.ts';
import { h } from '../lib/dom.ts';
import { announce } from '../lib/live.ts';
import { openAddQuestion } from './add-question.ts';
import { commit, setChange } from './commit.ts';
import { CONTROL_NAMES } from './control-names.ts';
import type { Context } from './context.ts';
import { textField } from './field.ts';
import { KeyedList } from './keyed.ts';
import { kindName } from './question-kinds.ts';
import { questionControls, type QuestionControls } from './question-controls.ts';

// The canvas: the current page's title, its questions as rows, and Add question. The selected question is the
// one row on the surface tone, and it holds that question's controls.

export function canvas(context: Context): HTMLElement {
  const { store } = context;
  const title = textField({
    name: CONTROL_NAMES.pageTitle,
    rev: () => store.rev,
    onCommit: (text, began) => {
      const page = store.currentPage();
      if (page && text !== page.title) void commit(context, setChange(page.key, 'title', text, began), showTitle);
    },
  });
  const list = h('ul', { class: 'rows' });
  const controls = new WeakMap<HTMLElement, QuestionControls>();
  const focusAfterRemoval = (neighbour: string | undefined): void => {
    const row = neighbour === undefined ? undefined : rows.element(neighbour);
    (row?.querySelector<HTMLElement>('.row-button') ?? addButton).focus();
  };

  const rows = new KeyedList<Question>(list, {
    key: (question) => question.key,
    create: (question) => {
      // The visible words sit beside the button, which is stretched over them, so its name holds no visible text.
      const button = h('button', { type: 'button', class: 'row-button', 'aria-label': `Select question ${question.key}` });
      button.addEventListener('click', () => store.select({ page: store.selection.page, question: question.key }));
      const head = h('div', { class: 'row-head' }, button,
        h('span', { class: 'row-label', 'aria-hidden': 'true' }), h('span', { class: 'row-meta', 'aria-hidden': 'true' }));
      return h('li', { class: 'row', 'data-key': question.key }, head);
    },
    update: (row, question) => {
      const selected = store.selection.question === question.key;
      const button = row.querySelector('.row-button');
      if (!button) return;
      button.setAttribute('aria-pressed', String(selected));
      row.toggleAttribute('data-selected', selected);
      const label = row.querySelector('.row-label');
      if (label) label.textContent = selected ? '' : question.label;
      const meta = row.querySelector('.row-meta');
      if (meta) meta.textContent = selected ? `${question.key} ${kindName(question.type)}` : kindName(question.type);
      let held = controls.get(row);
      if (selected && !held) {
        held = questionControls(context, question, focusAfterRemoval);
        controls.set(row, held);
        row.append(held.element);
      } else if (!selected && held) {
        held.element.remove();
        controls.delete(row);
        held = undefined;
      }
      held?.show(question);
    },
  });

  const addButton = h('button', { type: 'button' }, 'Add question');
  addButton.addEventListener('click', () => openAddQuestion(context, addButton));
  list.addEventListener('keydown', (event) => { void move(event); });

  async function move(event: KeyboardEvent): Promise<void> {
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    const row = event.target instanceof Element ? event.target.closest<HTMLElement>('.row') : null;
    const key = row?.dataset['key'];
    const questions = store.currentPage()?.questions ?? [];
    const index = questions.findIndex((question) => question.key === key);
    if (key === undefined || index < 0) return;
    event.preventDefault();
    const position = index + 1 + (event.key === 'ArrowUp' ? -1 : 1);
    if (position < 1 || position > questions.length) return;
    const moved = await commit(context, { op: 'move_question', key, position, base_rev: store.rev }, () => undefined);
    if (moved) announce(M38(key, position, questions.length));
  }

  function showTitle(): void {
    const page = store.currentPage();
    title.show(page?.title ?? '');
  }

  function render(): void {
    showTitle();
    rows.render(store.currentPage()?.questions ?? []);
  }

  store.drafted.listen(render);
  store.selected.listen(render);
  render();
  return h('div', { class: 'canvas-pane' }, title.element, list, addButton);
}
