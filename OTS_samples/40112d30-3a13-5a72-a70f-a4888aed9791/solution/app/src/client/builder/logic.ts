import { h, replaceChildren } from '../lib/dom.ts';
import { checkEditor } from './check-editor.ts';
import type { Context } from './context.ts';
import type { Editor } from './editor.ts';
import { formulaError } from './formula-error.ts';
import { formulaEditor } from './formula-editor.ts';
import { jumpEditor } from './jump-editor.ts';
import { litPath } from './lit-path.ts';
import { ruleEditor } from './rule-editor.ts';

// The logic pane: the rule, jumps, formula and checks of whatever is selected, then the Lit path below them.

export function logicPane(context: Context): HTMLElement {
  const { store } = context;
  const errors = formulaError();
  const env = { context, errors };
  const editors = h('div', { class: 'editors' });
  let shownFor = '';
  let current: Editor[] = [];

  function build(): Editor[] {
    const { page, question } = store.selection;
    if (question === null) return [ruleEditor(env, 'page', page), jumpEditor(env, page)];
    const type = store.selectedQuestion()?.type;
    return [ruleEditor(env, 'question', question), ...(type === 'calculated' ? [formulaEditor(env, question)] : []), checkEditor(env, question)];
  }

  function render(): void {
    const { page, question } = store.selection;
    const target = question === null ? `page:${page}` : `question:${question}`;
    if (target !== shownFor) {
      shownFor = target;
      errors.clear();
      current = build();
      replaceChildren(editors, current.map((editor) => editor.element));
    }
    for (const editor of current) editor.show();
  }

  store.drafted.listen(render);
  store.selected.listen(render);
  render();
  return h('div', { class: 'logic-pane' }, h('h2', {}, 'Logic'), editors, errors.element, litPath(context));
}
