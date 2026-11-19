import { clear, el } from '../dom.js';
import type { FilterSpec, ParameterDoc } from '../../shared/types.js';
import { filterCaption } from './pills.js';

export interface ControlsOptions {
  parameters: () => ParameterDoc[];
  values: () => Record<string, unknown>;
  onParameter: (name: string, value: unknown) => void;
  filters: () => FilterSpec[];
  openFilter: (filter: FilterSpec, opener: HTMLElement) => void;
}

export interface ControlsHandle {
  root: HTMLElement;
  redraw: () => void;
}

export function buildControls(options: ControlsOptions): ControlsHandle {
  const root = el('section', { role: 'region', 'aria-label': 'Controls', class: 'controls-region' });
  const body = el('div', { class: 'controls-body' });
  root.append(body);

  const redraw = (): void => {
    clear(body);
    for (const filter of options.filters()) {
      if (filter.step === 'source') continue;
      const button = el('button', { type: 'button', class: 'pill dimension', text: `${filterCaption(filter)} on Filters` });
      button.addEventListener('click', () => options.openFilter(filter, button));
      body.append(button);
    }
    for (const parameter of options.parameters()) {
      const id = `param-${parameter.id}`;
      const current = options.values()[parameter.name] ?? parameter.value;
      let control: HTMLInputElement | HTMLSelectElement;
      if (parameter.type === 'number') {
        control = el('input', { type: 'number', id, class: 'input', step: 'any', value: current === null ? '' : String(current) });
      } else if (parameter.type === 'list') {
        control = el('select', { id, class: 'input' }, parameter.values.map((value) => el('option', { value, text: value })));
        if (typeof current === 'string') (control as HTMLSelectElement).value = current;
      } else {
        control = el('input', {
          type: 'text',
          id,
          class: 'input',
          role: 'combobox',
          'aria-expanded': 'false',
          value: current === null ? '' : String(current),
        });
      }
      const commit = (): void => {
        const raw = control.value;
        options.onParameter(parameter.name, parameter.type === 'number' ? Number(raw) : raw);
      };
      control.addEventListener('keydown', (event) => {
        if ((event as KeyboardEvent).key === 'Enter') {
          event.preventDefault();
          commit();
        }
      });
      control.addEventListener('blur', commit);
      if (parameter.type === 'list') control.addEventListener('change', commit);
      body.append(el('label', { for: id, text: parameter.name }), control);
    }
  };

  redraw();
  return { root, redraw };
}
