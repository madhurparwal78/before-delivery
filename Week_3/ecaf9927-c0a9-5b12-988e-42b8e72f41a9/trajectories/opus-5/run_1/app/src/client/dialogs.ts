import type { Ctx, DialogKind } from './context.js';
import { COPY } from './copy.js';
import { el, textField } from './dom.js';
import { show } from './format.js';

const TITLES: Record<DialogKind, string> = {
  'new-part': 'New part',
  'new-assembly': 'New assembly',
  'new-purchased': 'New purchased part',
  'new-sketch': 'New sketch',
  'add-to-assembly': 'Add to assembly',
};

const SUBMIT_LABELS: Record<DialogKind, string> = {
  'new-part': 'Create part',
  'new-assembly': 'Create assembly',
  'new-purchased': 'Create purchased part',
  'new-sketch': 'Create sketch',
  'add-to-assembly': COPY.add,
};

function bindText(ctx: Ctx, row: HTMLElement, name: string): HTMLElement {
  const input = row.querySelector('input') as HTMLInputElement;
  input.addEventListener('input', () => ctx.actions.setDialogField(name, input.value));
  return row;
}

function dialogFields(ctx: Ctx, kind: DialogKind): HTMLElement[] {
  const fields = ctx.state.dialogFields;
  const errors = ctx.state.dialogErrors;
  if (kind === 'new-part') {
    const select = el('select', { 'aria-label': 'Material', id: 'dialog-material' });
    for (const material of ctx.state.materials) {
      select.appendChild(
        el('option', { value: material.id, selected: fields.material_id === material.id }, [
          `${material.name} \u00b7 ${show.density(material.density_g_cm3)}`,
        ]),
      );
    }
    select.addEventListener('change', () => ctx.actions.setDialogField('material_id', select.value));
    return [
      bindText(ctx, textField('Name', 'dialog-name', fields.name ?? '', errors.name), 'name'),
      el('div', { class: 'field' }, [
        el('label', { for: 'dialog-material' }, ['Material']),
        select,
        ...(errors.material_id ? [el('p', { class: 'field-error' }, [errors.material_id])] : []),
      ]),
    ];
  }
  if (kind === 'new-assembly') {
    return [bindText(ctx, textField('Name', 'dialog-name', fields.name ?? '', errors.name), 'name')];
  }
  if (kind === 'new-purchased') {
    return [
      bindText(ctx, textField('Name', 'dialog-name', fields.name ?? '', errors.name), 'name'),
      bindText(
        ctx,
        textField(
          'Declared mass (g)',
          'dialog-mass',
          fields.declared_mass_g ?? '',
          errors.declared_mass_g,
        ),
        'declared_mass_g',
      ),
    ];
  }
  if (kind === 'new-sketch') {
    const planes = el('div', { role: 'radiogroup', 'aria-label': 'Plane', class: 'radios' });
    for (const plane of [
      { value: 'top', label: 'Top' },
      { value: 'front', label: 'Front' },
      { value: 'right', label: 'Right' },
    ]) {
      const id = `plane-${plane.value}`;
      const input = el('input', {
        type: 'radio',
        name: 'plane',
        id,
        checked: (fields.plane ?? 'top') === plane.value,
      });
      input.addEventListener('change', () => ctx.actions.setDialogField('plane', plane.value));
      planes.appendChild(el('span', { class: 'radio' }, [input, el('label', { for: id }, [plane.label])]));
    }
    return [
      planes,
      bindText(ctx, textField('Offset', 'dialog-offset', fields.offset ?? '0', errors.offset), 'offset'),
    ];
  }
  const components = el('select', { 'aria-label': 'Component', id: 'dialog-component' });
  const options: { id: string; type: string; name: string }[] = [
    ...ctx.state.parts.map((part) => ({ id: part.id, type: 'part', name: part.name })),
    ...ctx.state.purchased.map((item) => ({ id: item.id, type: 'purchased', name: item.name })),
    ...ctx.state.assemblies.map((item) => ({ id: item.id, type: 'assembly', name: item.name })),
  ];
  for (const option of options) {
    const value = `${option.type}:${option.id}`;
    components.appendChild(
      el('option', { value, selected: fields.component === value }, [option.name]),
    );
  }
  components.addEventListener('change', () =>
    ctx.actions.setDialogField('component', components.value),
  );
  const quantity = el('input', {
    type: 'number',
    min: '1',
    max: '999',
    step: '1',
    value: ctx.state.dialogFields.quantity ?? '1',
    'aria-label': 'Quantity',
    id: 'dialog-quantity',
  });
  quantity.addEventListener('input', () => ctx.actions.setDialogField('quantity', quantity.value));
  return [
    el('div', { class: 'field' }, [
      el('label', { for: 'dialog-component' }, ['Component']),
      components,
      ...(ctx.state.dialogErrors.component
        ? [el('p', { class: 'field-error' }, [ctx.state.dialogErrors.component])]
        : []),
    ]),
    el('div', { class: 'field' }, [
      el('label', { for: 'dialog-quantity' }, ['Quantity']),
      quantity,
      ...(ctx.state.dialogErrors.quantity
        ? [el('p', { class: 'field-error' }, [ctx.state.dialogErrors.quantity])]
        : []),
    ]),
  ];
}

export function renderDialog(ctx: Ctx, kind: DialogKind): HTMLElement {
  const panel = el('div', {
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': TITLES[kind],
    class: 'dialog',
  });
  const form = el('form', {}, dialogFields(ctx, kind));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    ctx.actions.submitDialog();
  });
  const pendingLabel = kind === 'add-to-assembly' ? COPY.adding : SUBMIT_LABELS[kind];
  form.appendChild(
    el('div', { class: 'dialog-actions' }, [
      el(
        'button',
        { type: 'submit', class: 'primary', disabled: ctx.state.dialogPending },
        [ctx.state.dialogPending ? pendingLabel : SUBMIT_LABELS[kind]],
      ),
      cancelButton(ctx),
    ]),
  );
  panel.appendChild(el('h2', { class: 'panel-title' }, [TITLES[kind]]));
  panel.appendChild(form);
  return panel;
}

function cancelButton(ctx: Ctx): HTMLElement {
  const node = el('button', { type: 'button' }, ['Cancel']);
  node.addEventListener('click', () => ctx.actions.closeDialog());
  return node;
}
