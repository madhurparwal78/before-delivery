import { api, ApiCallError, type Field, type Project } from './api.js';
import { openDialog } from './dialog.js';
import { el, on } from './dom.js';
import { labelledField } from './forms.js';

const BUILT_IN_REFERENCES = ['Start', 'Due', 'Effort'];

export function openAddField(project: Project, opener: HTMLElement): void {
  openDialog({
    name: 'Add field',
    opener,
    build: (handle) => {
      const name = labelledField({ name: 'Field name' });
      const type = labelledField({
        name: 'Field type',
        kind: 'select',
        options: ['text', 'number', 'date', 'single_select', 'multi_select', 'formula'],
      });
      type.input.setAttribute('role', 'combobox');
      const options = labelledField({ name: 'Options', hint: 'Comma separated' });
      const add = el('button', { type: 'submit', class: 'pill pill--dark' }, 'Add field');
      const cancel = el('button', { type: 'button', class: 'pill pill--ghost' }, 'Cancel');
      on(cancel, 'click', handle.close);
      const form = el('form', { class: 'dialog-body stack' }, [
        el('h2', { class: 'dialog-title' }, 'Add field'),
        name.wrap,
        type.wrap,
        options.wrap,
        el('div', { class: 'dialog-actions' }, [add, cancel]),
      ]) as HTMLFormElement;
      on(form, 'submit', (event) => {
        event.preventDefault();
        if (add.getAttribute('aria-busy') === 'true') return;
        add.setAttribute('aria-busy', 'true');
        void api
          .post(`/api/projects/${project.id}/fields`, {
            name: (name.input as HTMLInputElement).value,
            type: (type.input as HTMLSelectElement).value,
            options: (options.input as HTMLInputElement).value
              .split(',')
              .map((option) => option.trim())
              .filter((option) => option !== ''),
          })
          .then(() => handle.close())
          .catch((err) => {
            if (err instanceof ApiCallError) {
              name.setError(err.failure.errors?.name ?? null);
              type.setError(err.failure.errors?.type ?? null);
            }
            add.removeAttribute('aria-busy');
          });
      });
      return form;
    },
  });
}

export function openEditField(field: Field, opener: HTMLElement): void {
  openDialog({
    name: `Edit field: ${field.name}`,
    opener,
    build: (handle) => {
      const name = labelledField({ name: 'Field name', value: field.name });
      const save = el('button', { type: 'submit', class: 'pill pill--dark' }, 'Save field');
      const cancel = el('button', { type: 'button', class: 'pill pill--ghost' }, 'Cancel');
      on(cancel, 'click', handle.close);
      const form = el('form', { class: 'dialog-body stack' }, [
        el('h2', { class: 'dialog-title' }, `Edit field: ${field.name}`),
        name.wrap,
        el('div', { class: 'dialog-actions' }, [save, cancel]),
      ]) as HTMLFormElement;
      on(form, 'submit', (event) => {
        event.preventDefault();
        if (save.getAttribute('aria-busy') === 'true') return;
        save.setAttribute('aria-busy', 'true');
        void api
          .patch(`/api/fields/${field.id}`, { name: (name.input as HTMLInputElement).value })
          .then(() => handle.close())
          .catch((err) => {
            if (err instanceof ApiCallError) name.setError(err.failure.errors?.name ?? null);
            save.removeAttribute('aria-busy');
          });
      });
      return form;
    },
  });
}

export function openFormulaEditor(project: Project, field: Field, opener: HTMLElement): void {
  openDialog({
    name: `Edit formula: ${field.name}`,
    opener,
    variant: 'popover',
    build: (handle) => {
      const formula = labelledField({ name: 'Formula', value: field.formula ?? '' });
      const input = formula.input as HTMLInputElement;
      const alert = el('div', { role: 'alert', class: 'field__error', hidden: true });
      const names = [
        ...BUILT_IN_REFERENCES,
        ...project.fields.filter((other) => other.id !== field.id).map((other) => other.name),
      ];
      const listbox = el('ul', {
        role: 'listbox',
        'aria-label': 'Field suggestions',
        class: 'suggestions',
        hidden: true,
      });
      let active = 0;
      const drawSuggestions = () => {
        listbox.replaceChildren();
        names.forEach((name, index) => {
          const option = el(
            'li',
            {
              role: 'option',
              'aria-selected': index === active ? 'true' : 'false',
              class: index === active ? 'suggestions__item is-active' : 'suggestions__item',
            },
            name,
          );
          on(option, 'click', () => insert(name));
          listbox.appendChild(option);
        });
      };
      const insert = (name: string) => {
        const start = input.selectionStart ?? input.value.length;
        const before = input.value.slice(0, start).replace(/\{$/, '');
        const after = input.value.slice(start);
        input.value = `${before}{${name}}${after}`;
        const caret = `${before}{${name}}`.length;
        input.setSelectionRange(caret, caret);
        listbox.hidden = true;
        input.focus();
      };
      drawSuggestions();

      on(input, 'keydown', (event) => {
        if (event.key === '{') {
          active = 0;
          drawSuggestions();
          listbox.hidden = false;
          return;
        }
        if (listbox.hidden) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          active =
            (active + (event.key === 'ArrowDown' ? 1 : names.length - 1)) % names.length;
          drawSuggestions();
          return;
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          insert(names[active]);
        }
      });

      const save = el('button', { type: 'submit', class: 'pill pill--dark' }, 'Save formula');
      const cancel = el('button', { type: 'button', class: 'pill pill--ghost' }, 'Cancel');
      on(cancel, 'click', handle.close);
      const form = el('form', { class: 'dialog-body stack' }, [
        el('h2', { class: 'dialog-title' }, `Edit formula: ${field.name}`),
        formula.wrap,
        listbox,
        alert,
        el('div', { class: 'dialog-actions' }, [save, cancel]),
      ]) as HTMLFormElement;
      on(form, 'submit', (event) => {
        event.preventDefault();
        if (save.getAttribute('aria-busy') === 'true') return;
        save.setAttribute('aria-busy', 'true');
        void api
          .patch(`/api/fields/${field.id}`, { formula: input.value })
          .then(() => handle.close())
          .catch((err) => {
            if (err instanceof ApiCallError && err.failure.errors?.formula) {
              alert.hidden = false;
              alert.textContent = err.failure.errors.formula;
            }
            save.removeAttribute('aria-busy');
          });
      });
      return form;
    },
  });
}
