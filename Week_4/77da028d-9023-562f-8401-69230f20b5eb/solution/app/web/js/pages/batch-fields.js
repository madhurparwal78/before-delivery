// The batch fields shared by Log batch and Amend session.
import { h } from '../core/dom.js';
import { field } from '../core/forms.js';
import { parseNumber } from './values.js';

const NUMBER_FIELDS = [
  ['sub_count', 'Subs', { min: '1', step: '1' }],
  ['exposure_s', 'Sub exposure (s)', { min: '1', step: '1' }],
  ['gain', 'Gain', { min: '0', step: '1' }],
  ['offset', 'Offset', { min: '0', step: '1' }],
  ['temperature_c', 'Sensor temperature (C)', { min: '-40', max: '40', step: '0.1' }],
  ['binning', 'Binning', { min: '1', max: '4', step: '1' }],
];

// createBatchFields({filters, values, prefix}) -> {element, read()}
// `prefix` namespaces data-field so repeated batches link to the right input from the error summary.
export function createBatchFields({ filters, values = {}, prefix = '' }) {
  const filter = h('select', { 'data-field': `${prefix}filter` },
    filters.map((name) => h('option', { value: name, selected: name === values.filter }, name)));
  const camera = h('input', { type: 'text', maxlength: '60', value: values.camera ?? '', 'data-field': `${prefix}camera` });
  const numbers = NUMBER_FIELDS.map(([name, label, attributes]) => ({
    name,
    label,
    input: h('input', { type: 'number', ...attributes, value: values[name] ?? '', 'data-field': `${prefix}${name}` }),
  }));
  const element = h('div', { class: 'batch-fields' },
    field({ label: 'Filter', input: filter }),
    ...numbers.map(({ label, input }) => field({ label, input })),
    field({ label: 'Camera', input: camera }));
  return {
    element,
    read() {
      const batch = { filter: filter.value, camera: camera.value.trim() };
      for (const { name, input } of numbers) batch[name] = parseNumber(input.value);
      if (values.id) batch.id = values.id;
      return batch;
    },
  };
}
