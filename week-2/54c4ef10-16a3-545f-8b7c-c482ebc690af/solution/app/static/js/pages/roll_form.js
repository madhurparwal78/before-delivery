// New roll and Edit roll.
import { get, patch, post } from '../api.js';
import { announce, field, h, showFieldErrors } from '../dom.js';
import { hooks } from '../hooks.js';
import { LIMITS, MESSAGES, RANGES } from '../domain.js';
import { characters } from '../format.js';
import { notFoundPage } from './shared.js';

const FORMATS = [['35mm', '35mm'], ['120-6x6', '120 6×6'], ['120-6x7', '120 6×7']];

function validate(values) {
  const problems = {};
  const whole = (value, [low, high]) => Number.isInteger(value) && value >= low && value <= high;
  if (!(characters(values.name) >= 1 && characters(values.name) <= LIMITS.name)) problems.name = MESSAGES.name;
  if (!(characters(values.stock) >= 1 && characters(values.stock) <= LIMITS.stock)) problems.stock = MESSAGES.stock;
  if (!whole(values.ei, RANGES.ei)) problems.ei = MESSAGES.ei;
  if (!whole(values.push_pull, RANGES.push_pull)) problems.push_pull = MESSAGES.push_pull;
  const p = values.reciprocity_p;
  if (!(Number.isFinite(p) && p >= RANGES.reciprocity_p[0] && p <= RANGES.reciprocity_p[1] && Math.abs(p * 100 - Math.round(p * 100)) < 1e-9)) {
    problems.reciprocity_p = MESSAGES.reciprocity_p;
  }
  if (characters(values.development_note) > LIMITS.development_note) problems.development_note = MESSAGES.development_note;
  return problems;
}

export async function render(main, { params }) {
  const editing = params.length > 0;
  const [rolls, existing] = await Promise.all([get('/api/rolls'), editing ? get(`/api/rolls/${params[0]}`) : null]);
  if (editing && !existing.ok) return notFoundPage(main);
  const roll = existing?.data;
  const tests = rolls.data.rolls.filter((candidate) => candidate.kind === 'test' && candidate.id !== roll?.id);

  const name = h('input', { type: 'text', value: roll?.name ?? '' });
  const stock = h('input', { type: 'text', value: roll?.stock ?? '' });
  const format = h('select', { disabled: editing }, FORMATS.map(([value, label]) =>
    h('option', { value, selected: (roll?.format ?? '35mm') === value }, label)));
  const ei = h('input', { type: 'number', step: 1, value: roll?.ei ?? 400 });
  const pushPull = h('input', { type: 'number', step: 1, value: roll?.push_pull ?? 0 });
  const reciprocity = h('input', { type: 'number', step: 0.01, value: (roll?.reciprocity_p ?? 1).toFixed(2) });
  const note = h('textarea', {}, roll?.development_note ?? '');
  note.value = roll?.development_note ?? '';
  const kindOf = roll?.kind ?? 'normal';
  const normal = h('input', { type: 'radio', name: 'kind', id: 'kind-normal', checked: kindOf === 'normal', disabled: editing });
  const test = h('input', { type: 'radio', name: 'kind', id: 'kind-test', checked: kindOf === 'test', disabled: editing });
  const curve = h('select', {}, h('option', { value: '' }, 'None'),
    tests.map((candidate) => h('option', { value: candidate.id, selected: roll?.curve_roll_id === candidate.id }, candidate.name)));
  const syncCurve = () => { curve.disabled = !normal.checked; };
  normal.addEventListener('change', syncCurve);
  test.addEventListener('change', syncCurve);
  syncCurve();

  const fields = {
    name: field('Roll name', name), stock: field('Stock', stock), format: field('Format', format),
    ei: field('EI', ei), push_pull: field('Push or pull', pushPull), reciprocity_p: field('Reciprocity exponent', reciprocity),
    development_note: field('Development note', note),
  };
  const kindField = h('fieldset', {}, h('legend', {}, 'Kind'), h('div', { class: 'radios' },
    h('label', { class: 'check', for: 'kind-normal' }, normal, 'Normal roll'), h('label', { class: 'check', for: 'kind-test' }, test, 'Test roll')));
  const curveField = field('Curve from test roll', curve);
  const submit = h('button', { type: 'submit', class: 'primary' }, editing ? 'Save roll' : 'Create roll');
  const form = h('form', { class: 'form', novalidate: true }, fields.name.root, fields.stock.root, fields.format.root, fields.ei.root,
    fields.push_pull.root, fields.reciprocity_p.root, fields.development_note.root, kindField, curveField.root,
    h('div', { class: 'actions' }, submit));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = {
      name: name.value, stock: stock.value, ei: ei.value.trim() === '' ? NaN : Number(ei.value),
      push_pull: pushPull.value.trim() === '' ? NaN : Number(pushPull.value),
      reciprocity_p: reciprocity.value.trim() === '' ? NaN : Number(reciprocity.value), development_note: note.value,
    };
    if (showFieldErrors({ ...fields, curve_roll_id: curveField }, validate(values))) return;
    const body = { ...values, name: values.name.trim(), stock: values.stock.trim(), development_note: values.development_note.trim(),
      curve_roll_id: normal.checked && curve.value ? curve.value : null };
    if (!editing) Object.assign(body, { format: format.value, kind: normal.checked ? 'normal' : 'test' });
    announce('Saving roll…');
    submit.disabled = true;
    const response = editing ? await patch(`/api/rolls/${roll.id}`, body) : await post('/api/rolls', body);
    submit.disabled = false;
    if (response.status === 422) {
      showFieldErrors({ ...fields, kind: fields.format, curve_roll_id: curveField }, response.data.fields);
      return;
    }
    if (!response.ok) {
      announce(MESSAGES.curve_roll_id);
      return;
    }
    await hooks.navigate(`/rolls/${response.data.id}`);
    announce('Roll saved.');
  });
  main.append(h('div', { class: 'page-head' }, h('h1', {}, editing ? 'Edit roll' : 'New roll')), form);
}
