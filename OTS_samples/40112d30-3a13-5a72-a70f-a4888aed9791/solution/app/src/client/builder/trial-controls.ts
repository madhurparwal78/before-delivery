import type { ChoiceOption, Question } from '../../shared/types.ts';
import { h } from '../lib/dom.ts';
import type { Context } from './context.ts';
import { checkField, selectField, textField, type CheckField, type SelectChoice, type SelectField, type TextField } from './field.ts';
import { KeyedList } from './keyed.ts';
import { isAnswerable } from './question-kinds.ts';

// `region "Trial answers"`: one control per answerable question, named `Trial: <label>`. Boxes commit on blur or
// Enter; lists and ticks commit on change. Ranking and file questions have none and count as blank.

interface TrialControl { element: HTMLElement; show: () => void }

const blank: SelectChoice = { value: '', label: '' };
const asChoices = (options: ChoiceOption[] | undefined): SelectChoice[] => (options ?? []).map((option) => ({ value: option.value, label: option.label }));

function scaleChoices(question: Question): SelectChoice[] {
  const low = Number(question.min);
  const high = Number(question.max);
  if (!Number.isInteger(low) || !Number.isInteger(high) || high < low) return [];
  return Array.from({ length: high - low + 1 }, (_, step) => ({ value: String(low + step), label: String(low + step) }));
}

export function trialControls(context: Context): HTMLElement {
  const { store, trial } = context;
  const body = h('div', { class: 'trial-items' });
  const built = new WeakMap<HTMLElement, TrialControl>();
  const shapes = new WeakMap<HTMLElement, string>();

  const answer = (key: string): string => {
    const value = trial.answers.get(key);
    return typeof value === 'string' ? value : '';
  };

  function textual(question: Question): TrialControl {
    const field: TextField = textField({
      name: `Trial: ${question.label}`,
      rev: () => store.rev,
      onInput: () => field.input.removeAttribute('aria-invalid'),
      onCommit: (text) => {
        const value = text.trim();
        if (value === answer(question.key)) return;
        void trial.set(question.key, value === '' ? null : value).then(() => {
          if (trial.rejected.has(question.key)) field.input.setAttribute('aria-invalid', 'true');
        });
      },
    });
    return { element: field.element, show: () => field.show(answer(question.key)) };
  }

  function listed(question: Question): TrialControl {
    const field = selectField(`Trial: ${question.label}`, [blank, ...(question.type === 'scale' ? scaleChoices(question) : asChoices(question.options))],
      (value) => { void trial.set(question.key, value === '' ? null : value); });
    return { element: field.element, show: () => field.show(answer(question.key)) };
  }

  function ticks(question: Question): TrialControl {
    const options = question.options ?? [];
    const fields: CheckField[] = options.map((option) => checkField(option.label, () => {
      const ticked = options.filter((_, index) => fields[index]?.input.checked).map((candidate) => candidate.value);
      void trial.set(question.key, ticked.length > 0 ? ticked : null);
    }));
    const element = h('fieldset', { class: 'trial-group' }, h('legend', {}, `Trial: ${question.label}`), ...fields.map((field) => field.element));
    const show = (): void => {
      const value = trial.answers.get(question.key);
      options.forEach((option, index) => fields[index]?.show(Array.isArray(value) && value.includes(option.value)));
    };
    return { element, show };
  }

  function grid(question: Question): TrialControl {
    const rows = question.rows ?? [];
    const fields: SelectField[] = rows.map((row) => selectField(`Trial: ${question.label}: ${row.label}`, [blank, ...asChoices(question.columns)], () => {
      const picked = rows.flatMap((candidate, index) => {
        const value = fields[index]?.select.value ?? '';
        return value === '' ? [] : [[candidate.value, value] as const];
      });
      void trial.set(question.key, picked.length > 0 ? Object.fromEntries(picked) : null);
    }));
    const show = (): void => {
      const value = trial.answers.get(question.key);
      const chosen = typeof value === 'object' && !Array.isArray(value) ? value : {};
      rows.forEach((row, index) => fields[index]?.show(chosen[row.value] ?? ''));
    };
    return { element: h('div', { class: 'trial-group' }, ...fields.map((field) => field.element)), show };
  }

  function controlFor(question: Question): TrialControl {
    switch (question.type) {
      case 'choice': case 'dropdown': case 'scale': return listed(question);
      case 'checkbox': return ticks(question);
      case 'grid': return grid(question);
      default: return textual(question);
    }
  }

  const items = new KeyedList<Question>(body, {
    key: (question) => question.key,
    create: () => h('div', { class: 'trial-item' }),
    update: (item, question) => {
      const shape = JSON.stringify([question.type, question.label, question.options, question.rows, question.columns, question.min, question.max]);
      if (shapes.get(item) !== shape) {
        const control = controlFor(question);
        built.set(item, control);
        shapes.set(item, shape);
        item.replaceChildren(control.element);
      }
      built.get(item)?.show();
    },
  });

  const render = (): void => items.render(store.questions().filter(isAnswerable));
  store.drafted.listen(render);
  render();
  return h('section', { class: 'trial-answers', 'aria-labelledby': 'trial-answers-heading' }, h('h4', { id: 'trial-answers-heading' }, 'Trial answers'), body);
}
