import { ApiFailure, api } from '../api';
import { h, replace } from '../dom';
import { notice } from '../regions';
import { settings } from '../settings';
import { actionButton, problemAlert } from '../ui';
import { renderNotFound } from './notFound';
import type { ScreenCtx } from '../router';
import type { JsonObject } from '../../shared/types';

export async function renderPublicForm(ctx: ScreenCtx): Promise<HTMLElement> {
  const form = settings.form;
  if (form === null) return renderNotFound();
  const problem = h('div', { class: 'problem-holder' });
  const inputs = new Map<string, HTMLInputElement>();
  const fields = form.fields.map((field) => {
    const input = h('input', {
      class: 'input',
      type: field.type === 'number' ? 'number' : 'text',
      'aria-label': field.label,
    });
    inputs.set(field.name, input);
    return h('label', { class: 'field' }, h('span', { class: 'field-label', text: field.label }), input);
  });
  const action = actionButton(
    'Submit',
    async () => {
      replace(problem);
      const values: JsonObject = {};
      for (const field of form.fields) {
        const input = inputs.get(field.name);
        values[field.name] = input === undefined ? '' : input.value;
      }
      try {
        await api('POST', `/api/forms/${encodeURIComponent(ctx.params.slug)}/${encodeURIComponent(ctx.params.path)}`, values);
        notice('Thanks, your response was received.');
      } catch (error) {
        if (error instanceof ApiFailure) {
          const input = error.field === null ? undefined : inputs.get(error.field);
          if (input !== undefined) replace(problem, problemAlert(error.message, () => input.focus()));
          else notice(error.message);
        }
      }
    },
    { variant: 'primary' },
  );
  return h(
    'section',
    { class: 'panel panel-dark public-form' },
    h('h1', { class: 'display', text: form.name }),
    problem,
    ...fields,
    action.element,
  );
}
