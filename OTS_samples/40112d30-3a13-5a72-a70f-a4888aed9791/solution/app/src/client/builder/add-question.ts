import type { Question } from '../../shared/types.ts';
import { M35 } from '../../shared/messages.ts';
import { h } from '../lib/dom.ts';
import { dialogShell, openDialog } from '../lib/dialog.ts';
import { announce } from '../lib/live.ts';
import { choicesFrom } from './choices.ts';
import { CONTROL_NAMES } from './control-names.ts';
import type { Context } from './context.ts';
import { checkField, fieldError, onEnter, selectField, textField } from './field.ts';
import { QUESTION_KINDS, hasOptions, questionType } from './question-kinds.ts';

// The Add question dialog: a type, a key and a label, and options where the type has them. `Add` puts the
// question at the end of the selected page; a refusal stays in the dialog.

export function openAddQuestion(context: Context, opener: HTMLElement): void {
  const { store, sync } = context;
  const rev = (): number => store.rev;
  const kind = selectField('Question type', QUESTION_KINDS.map((entry) => ({ value: entry.type, label: entry.name })), () => matchType());
  const key = textField({ name: 'Question key', rev });
  const label = textField({ name: CONTROL_NAMES.label, rev });
  const required = checkField(CONTROL_NAMES.required, () => undefined);
  const options = textField({ name: CONTROL_NAMES.options, rev, multiline: true });
  const add = h('button', { type: 'button' }, 'Add');
  const cancel = h('button', { type: 'button' }, 'Cancel');
  const problem = h('p', { class: 'error-text', hidden: true });
  const dialog = dialogShell('Add question', kind.element, key.element, label.element, required.element, options.element, problem,
    h('div', { class: 'dialog-actions' }, add, cancel));
  const open = openDialog(dialog, opener, { first: kind.select });

  function matchType(): void {
    const type = questionType(kind.select.value);
    options.element.hidden = !hasOptions(type);
    required.element.hidden = type === 'calculated';
  }
  matchType();

  function question(): Question {
    const type = questionType(kind.select.value);
    return {
      key: key.value(),
      type,
      label: label.value(),
      ...(type !== 'calculated' && required.input.checked ? { required: true } : {}),
      ...(hasOptions(type) ? { options: choicesFrom(options.value()) } : {}),
    };
  }

  async function addIt(): Promise<void> {
    if (add.getAttribute('aria-busy') === 'true') return;
    add.setAttribute('aria-busy', 'true');
    const wanted = question();
    const outcome = await sync.send({ op: 'add_question', page: store.selection.page, question: wanted, base_rev: store.rev });
    add.removeAttribute('aria-busy');
    if (!outcome.ok) {
      sync.report(outcome.refusal);
      const aboutKey = outcome.refusal.code === 'DUPLICATE_KEY' || outcome.refusal.code === 'VALIDATION_FAILED';
      fieldError(key.element, key.input, aboutKey ? outcome.refusal.items[0]?.message ?? outcome.refusal.message : null);
      problem.hidden = aboutKey;
      problem.textContent = outcome.refusal.message;
      return;
    }
    open.close();
    store.select({ page: store.selection.page, question: wanted.key });
    announce(M35(wanted.label));
  }

  add.addEventListener('click', () => { void addIt(); });
  cancel.addEventListener('click', () => open.close());
  for (const field of [key, label]) onEnter(field.input, () => add.click());
}
