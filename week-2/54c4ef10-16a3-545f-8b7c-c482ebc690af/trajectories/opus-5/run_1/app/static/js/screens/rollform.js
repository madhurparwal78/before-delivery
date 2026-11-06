// The roll form, used for both New roll and Edit roll.
import * as api from '../api.js';
import { COPY, FORMATS, LIMITS, fieldCopy } from '../boot.js';
import { el, field, option, setFieldError } from '../dom.js';
import { activity } from '../main.js';

function characters(value) {
  return [...value.trim()].length;
}

export async function render(context) {
  const rollId = context.params[0] || null;
  const roll = rollId ? await api.get(`/api/rolls/${rollId}`) : null;
  const { rolls } = await api.get('/api/rolls');
  const testRolls = rolls.filter((item) => item.kind === 'test' && item.id !== rollId);

  const nameField = field('Roll name', el('input', { type: 'text', value: roll ? roll.name : '' }));
  const stockField = field('Stock', el('input', { type: 'text', value: roll ? roll.stock : '' }));
  const formatControl = el(
    'select',
    { disabled: Boolean(roll) },
    FORMATS.map((item) => option(item.value, item.label, roll ? roll.format === item.value : item.value === '35mm')),
  );
  const formatField = field('Format', formatControl);
  const eiField = field('EI', el('input', {
    type: 'number',
    min: 6,
    max: 12800,
    step: 1,
    value: roll ? roll.ei : 400,
  }));
  const pushField = field('Push or pull', el('input', {
    type: 'number',
    min: -3,
    max: 3,
    step: 1,
    value: roll ? roll.push_pull : 0,
  }));
  const exponentField = field('Reciprocity exponent', el('input', {
    type: 'number',
    min: 0.5,
    max: 1,
    step: 0.01,
    value: roll ? Number(roll.reciprocity_p).toFixed(2) : '1.00',
  }));
  const noteField = field('Development note', el('textarea', {
    rows: 3,
    value: roll ? roll.development_note : '',
  }));

  const normalRadio = el('input', {
    type: 'radio',
    name: 'kind',
    value: 'normal',
    checked: !roll || roll.kind === 'normal',
    disabled: Boolean(roll),
  });
  const testRadio = el('input', {
    type: 'radio',
    name: 'kind',
    value: 'test',
    checked: Boolean(roll) && roll.kind === 'test',
    disabled: Boolean(roll),
  });
  const kindGroup = el('fieldset', { class: 'kinds' }, [
    el('legend', { text: 'Kind' }),
    el('label', {}, [normalRadio, el('span', { text: 'Normal roll' })]),
    el('label', {}, [testRadio, el('span', { text: 'Test roll' })]),
  ]);
  normalRadio.setAttribute('aria-label', 'Normal roll');
  testRadio.setAttribute('aria-label', 'Test roll');

  const curveControl = el('select', {}, [
    option('', 'None', !roll || !roll.curve_roll_id),
    ...testRolls.map((item) => option(item.id, item.name, roll && roll.curve_roll_id === item.id)),
  ]);
  const curveField = field('Curve from test roll', curveControl);

  function syncKind() {
    curveControl.disabled = testRadio.checked;
    if (testRadio.checked) curveControl.value = '';
  }
  normalRadio.addEventListener('change', syncKind);
  testRadio.addEventListener('change', syncKind);
  syncKind();

  const submit = el('button', {
    type: 'submit',
    class: 'solid',
    text: roll ? 'Save roll' : 'Create roll',
  });
  const form = el('form', { class: 'single-column', novalidate: true }, [
    el('h1', { text: roll ? 'Edit roll' : 'New roll' }),
    nameField.wrapper,
    stockField.wrapper,
    formatField.wrapper,
    eiField.wrapper,
    pushField.wrapper,
    exponentField.wrapper,
    noteField.wrapper,
    kindGroup,
    curveField.wrapper,
    submit,
  ]);

  const entries = [nameField, stockField, eiField, pushField, exponentField, noteField, curveField];

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    for (const entry of entries) setFieldError(entry, '');
    const body = {
      name: nameField.control.value.trim(),
      stock: stockField.control.value.trim(),
      ei: Number(eiField.control.value),
      push_pull: Number(pushField.control.value),
      reciprocity_p: Number(Number(exponentField.control.value).toFixed(2)),
      development_note: noteField.control.value.trim(),
      curve_roll_id: curveControl.value || null,
    };
    const local = {};
    if (characters(body.name) < 1 || characters(body.name) > LIMITS.name) local.name = fieldCopy('name');
    if (characters(body.stock) < 1 || characters(body.stock) > LIMITS.stock) local.stock = fieldCopy('stock');
    if (!Number.isInteger(body.ei) || body.ei < 6 || body.ei > 12800) local.ei = fieldCopy('ei');
    if (!Number.isInteger(body.push_pull) || Math.abs(body.push_pull) > 3) {
      local.push_pull = fieldCopy('push_pull');
    }
    if (!(body.reciprocity_p >= 0.5 && body.reciprocity_p <= 1)) {
      local.reciprocity_p = fieldCopy('reciprocity_p');
    }
    if (characters(body.development_note) > LIMITS.note) {
      local.development_note = fieldCopy('development_note');
    }
    if (Object.keys(local).length > 0) {
      showFields(local);
      return;
    }
    activity(COPY.pending.roll);
    try {
      let saved;
      if (roll) {
        saved = await api.patch(`/api/rolls/${roll.id}`, body);
      } else {
        saved = await api.post('/api/rolls', {
          ...body,
          format: formatControl.value,
          kind: testRadio.checked ? 'test' : 'normal',
        });
      }
      await context.navigate(`/rolls/${saved.id}`);
      activity(COPY.success.roll);
    } catch (failure) {
      if (failure.status === 422) showFields(failure.fields);
      else activity(COPY.error[failure.code] || '');
    }
  });

  function showFields(fields) {
    const order = [
      ['name', nameField],
      ['stock', stockField],
      ['format', formatField],
      ['ei', eiField],
      ['push_pull', pushField],
      ['reciprocity_p', exponentField],
      ['development_note', noteField],
      ['curve_roll_id', curveField],
    ];
    let focused = false;
    let first = '';
    for (const [key, entry] of order) {
      if (fields[key]) {
        setFieldError(entry, fields[key]);
        if (!focused) {
          entry.control.focus();
          first = fields[key];
          focused = true;
        }
      }
    }
    activity(first);
  }

  return el('section', { class: 'roll-form' }, [form]);
}
