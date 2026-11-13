import { api } from './api';
import { h, chip } from './ui';
import { COPY } from '../bench/copy';
import { KIND_SPECS, type SceneObject, type ObjectKind } from '../bench/scene';
import { parseEntry, formatSi, entryCopyFor } from '../bench/units';
import { readoutsForObject, formatReadout } from '../bench/readouts';
import type { Op } from '../bench/ops';
import type { EditorState } from './editor';
import type { AssetData } from './editor-util';
import { KIND_GLYPHS } from './editor-util';

// Outline, inspector, props and assets panels, drawn from EditorState.

export function drawOutline(ed: EditorState): void {
  const body = ed.panelBody('Outline');
  // attach the keyboard handler once per panel body
  if (!(body as BodyWithTreeKeys).treeKeysBound) {
    (body as BodyWithTreeKeys).treeKeysBound = true;
    body.addEventListener('keydown', (e) => {
      const tree = body.querySelector('[role="tree"]');
      if (!tree || !tree.contains(document.activeElement) && document.activeElement !== tree) {
        const active = document.activeElement;
        if (!tree || (active !== tree && !(tree as HTMLElement).contains(active))) return;
      }
      const rows = Array.from(body.querySelectorAll('[role="treeitem"]')) as Array<HTMLElement>;
      if (rows.length === 0) return;
      const current = rows.findIndex((r) => r.getAttribute('aria-selected') === 'true');
      let target = current;
      if (e.key === 'ArrowDown') target = Math.min(rows.length - 1, current + 1);
      else if (e.key === 'ArrowUp') target = Math.max(0, current - 1);
      else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (current >= 0) void ed.selectObject(ed.doc!.objects[current]!.id);
        else void ed.selectObject(ed.doc!.objects[0]!.id);
        return;
      } else if (e.key === 'F2') {
        if (current >= 0) ed.openRename(ed.doc!.objects[current]!.id);
        return;
      } else {
        return;
      }
      e.preventDefault();
      const object = ed.doc!.objects[target]!;
      void ed.selectObject(object.id);
    });
  }
  body.replaceChildren();
  if (!ed.doc) return;
  const count = h('span', { class: 'muted', style: { fontSize: '11.5px' } }, `${ed.doc.objects.length} objects`);
  const find = h('input', { type: 'search', 'aria-label': 'Find objects', placeholder: 'Find' }) as HTMLInputElement;
  find.style.cssText = 'min-width:0;flex:1';
  body.append(h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, count, find));
  const tree = h('div', { role: 'tree', 'aria-label': 'Scene outline', tabindex: '0' });
  body.append(tree);
  const renderRows = (): void => {
    tree.replaceChildren();
    if (ed.doc!.objects.length === 0) {
      tree.append(h('div', { class: 'empty-state' }, COPY.empty.outline));
      return;
    }
    const filter = find.value.trim().toLowerCase();
    for (const object of ed.doc!.objects) {
      if (filter && !object.name.toLowerCase().includes(filter)) continue;
      const row = h('div', {
        class: `row${object.id === ed.selected ? ' selected' : ''}`,
        role: 'treeitem', 'aria-selected': String(object.id === ed.selected), tabindex: '-1',
        onclick: () => void ed.selectObject(object.id),
        ondblclick: () => ed.openRename(object.id),
      });
      row.append(h('span', { class: 'muted', 'aria-hidden': 'true' }, KIND_GLYPHS[object.kind]));
      const holder = ed.locks.get(object.id);
      let nameEl: HTMLElement = h('span', { style: { flex: '1', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, object.name);
      if (ed.renameOpenFor === object.id) {
        const rename = h('input', { type: 'text', 'aria-label': `Rename ${object.name}`, value: object.name, style: { flex: '1', minWidth: '0' } }) as HTMLInputElement;
        nameEl = rename;
        requestAnimationFrame(() => { rename.focus(); rename.select(); });
        rename.addEventListener('keydown', (e) => {
          e.stopPropagation();
          if (e.key === 'Enter') { e.preventDefault(); void ed.commitRename(object.id, rename.value); }
          if (e.key === 'Escape') { e.preventDefault(); ed.renameOpenFor = null; renderRows(); }
        });
        rename.addEventListener('blur', () => { void ed.commitRename(object.id, rename.value); });
      }
      row.append(nameEl);
      if (holder && holder.userId !== ed.me?.user.id) {
        row.append(h('span', { class: 'muted', title: holder.displayName, 'aria-label': `${holder.displayName} is editing ${object.name}` }, holder.displayName.charAt(0).toUpperCase()));
      }
      row.append(h('button', { class: 'glyph-btn', 'aria-label': `Hide ${object.name}`, onclick: (e: Event) => { e.stopPropagation(); } }, '◌'));
      tree.append(row);
    }
  };
  find.addEventListener('input', renderRows);
  renderRows();
}

type BodyWithTreeKeys = { treeKeysBound?: boolean };

export function drawInspector(ed: EditorState): void {
  const body = ed.panelBody('Inspector');
  body.replaceChildren();
  if (!ed.doc) return;
  const object = ed.selected ? ed.doc.objects.find((o) => o.id === ed.selected) ?? null : null;
  if (object) {
    body.append(objectFields(ed, object));
  } else {
    body.append(sceneFields(ed));
  }
  const readouts = h('div', { role: 'region', 'aria-label': 'Derived readouts', 'aria-live': 'polite' });
  readouts.append(ed.readoutsHost ?? (ed.readoutsHost = h('div', { class: 'readout-rows' })));
  body.append(readouts);
  renderReadouts(ed);
  body.append(ed.lockNotice);
}

function sceneFields(ed: EditorState): HTMLElement {
  const host = h('div', {});
  host.append(textField(ed, 'Scene name', 'scene.name', ed.doc!.name, 'none', (value) => {
    void ed.applyChange([{ op: 'scene', field: 'name', value }]);
  }));
  host.append(textField(ed, 'Gravity (m/s²)', 'scene.gravity', ed.doc!.gravity, 'none', (value) => {
    void ed.applyChange([{ op: 'scene', field: 'gravity', value }]);
  }));
  return host;
}

function objectFields(ed: EditorState, object: SceneObject): HTMLElement {
  const host = h('div', {});
  const holder = ed.locks.get(object.id);
  const readOnly = ed.role === 'viewer' || (holder !== undefined && holder.userId !== ed.me?.user.id);
  host.append(h('div', { style: { color: 'var(--muted)', margin: '2px 0', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em' } }, object.kind));
  const axes: Array<[string, number]> = [['Position X (m)', 0], ['Position Y (m)', 1], ['Position Z (m)', 2]];
  for (const [label, axis] of axes) {
    host.append(textField(ed, label, `${object.id}.position.${axis}`, object.position[axis] ?? 0, 'length', (value) => {
      const next = [...object.position] as [number, number, number];
      next[axis] = Number(value);
      void ed.applyChange([{ op: 'set', objectId: object.id, fence: ed.leaseFence.get(object.id) ?? 0, field: 'position', value: next }]);
    }, readOnly, object));
  }
  for (const spec of KIND_SPECS[object.kind].params) {
    host.append(textField(ed, spec.label, `${object.id}.params.${spec.key}`, object.params[spec.key] ?? spec.default, spec.group, (value) => {
      void ed.applyChange([{ op: 'set', objectId: object.id, fence: ed.leaseFence.get(object.id) ?? 0, field: `params.${spec.key}`, value }]);
    }, readOnly, object));
  }
  if (object.kind === 'ramp' && !readOnly) {
    const btn = chip('Material', { onClick: () => ed.openMaterial(object) });
    host.append(h('div', { class: 'field-line' }, btn));
  }
  if (readOnly && ed.role === 'viewer') {
    host.append(h('div', { style: { color: 'var(--muted)', marginTop: '6px' } }, 'View only'));
  }
  return host;
}

export function textField(ed: EditorState, label: string, key: string, value: number | string, group: 'mass' | 'length' | 'angle' | 'none', commit: (value: number | string) => void, readOnly = false, object?: SceneObject): HTMLElement {
  const host = h('div', {});
  const line = h('div', { class: 'field-line' });
  const spec = specFor(key, object);
  const min = spec instanceof Object && 'min' in spec ? spec.min : undefined;
  const max = spec instanceof Object && 'max' in spec ? spec.max : undefined;
  const step = spec instanceof Object && 'step' in spec ? spec.step : undefined;
  const attrs: Record<string, unknown> = {
    type: 'text',
    class: 'num-input',
    'aria-label': label,
    role: 'spinbutton',
  };
  if (min !== undefined) attrs['aria-valuemin'] = String(min);
  if (max !== undefined) attrs['aria-valuemax'] = String(max);
  if (step !== undefined) attrs['aria-valuenow'] = String(value);
  if (readOnly) attrs.disabled = true;
  const input = h('input', attrs) as HTMLInputElement;
  input.value = ed.fieldText.get(key) ?? String(value);
  const labelEl = h('label', { class: 'field-label' }, label);
  labelEl.style.minWidth = '110px';
  line.append(labelEl, input);
  host.append(line);
  const err = h('div', { class: 'field-error' });
  host.append(err);
  let timer: number | null = null;
  const recompute = (): void => {
    ed.fieldText.set(key, input.value);
    const parsed = parseEntry(input.value, group);
    if (typeof parsed === 'object' && 'error' in parsed) {
      err.textContent = entryCopyFor(group, parsed.error);
      input.setAttribute('aria-invalid', 'true');
      ed.setSaveStatus(COPY.saveStatus.fieldError, true);
      renderReadouts(ed);
      return;
    }
    err.textContent = '';
    input.removeAttribute('aria-invalid');
    ed.clearFieldErrorIfAny();
    renderReadouts(ed);
    if (timer !== null) clearTimeout(timer);
    timer = window.setTimeout(() => {
      const again = parseEntry(input.value, group);
      if (typeof again === 'object' && 'value' in again) {
        commit(again.value);
        ed.fieldText.delete(key);
      }
    }, 500);
  };
  input.addEventListener('input', recompute);
  input.addEventListener('keydown', (e) => {
    // Ctrl+K must still open the palette even from a field
    if (e.ctrlKey || e.metaKey) return;
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      const again = parseEntry(input.value, group);
      if (typeof again === 'object' && 'value' in again) {
        commit(again.value);
        input.value = formatSi(again.value);
        ed.fieldText.delete(key);
      }
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const spec = specFor(key, object);
      const step = spec?.step ?? 0.1;
      const again = parseEntry(input.value, group);
      const base = typeof again === 'object' && 'value' in again ? again.value : 0;
      const next = base + (e.key === 'ArrowUp' ? step : -step);
      input.value = formatSi(next);
      recompute();
    }
  });
  input.addEventListener('blur', () => {
    const again = parseEntry(input.value, group);
    if (typeof again === 'object' && 'value' in again) {
      input.value = formatSi(again.value);
      ed.fieldText.delete(key);
      renderReadouts(ed);
    }
  });
  return host;
}

function specFor(key: string, object?: SceneObject): { min: number; max: number; step: number } | null {
  const match = /\.params\.(.+)$/.exec(key);
  if (!match || !object) return null;
  const spec = KIND_SPECS[object.kind].params.find((p) => p.key === match[1]);
  return spec ?? null;
}

export function renderReadouts(ed: EditorState): void {
  if (!ed.readoutsHost) return;
  const object = ed.selected ? ed.doc?.objects.find((o) => o.id === ed.selected) ?? null : null;
  const gravity = ed.doc?.gravity ?? 9.81;
  const overrides: Record<string, number | null> = {};
  for (const [key, text] of ed.fieldText) {
    const match = /\.params\.(.+)$/.exec(key);
    if (!match) continue;
    const param = match[1]!;
    const spec = object ? KIND_SPECS[object.kind].params.find((p) => p.key === param) : null;
    if (!spec) continue;
    const parsed = parseEntry(text, spec.group);
    overrides[param] = typeof parsed === 'object' && 'value' in parsed ? parsed.value : null;
  }
  const rows = readoutsForObject(object, gravity, overrides);
  ed.readoutsHost.replaceChildren();
  for (const row of rows) {
    ed.readoutsHost.append(h('div', {}, formatReadout(row)));
  }
}

export function drawProps(ed: EditorState): void {
  const body = ed.panelBody('Props');
  body.replaceChildren();
  const tabs = h('div', { class: 'tab-row', role: 'tablist', 'aria-label': 'Prop types' });
  const grid = h('div', { class: 'tile-grid', role: 'grid' });
  let active = 'rigs';
  const rigsTab = h('button', { role: 'tab', 'aria-selected': 'true' }, 'Rigs');
  const modelsTab = h('button', { role: 'tab', 'aria-selected': 'false' }, 'Models');
  const render = (): void => {
    grid.replaceChildren();
    if (active === 'rigs') {
      const rigs: Array<[string, string, ObjectKind]> = [
        ['Add ramp', '◺', 'ramp'], ['Add pendulum', '⏱', 'pendulum'],
        ['Add launcher', '⤴', 'launcher'], ['Add crate', '▢', 'crate'],
      ];
      for (const [label, glyph, kind] of rigs) {
        grid.append(h('button', {
          class: 'tile', 'aria-label': label,
          onclick: () => ed.place(kind),
          onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter') ed.place(kind); },
        }, h('span', { class: 'tile-glyph' }, glyph), h('span', { class: 'tile-label' }, label.replace('Add ', ''))));
      }
    } else {
      renderModelTiles(ed, grid);
    }
  };
  rigsTab.addEventListener('click', () => { active = 'rigs'; rigsTab.setAttribute('aria-selected', 'true'); modelsTab.setAttribute('aria-selected', 'false'); render(); });
  modelsTab.addEventListener('click', () => { active = 'models'; modelsTab.setAttribute('aria-selected', 'true'); rigsTab.setAttribute('aria-selected', 'false'); render(); });
  tabs.append(rigsTab, modelsTab);
  body.append(tabs, grid);
  render();
}

async function renderModelTiles(ed: EditorState, grid: HTMLElement): Promise<void> {
  if (!ed.scene) return;
  const result = await api('GET', `/api/projects/${ed.scene.projectId}`);
  if (!result.ok) return;
  const data = result.body as { assets: AssetData[] };
  const models = data.assets.filter((a) => a.kind === 'glb' || a.kind === 'gltf');
  ed.pendingAssets.clear();
  if (models.length === 0) {
    grid.append(h('div', { class: 'empty-state' }, COPY.empty.models));
    return;
  }
  for (const asset of models) {
    ed.pendingAssets.set(asset.id, asset);
    const name = asset.name.replace(/\.[^.]+$/, '');
    const tile = h('button', { class: 'tile', 'aria-label': `Add ${name}`, onclick: () => ed.placeModel(asset), draggable: 'true' },
      h('span', { class: 'tile-glyph' }, '◈'), h('span', { class: 'tile-label' }, name));
    tile.addEventListener('dragstart', (e) => {
      (e as DragEvent).dataTransfer?.setData('text/plain', asset.id);
    });
    grid.append(tile);
  }
}
