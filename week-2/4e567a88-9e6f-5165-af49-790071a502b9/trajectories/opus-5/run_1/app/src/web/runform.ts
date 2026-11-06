import { ApiFailure, AssetView, ModelView, SchemaProperty, api } from './api';
import { credits, units } from './format';
import { el } from './dom';
import { notice, alertError } from './shell';

export interface FieldHandle {
  name: string;
  property: SchemaProperty;
  control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  errorNode: HTMLElement;
  isMedia: boolean;
}

export interface RunFormHandle {
  form: HTMLFormElement;
  fields: FieldHandle[];
  values: () => Record<string, string | number>;
  focusFirst: () => void;
  showErrors: (errors: Record<string, string>) => void;
  updateEstimate: () => void;
  setBusy: (busy: boolean) => void;
}

function isMediaProperty(property: SchemaProperty): boolean {
  return property.type === 'string' && (property.contentMediaType ?? '').startsWith('image/');
}

/** Estimated units, scaled by 1e6, following each model's published unit rule. */
export function estimatedUnitsMicro(slug: string, values: Record<string, string | number>): bigint {
  const integer = (key: string): bigint => {
    const value = values[key];
    return typeof value === 'number' && Number.isInteger(value) ? BigInt(value) : 0n;
  };
  switch (slug) {
    case 'quill-still':
      return integer('num_images') * 1000000n;
    case 'halftone-xl':
      return integer('width') * integer('height') * integer('num_images');
    case 'reel-10':
      return integer('duration_seconds') * 1000000n;
    case 'murmur-voice':
      return integer('max_seconds') * 1000000n;
    default:
      return 0n;
  }
}

function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  const doubled = numerator * 2n + denominator;
  return doubled / (denominator * 2n);
}

export function reservationMicro(model: ModelView, values: Record<string, string | number>): bigint {
  const rate = BigInt(model.current_rate?.micro_per_unit ?? 0);
  return roundHalfUp(estimatedUnitsMicro(model.slug, values) * rate, 1000000n);
}

function exactUnits(unitsMicro: bigint): string {
  const whole = unitsMicro / 1000000n;
  const fraction = (unitsMicro % 1000000n).toString().padStart(6, '0').replace(/0+$/, '');
  return fraction.length === 0 ? whole.toString() : `${whole}.${fraction}`;
}

export function buildRunForm(model: ModelView, options: { onChange: () => void }): RunFormHandle {
  const form = el('form', { class: 'run-form', 'aria-label': `Run ${model.name}`, novalidate: true });
  const fields: FieldHandle[] = [];

  for (const [name, property] of Object.entries(model.input_schema.properties)) {
    const required = model.input_schema.required.includes(name);
    const fieldId = `field-${model.slug}-${name}`;
    const errorNode = el('p', { class: 'field-error', id: `${fieldId}-error` });
    const help = el('p', { class: 'field-help', id: `${fieldId}-help`, text: property.description ?? '' });
    let control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

    if (property.enum) {
      const select = el('select', { id: fieldId, class: 'control' });
      for (const option of property.enum) {
        select.append(el('option', { value: String(option), text: String(option) }));
      }
      select.value = String(property.default ?? property.enum[0]);
      control = select;
    } else if (property.type === 'integer') {
      control = el('input', {
        id: fieldId,
        class: 'control',
        type: 'number',
        step: '1',
        min: property.minimum ?? null,
        max: property.maximum ?? null,
        value: property.default === undefined ? '' : String(property.default),
      });
    } else if ((property.maxLength ?? 0) > 200 && !isMediaProperty(property)) {
      control = el('textarea', {
        id: fieldId,
        class: 'control',
        rows: 4,
        maxlength: property.maxLength ?? null,
        '.value': property.default === undefined ? '' : String(property.default),
      });
    } else {
      control = el('input', {
        id: fieldId,
        class: 'control',
        type: 'text',
        maxlength: property.maxLength ?? null,
        value: property.default === undefined ? '' : String(property.default),
      });
    }
    control.setAttribute('aria-describedby', `${fieldId}-help ${fieldId}-error`);
    if (required) control.setAttribute('aria-required', 'true');
    control.addEventListener('input', options.onChange);
    control.addEventListener('change', options.onChange);

    const label = el('label', { class: 'field-label', for: fieldId, text: property.title });
    const marker = required ? el('span', { class: 'required-mark', text: 'Required' }) : null;

    const media = isMediaProperty(property);
    const row = el('div', { class: `field${media ? ' field-media' : ''}` }, [
      el('div', { class: 'field-head' }, [label, marker]),
      help,
    ]);
    if (media) {
      const uploadButton = el('button', {
        type: 'button',
        class: 'secondary',
        text: `Upload image for ${property.title}`,
        'aria-label': `Upload image for ${property.title}`,
      });
      const clearButton = el('button', {
        type: 'button',
        class: 'secondary',
        text: `Clear ${property.title}`,
        'aria-label': `Clear ${property.title}`,
      });
      const picker = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', class: 'file-input' });
      picker.addEventListener('change', () => {
        const file = picker.files?.[0];
        if (!file) return;
        notice('Uploading…');
        void api
          .postRaw<{ asset: AssetView }>('/api/uploads', file, { 'x-file-name': file.name })
          .then((response) => {
            (control as HTMLInputElement).value = `asset:${response.asset.id}`;
            notice(`Uploaded ${file.name}.`);
            options.onChange();
          })
          .catch((error: unknown) => {
            if (!(error instanceof ApiFailure)) throw error;
            if (error.status === 413) alertError('That file is larger than the upload limit.');
            else if (error.status === 415) alertError('Use a PNG, JPEG or WebP image.');
            else if (error.status === 503) alertError('Storage is unreachable. Try the upload again when it returns.');
            else alertError(error.message);
          })
          .finally(() => {
            picker.value = '';
          });
      });
      uploadButton.addEventListener('click', () => picker.click());
      clearButton.addEventListener('click', () => {
        (control as HTMLInputElement).value = '';
        options.onChange();
      });
      row.append(el('div', { class: 'media-row' }, [control, uploadButton, clearButton, picker]));
    } else {
      row.append(control);
    }
    row.append(errorNode);
    form.append(row);
    fields.push({ name, property, control, errorNode, isMedia: media });
  }

  const estimate = el('p', { class: 'estimate' });
  const runButton = el('button', { type: 'submit', class: 'primary run-button', text: 'Run' });
  form.append(el('div', { class: 'run-actions' }, [runButton, estimate]));

  const values = (): Record<string, string | number> => {
    const collected: Record<string, string | number> = {};
    for (const field of fields) {
      const raw = field.control.value;
      if (field.property.type === 'integer') {
        if (raw.trim() === '') continue;
        const parsed = Number.parseInt(raw, 10);
        if (Number.isInteger(parsed)) collected[field.name] = parsed;
        continue;
      }
      if (raw === '') continue;
      collected[field.name] = raw;
    }
    return collected;
  };

  const handle: RunFormHandle = {
    form,
    fields,
    values,
    focusFirst: () => fields[0]?.control.focus(),
    showErrors: (errors) => {
      for (const field of fields) {
        const message = errors[`input.${field.name}`] ?? errors[field.name];
        field.errorNode.textContent = message ?? '';
        field.control.setAttribute('aria-invalid', message ? 'true' : 'false');
      }
      const firstInvalid = fields.find((field) => field.errorNode.textContent !== '');
      firstInvalid?.control.focus();
    },
    updateEstimate: () => {
      const collected = values();
      const unitsMicro = estimatedUnitsMicro(model.slug, collected);
      estimate.replaceChildren(
        document.createTextNode('Estimated '),
        el('span', { class: 'num', text: credits(reservationMicro(model, collected)) }),
        document.createTextNode(' credits for '),
        el('span', { class: 'num', text: units(exactUnits(unitsMicro), model.unit) }),
        document.createTextNode(` ${model.unit_label}`),
      );
    },
    setBusy: (busy) => {
      runButton.disabled = busy;
      runButton.textContent = busy ? 'Submitting…' : 'Run';
    },
  };
  handle.updateEstimate();
  return handle;
}

/** Checks the form against the schema in the browser, in the same shape the API answers with. */
export function validateInBrowser(
  model: ModelView,
  values: Record<string, string | number>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const [name, property] of Object.entries(model.input_schema.properties)) {
    const path = `input.${name}`;
    const value = values[name];
    const required = model.input_schema.required.includes(name);
    if (value === undefined || value === '') {
      if (required) errors[path] = 'Required.';
      continue;
    }
    if (property.type === 'integer') {
      const numeric = Number(value);
      if (!Number.isInteger(numeric)) {
        errors[path] = `Enter a whole number from ${property.minimum ?? 0} to ${property.maximum ?? 0}.`;
        continue;
      }
      if (property.enum && !property.enum.map(Number).includes(numeric)) {
        errors[path] = `Choose one of ${property.enum.join(', ')}.`;
        continue;
      }
      if (property.minimum !== undefined && numeric < property.minimum) {
        errors[path] = `Enter a whole number from ${property.minimum} to ${property.maximum ?? ''}.`;
        continue;
      }
      if (property.maximum !== undefined && numeric > property.maximum) {
        errors[path] = `Enter a whole number from ${property.minimum ?? 0} to ${property.maximum}.`;
      }
      continue;
    }
    const text = String(value);
    if (property.enum && !property.enum.map(String).includes(text)) {
      errors[path] = `Choose one of ${property.enum.join(', ')}.`;
      continue;
    }
    if (property.minLength !== undefined && text.length < property.minLength) {
      errors[path] = `Enter from ${property.minLength} to ${property.maxLength ?? ''} characters.`;
      continue;
    }
    if (property.maxLength !== undefined && text.length > property.maxLength) {
      errors[path] = `Enter from ${property.minLength ?? 0} to ${property.maxLength} characters.`;
    }
  }
  return errors;
}
