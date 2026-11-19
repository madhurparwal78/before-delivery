// Error summary: an alert named "Error summary" with one link per field error.
import { h, uid } from './dom.js';
import { icon } from './icons.js';

export const CHECK_FIELDS = 'Check the highlighted fields.';

export function createErrorSummary() {
  const element = h('div', { role: 'alert', 'aria-label': 'Error summary', class: 'error-summary', hidden: true });
  return {
    element,
    clear() {
      element.hidden = true;
      element.replaceChildren();
    },
    // fields: {fieldName: message}; resolve(fieldName) -> the input element (or null)
    showFields(fields, resolve) {
      const list = h('ul');
      for (const [field, message] of Object.entries(fields)) {
        const target = resolve(field);
        const link = h('a', {
          href: `#${target ? (target.id || (target.id = uid('field'))) : field}`,
          onclick: (event) => { event.preventDefault(); if (target) target.focus(); },
        }, message);
        list.append(h('li', {}, link));
        if (target) markInvalid(target, message);
      }
      element.replaceChildren(h('p', {}, icon('alert', 20), h('span', {}, CHECK_FIELDS)), list);
      element.hidden = false;
    },
    showMessage(message) {
      element.replaceChildren(h('p', {}, icon('alert', 20), h('span', {}, message)));
      element.hidden = false;
    },
  };
}

function markInvalid(input, message) {
  input.setAttribute('aria-invalid', 'true');
  const holder = input.closest('.field');
  if (!holder) return;
  let note = holder.querySelector('.field-error');
  if (!note) {
    note = h('div', { class: 'field-error', id: uid('error') });
    holder.append(note);
  }
  note.replaceChildren(icon('alert', 16), h('span', {}, message));
  input.setAttribute('aria-describedby', note.id);
}

export function clearInvalid(root) {
  for (const input of root.querySelectorAll('[aria-invalid]')) {
    input.removeAttribute('aria-invalid');
    input.removeAttribute('aria-describedby');
  }
  for (const note of root.querySelectorAll('.field-error')) note.remove();
}

// A labelled field: field({label, input}) -> div.field; the label is associated by id.
export function field({ label, input, hint }) {
  if (!input.id) input.id = uid('input');
  return h('div', { class: 'field' },
    h('label', { for: input.id }, label),
    input,
    hint ? h('div', { class: 'hint' }, hint) : null);
}
