import type { Pattern, Question, QuestionType } from '../../shared/types.ts';
import { M36 } from '../../shared/messages.ts';
import { h } from '../lib/dom.ts';
import { announce } from '../lib/live.ts';
import { choiceLines, choicesFrom } from './choices.ts';
import { commit, setChange } from './commit.ts';
import { CONTROL_NAMES } from './control-names.ts';
import type { Context } from './context.ts';
import { checkField, selectField, textField, type CheckField, type SelectField, type TextField } from './field.ts';
import { hasOptions, isTextual } from './question-kinds.ts';

// The controls of the selected question, each shown only where the type has that field. A text box commits on
// blur (or Enter in a single-line box); the tick box and the pattern list commit at once.

interface Control { element: HTMLElement; show: (question: Question) => void }
type Maker = (context: Context, key: string) => Control;
interface Spec {
  field: 'label' | 'help' | 'options' | 'rows' | 'columns' | 'min' | 'max' | 'note';
  multiline: boolean;
  applies: (type: QuestionType) => boolean;
  show: (question: Question) => string;
  value: (text: string, question: Question) => unknown;
}

const always = (): boolean => true;
const asked = (type: QuestionType): boolean => type !== 'calculated';
const bounded = (type: QuestionType): boolean => type === 'number' || type === 'scale' || type === 'date';
const orNothing = (text: string): string | null => (text === '' ? null : text);

/** A number or scale limit is sent as a number, a date as typed; anything else goes as typed so the server names the problem. */
function bound(text: string, question: Question): number | string | null {
  const typed = text.trim();
  if (typed === '') return null;
  return question.type !== 'date' && /^-?\d+(\.\d+)?$/.test(typed) ? Number(typed) : typed;
}

const SPECS: Spec[] = [
  { field: 'label', multiline: false, applies: always, show: (q) => q.label, value: (text) => text },
  { field: 'help', multiline: false, applies: asked, show: (q) => q.help ?? '', value: orNothing },
  { field: 'options', multiline: true, applies: hasOptions, show: (q) => choiceLines(q.options), value: (text, q) => choicesFrom(text, q.options) },
  { field: 'rows', multiline: true, applies: (type) => type === 'grid', show: (q) => choiceLines(q.rows), value: (text, q) => choicesFrom(text, q.rows) },
  { field: 'columns', multiline: true, applies: (type) => type === 'grid', show: (q) => choiceLines(q.columns), value: (text, q) => choicesFrom(text, q.columns) },
  { field: 'min', multiline: false, applies: bounded, show: (q) => (q.min === undefined ? '' : String(q.min)), value: bound },
  { field: 'max', multiline: false, applies: bounded, show: (q) => (q.max === undefined ? '' : String(q.max)), value: bound },
  { field: 'note', multiline: true, applies: always, show: (q) => q.note ?? '', value: orNothing },
];

function textControl(spec: Spec): Maker {
  return (context, key) => {
    const { store } = context;
    const current = (): Question | undefined => store.questions().find((question) => question.key === key);
    const revert = (): void => { const question = current(); if (question) field.show(spec.show(question)); };
    const field: TextField = textField({
      name: CONTROL_NAMES[spec.field],
      multiline: spec.multiline,
      rev: () => store.rev,
      onCommit: (text, began) => {
        const question = current();
        if (question && text !== spec.show(question)) void commit(context, setChange(key, spec.field, spec.value(text, question), began), revert);
      },
    });
    return { element: field.element, show: (question) => field.show(spec.show(question)) };
  };
}

const requiredControl: Maker = (context, key) => {
  const field: CheckField = checkField(CONTROL_NAMES.required, (checked) => {
    void commit(context, setChange(key, 'required', checked, context.store.rev), () => field.show(!checked));
  });
  return { element: field.element, show: (question) => field.show(question.required === true) };
};

const PATTERNS: { value: '' | Pattern; label: string }[] = [
  { value: '', label: 'none' }, { value: 'email', label: 'email' }, { value: 'phone', label: 'phone' },
  { value: 'digits', label: 'digits' }, { value: 'letters', label: 'letters' },
];

const patternControl: Maker = (context, key) => {
  const field: SelectField = selectField(CONTROL_NAMES.pattern, PATTERNS, (value) => {
    const previous = context.store.questions().find((question) => question.key === key)?.pattern ?? '';
    void commit(context, setChange(key, 'pattern', value === '' ? null : value, context.store.rev), () => field.show(previous));
  });
  return { element: field.element, show: (question) => field.show(question.pattern ?? '') };
};

/** Which makers a type uses, in the order the controls appear. */
function makersFor(type: QuestionType): Maker[] {
  const text = (field: Spec['field']): Maker[] => SPECS.filter((spec) => spec.field === field && spec.applies(type)).map(textControl);
  return [
    ...text('label'), ...text('help'),
    ...(asked(type) ? [requiredControl] : []),
    ...text('options'), ...text('rows'), ...text('columns'), ...text('min'), ...text('max'),
    ...(isTextual(type) ? [patternControl] : []),
    ...text('note'),
  ];
}

export interface QuestionControls { element: HTMLElement; show: (question: Question) => void }

export function questionControls(context: Context, question: Question, removed: (neighbour: string | undefined) => void): QuestionControls {
  const controls = makersFor(question.type).map((make) => make(context, question.key));
  const remove = h('button', { type: 'button' }, 'Remove question');
  remove.addEventListener('click', () => {
    void (async () => {
      const siblings = context.store.draft.pages.find((page) => page.questions.some((q) => q.key === question.key))?.questions ?? [];
      const at = siblings.findIndex((sibling) => sibling.key === question.key);
      const neighbour = (siblings[at + 1] ?? siblings[at - 1])?.key;
      const label = siblings[at]?.label ?? question.label;
      const gone = await commit(context, { op: 'remove_question', key: question.key, base_rev: context.store.rev }, () => undefined);
      if (!gone) return;
      announce(M36(label));
      removed(neighbour);
    })();
  });
  const element = h('div', { class: 'controls' }, ...controls.map((control) => control.element), remove);
  const show = (next: Question): void => { for (const control of controls) control.show(next); };
  show(question);
  return { element, show };
}
