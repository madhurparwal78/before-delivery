import { el, iconButton, openMenu } from './dom';
import { icons } from './icons';
import type { EditorStore } from './editor-state';
import { MSG } from '../shared/messages';
import type { Layer } from '../shared/types';

const ADD_LAYER_ITEMS: { label: string; kind: string; props?: Record<string, string> }[] = [
  { label: 'Rectangle', kind: 'Rectangle' },
  { label: 'Ellipse', kind: 'Ellipse' },
  { label: 'Polygon', kind: 'Polygon' },
  { label: 'Text', kind: 'Text' },
  { label: 'Image', kind: 'Image' },
  { label: 'Gradient', kind: 'Gradient' },
  { label: 'Blur', kind: 'Effect', props: { 'effect.kind': 'Blur' } },
  { label: 'Grain', kind: 'Effect', props: { 'effect.kind': 'Grain' } },
  { label: 'Bloom', kind: 'Effect', props: { 'effect.kind': 'Bloom' } },
  { label: 'Glow', kind: 'Effect', props: { 'effect.kind': 'Glow' } },
  { label: 'Chromatic aberration', kind: 'Effect', props: { 'effect.kind': 'Chromatic aberration' } },
  { label: 'Displacement', kind: 'Effect', props: { 'effect.kind': 'Displacement' } },
  { label: 'Pixelate', kind: 'Effect', props: { 'effect.kind': 'Pixelate' } },
  { label: 'Cube', kind: 'Primitive', props: { primitive: 'Cube' } },
  { label: 'Sphere', kind: 'Primitive', props: { primitive: 'Sphere' } },
  { label: 'Cylinder', kind: 'Primitive', props: { primitive: 'Cylinder' } },
  { label: 'Torus', kind: 'Primitive', props: { primitive: 'Torus' } },
  { label: 'Plane', kind: 'Primitive', props: { primitive: 'Plane' } },
  { label: 'Extruded text', kind: 'Extrusion', props: { source: 'text' } },
  { label: 'Extruded SVG', kind: 'Extrusion', props: { source: 'svg' } },
  { label: 'Model', kind: 'Model' },
  { label: 'Pebble model', kind: 'Model', props: { preset: 'Pebble' } },
  { label: 'Arch model', kind: 'Model', props: { preset: 'Arch' } },
  { label: 'Lattice model', kind: 'Model', props: { preset: 'Lattice' } },
  { label: 'Particles', kind: 'Particles' },
  { label: 'Cloth', kind: 'Cloth' },
];

const FILE_KINDS: Record<string, { kind: 'image' | 'svg' | 'model'; chooser: string; prop: string }> = {
  Image: { kind: 'image', chooser: 'Choose image', prop: 'assetId' },
  'Extruded SVG': { kind: 'svg', chooser: 'Choose SVG', prop: 'svgAssetId' },
  Model: { kind: 'model', chooser: 'Choose model', prop: 'modelAssetId' },
};

export interface LayersCallbacks {
  rerender: () => void;
  focusKey: (key: string) => void;
}

function orderedRows(store: EditorStore): { layer: Layer; depth: number }[] {
  const scene = store.scene;
  if (!scene) return [];
  const rows: { layer: Layer; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number): void => {
    const children = scene.layers
      .filter((layer) => layer.parentId === parentId)
      .sort((a, b) => b.order - a.order);
    for (const layer of children) {
      rows.push({ layer, depth });
      if (layer.kind === 'Group') walk(layer.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

export function renderLayers(store: EditorStore, callbacks: LayersCallbacks): HTMLElement {
  const tree = el('div', {
    role: 'tree',
    'aria-label': 'Layers',
    'aria-multiselectable': 'true',
    class: 'layer-tree',
  });

  const cameraRow = el('div', {
    role: 'treeitem',
    'aria-label': 'Camera, Camera',
    'aria-selected': store.state.selection.length === 0 ? 'true' : 'false',
    class: 'layer-row',
    tabindex: '0',
    'data-kind': 'Camera',
    'data-focus-key': 'layer:camera',
  }, [el('span', { class: 'layer-name', text: 'Camera' })]);
  cameraRow.addEventListener('click', () => {
    store.state.selection = [];
    callbacks.rerender();
  });
  tree.append(cameraRow);

  const rows = orderedRows(store);
  for (const { layer, depth } of rows) {
    tree.append(layerRow(store, layer, depth, callbacks, rows));
  }
  if (rows.length === 0) {
    tree.append(el('p', { class: 'empty-state', text: 'No layers yet. Add one to begin.' }));
  }

  const addButton = el('button', { type: 'button', class: 'button primary', text: 'Add layer', 'aria-label': 'Add layer' });
  addButton.addEventListener('click', () => {
    openMenu({
      name: 'Add layer',
      opener: addButton,
      items: ADD_LAYER_ITEMS.map((item) => ({
        label: item.label,
        onSelect: () => {
          const fileKind = FILE_KINDS[item.label];
          if (fileKind) {
            chooseFile(store, fileKind, item, callbacks);
            return;
          }
          addLayer(store, item, callbacks, {});
        },
      })),
    });
  });

  return el('section', { class: 'panel' }, [
    el('h3', { text: 'Layers' }),
    addButton,
    tree,
  ]);
}

function chooseFile(
  store: EditorStore,
  fileKind: { kind: 'image' | 'svg' | 'model'; chooser: string; prop: string },
  item: { label: string; kind: string; props?: Record<string, string> },
  callbacks: LayersCallbacks,
): void {
  const input = el('input', {
    type: 'file',
    class: 'visually-hidden',
    'aria-label': fileKind.chooser,
    accept:
      fileKind.kind === 'image'
        ? 'image/png,image/jpeg,image/webp'
        : fileKind.kind === 'svg'
          ? 'image/svg+xml,.svg'
          : '.gltf,.glb',
  });
  document.body.append(input);
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;
    store.setStatus(`Uploading ${file.name}…`);
    store.setNotice(null);
    void import('./api')
      .then(({ api }) => api.upload(store.state.project.id, fileKind.kind, file))
      .then((result) => {
        store.setStatus(`${file.name} is ready.`);
        store.state.assets = [...store.state.assets, result.asset];
        void store.reload();
        addLayer(store, item, callbacks, { [fileKind.prop]: result.asset.id });
      })
      .catch((failure: unknown) => {
        store.setStatus('');
        const message =
          failure && typeof failure === 'object' && 'failure' in failure
            ? (failure as { failure: { message: string } }).failure.message
            : MSG.storageUploads;
        store.setNotice(message);
      });
  });
  input.click();
}

function addLayer(
  store: EditorStore,
  item: { label: string; kind: string; props?: Record<string, string> },
  callbacks: LayersCallbacks,
  extraProps: Record<string, string>,
): void {
  const props: Record<string, unknown> = {};
  for (const [path, value] of Object.entries({ ...(item.props ?? {}), ...extraProps })) {
    const parts = path.split('.');
    let target = props;
    for (let i = 0; i < parts.length - 1; i += 1) {
      target[parts[i]] = target[parts[i]] ?? {};
      target = target[parts[i]] as Record<string, unknown>;
    }
    target[parts[parts.length - 1]] = value;
  }
  const ref = `ref-${Date.now()}`;
  store.queue({
    type: 'addLayer',
    ref,
    layer: { kind: item.kind, props } as never,
  });
  void store.flush().then(() => {
    const scene = store.scene;
    const added = scene?.layers[scene.layers.length - 1];
    if (added) {
      store.state.selection = [added.id];
      store.state.focusTarget = `layer:${added.id}`;
    }
    callbacks.rerender();
  });
}

function layerRow(
  store: EditorStore,
  layer: Layer,
  depth: number,
  callbacks: LayersCallbacks,
  rows: { layer: Layer; depth: number }[],
): HTMLElement {
  const selected = store.state.selection.includes(layer.id);
  const held = store.heldBy(layer.id);
  const row = el('div', {
    role: 'treeitem',
    'aria-label': `${layer.name}, ${layer.kind}`,
    'aria-selected': selected ? 'true' : 'false',
    'aria-expanded': layer.kind === 'Group' ? 'true' : null,
    'aria-level': String(depth + 1),
    class: 'layer-row',
    tabindex: selected ? '0' : '-1',
    'data-layer-id': layer.id,
    'data-kind': layer.kind,
    'data-order': String(layer.order),
    'data-focus-key': `layer:${layer.id}`,
  });
  row.style.paddingLeft = `${depth * 12 + 4}px`;

  const handle = iconButton({
    label: `Drag ${layer.name}`,
    icon: icons.drag,
    disabled: !store.canEdit,
    description: store.canEdit ? undefined : MSG.viewerCantEdit,
    onClick: () => undefined,
  });
  attachDrag(handle, store, layer, rows, callbacks);
  const main = el('div', { class: 'layer-main' }, [
    handle,
    el('span', { class: 'layer-name', text: layer.name }),
  ]);
  if (held) main.append(el('span', { class: 'layer-held', text: `Held by ${held.name}` }));
  row.append(main);

  const tools = el('div', { class: 'layer-tools' });
  const visible = layer.visible;
  tools.append(
    iconButton({
      label: visible ? `Hide ${layer.name}` : `Show ${layer.name}`,
      icon: visible ? icons.show : icons.hide,
      disabled: !store.canEdit,
      description: store.canEdit ? undefined : MSG.viewerCantEdit,
      onClick: () => {
        void store.takeLock(layer.id);
        store.updateLayerValue(layer.id, 'visible', !visible);
        store.state.focusTarget = `layer-visible:${layer.id}`;
        callbacks.rerender();
      },
    }),
    iconButton({
      label: layer.locked ? `Unlock ${layer.name}` : `Lock ${layer.name}`,
      icon: layer.locked ? icons.lock : icons.unlock,
      disabled: !store.canEdit,
      description: store.canEdit ? undefined : MSG.viewerCantEdit,
      onClick: () => {
        store.queue({ type: 'updateLayer', layerId: layer.id, set: { locked: !layer.locked } });
        void store.flush().then(() => callbacks.rerender());
      },
    }),
  );
  const actions = iconButton({
    label: `Actions for ${layer.name}`,
    icon: icons.actions,
    onClick: () => {
      openMenu({
        name: `Actions for ${layer.name}`,
        opener: actions,
        items: [
          { label: 'Move up', onSelect: () => moveRelative(store, layer, -1, callbacks) },
          { label: 'Move down', onSelect: () => moveRelative(store, layer, 1, callbacks) },
          {
            label: 'Duplicate',
            onSelect: () => {
              store.queue({ type: 'duplicateLayer', layerId: layer.id });
              void store.flush().then(() => callbacks.rerender());
            },
          },
          {
            label: 'Group',
            onSelect: () => {
              const ids = store.state.selection.includes(layer.id)
                ? store.state.selection
                : [layer.id];
              store.queue({ type: 'group', layerIds: ids });
              void store.flush().then(() => callbacks.rerender());
            },
          },
          {
            label: 'Ungroup',
            onSelect: () => {
              const target = layer.kind === 'Group' ? layer.id : layer.parentId;
              if (!target) return;
              store.queue({ type: 'ungroup', groupId: target });
              void store.flush().then(() => callbacks.rerender());
            },
          },
          {
            label: 'Delete',
            onSelect: () => {
              store.queue({ type: 'deleteLayer', layerId: layer.id });
              store.state.selection = [];
              void store.flush().then(() => callbacks.rerender());
            },
          },
        ],
      });
    },
  });
  tools.append(actions);
  row.append(tools);

  row.addEventListener('pointerdown', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('button')) return;
    if (event.shiftKey) {
      if (!store.state.selection.includes(layer.id)) store.state.selection.push(layer.id);
    } else {
      store.state.selection = [layer.id];
    }
    store.state.focusTarget = `layer:${layer.id}`;
    callbacks.rerender();
  });

  row.addEventListener('keydown', (event) => {
    const index = rows.findIndex((entry) => entry.layer.id === layer.id);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = rows[index + (event.key === 'ArrowDown' ? 1 : -1)];
      if (!next) return;
      if (event.shiftKey) {
        if (!store.state.selection.includes(next.layer.id)) {
          store.state.selection = [...store.state.selection, next.layer.id];
        }
      } else {
        store.state.selection = [next.layer.id];
      }
      store.state.focusTarget = `layer:${next.layer.id}`;
      callbacks.rerender();
      return;
    }
    if (event.key === ' ') {
      event.preventDefault();
      store.state.selection = store.state.selection.includes(layer.id)
        ? store.state.selection.filter((id) => id !== layer.id)
        : [...store.state.selection, layer.id];
      store.state.focusTarget = `layer:${layer.id}`;
      callbacks.rerender();
      return;
    }
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      moveRelative(store, layer, event.key === 'ArrowUp' ? -1 : 1, callbacks);
    }
  });

  return row;
}

/** Dragging a row's handle drops it between rows, with an accent line at the drop point. */
function attachDrag(
  handle: HTMLElement,
  store: EditorStore,
  layer: Layer,
  rows: { layer: Layer; depth: number }[],
  callbacks: LayersCallbacks,
): void {
  let line: HTMLElement | null = null;
  let dropBefore: { layer: Layer } | null = null;
  let dragging = false;

  const siblingRows = (): { layer: Layer; element: HTMLElement }[] =>
    rows
      .filter((entry) => entry.layer.parentId === layer.parentId)
      .map((entry) => ({
        layer: entry.layer,
        element: document.querySelector<HTMLElement>(`[data-layer-id="${entry.layer.id}"]`)!,
      }))
      .filter((entry) => entry.element !== null);

  const clear = (): void => {
    line?.remove();
    line = null;
  };

  handle.addEventListener('pointerdown', (event) => {
    if (!store.canEdit) return;
    event.preventDefault();
    dragging = true;
    handle.setPointerCapture(event.pointerId);
    line = el('div', { class: 'drop-line' });
  });

  handle.addEventListener('pointermove', (event) => {
    if (!dragging || !line) return;
    const candidates = siblingRows();
    dropBefore = null;
    for (const candidate of candidates) {
      const rect = candidate.element.getBoundingClientRect();
      if (event.clientY < rect.top + rect.height / 2) {
        dropBefore = { layer: candidate.layer };
        candidate.element.before(line);
        return;
      }
    }
    const last = candidates[candidates.length - 1];
    if (last) last.element.after(line);
  });

  handle.addEventListener('pointerup', () => {
    if (!dragging) return;
    dragging = false;
    clear();
    const ordered = rows
      .filter((entry) => entry.layer.parentId === layer.parentId)
      .map((entry) => entry.layer);
    const target = dropBefore
      ? ordered.findIndex((candidate) => candidate.id === dropBefore?.layer.id)
      : ordered.length;
    if (target < 0) return;
    const fromTop = ordered.findIndex((candidate) => candidate.id === layer.id);
    if (target === fromTop || target === fromTop + 1) return;
    const topIndex = target > fromTop ? target - 1 : target;
    const order = ordered.length - 1 - topIndex;
    store.queue({ type: 'moveLayer', layerId: layer.id, parentId: layer.parentId, order });
    store.state.focusTarget = `layer:${layer.id}`;
    void store.flush().then(() => callbacks.rerender());
  });

  handle.addEventListener('pointercancel', () => {
    dragging = false;
    clear();
  });
}

/** Moving one place up the list is one step higher in stack order. */
function moveRelative(
  store: EditorStore,
  layer: Layer,
  direction: -1 | 1,
  callbacks: LayersCallbacks,
): void {
  const scene = store.scene;
  if (!scene) return;
  const siblings = scene.layers
    .filter((candidate) => candidate.parentId === layer.parentId)
    .sort((a, b) => a.order - b.order);
  const position = siblings.findIndex((candidate) => candidate.id === layer.id);
  const target = position + (direction === -1 ? 1 : -1);
  if (target < 0 || target >= siblings.length) return;
  store.queue({
    type: 'moveLayer',
    layerId: layer.id,
    parentId: layer.parentId,
    order: target,
  });
  store.state.focusTarget = `layer:${layer.id}`;
  void store.flush().then(() => callbacks.rerender());
}

export { ADD_LAYER_ITEMS };
