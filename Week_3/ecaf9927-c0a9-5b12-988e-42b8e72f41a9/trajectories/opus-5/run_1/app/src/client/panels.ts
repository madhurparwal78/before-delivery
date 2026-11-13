import {
  CONSTRAINT_LABEL_WORD,
  DIMENSION_KINDS,
  type Assembly,
  type Bom,
  type ConstraintKind,
  type Part,
  type TreeRow,
} from '../shared/api.js';
import type { Tolerance } from '../shared/units.js';
import { COPY, slackReadout } from './copy.js';
import type { Ctx, Mode } from './context.js';
import { el, textField } from './dom.js';
import { displayOf, show } from './format.js';
import { canApply, dimensionKindFor } from './selection.js';

const CONSTRAIN_BUTTONS: ConstraintKind[] = [
  'coincident',
  'horizontal',
  'vertical',
  'parallel',
  'perpendicular',
  'equal',
  'fix',
  'distance',
  'horizontal_distance',
  'vertical_distance',
];

const TOOL_LABELS: { tool: Ctx['state']['tool']; label: string }[] = [
  { tool: 'select', label: 'Select' },
  { tool: 'line', label: 'Line' },
  { tool: 'circle', label: 'Circle' },
  { tool: 'arc', label: 'Arc' },
  { tool: 'point', label: 'Point' },
];

export function partOf(ctx: Ctx, mode: Mode | null): Part | null {
  if (!mode) return null;
  if (mode.kind === 'part' || mode.kind === 'feature') {
    return ctx.state.parts.find((part) => part.id === mode.partId) ?? null;
  }
  if (mode.kind === 'sketch') {
    return ctx.state.parts.find((part) => part.id === ctx.state.sketch?.part_id) ?? null;
  }
  return null;
}

export function chipFor(ctx: Ctx, part: Part): string {
  if (ctx.state.savingPartId === part.id && ctx.state.saveStatus === 'saving') return COPY.saving;
  if (part.body.status === 'none') return COPY.noBody;
  if (part.body.status === 'stored') return COPY.stored;
  if (part.body.status === 'saving') return COPY.saving;
  return COPY.notStored;
}

function button(
  label: string,
  attributes: Record<string, string | boolean | undefined>,
  onClick: (event: MouseEvent) => void,
): HTMLButtonElement {
  const node = el('button', { type: 'button', ...attributes }, [label]);
  node.addEventListener('click', onClick);
  return node;
}

// ---------------------------------------------------------------- feature tree

type TreeEntry = { key: string; node: HTMLElement };

export function featureTreeItems(ctx: Ctx): string[] {
  const keys: string[] = [];
  for (const assembly of ctx.state.assemblies) keys.push(`assembly:${assembly.id}`);
  for (const part of sortedParts(ctx)) {
    keys.push(`part:${part.id}`);
    if (ctx.state.partsExpanded.has(part.id)) {
      for (const sketch of part.sketches) keys.push(`sketch:${sketch.id}`);
      for (const feature of part.features) keys.push(`feature:${part.id}:${feature.id}`);
    }
  }
  for (const purchased of ctx.state.purchased) keys.push(`purchased:${purchased.id}`);
  return keys;
}

function sortedParts(ctx: Ctx): Part[] {
  return [...ctx.state.parts].sort((left, right) => left.name.localeCompare(right.name));
}

function treeItem(ctx: Ctx, key: string, label: string, depth: number, extras: Record<string, string | boolean | undefined> = {}): TreeEntry {
  const node = el(
    'div',
    {
      role: 'treeitem',
      id: `tree-${key.replace(/[^a-zA-Z0-9]/g, '-')}`,
      tabindex: '-1',
      class: `tree-item depth-${depth} ${ctx.state.treeActive === key ? 'active' : ''}`,
      'data-tree-key': key,
      ...extras,
    },
    [label],
  );
  node.addEventListener('click', () => ctx.actions.openTreeKey(key));
  return { key, node };
}

export function renderFeatureTree(ctx: Ctx): HTMLElement {
  const tree = el('div', {
    role: 'tree',
    'aria-label': 'Feature tree',
    tabindex: '0',
    class: 'tree',
    'data-focus-key': 'feature-tree',
  });
  const active = ctx.state.treeActive;
  if (active) tree.setAttribute('aria-activedescendant', `tree-${active.replace(/[^a-zA-Z0-9]/g, '-')}`);

  const group = (title: string, children: HTMLElement[]): HTMLElement =>
    el('div', { class: 'tree-group' }, [
      el('h2', { class: 'tree-group-title' }, [title]),
      el('div', { role: 'group' }, children),
    ]);

  tree.appendChild(
    group(
      'Assemblies',
      ctx.state.assemblies.map(
        (assembly) => treeItem(ctx, `assembly:${assembly.id}`, assembly.name, 0).node,
      ),
    ),
  );

  const partNodes: HTMLElement[] = [];
  for (const part of sortedParts(ctx)) {
    const expanded = ctx.state.partsExpanded.has(part.id);
    partNodes.push(
      treeItem(ctx, `part:${part.id}`, `${part.name} ${chipFor(ctx, part)}`, 0, {
        'aria-expanded': expanded ? 'true' : 'false',
      }).node,
    );
    if (!expanded) continue;
    const children: HTMLElement[] = [];
    for (const sketch of part.sketches) {
      children.push(treeItem(ctx, `sketch:${sketch.id}`, sketch.name, 1).node);
    }
    for (const feature of part.features) {
      children.push(treeItem(ctx, `feature:${part.id}:${feature.id}`, feature.name, 1).node);
    }
    partNodes.push(el('div', { role: 'group' }, children));
  }
  tree.appendChild(group('Parts', partNodes));

  tree.appendChild(
    group(
      'Purchased parts',
      ctx.state.purchased.map(
        (purchased) => treeItem(ctx, `purchased:${purchased.id}`, purchased.name, 0).node,
      ),
    ),
  );

  const panel = el('div', { class: 'tree-panel-inner' }, [tree]);
  if (ctx.state.member?.role === 'founder') {
    panel.appendChild(
      el('div', { class: 'tree-actions' }, [
        button('New part', { 'data-focus-key': 'new-part' }, (event) =>
          ctx.actions.openDialog('new-part', event.currentTarget as HTMLElement),
        ),
        button('New assembly', { 'data-focus-key': 'new-assembly' }, (event) =>
          ctx.actions.openDialog('new-assembly', event.currentTarget as HTMLElement),
        ),
        button('New purchased part', { 'data-focus-key': 'new-purchased' }, (event) =>
          ctx.actions.openDialog('new-purchased', event.currentTarget as HTMLElement),
        ),
      ]),
    );
  }
  return panel;
}

// ------------------------------------------------------------- assembly panel

function massCell(value: number | null): string {
  return value === null ? COPY.dash : show.mass(value);
}

function assemblyRows(ctx: Ctx, rows: TreeRow[], depth: number, into: HTMLElement[]): void {
  const founder = ctx.state.member?.role === 'founder';
  for (const row of rows) {
    const expanded = ctx.state.treeExpanded.has(row.instance_id);
    const itemCell = el('td', { class: `item-cell depth-${depth}` }, [row.component.name]);
    if (row.children) {
      itemCell.insertBefore(
        button(expanded ? '\u25be' : '\u25b8', {
          'aria-label': `${expanded ? 'Collapse' : 'Expand'} ${row.component.name}`,
          'aria-expanded': expanded ? 'true' : 'false',
          class: 'twisty',
        }, () => ctx.actions.toggleTreeRow(row.instance_id)),
        itemCell.firstChild,
      );
    }
    if (row.body_status === 'not_stored' || row.body_status === 'none') {
      itemCell.appendChild(el('span', { class: 'chip' }, [COPY.notStored]));
    }
    const quantityCell = el('td', { class: 'num' });
    if (founder) {
      const input = el('input', {
        type: 'number',
        min: '1',
        max: '999',
        step: '1',
        value: String(row.quantity),
        'aria-label': `Quantity of ${row.component.name}`,
        'data-focus-key': `qty-${row.instance_id}`,
      });
      input.addEventListener('change', () => ctx.actions.setQuantity(row.instance_id, Number(input.value)));
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          ctx.actions.setQuantity(row.instance_id, Number(input.value));
        }
      });
      quantityCell.appendChild(input);
    } else {
      quantityCell.appendChild(document.createTextNode(String(row.quantity)));
    }
    const cells = [
      itemCell,
      quantityCell,
      el('td', { class: 'num' }, [massCell(row.unit_mass_g)]),
      el('td', { class: 'num' }, [massCell(row.subtotal_mass_g)]),
      el('td', { class: 'num' }, [String(row.pieces)]),
    ];
    if (founder) {
      cells.push(
        el('td', {}, [
          button('Remove', { 'aria-label': `Remove ${row.component.name}` }, () =>
            ctx.actions.removeInstance(row.instance_id),
          ),
        ]),
      );
    }
    into.push(el('tr', {}, cells));
    if (row.children && expanded) assemblyRows(ctx, row.children, depth + 1, into);
  }
}

function renderAssemblyProperties(ctx: Ctx, assembly: Assembly): HTMLElement[] {
  const founder = ctx.state.member?.role === 'founder';
  const headers = ['Item', 'Qty', 'Unit mass', 'Subtotal', 'Pieces'].map((title) =>
    el('th', { scope: 'col' }, [title]),
  );
  if (founder) headers.push(el('th', { scope: 'col' }, ['']));
  const bodyRows: HTMLElement[] = [];
  assemblyRows(ctx, ctx.state.rows, 0, bodyRows);
  const table = el('table', { class: 'assembly-tree', 'aria-label': 'Assembly tree' }, [
    el('thead', {}, [el('tr', {}, headers)]),
    el('tbody', {}, bodyRows),
  ]);

  const totals = el('div', { role: 'region', 'aria-label': 'Assembly totals', class: 'totals' }, [
    el('p', {}, [`Total mass ${show.mass(assembly.rollup.mass_g)}`]),
    el('p', {}, [`Pieces ${assembly.rollup.part_count}`]),
    el('p', {}, [`Lines ${assembly.rollup.line_count}`]),
  ]);

  const nodes: HTMLElement[] = [el('h2', { class: 'panel-title' }, [assembly.name]), table, totals];
  if (founder) {
    nodes.push(
      button('Add to assembly', { class: 'primary', 'data-focus-key': 'add-to-assembly' }, (event) =>
        ctx.actions.openDialog('add-to-assembly', event.currentTarget as HTMLElement),
      ),
    );
  }
  return nodes;
}

// ----------------------------------------------------------------- part panel

function saveStatusText(ctx: Ctx, part: Part): string {
  if (ctx.state.savingPartId === part.id && ctx.state.saveStatus === 'saving') return COPY.saving;
  if (ctx.state.saveStatus === 'no_body') return COPY.noBodyYet;
  if (part.body.status === 'none') return COPY.noBodyYet;
  if (part.body.status === 'stored') return COPY.stored;
  return COPY.notStored;
}

function measurements(ctx: Ctx, part: Part): HTMLElement {
  const display = displayOf(ctx.state.member);
  const region = el('div', { role: 'status', 'aria-label': 'Measurements', class: 'measurements' });
  const preview = ctx.state.preview;
  if (!part.confirmed && !preview) {
    region.appendChild(el('p', {}, [COPY.noStoredBodyYet]));
    return region;
  }
  const density = part.material.density_g_cm3;
  const heading = preview ? COPY.preview : COPY.confirmed;
  const volume = preview ? preview.volume_mm3 : part.confirmed?.volume_mm3 ?? null;
  const mass = preview ? preview.mass_g : part.confirmed?.mass_g ?? null;
  const area = preview ? null : part.confirmed?.area_mm2 ?? null;
  const centroid = preview ? null : part.confirmed?.centroid_mm ?? null;
  region.appendChild(el('h3', { class: 'measure-heading' }, [heading]));
  const row = (label: string, value: string): HTMLElement =>
    el('div', { class: 'measure-row' }, [el('span', {}, [label]), el('span', { class: 'figure' }, [value])]);
  region.appendChild(row('Volume', volume === null ? COPY.dash : show.volume(volume, display)));
  region.appendChild(row('Surface area', area === null ? COPY.dash : show.area(area, display)));
  region.appendChild(
    row('Centroid', centroid === null ? COPY.dash : show.centroid(centroid, display)),
  );
  region.appendChild(row('Mass', mass === null ? COPY.dash : show.mass(mass)));
  void density;
  return region;
}

function renderPartProperties(ctx: Ctx, part: Part): HTMLElement[] {
  const founder = ctx.state.member?.role === 'founder';
  const nodes: HTMLElement[] = [
    el('h2', { class: 'panel-title' }, [part.name]),
    el('div', { role: 'status', 'aria-label': 'Save status', class: 'save-status' }, [
      saveStatusText(ctx, part),
    ]),
  ];
  if (founder) {
    const select = el('select', { 'aria-label': 'Material', 'data-focus-key': 'material' });
    for (const material of ctx.state.materials) {
      select.appendChild(
        el('option', { value: material.id, selected: material.id === part.material.id }, [
          `${material.name} \u00b7 ${show.density(material.density_g_cm3)}`,
        ]),
      );
    }
    select.addEventListener('change', () => ctx.actions.setMaterial(select.value));
    nodes.push(el('div', { class: 'field' }, [el('label', {}, ['Material']), select]));
  } else {
    nodes.push(
      el('div', { class: 'field' }, [
        el('label', {}, ['Material']),
        el('p', {}, [`${part.material.name} \u00b7 ${show.density(part.material.density_g_cm3)}`]),
      ]),
    );
  }
  nodes.push(measurements(ctx, part));
  nodes.push(button('Save part', { class: 'primary' }, () => ctx.actions.savePart()));
  if (founder) {
    nodes.push(
      button('New sketch', { 'data-focus-key': 'new-sketch' }, (event) =>
        ctx.actions.openDialog('new-sketch', event.currentTarget as HTMLElement),
      ),
    );
  }
  return nodes;
}

// --------------------------------------------------------------- sketch panel

const TOOL_FIELDS: Record<string, { label: string; key: string }[]> = {
  line: [
    { label: 'Start X', key: 'startX' },
    { label: 'Start Y', key: 'startY' },
    { label: 'End X', key: 'endX' },
    { label: 'End Y', key: 'endY' },
  ],
  circle: [
    { label: 'Centre X', key: 'centreX' },
    { label: 'Centre Y', key: 'centreY' },
    { label: 'Diameter', key: 'diameter' },
  ],
  arc: [
    { label: 'Centre X', key: 'centreX' },
    { label: 'Centre Y', key: 'centreY' },
    { label: 'Radius', key: 'radius' },
    { label: 'Start angle', key: 'startAngle' },
    { label: 'End angle', key: 'endAngle' },
  ],
  point: [
    { label: 'X', key: 'x' },
    { label: 'Y', key: 'y' },
  ],
};

const TOOL_GROUP_NAME: Record<string, string> = {
  line: 'Line',
  circle: 'Circle',
  arc: 'Arc',
  point: 'Point',
};

function renderToolForm(ctx: Ctx): HTMLElement | null {
  const tool = ctx.state.tool;
  if (tool === 'select') return null;
  const fields = TOOL_FIELDS[tool] as { label: string; key: string }[];
  const group = el('div', { role: 'group', 'aria-label': TOOL_GROUP_NAME[tool] as string, class: 'tool-form' });
  for (const field of fields) {
    const id = `tool-${field.key}`;
    const row = textField(
      field.label,
      id,
      ctx.state.toolDraft[field.key] ?? '',
      ctx.state.toolErrors[field.key],
    );
    const input = row.querySelector('input') as HTMLInputElement;
    input.addEventListener('input', () => ctx.actions.setToolField(field.key, input.value));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        ctx.actions.placeEntity();
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        ctx.actions.setTool('select');
      }
    });
    group.appendChild(row);
  }
  group.appendChild(
    button(`Place ${(TOOL_GROUP_NAME[tool] as string).toLowerCase()}`, { class: 'primary' }, () =>
      ctx.actions.placeEntity(),
    ),
  );
  return group;
}

function renderConstrainGroup(ctx: Ctx): HTMLElement {
  const sketch = ctx.state.sketch;
  const group = el('div', { role: 'group', 'aria-label': 'Constrain selection', class: 'constrain' });
  for (const kind of CONSTRAIN_BUTTONS) {
    const label = kind === 'distance' ? 'Dimension' : CONSTRAINT_LABEL_WORD[kind];
    const enabled = sketch !== null && canApply(sketch, ctx.state.selection, kind);
    group.appendChild(
      button(label, { disabled: !enabled }, () => {
        if (kind === 'distance') ctx.actions.startDimension();
        else if (DIMENSION_KINDS.includes(kind)) ctx.actions.startDimension(kind);
        else ctx.actions.applyConstraint(kind);
      }),
    );
  }
  return group;
}

function renderDimensionFields(ctx: Ctx): HTMLElement | null {
  const draft = ctx.state.dimension;
  if (!draft) return null;
  const group = el('div', { class: 'dimension-fields' });
  const valueRow = textField(
    'Dimension value',
    'dimension-value',
    draft.value,
    ctx.state.dimensionErrors.value,
  );
  const valueInput = valueRow.querySelector('input') as HTMLInputElement;
  valueInput.addEventListener('input', () => ctx.actions.setDimensionField('value', valueInput.value));
  const toleranceRow = textField(
    'Tolerance',
    'dimension-tolerance',
    draft.tolerance,
    ctx.state.dimensionErrors.tolerance,
  );
  const toleranceInput = toleranceRow.querySelector('input') as HTMLInputElement;
  toleranceInput.addEventListener('input', () =>
    ctx.actions.setDimensionField('tolerance', toleranceInput.value),
  );
  for (const input of [valueInput, toleranceInput]) {
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        ctx.actions.applyDimension();
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        ctx.actions.cancelDimension();
      }
    });
  }
  group.appendChild(valueRow);
  group.appendChild(toleranceRow);
  group.appendChild(
    button('Apply dimension', { class: 'primary' }, () => ctx.actions.applyDimension()),
  );
  return group;
}

function renderConstraintList(ctx: Ctx): HTMLElement {
  const display = displayOf(ctx.state.member);
  const list = el('ul', { 'aria-label': 'Constraints', class: 'constraint-list' });
  for (const constraint of ctx.state.sketch?.constraints ?? []) {
    const parts: (Node | string)[] = [el('span', { class: 'constraint-label' }, [constraint.label])];
    if (constraint.value_mm !== undefined) {
      parts.push(
        el('span', { class: 'figure' }, [
          show.dimension(
            constraint.value_mm,
            (constraint.tolerance as Tolerance | undefined) ?? null,
            display,
            true,
          ),
        ]),
      );
    }
    if (constraint.redundant) parts.push(el('span', { class: 'redundant' }, ['redundant']));
    if (DIMENSION_KINDS.includes(constraint.kind)) {
      parts.push(
        button('Edit', { 'aria-label': `Edit ${constraint.label}` }, () =>
          ctx.actions.editDimension(constraint.id),
        ),
      );
    }
    parts.push(
      button('Delete', { 'aria-label': `Delete ${constraint.label}` }, () =>
        ctx.actions.deleteConstraint(constraint.id),
      ),
    );
    list.appendChild(el('li', {}, parts));
  }
  return list;
}

function renderSketchProperties(ctx: Ctx, part: Part): HTMLElement[] {
  const sketch = ctx.state.sketch;
  const nodes: HTMLElement[] = [
    el('div', { role: 'status', 'aria-label': 'Save status', class: 'save-status' }, [
      saveStatusText(ctx, part),
    ]),
    el('h2', { class: 'panel-title' }, [`${sketch?.name ?? ''} \u00b7 ${part.name}`]),
  ];
  const toolForm = renderToolForm(ctx);
  if (toolForm) nodes.push(toolForm);
  nodes.push(renderConstrainGroup(ctx));
  const dimension = renderDimensionFields(ctx);
  if (dimension) nodes.push(dimension);
  nodes.push(renderConstraintList(ctx));
  nodes.push(button('Delete selection', {}, () => ctx.actions.deleteSelection()));
  nodes.push(button('Close sketch', {}, () => ctx.actions.closeSketch()));
  return nodes;
}

// -------------------------------------------------------------- extrude forms

function radioGroup(
  name: string,
  label: string,
  options: { value: string; label: string }[],
  current: string,
  onChange: (value: string) => void,
): HTMLElement {
  const group = el('div', { role: 'radiogroup', 'aria-label': label, class: 'radios' });
  for (const option of options) {
    const id = `${name}-${option.value}`;
    const input = el('input', {
      type: 'radio',
      name,
      id,
      value: option.value,
      checked: option.value === current,
      'data-focus-key': id,
    });
    input.addEventListener('change', () => onChange(option.value));
    group.appendChild(el('span', { class: 'radio' }, [input, el('label', { for: id }, [option.label])]));
  }
  return group;
}

const OPERATION_OPTIONS = [
  { value: 'new', label: 'New body' },
  { value: 'join', label: 'Join' },
  { value: 'cut', label: 'Cut' },
  { value: 'intersect', label: 'Intersect' },
];

const DIRECTION_OPTIONS = [
  { value: 'normal', label: 'Normal' },
  { value: 'reverse', label: 'Reverse' },
  { value: 'symmetric', label: 'Symmetric' },
];

function renderExtrudeForm(ctx: Ctx): HTMLElement {
  const draft = ctx.state.extrude as NonNullable<Ctx['state']['extrude']>;
  const form = el('form', { 'aria-label': 'Extrude', class: 'extrude-form' });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    ctx.actions.confirmExtrude();
  });
  const depthRow = textField('Depth', 'extrude-depth', draft.depth, ctx.state.dimensionErrors.depth);
  const depthInput = depthRow.querySelector('input') as HTMLInputElement;
  depthInput.addEventListener('input', () => ctx.actions.setExtrudeField('depth', depthInput.value));
  depthInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      ctx.actions.cancelExtrude();
    }
  });
  form.appendChild(depthRow);
  form.appendChild(
    radioGroup('operation', 'Operation', OPERATION_OPTIONS, draft.operation, (value) =>
      ctx.actions.setExtrudeField('operation', value),
    ),
  );
  form.appendChild(
    radioGroup('direction', 'Direction', DIRECTION_OPTIONS, draft.direction, (value) =>
      ctx.actions.setExtrudeField('direction', value),
    ),
  );
  const confirm = el(
    'button',
    { type: 'submit', class: 'primary', disabled: draft.pending },
    [draft.pending ? COPY.extruding : COPY.confirmExtrude],
  );
  form.appendChild(confirm);
  form.appendChild(button('Cancel', {}, () => ctx.actions.cancelExtrude()));
  return form;
}

function renderFeatureForm(ctx: Ctx, part: Part): HTMLElement[] {
  const draft = ctx.state.featureDraft as NonNullable<Ctx['state']['featureDraft']>;
  const feature = part.features.find((candidate) => candidate.id === draft.featureId);
  const form = el('form', { 'aria-label': `Edit ${feature?.name ?? ''}`, class: 'extrude-form' });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    ctx.actions.applyFeatureDepth();
  });
  const depthRow = textField('Depth', 'feature-depth', draft.depth, ctx.state.dimensionErrors.depth);
  const depthInput = depthRow.querySelector('input') as HTMLInputElement;
  depthInput.addEventListener('input', () => ctx.actions.setFeatureField('depth', depthInput.value));
  form.appendChild(depthRow);
  form.appendChild(
    radioGroup('feature-direction', 'Direction', DIRECTION_OPTIONS, draft.direction, (value) =>
      ctx.actions.setFeatureField('direction', value),
    ),
  );
  form.appendChild(el('button', { type: 'submit', class: 'primary' }, ['Apply depth']));
  return [
    el('div', { role: 'status', 'aria-label': 'Save status', class: 'save-status' }, [
      saveStatusText(ctx, part),
    ]),
    form,
    measurements(ctx, part),
  ];
}

// ------------------------------------------------------------- panel assembly

export function renderPropertiesContent(ctx: Ctx): HTMLElement[] {
  const mode = ctx.state.mode;
  if (!mode) return [];
  if (mode.kind === 'assembly') {
    const assembly = ctx.state.assemblies.find((candidate) => candidate.id === mode.assemblyId);
    return assembly ? renderAssemblyProperties(ctx, assembly) : [];
  }
  const part = partOf(ctx, mode);
  if (!part) return [];
  if (mode.kind === 'feature') return renderFeatureForm(ctx, part);
  if (mode.kind === 'sketch') {
    const nodes = renderSketchProperties(ctx, part);
    if (ctx.state.extrude) nodes.splice(1, 0, renderExtrudeForm(ctx));
    nodes.splice(ctx.state.extrude ? 3 : 2, 0, measurements(ctx, part));
    return nodes;
  }
  return renderPartProperties(ctx, part);
}

// ------------------------------------------------------------------ bom table

const BOM_COLUMNS = ['Item', 'Kind', 'Material', 'Qty', 'Unit mass', 'Line mass'];

export function renderBomTable(ctx: Ctx, bom: Bom): HTMLElement {
  const stacked = ctx.state.width < 600;
  const cell = (column: string, value: string, extra = ''): HTMLElement =>
    el('td', { class: `${extra} ${stacked ? 'stacked' : ''}` }, [
      el('span', { class: 'cell-label' }, [column]),
      el('span', { class: 'cell-value' }, [value]),
    ]);
  const rows = bom.lines.map((line) => {
    const itemValue =
      line.body_status === 'not_stored' || line.body_status === 'none'
        ? `${line.item.name} ${COPY.notStored}`
        : line.item.name;
    return el('tr', {}, [
      cell('Item', itemValue),
      cell('Kind', line.kind === 'made' ? 'Made' : 'Purchased'),
      cell('Material', line.material ?? COPY.dash),
      cell('Qty', String(line.quantity), 'num'),
      cell('Unit mass', line.unit_mass_g === null ? COPY.dash : show.mass(line.unit_mass_g), 'num'),
      cell('Line mass', line.line_mass_g === null ? COPY.dash : show.mass(line.line_mass_g), 'num'),
    ]);
  });
  rows.push(
    el('tr', { class: 'total-row' }, [
      cell('Item', 'Total'),
      cell('Kind', ''),
      cell('Material', ''),
      cell('Qty', String(bom.part_count), 'num'),
      cell('Unit mass', ''),
      cell('Line mass', show.mass(bom.total_mass_g), 'num'),
    ]),
  );
  return el('table', { class: `bom ${stacked ? 'stacked' : ''}`, 'aria-label': 'Bill of materials' }, [
    el('thead', {}, [
      el('tr', {}, BOM_COLUMNS.map((column) => el('th', { scope: 'col' }, [column]))),
    ]),
    el('tbody', {}, rows),
  ]);
}

// -------------------------------------------------------------- command strip

export function renderCommandStrip(ctx: Ctx): HTMLElement {
  const inSketch = ctx.state.mode?.kind === 'sketch';
  const founder = ctx.state.member?.role === 'founder';
  const toolbar = el('div', { role: 'toolbar', 'aria-label': 'Tools', class: 'toolbar' });
  for (const entry of TOOL_LABELS) {
    toolbar.appendChild(
      button(
        entry.label,
        { 'aria-pressed': ctx.state.tool === entry.tool ? 'true' : 'false' },
        () => ctx.actions.setTool(entry.tool),
      ),
    );
  }
  if (founder) {
    toolbar.appendChild(
      button('Extrude', { 'aria-pressed': ctx.state.extrude ? 'true' : 'false' }, () =>
        ctx.actions.startExtrude(),
      ),
    );
  }

  const slack = el('div', { role: 'status', 'aria-label': 'Slack', class: 'slack-readout' }, [
    inSketch && ctx.state.slackShown !== null ? slackReadout(ctx.state.slackShown) : '',
  ]);
  if (inSketch && ctx.state.slackShown === 0) slack.classList.add('held');

  const units = el('div', { role: 'radiogroup', 'aria-label': 'Units', class: 'radios' });
  for (const unit of ['mm', 'in'] as const) {
    const id = `units-${unit}`;
    const input = el('input', {
      type: 'radio',
      name: 'units',
      id,
      checked: ctx.state.member?.units === unit,
      'data-focus-key': id,
    });
    input.addEventListener('change', () => ctx.actions.setUnits(unit));
    units.appendChild(el('span', { class: 'radio' }, [input, el('label', { for: id }, [unit])]));
  }

  const decimals = el('input', {
    type: 'number',
    min: '0',
    max: '4',
    step: '1',
    value: String(ctx.state.member?.precision ?? 2),
    'aria-label': 'Decimals',
    class: 'decimals',
    'data-focus-key': 'decimals',
  });
  decimals.addEventListener('change', () => ctx.actions.setPrecision(Number(decimals.value)));

  decimals.id = 'decimals';
  const secondRow = el('div', { class: 'strip-row' }, [
    units,
    el('div', { class: 'field inline' }, [el('label', { for: 'decimals' }, ['Decimals']), decimals]),
  ]);
  const strip = el('div', { class: 'strip' }, [
    el('div', { class: 'strip-row' }, [toolbar, slack]),
    secondRow,
  ]);
  if (ctx.state.width < 768) {
    secondRow.appendChild(
      el('div', { class: 'sheet-buttons' }, [
        button('Feature tree', { 'data-focus-key': 'sheet-tree' }, (event) =>
          ctx.actions.openSheet('tree', event.currentTarget as HTMLElement),
        ),
        button('Properties', { 'data-focus-key': 'sheet-properties' }, (event) =>
          ctx.actions.openSheet('properties', event.currentTarget as HTMLElement),
        ),
      ]),
    );
  }
  return strip;
}

export { dimensionKindFor };
