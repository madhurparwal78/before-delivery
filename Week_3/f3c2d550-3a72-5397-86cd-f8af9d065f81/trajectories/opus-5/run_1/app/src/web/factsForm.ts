import { COLOUR_FAMILIES, FORM_ORDER } from '../shared/copy.js';
import type { ReferenceJson, Unit } from '../shared/types.js';
import { element, setText } from './dom.js';

/**
 * The capture fields, in the published form order. The facts edit form follows the same
 * order for the fields it shows.
 */

export interface FactsForm {
  root: HTMLElement;
  photoInput: HTMLInputElement | null;
  pickSwatch: HTMLButtonElement;
  unitOf(): Unit;
  values(): Record<string, string>;
  patch(): Record<string, unknown>;
  fill(reference: ReferenceJson, unit: Unit): void;
  clear(): void;
  showErrors(fields: Record<string, string>): void;
  clearErrors(): void;
  onUnitChange(listener: (unit: Unit) => void): void;
}

interface Control {
  input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  error: HTMLElement;
}

let sequence = 0;

function textField(
  label: string,
  name: string,
  kind: 'text' | 'textarea' = 'text',
): { wrapper: HTMLElement; control: Control } {
  sequence += 1;
  const id = `field-${name}-${sequence}`;
  const errorId = `${id}-error`;
  const input =
    kind === 'textarea'
      ? element('textarea', { id, name, rows: 4 })
      : element('input', { id, name, type: 'text', autocomplete: 'off' });
  const error = element('p', { id: errorId, class: 'field-error', hidden: true });
  const wrapper = element('div', { class: 'form-field' }, [
    element('label', { for: id }, [label]),
    input,
    error,
  ]);
  return { wrapper, control: { input, error } };
}

export function buildFactsForm(options: {
  includePhoto: boolean;
  unit: Unit;
  onPhotoChosen?: (file: File | null) => void;
}): FactsForm {
  const controls = new Map<string, Control>();
  const children: HTMLElement[] = [];
  const unitListeners: Array<(unit: Unit) => void> = [];

  let photoInput: HTMLInputElement | null = null;
  if (options.includePhoto) {
    sequence += 1;
    const id = `field-photo-${sequence}`;
    photoInput = element('input', {
      id,
      name: 'photo',
      type: 'file',
      accept: 'image/jpeg,image/png',
      capture: 'environment',
    });
    const error = element('p', { id: `${id}-error`, class: 'field-error', hidden: true });
    controls.set('photo', { input: photoInput, error });
    children.push(
      element('div', { class: 'form-field' }, [
        element('label', { for: id }, ['Photograph']),
        photoInput,
        error,
      ]),
    );
    photoInput.addEventListener('change', () =>
      options.onPhotoChosen?.(photoInput?.files?.[0] ?? null),
    );
  }

  const pickSwatch = element('button', { type: 'button', class: 'action quiet' }, [
    'Pick swatch',
  ]);
  const swatchError = element('p', { class: 'field-error', hidden: true });
  children.push(element('div', { class: 'form-field' }, [pickSwatch, swatchError]));

  for (const [label, name] of [
    ['Name', 'title'],
    ['Maker', 'maker'],
    ['Year', 'year'],
  ] as const) {
    const { wrapper, control } = textField(label, name);
    controls.set(name, control);
    children.push(wrapper);
  }

  sequence += 1;
  const unitName = `unit-${sequence}`;
  const unitRadios = (['mm', 'in'] as const).map((value) => {
    const id = `${unitName}-${value}`;
    const input = element('input', {
      id,
      type: 'radio',
      name: unitName,
      value,
      checked: value === options.unit,
    });
    input.addEventListener('change', () => {
      if (input.checked) for (const listener of unitListeners) listener(value);
    });
    return { value, input, label: element('label', { for: id }, [value]) };
  });
  const unitError = element('p', { class: 'field-error', hidden: true });
  children.push(
    element('div', { class: 'form-field' }, [
      element(
        'div',
        { role: 'radiogroup', 'aria-label': 'Size unit', class: 'radio-row' },
        unitRadios.flatMap((radio) => [radio.input, radio.label]),
      ),
      unitError,
    ]),
  );
  controls.set('unit', { input: unitRadios[0]!.input, error: unitError });

  for (const [label, name] of [
    ['Width', 'width'],
    ['Height', 'height'],
    ['Depth', 'depth'],
    ['Materials', 'materials'],
    ['Finish', 'finish'],
  ] as const) {
    const { wrapper, control } = textField(label, name);
    controls.set(name, control);
    children.push(wrapper);
  }

  sequence += 1;
  const colourId = `field-colour-${sequence}`;
  const colourSelect = element('select', { id: colourId, name: 'colour_family' }, [
    element('option', { value: '' }, ['Choose a colour family']),
    ...COLOUR_FAMILIES.map((family) => element('option', { value: family }, [family])),
  ]);
  const colourError = element('p', { class: 'field-error', hidden: true });
  controls.set('colour_family', { input: colourSelect, error: colourError });
  children.push(
    element('div', { class: 'form-field' }, [
      element('label', { for: colourId }, ['Colour family']),
      colourSelect,
      colourError,
    ]),
  );

  for (const [label, name, kind] of [
    ['Source link', 'source_url', 'text'],
    ['Where you found it', 'source_note', 'text'],
    ['Notes', 'notes', 'textarea'],
  ] as const) {
    const { wrapper, control } = textField(label, name, kind);
    controls.set(name, control);
    children.push(wrapper);
  }

  const root = element('div', { class: 'facts-form' }, children);

  function unitOf(): Unit {
    return unitRadios.find((radio) => radio.input.checked)?.value ?? 'mm';
  }

  function values(): Record<string, string> {
    const collected: Record<string, string> = { unit: unitOf() };
    for (const [name, control] of controls) {
      if (name === 'photo' || name === 'unit') continue;
      collected[name] = (control.input as HTMLInputElement).value;
    }
    return collected;
  }

  function controlFor(field: string): HTMLElement | null {
    if (field === 'swatch_x' || field === 'swatch_y') return pickSwatch;
    return controls.get(field)?.input ?? null;
  }

  return {
    root,
    photoInput,
    pickSwatch,
    unitOf,
    values,
    patch() {
      const collected: Record<string, unknown> = { unit: unitOf() };
      for (const [name, control] of controls) {
        if (name === 'photo' || name === 'unit') continue;
        collected[name] = (control.input as HTMLInputElement).value;
      }
      return collected;
    },
    fill(reference, unit) {
      const assign = (name: string, value: string): void => {
        const control = controls.get(name);
        if (control) (control.input as HTMLInputElement).value = value;
      };
      assign('title', reference.title);
      assign('maker', reference.maker ?? '');
      assign('year', reference.year === null ? '' : String(reference.year));
      assign('materials', reference.materials.join(', '));
      assign('finish', reference.finish ?? '');
      assign('colour_family', reference.colour_family);
      assign('source_url', reference.source_url ?? '');
      assign('source_note', reference.source_note ?? '');
      assign('notes', reference.notes ?? '');
      for (const radio of unitRadios) radio.input.checked = radio.value === unit;
      const sizes = reference.size_text[unit].replace(` ${unit}`, '').split(' × ');
      assign('width', sizes[0] ?? '');
      assign('height', sizes[1] ?? '');
      assign('depth', sizes[2] ?? '');
    },
    clear() {
      for (const [name, control] of controls) {
        if (name === 'unit') continue;
        (control.input as HTMLInputElement).value = '';
      }
      this.clearErrors();
    },
    clearErrors() {
      for (const control of controls.values()) {
        control.input.removeAttribute('aria-invalid');
        control.input.removeAttribute('aria-describedby');
        control.error.hidden = true;
        setText(control.error, '');
      }
      swatchError.hidden = true;
      setText(swatchError, '');
      pickSwatch.removeAttribute('aria-invalid');
    },
    /** Every field the answer names is marked and linked to its error text. */
    showErrors(fields) {
      this.clearErrors();
      for (const [field, copy] of Object.entries(fields)) {
        if (field === 'swatch_x' || field === 'swatch_y') {
          swatchError.hidden = false;
          setText(swatchError, copy);
          pickSwatch.setAttribute('aria-invalid', 'true');
          continue;
        }
        const control = controls.get(field);
        if (!control) continue;
        control.error.hidden = false;
        setText(control.error, copy);
        control.input.setAttribute('aria-invalid', 'true');
        const errorId = control.error.id || `${control.input.id}-error`;
        control.error.id = errorId;
        control.input.setAttribute('aria-describedby', errorId);
      }
      const first = FORM_ORDER.find((field) => field in fields);
      if (first) controlFor(first)?.focus();
    },
    onUnitChange(listener) {
      unitListeners.push(listener);
    },
  };
}
