import { el, clear } from '../dom.js';
import { api } from '../api.js';
import type { LayerDoc } from '../api.js';
import { openDialogWith, closeActiveDialog } from '../dialogs.js';
import { ScrubField } from '../scrub.js';
import { icon } from '../icons.js';
import { snapToQuarterBeat } from '../beattime.js';
import { commitOp, commitValue, KEYABLE_PROPERTIES, OUTPUT_BUS_LABELS, layerOf, type EditorContext } from './context.js';

// The layer tree: click selects, arrows walk, twist buttons expand and collapse.
export function buildLayerTree (ctx: EditorContext): HTMLElement {
  const list = el('div', { class: 'tree', role: 'tree', 'aria-label': 'Layers' });
  ctx.rebuildTree = (): void => rebuildTree(ctx, list);
  return list;
}

function visibleLayers (ctx: EditorContext): LayerDoc[] {
  const doc = ctx.store.getDocument();
  if (doc === null) return [];
  const byParent = new Map<string | null, LayerDoc[]>();
  for (const layer of doc.layers) {
    const list = byParent.get(layer.parent_id) ?? [];
    list.push(layer);
    byParent.set(layer.parent_id, list);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.index - b.index);
  // Groups start expanded so the starting tree is visible at once.
  if (ctx.expanded.size === 0) {
    for (const layer of doc.layers) {
      if (byParent.get(layer.id) !== undefined) ctx.expanded.add(layer.id);
    }
  }
  const out: LayerDoc[] = [];
  const walk = (parent: string | null): void => {
    for (const layer of byParent.get(parent) ?? []) {
      out.push(layer);
      if (ctx.expanded.has(layer.id)) walk(layer.id);
    }
  };
  walk(null);
  return out;
}

function rebuildTree (ctx: EditorContext, list: HTMLElement): void {
  clear(list);
  const rows = visibleLayers(ctx);
  rows.forEach((layer, index) => {
    const isParent = (ctx.store.getDocument()?.layers ?? []).some((l) => l.parent_id === layer.id);
    const lock = ctx.store.lockFor(layer.id);
    const row = el('div', {
      class: 'tree-row', role: 'treeitem',
      'aria-selected': String(layer.id === ctx.selectedLayerId),
      ...(isParent ? { 'aria-expanded': String(ctx.expanded.has(layer.id)) } : {}),
      tabindex: layer.id === ctx.selectedLayerId || (ctx.selectedLayerId === null && index === 0) ? '0' : '-1',
    });
    if (isParent) {
      const twistGlyph = el('span', { class: 'twist-glyph', text: ctx.expanded.has(layer.id) ? '▾' : '▸' });
      twistGlyph.setAttribute('aria-hidden', 'true');
      const twist = el('button', {
        class: 'twist',
        'aria-label': ctx.expanded.has(layer.id) ? 'Collapse' : 'Expand',
        click: (event) => {
          event.stopPropagation();
          if (ctx.expanded.has(layer.id)) ctx.expanded.delete(layer.id);
          else ctx.expanded.add(layer.id);
          rebuildTree(ctx, list);
        },
      }, twistGlyph);
      row.append(twist);
    } else {
      row.append(el('span', { class: 'indent' }));
    }
    row.append(el('span', { text: layer.name }));
    if (lock !== undefined) {
      const badge = el('span', { class: 'lock-badge', role: 'img', 'aria-label': `Locked by ${lock.holder.display_name}` });
      badge.innerHTML = icon('lock');
      row.append(badge);
    }
    row.addEventListener('click', () => { selectLayer(ctx, layer.id); });
    list.append(row);
  });
  list.onkeydown = (event) => onTreeKey(ctx, event, rows);
}

function onTreeKey (ctx: EditorContext, event: KeyboardEvent, rows: LayerDoc[]): void {
  const index = rows.findIndex((l) => l.id === ctx.selectedLayerId);
  const move = (next: number): void => {
    const target = rows[next];
    if (target !== undefined) selectLayer(ctx, target.id);
  };
  const current = index >= 0 ? rows[index] : undefined;
  const isParent = current !== undefined && (ctx.store.getDocument()?.layers ?? []).some((l) => l.parent_id === current.id);
  if (event.key === 'ArrowDown') { event.preventDefault(); move(index + 1); }
  else if (event.key === 'ArrowUp') { event.preventDefault(); move(Math.max(0, index - 1)); }
  else if (event.key === 'Home') { event.preventDefault(); move(0); }
  else if (event.key === 'End') { event.preventDefault(); move(rows.length - 1); }
  else if (event.key === 'ArrowRight' && current !== undefined) { event.preventDefault(); if (isParent) { ctx.expanded.add(current.id); ctx.rebuildTree(); } }
  else if (event.key === 'ArrowLeft' && current !== undefined) { event.preventDefault(); if (isParent && ctx.expanded.has(current.id)) { ctx.expanded.delete(current.id); ctx.rebuildTree(); } else { const parent = layerOf(ctx, current.parent_id); if (parent !== null) selectLayer(ctx, parent.id); } }
  else if (event.altKey && event.key === 'ArrowUp') { event.preventDefault(); void reparentSibling(ctx, current, -1); }
  else if (event.altKey && event.key === 'ArrowDown') { event.preventDefault(); void reparentSibling(ctx, current, 1); }
  else if (event.altKey && event.key === 'ArrowRight') { event.preventDefault(); void makeChildOfSiblingAbove(ctx, current); }
  else if (event.altKey && event.key === 'ArrowLeft') { event.preventDefault(); void moveOutToParentLevel(ctx, current); }
  else if (event.key === 'w') { event.preventDefault(); ctx.gizmoMode = 'move'; }
  else if (event.key === 'e') { event.preventDefault(); ctx.gizmoMode = 'rotate'; }
  else if (event.key === 'r') { event.preventDefault(); ctx.gizmoMode = 'scale'; }
}

async function reparentSibling (ctx: EditorContext, layer: LayerDoc | undefined, direction: -1 | 1): Promise<void> {
  if (layer === undefined) return;
  const siblings = (ctx.store.getDocument()?.layers ?? []).filter((l) => l.parent_id === layer.parent_id).sort((a, b) => a.index - b.index);
  const position = siblings.findIndex((l) => l.id === layer.id);
  const nextIndex = Math.max(0, Math.min(siblings.length - 1, position + direction));
  if (nextIndex === position) return;
  await commitOp(ctx, {
    target: layer.id,
    baseVersion: ctx.store.layerVersion(layer.id),
    type: 'layer.reparent',
    payload: { parent_id: layer.parent_id, index: nextIndex },
  }, () => {
    const other = siblings[nextIndex];
    if (other !== undefined) other.index = position;
    layer.index = nextIndex;
  });
  ctx.rebuildTree();
}

async function makeChildOfSiblingAbove (ctx: EditorContext, layer: LayerDoc | undefined): Promise<void> {
  if (layer === undefined) return;
  const siblings = (ctx.store.getDocument()?.layers ?? []).filter((l) => l.parent_id === layer.parent_id).sort((a, b) => a.index - b.index);
  const position = siblings.findIndex((l) => l.id === layer.id);
  if (position <= 0) return;
  const above = siblings[position - 1];
  await commitOp(ctx, {
    target: layer.id,
    baseVersion: ctx.store.layerVersion(layer.id),
    type: 'layer.reparent',
    payload: { parent_id: above.id, index: 0 },
  }, () => {
    layer.parent_id = above.id;
    layer.index = 0;
  });
  ctx.expanded.add(above.id);
  ctx.rebuildTree();
}

async function moveOutToParentLevel (ctx: EditorContext, layer: LayerDoc | undefined): Promise<void> {
  if (layer === undefined || layer.parent_id === null) return;
  const parent = layerOf(ctx, layer.parent_id);
  if (parent === null) return;
  await commitOp(ctx, {
    target: layer.id,
    baseVersion: ctx.store.layerVersion(layer.id),
    type: 'layer.reparent',
    payload: { parent_id: parent.parent_id, index: parent.index + 1 },
  }, () => {
    layer.parent_id = parent.parent_id;
    layer.index = parent.index + 1;
  });
  ctx.rebuildTree();
}

export function selectLayer (ctx: EditorContext, layerId: string): void {
  // Changing the selection releases the lock on the previously selected layer.
  if (ctx.selectedLayerId !== null && ctx.selectedLayerId !== layerId) {
    void api.del(`/api/sets/${ctx.setId}/layers/${ctx.selectedLayerId}/lock`).then(() => {
      ctx.store.clearLock(ctx.selectedLayerId!);
    }).catch(() => {});
  }
  ctx.selectedLayerId = layerId;
  ctx.rebuildTree();
  ctx.rebuildInspector();
  ctx.rebuildTimeline();
  ctx.redrawOnce();
  void api.post(`/api/sets/${ctx.setId}/presence`, { selection: layerId }).catch(() => {});
}

// The inspector: component drawers with blue-numeral scrub fields.
export function buildInspector (ctx: EditorContext): HTMLElement {
  const panel = el('div', { class: 'inspector', role: 'region', 'aria-label': 'Inspector' });
  ctx.rebuildInspector = (): void => rebuildInspector(ctx, panel);
  return panel;
}

function rebuildInspector (ctx: EditorContext, panel: HTMLElement): void {
  clear(panel);
  const layer = layerOf(ctx, ctx.selectedLayerId);
  if (layer === null) {
    panel.append(el('div', { class: 'empty-state', text: 'Select a layer' }));
    return;
  }
  panel.append(el('h2', { text: layer.name }));

  const lock = ctx.store.lockFor(layer.id);
  const mine = lock !== undefined && lock.holder.user_id === ctx.user?.id;
  const lockButton = el('button', { class: 'row-button', text: mine ? 'Release lock' : 'Take lock' });
  lockButton.addEventListener('click', () => {
    if (mine) {
      void api.del(`/api/sets/${ctx.setId}/layers/${layer.id}/lock`).then(() => {
        ctx.store.clearLock(layer.id);
        ctx.rebuildInspector();
        ctx.rebuildTree();
      }).catch(() => {});
      return;
    }
    void api.post(`/api/sets/${ctx.setId}/layers/${layer.id}/lock`).then((result) => {
      if (result.ok) {
        ctx.store.setLockFromResponse(layer.id, { user_id: ctx.user?.id ?? '', display_name: ctx.user?.display_name ?? '' }, (result.body as { expires_at: string }).expires_at);
        ctx.rebuildInspector();
        ctx.rebuildTree();
      } else if (result.error.body.code === 'lock_held') {
        const holderName = (result.error.body.holder as { display_name?: string } | undefined)?.display_name;
        const region = ctx.regions['Notifications'];
        region.textContent = `Locked by ${holderName ?? 'someone'}`;
      }
    }).catch(() => {});
  });
  panel.append(lockButton);

  panel.append(makeDrawer(ctx, 'Transform', () => [
    vectorRow(ctx, layer, 'Position', 'position'),
    vectorRow(ctx, layer, 'Rotation', 'rotation'),
    vectorRow(ctx, layer, 'Scale', 'scale'),
  ]));
  if (layer.kind === 'camera') panel.append(makeDrawer(ctx, 'Camera', () => [
    pairRow(ctx, layer, 'Near plane', 'props.near', 'Far plane', 'props.far'),
    scrubRow(ctx, 'Field of view', 'props.fov', () => layer.props.fov, (v) => { layer.props.fov = v; }, 1),
  ]));
  if (layer.material !== null) panel.append(makeDrawer(ctx, 'Material', () => {
    const rows: HTMLElement[] = [
      scrubRow(ctx, 'Tint alpha', 'material.tint_alpha', () => layer.material!.tint_alpha, (v) => { layer.material!.tint_alpha = v; }, 2),
    ];
    const tintButton = el('button', { class: 'row-button', text: 'Tint' });
    tintButton.addEventListener('click', () => openTintDialog(ctx, layer));
    rows.push(wrapLabelled('Tint', tintButton));
    rows.push(textureSlot(ctx, layer, 'Albedo', 'albedo_texture_id'));
    rows.push(textureSlot(ctx, layer, 'Emissive', 'emissive_texture_id'));
    return rows;
  }));
  if (layer.kind === 'tube') panel.append(makeDrawer(ctx, 'Shape', () => [
    scrubRow(ctx, 'Twist', 'props.twist', () => layer.props.twist, (v) => { layer.props.twist = v; }, 3),
    scrubRow(ctx, 'Radius', 'props.radius', () => layer.props.radius, (v) => { layer.props.radius = v; }, 2),
  ]));
  if (layer.kind === 'light') panel.append(makeDrawer(ctx, 'Light', () => [
    scrubRow(ctx, 'Intensity', 'props.intensity', () => layer.props.intensity, (v) => { layer.props.intensity = v; }, 2),
  ]));
  if (layer.kind === 'model') panel.append(makeDrawer(ctx, 'Model', () => [modelSelect(ctx, layer)]));
  if (['cube', 'sphere', 'plane', 'torus', 'tube', 'model', 'shader'].includes(layer.kind)) {
    panel.append(makeDrawer(ctx, 'Outputs', () => [outputsRow(ctx, layer)]));
  }
}

function wrapLabelled (label: string, control: HTMLElement): HTMLElement {
  const row = el('div', { class: 'inspector-row' });
  row.append(el('label', { text: label }));
  row.append(control);
  return row;
}

function vectorRow (ctx: EditorContext, layer: LayerDoc, label: string, field: 'position' | 'rotation' | 'scale'): HTMLElement {
  const row = el('div', { class: 'inspector-row vector' });
  row.append(el('label', { text: label }));
  const fields = el('div', { class: 'vector-fields' });
  (['x', 'y', 'z'] as const).forEach((axis, index) => {
    fields.append(scrubRow(ctx, `${label} ${axis.toUpperCase()}`, `${field}.${axis}`,
      () => layer[field][index],
      (v) => { layer[field][index] = v; },
      2));
  });
  row.append(fields);
  return row;
}

function pairRow (ctx: EditorContext, layer: LayerDoc, labelA: string, pathA: string, labelB: string, pathB: string): HTMLElement {
  const row = el('div', { class: 'inspector-row' });
  row.append(el('label', { text: 'Camera' }));
  const pair = el('div', { class: 'pair' });
  pair.append(scrubRow(ctx, labelA, pathA, () => layer.props[pathA.slice('props.'.length) as 'near' | 'far'], (v) => { layer.props[pathA.slice('props.'.length) as 'near' | 'far'] = v; }, 2));
  pair.append(scrubRow(ctx, labelB, pathB, () => layer.props[pathB.slice('props.'.length) as 'near' | 'far'], (v) => { layer.props[pathB.slice('props.'.length) as 'near' | 'far'] = v; }, 2));
  row.append(pair);
  return row;
}

export function scrubRow (ctx: EditorContext, label: string, path: string, get: () => number, set: (value: number) => void, decimals: number): HTMLElement {
  const field = new ScrubField(label, {
    getValue: get,
    setValue: () => {},
    decimals,
    onCommit: (value) => { void commitValue(ctx, path, value, () => { set(value); }); },
    onLive: () => { ctx.redrawOnce(); },
    onFocusGained: get,
  });
  field.input.addEventListener('pointerdown', () => { ctx.scrubbing = true; });
  field.input.addEventListener('pointerup', () => { ctx.scrubbing = false; });
  const row = el('div', { class: 'inspector-row' });
  row.append(el('label', { text: label }));
  const column = el('div', {});
  field.attachTo(column);
  if (KEYABLE_PROPERTIES.includes(path)) {
    const hasKey = (ctx.store.getDocument()?.keys ?? []).some((k) => k.layer_id === ctx.selectedLayerId && k.property === path);
    const dot = el('button', { class: 'key-dot', text: '◆', 'aria-label': `Keyframe ${label}`, 'aria-pressed': String(hasKey) });
    dot.addEventListener('click', () => { void placeKey(ctx, path, get()); });
    column.append(dot);
  }
  row.append(column);
  return row;
}

export async function placeKey (ctx: EditorContext, path: string, value: number): Promise<void> {
  const layerId = ctx.selectedLayerId;
  if (layerId === null) return;
  const tick = snapToQuarterBeat(ctx.transport.currentTick());
  await commitOp(ctx, {
    target: layerId,
    baseVersion: ctx.store.layerVersion(layerId),
    type: 'key.set',
    payload: { property: path, tick, value },
  }, () => {
    const doc = ctx.store.getDocument();
    if (doc === null) return;
    const existing = doc.keys.find((k) => k.layer_id === layerId && k.property === path && k.tick === tick);
    if (existing !== undefined) existing.value = value;
    else doc.keys.push({ layer_id: layerId, property: path, tick, value });
  });
  ctx.rebuildInspector();
  ctx.rebuildTimeline();
}

function makeDrawer (ctx: EditorContext, title: string, build: () => HTMLElement[]): HTMLElement {
  const open = ctx.drawerOpen.get(title) ?? true;
  const body = el('div', {});
  const toggle = el('button', { class: 'drawer-toggle', 'aria-expanded': String(open), text: title });
  toggle.append(el('span', { text: open ? '▾' : '▸' }));
  toggle.addEventListener('click', () => {
    const next = !(ctx.drawerOpen.get(title) ?? true);
    ctx.drawerOpen.set(title, next);
    toggle.setAttribute('aria-expanded', String(next));
    clear(body);
    if (next) for (const row of build()) body.append(row);
  });
  const wrap = el('div', {});
  wrap.append(toggle, body);
  if (open) for (const row of build()) body.append(row);
  return wrap;
}

function openTintDialog (ctx: EditorContext, layer: LayerDoc): void {
  const channels = (['Red', 'Green', 'Blue'] as const).map((channel, index) => {
    const input = el('input', { type: 'number', min: '0', max: '1', step: '0.01', value: String(layer.material?.tint[index] ?? 1), 'aria-label': channel }) as unknown as HTMLInputElement;
    return { channel, index, input };
  });
  const form = el('form', {},
    ...channels.map((c) => el('div', {}, el('label', { text: c.channel }), c.input)),
    el('button', { type: 'submit', class: 'row-button primary', text: 'OK' }));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const tint = channels.map((c) => Number(c.input.value)) as [number, number, number];
    void commitValue(ctx, 'material.tint', tint, () => { if (layer.material !== null) layer.material.tint = tint; });
    closeActiveDialog();
  });
  openDialogWith({ title: 'Tint', form });
}

function textureSlot (ctx: EditorContext, layer: LayerDoc, slot: 'Albedo' | 'Emissive', field: 'albedo_texture_id' | 'emissive_texture_id'): HTMLElement {
  const bound = layer.material?.[field] ?? null;
  const boundName = ctx.currentAssets.find((a) => a.id === bound)?.name ?? 'Texture';
  const row = el('div', { class: 'inspector-row' });
  row.append(el('label', { text: `${slot} texture` }));
  const group = el('div', { role: 'group', 'aria-label': `${slot} texture` });
  group.append(el('span', { text: boundName }));
  group.append(el('button', {
    class: 'row-button', text: `Browse texture for ${slot}`,
    click: () => openTexturePicker(ctx, layer, field, slot),
  }));
  group.append(el('button', {
    class: 'row-button', text: `Clear ${slot}`,
    click: () => void commitValue(ctx, field, null, () => { if (layer.material !== null) layer.material[field] = null; }),
  }));
  row.append(group);
  return row;
}

function openTexturePicker (ctx: EditorContext, layer: LayerDoc, field: 'albedo_texture_id' | 'emissive_texture_id', slot: 'Albedo' | 'Emissive'): void {
  const assets = ctx.currentAssets.filter((a) => a.kind === 'texture' && a.status === 'ready');
  let selected = 0;
  const listbox = el('div', { role: 'listbox', 'aria-label': 'Textures', tabindex: '0' });
  const render = (): void => {
    clear(listbox);
    assets.forEach((asset, index) => {
      listbox.append(el('div', { class: 'listbox-row', role: 'option', 'aria-selected': String(index === selected), text: asset.name }));
    });
  };
  render();
  listbox.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') { selected = Math.min(assets.length - 1, selected + 1); render(); event.preventDefault(); }
    else if (event.key === 'ArrowUp') { selected = Math.max(0, selected - 1); render(); event.preventDefault(); }
  });
  const use = el('button', { type: 'button', class: 'row-button primary', text: 'Use texture' });
  use.addEventListener('click', () => {
    const asset = assets[selected];
    if (asset !== undefined) {
      void commitValue(ctx, field, asset.id, () => { if (layer.material !== null) layer.material[field] = asset.id; });
    }
    closeActiveDialog();
  });
  const form = el('form', {}, listbox, use);
  form.addEventListener('submit', (event) => { event.preventDefault(); use.click(); });
  openDialogWith({ title: 'Choose texture', form });
  void slot;
}

function modelSelect (ctx: EditorContext, layer: LayerDoc): HTMLElement {
  const select = el('select', { class: 'camera-select', 'aria-label': 'Model asset' }) as unknown as HTMLSelectElement;
  const models = ctx.currentAssets.filter((a) => a.kind === 'model' && a.status === 'ready');
  select.append(el('option', { value: '', text: 'None' }) as unknown as HTMLOptionElement);
  for (const asset of models) {
    const option = el('option', { value: asset.id, text: asset.name }) as unknown as HTMLOptionElement;
    if (layer.model_asset_id === asset.id) option.selected = true;
    select.append(option);
  }
  select.addEventListener('change', () => {
    void commitValue(ctx, 'model_asset_id', select.value === '' ? null : select.value, () => { layer.model_asset_id = select.value === '' ? null : select.value; });
  });
  return wrapLabelled('Model asset', select);
}

function outputsRow (ctx: EditorContext, layer: LayerDoc): HTMLElement {
  const row = el('div', { class: 'inspector-row' });
  const label = el('label', { text: layer.output_buses.map((bus) => OUTPUT_BUS_LABELS[bus]).join(',') });
  row.append(label, el('button', {
    class: 'row-button', text: 'Choose output buses',
    click: () => {
      const boxes = ['main', 'side', 'led'].map((bus) => {
        const box = el('input', { type: 'checkbox', value: bus, ...(layer.output_buses.includes(bus) ? { checked: true } : {}) }) as unknown as HTMLInputElement;
        return { bus, box };
      });
      const form = el('form', {},
        ...boxes.map((b) => el('div', { class: 'radio-row' }, b.box, el('label', { text: OUTPUT_BUS_LABELS[b.bus] }))),
        el('button', { type: 'submit', class: 'row-button primary', text: 'OK' }));
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const buses = boxes.filter((b) => b.box.checked).map((b) => b.bus);
        if (buses.length > 0) {
          void commitValue(ctx, 'output_buses', buses as unknown as number, () => { layer.output_buses = buses; });
        }
        closeActiveDialog();
      });
      openDialogWith({ title: 'Output buses', form });
    },
  }));
  return row;
}

