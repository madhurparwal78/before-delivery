// A dialog wrapped around one form: error summary on top, Cancel and a submit button, pending state.
import { h } from '../core/dom.js';
import { createDialog } from '../core/dialog.js';
import { clearInvalid, createErrorSummary } from '../core/forms.js';

// formDialog({name, submitLabel, onSubmit, wide}) -> {dialog (createDialog result), form, summary, fieldsHost, submit}
// onSubmit() may throw an ApiError: a 422 fills the summary and marks fields; any other error is shown as one message.
// Inputs found by `data-field="<api field name>"` are linked from the summary.
export function formDialog({ name, submitLabel, onSubmit, wide = false, cancelLabel = 'Cancel', onClose }) {
  const dialog = createDialog({ name, wide, onClose });
  const summary = createErrorSummary();
  const fieldsHost = h('div', { class: 'form-fields' });
  const form = h('form', { novalidate: true });
  const submit = h('button', { type: 'submit', class: 'btn btn--primary' }, submitLabel);
  const cancel = h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => dialog.close() }, cancelLabel);
  dialog.body.append(summary.element, fieldsHost);
  dialog.actions.append(cancel, submit);
  form.append(dialog.body, dialog.actions);
  dialog.dialog.append(form);

  let pending = false;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (pending) return;
    pending = true;
    submit.disabled = true;
    submit.setAttribute('aria-busy', 'true');
    summary.clear();
    clearInvalid(form);
    try {
      await onSubmit();
    } catch (error) {
      if (error.fields) summary.showFields(error.fields, (field) => form.querySelector(`[data-field="${CSS.escape(field)}"]`));
      else summary.showMessage(error.message);
    } finally {
      pending = false;
      submit.disabled = false;
      submit.removeAttribute('aria-busy');
    }
  });
  return { dialog, form, summary, fieldsHost, submit };
}
