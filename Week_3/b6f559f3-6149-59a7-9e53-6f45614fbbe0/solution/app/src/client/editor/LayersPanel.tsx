import { memo, useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import {
  Atom,
  Box,
  Camera,
  ChevronDown,
  ChevronRight,
  Circle,
  Cuboid,
  Eye,
  EyeOff,
  Folder,
  Gem,
  GripVertical,
  Hexagon,
  Image as ImageIcon,
  Layers,
  Lock,
  LockOpen,
  Plus,
  Shapes,
  Sparkles,
  Square,
  Type,
  Waves,
  Ellipsis,
} from 'lucide-react';
import { descendants, siblings } from '../../shared/document';
import { heldBy } from '../../shared/messages';
import { newId } from '../api';
import type { AssetInfo, Change, Layer, LayerKind, JsonObject, Scene } from '../../shared/types';
import { editGate, MenuButton, Notice, type MenuItemDef } from './controls';
import { useEditorSelector, useEditorStore } from './EditorProvider';
import { CAMERA_ID } from './model';

const KIND_ICON: Record<LayerKind, typeof Box> = {
  Rectangle: Square,
  Ellipse: Circle,
  Polygon: Hexagon,
  Text: Type,
  Image: ImageIcon,
  Gradient: Waves,
  Effect: Sparkles,
  Primitive: Box,
  Extrusion: Cuboid,
  Model: Gem,
  Particles: Atom,
  Cloth: Shapes,
  Group: Folder,
};

type Upload = 'image' | 'svg' | 'model';
type AddItem = { label: string; draft: { kind: LayerKind; props?: JsonObject } } | { label: string; upload: Upload };

const effect = (kind: string): AddItem => ({ label: kind, draft: { kind: 'Effect', props: { effect: { kind } } } });
const primitive = (name: string): AddItem => ({ label: name, draft: { kind: 'Primitive', props: { primitive: name } } });
const preset = (name: string): AddItem => ({ label: `${name} model`, draft: { kind: 'Model', props: { preset: name } } });

const ADD_ITEMS: AddItem[] = [
  { label: 'Rectangle', draft: { kind: 'Rectangle' } },
  { label: 'Ellipse', draft: { kind: 'Ellipse' } },
  { label: 'Polygon', draft: { kind: 'Polygon' } },
  { label: 'Text', draft: { kind: 'Text' } },
  { label: 'Image', upload: 'image' },
  { label: 'Gradient', draft: { kind: 'Gradient' } },
  effect('Blur'),
  effect('Grain'),
  effect('Bloom'),
  effect('Glow'),
  effect('Chromatic aberration'),
  effect('Displacement'),
  effect('Pixelate'),
  primitive('Cube'),
  primitive('Sphere'),
  primitive('Cylinder'),
  primitive('Torus'),
  primitive('Plane'),
  { label: 'Extruded text', draft: { kind: 'Extrusion', props: { source: 'text' } } },
  { label: 'Extruded SVG', upload: 'svg' },
  { label: 'Model', upload: 'model' },
  preset('Pebble'),
  preset('Arch'),
  preset('Lattice'),
  { label: 'Particles', draft: { kind: 'Particles' } },
  { label: 'Cloth', draft: { kind: 'Cloth' } },
];

const UPLOAD_LABEL: Record<Upload, string> = { image: 'Choose image', svg: 'Choose SVG', model: 'Choose model' };
const UPLOAD_ACCEPT: Record<Upload, string> = {
  image: 'image/png,image/jpeg,image/webp',
  svg: 'image/svg+xml,.svg',
  model: '.gltf,.glb,model/gltf+json,model/gltf-binary',
};

interface Row {
  layer: Layer;
  depth: number;
}

/** Rows as listed: the topmost layer first, a group's children right after the group unless collapsed. */
function listRows(scene: Scene, collapsed: ReadonlySet<string>): Row[] {
  const rows: Row[] = [];
  const walk = (parentId: string | null, depth: number): void => {
    for (const layer of [...siblings(scene, parentId)].reverse()) {
      rows.push({ layer, depth });
      if (layer.kind === 'Group' && !collapsed.has(layer.id)) walk(layer.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

interface RowProps {
  layer: Layer;
  depth: number;
  selected: boolean;
  tabbable: boolean;
  expanded: boolean | null;
  heldName: string | null;
  canEdit: boolean;
  onSelect: (layer: Layer, mode: 'replace' | 'toggle' | 'range') => void;
  onKey: (event: KeyboardEvent<HTMLDivElement>, layer: Layer) => void;
  onToggleExpanded: (id: string) => void;
  onDragStart: (event: PointerEvent<HTMLButtonElement>, layer: Layer) => void;
  onField: (layer: Layer, set: JsonObject) => void;
  actions: (layer: Layer) => MenuItemDef[];
}

const LayerRow = memo(function LayerRow(props: RowProps) {
  const { layer, depth, selected, tabbable, expanded, heldName, canEdit } = props;
  const Icon = KIND_ICON[layer.kind];
  const gate = editGate(canEdit);
  return (
    <div
      role="treeitem"
      aria-label={`${layer.name}, ${layer.kind}`}
      aria-selected={selected}
      aria-level={depth + 1}
      aria-expanded={expanded === null ? undefined : expanded}
      tabIndex={tabbable ? 0 : -1}
      data-layer-id={layer.id}
      data-kind={layer.kind}
      data-order={layer.order}
      className={`layer-row${selected ? ' is-selected' : ''}${layer.visible ? '' : ' is-hidden'}`}
      style={{ paddingLeft: `${8 + depth * 16}px` }}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('button')) return;
        props.onSelect(layer, event.shiftKey ? 'range' : event.metaKey || event.ctrlKey ? 'toggle' : 'replace');
      }}
      onKeyDown={(event) => props.onKey(event, layer)}
    >
      <button type="button" className="row-button drag-handle" aria-label={`Drag ${layer.name}`} {...gate} onPointerDown={(event) => props.onDragStart(event, layer)}>
        <GripVertical size={16} aria-hidden="true" />
      </button>
      {expanded !== null ? (
        <button type="button" className="row-button row-fold" tabIndex={-1} aria-hidden="true" onClick={() => props.onToggleExpanded(layer.id)}>
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
      ) : (
        <span className="row-kind" aria-hidden="true">
          <Icon size={16} />
        </span>
      )}
      <span className="row-name">{layer.name}</span>
      {heldName && <span className="row-held">{heldBy(heldName)}</span>}
      <button
        type="button"
        className="row-button"
        aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
        {...gate}
        onClick={() => props.onField(layer, { visible: !layer.visible })}
      >
        {layer.visible ? <Eye size={16} aria-hidden="true" /> : <EyeOff size={16} aria-hidden="true" />}
      </button>
      <button
        type="button"
        className="row-button"
        aria-label={layer.locked ? `Unlock ${layer.name}` : `Lock ${layer.name}`}
        {...gate}
        onClick={() => props.onField(layer, { locked: !layer.locked })}
      >
        {layer.locked ? <Lock size={16} aria-hidden="true" /> : <LockOpen size={16} aria-hidden="true" />}
      </button>
      <MenuButton menuLabel={`Actions for ${layer.name}`} label={`Actions for ${layer.name}`} align="end" className="row-button" disabled={!canEdit} describedBy={gate['aria-describedby']} title={gate.title} items={props.actions(layer)}>
        <Ellipsis size={16} aria-hidden="true" />
      </MenuButton>
    </div>
  );
});

export function LayersPanel() {
  const store = useEditorStore();
  const scene = useEditorSelector((e) => e.scene);
  const selection = useEditorSelector((e) => e.selection);
  const canEdit = useEditorSelector((e) => e.canEdit);
  const locks = useEditorSelector((e) => e.locks);
  const notice = useEditorSelector((e) => e.notices.layers);
  const meId = useEditorSelector((e) => e.me.id);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [focusId, setFocusId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ layerId: string; top: number } | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const anchor = useRef<string | null>(null);
  const pendingFocus = useRef<string | null>(null);
  const inputs = useRef<Record<Upload, HTMLInputElement | null>>({ image: null, svg: null, model: null });
  const gate = editGate(canEdit);
  const actions = store.actions;

  const rows = listRows(scene, collapsed);
  const rowIds = rows.map((r) => r.layer.id);

  const focusRow = useCallback((id: string) => {
    treeRef.current?.querySelector<HTMLElement>(`[data-layer-id="${CSS.escape(id)}"], [data-camera-row="${CSS.escape(id)}"]`)?.focus();
  }, []);

  useLayoutEffect(() => {
    const id = pendingFocus.current;
    if (id && (id === CAMERA_ID || scene.layers.some((l) => l.id === id))) {
      pendingFocus.current = null;
      focusRow(id);
    }
  });

  const heldNameOf = (id: string): string | null => {
    const lock = locks.get(id);
    return lock && lock.heldBy.id !== meId ? lock.heldBy.name : null;
  };

  const select = useCallback(
    (layer: Layer, mode: 'replace' | 'toggle' | 'range') => {
      const current = store.getSnapshot().selection;
      setFocusId(layer.id);
      if (mode === 'replace') {
        anchor.current = layer.id;
        actions.select([layer.id]);
      } else if (mode === 'toggle') {
        anchor.current = layer.id;
        const next = current.includes(layer.id) ? current.filter((id) => id !== layer.id) : [...current.filter((id) => id !== CAMERA_ID), layer.id];
        actions.select(next, next.includes(layer.id) ? layer.id : (next[next.length - 1] ?? null));
      } else {
        const from = rowIds.indexOf(anchor.current ?? layer.id);
        const to = rowIds.indexOf(layer.id);
        const [lo, hi] = from <= to ? [from, to] : [to, from];
        actions.select(rowIds.slice(lo, hi + 1), layer.id);
      }
    },
    [actions, rowIds, store],
  );

  const targetsOf = (layer: Layer): string[] => {
    const current = store.getSnapshot().selection;
    return current.includes(layer.id) ? current.filter((id) => id !== CAMERA_ID) : [layer.id];
  };

  const move = (layer: Layer, delta: 1 | -1): void => {
    const order = layer.order + delta;
    if (order < 0 || order >= siblings(scene, layer.parentId).length) return;
    pendingFocus.current = layer.id;
    actions.apply([{ type: 'moveLayer', layerId: layer.id, parentId: layer.parentId, order }], undefined, 'layers');
  };

  const duplicate = async (layer: Layer): Promise<void> => {
    const ids = await actions.applyWithIds([{ type: 'duplicateLayer', layerId: layer.id }], 'layers');
    const copy = ids?.[`duplicate:${layer.id}`];
    if (copy) {
      pendingFocus.current = copy;
      actions.select([copy]);
    }
  };

  const group = async (layer: Layer): Promise<void> => {
    const layerIds = targetsOf(layer);
    const parents = new Set(layerIds.map((id) => scene.layers.find((l) => l.id === id)?.parentId ?? null));
    if (parents.size > 1) {
      actions.setNotice('layers', 'Grouped layers must share a parent.');
      return;
    }
    const ids = await actions.applyWithIds([{ type: 'group', layerIds }], 'layers');
    const top = [...layerIds].sort((a, b) => (scene.layers.find((l) => l.id === b)?.order ?? 0) - (scene.layers.find((l) => l.id === a)?.order ?? 0))[0];
    const made = top ? ids?.[`group:${top}`] : undefined;
    if (made) {
      pendingFocus.current = made;
      actions.select([made]);
    }
  };

  const ungroup = (layer: Layer): void => {
    if (layer.kind !== 'Group') return;
    const children = siblings(scene, layer.id).map((l) => l.id);
    actions.apply([{ type: 'ungroup', groupId: layer.id }], undefined, 'layers');
    actions.select(children);
  };

  const remove = (layer: Layer): void => {
    const ids = targetsOf(layer);
    actions.apply(ids.map((layerId): Change => ({ type: 'deleteLayer', layerId })), undefined, 'layers');
    actions.select([]);
  };

  const rowActions = (layer: Layer): MenuItemDef[] => {
    const count = siblings(scene, layer.parentId).length;
    return [
      { label: 'Move up', onSelect: () => move(layer, 1), disabled: layer.order >= count - 1 },
      { label: 'Move down', onSelect: () => move(layer, -1), disabled: layer.order <= 0 },
      { label: 'Duplicate', onSelect: () => void duplicate(layer) },
      { label: 'Group', onSelect: () => void group(layer) },
      { label: 'Ungroup', onSelect: () => ungroup(layer), disabled: layer.kind !== 'Group' },
      { label: 'Delete', onSelect: () => remove(layer) },
    ];
  };

  const onKey = (event: KeyboardEvent<HTMLDivElement>, layer: Layer): void => {
    if (event.target !== event.currentTarget) return;
    const at = rowIds.indexOf(layer.id);
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      if (canEdit) move(layer, event.key === 'ArrowUp' ? 1 : -1);
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const nextId = rowIds[at + (event.key === 'ArrowUp' ? -1 : 1)];
      const next = rows.find((r) => r.layer.id === nextId)?.layer;
      if (!next) {
        if (event.key === 'ArrowUp') {
          setFocusId(CAMERA_ID);
          focusRow(CAMERA_ID);
        }
        return;
      }
      setFocusId(next.id);
      focusRow(next.id);
      if (event.shiftKey) select(next, 'range');
      else {
        anchor.current = next.id;
        actions.select([next.id]);
      }
    } else if (event.key === ' ') {
      event.preventDefault();
      select(layer, 'toggle');
    } else if (event.key === 'Enter') {
      event.preventDefault();
      select(layer, 'replace');
    } else if (layer.kind === 'Group' && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
      event.preventDefault();
      const open = event.key === 'ArrowRight';
      setCollapsed((current) => {
        const next = new Set(current);
        if (open) next.delete(layer.id);
        else next.add(layer.id);
        return next;
      });
    }
  };

  const cameraKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const first = rows[0]?.layer;
      if (first) {
        setFocusId(first.id);
        focusRow(first.id);
        anchor.current = first.id;
        actions.select([first.id]);
      }
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      actions.select([CAMERA_ID]);
    }
  };

  // ---- drag to reorder, by mouse or touch, from the Drag handle
  const startDrag = (event: PointerEvent<HTMLButtonElement>, layer: Layer): void => {
    if (!canEdit || event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const tree = treeRef.current as HTMLDivElement;
    const hidden = new Set([layer.id, ...descendants(scene, layer.id).map((l) => l.id)]);
    const others = rows.filter((r) => !hidden.has(r.layer.id));
    const target = (clientY: number): { index: number; top: number } => {
      const treeTop = tree.getBoundingClientRect().top - tree.scrollTop;
      const rects = others.map((r) => (tree.querySelector(`[data-layer-id="${CSS.escape(r.layer.id)}"]`) as HTMLElement).getBoundingClientRect());
      let index = rects.filter((rect) => rect.top + rect.height / 2 < clientY).length;
      index = Math.min(index, rects.length);
      const edge = index < rects.length ? (rects[index] as DOMRect).top : rects.length ? (rects[rects.length - 1] as DOMRect).bottom : treeTop;
      return { index, top: edge - treeTop };
    };
    let last = target(event.clientY);
    setDrop({ layerId: layer.id, top: last.top });
    const move = (e: globalThis.PointerEvent): void => {
      last = target(e.clientY);
      setDrop({ layerId: layer.id, top: last.top });
    };
    const finish = (e: globalThis.PointerEvent): void => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', finish);
      handle.removeEventListener('pointercancel', finish);
      handle.releasePointerCapture(e.pointerId);
      setDrop(null);
      if (e.type === 'pointercancel') return;
      const below = others[last.index]?.layer;
      const parentId = below ? below.parentId : null;
      const peers = siblings(scene, parentId).filter((l) => l.id !== layer.id);
      const order = below ? peers.findIndex((l) => l.id === below.id) + 1 : 0;
      if (parentId === layer.parentId && siblings(scene, parentId).findIndex((l) => l.id === layer.id) === order) return;
      pendingFocus.current = layer.id;
      actions.apply([{ type: 'moveLayer', layerId: layer.id, parentId, order }], undefined, 'layers');
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
  };

  const add = async (item: AddItem): Promise<void> => {
    if ('upload' in item) {
      inputs.current[item.upload]?.click();
      return;
    }
    await create({ ...item.draft });
  };

  const create = async (draft: { kind: LayerKind; props?: JsonObject }): Promise<void> => {
    const ref = newId();
    const ids = await actions.applyWithIds([{ type: 'addLayer', layer: draft, ref }], 'layers');
    const id = ids?.[ref];
    if (id) {
      pendingFocus.current = id;
      setFocusId(id);
      actions.select([id]);
    }
  };

  const uploaded = async (kind: Upload, file: File): Promise<void> => {
    const asset: AssetInfo | null = await actions.uploadAsset(kind, file);
    if (!asset) return;
    if (kind === 'image') {
      const fit = Math.min(1, 1440 / (asset.width ?? 200), 810 / (asset.height ?? 200));
      await create({ kind: 'Image', props: { assetId: asset.id, width: Math.max(1, Math.round((asset.width ?? 200) * fit)), height: Math.max(1, Math.round((asset.height ?? 200) * fit)) } });
    } else if (kind === 'svg') {
      await create({ kind: 'Extrusion', props: { source: 'svg', svgAssetId: asset.id } });
    } else {
      const clips = asset.clips.map((clip) => ({ name: clip.name, play: false, loop: false, speed: 1, offsetMs: 0 }));
      await create({ kind: 'Model', props: { modelAssetId: asset.id, clips } });
    }
  };

  const tabbableId = focusId && (focusId === CAMERA_ID || rowIds.includes(focusId)) ? focusId : (selection[selection.length - 1] ?? CAMERA_ID);
  const cameraSelected = selection.includes(CAMERA_ID);

  return (
    <section className="panel layers-panel" aria-labelledby="layers-title">
      <div className="panel-head">
        <h2 id="layers-title" className="panel-title">
          <Layers size={16} aria-hidden="true" /> Layers
        </h2>
        <MenuButton
          menuLabel="Add layer"
          label="Add layer"
          align="end"
          className="btn btn-compact"
          disabled={!canEdit}
          describedBy={gate['aria-describedby']}
          title={gate.title}
          items={ADD_ITEMS.map((item) => ({ label: item.label, onSelect: () => void add(item) }))}
        >
          <Plus size={16} aria-hidden="true" /> Add layer
        </MenuButton>
      </div>
      <Notice message={notice} />
      {(['image', 'svg', 'model'] as const).map((kind) => (
        <input
          key={kind}
          ref={(node) => {
            inputs.current[kind] = node;
          }}
          type="file"
          className="sr-only"
          tabIndex={-1}
          aria-label={UPLOAD_LABEL[kind]}
          accept={UPLOAD_ACCEPT[kind]}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void uploaded(kind, file);
          }}
        />
      ))}
      <div ref={treeRef} role="tree" aria-label="Layers" aria-multiselectable="true" className="layer-tree">
        <div
          role="treeitem"
          aria-label="Camera, Camera"
          aria-selected={cameraSelected}
          aria-level={1}
          tabIndex={tabbableId === CAMERA_ID ? 0 : -1}
          data-camera-row={CAMERA_ID}
          data-kind="Camera"
          className={`layer-row${cameraSelected ? ' is-selected' : ''}`}
          onClick={() => {
            setFocusId(CAMERA_ID);
            actions.select([CAMERA_ID]);
          }}
          onKeyDown={cameraKey}
        >
          <span className="row-grip-space" aria-hidden="true" />
          <span className="row-kind" aria-hidden="true">
            <Camera size={16} />
          </span>
          <span className="row-name">Camera</span>
        </div>
        {rows.map(({ layer, depth }) => (
          <LayerRow
            key={layer.id}
            layer={layer}
            depth={depth}
            selected={selection.includes(layer.id)}
            tabbable={tabbableId === layer.id}
            expanded={layer.kind === 'Group' ? !collapsed.has(layer.id) : null}
            heldName={heldNameOf(layer.id)}
            canEdit={canEdit}
            onSelect={select}
            onKey={onKey}
            onToggleExpanded={(id) =>
              setCollapsed((current) => {
                const next = new Set(current);
                if (!next.delete(id)) next.add(id);
                return next;
              })
            }
            onDragStart={startDrag}
            onField={(target, set) => actions.apply([{ type: 'updateLayer', layerId: target.id, set, breakpoint: 'desktop' }], `row|${target.id}|${Object.keys(set)[0]}`, 'layers')}
            actions={rowActions}
          />
        ))}
        {rows.length === 0 && (
          <div className="empty-state">
            <svg width="96" height="64" viewBox="0 0 96 64" aria-hidden="true">
              <rect x="1" y="1" width="94" height="62" rx="6" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="3 4" />
              <circle cx="48" cy="32" r="9" fill="none" stroke="currentColor" strokeWidth="1" />
            </svg>
            <p className="muted">No layers yet. Use Add layer.</p>
          </div>
        )}
        {drop && <div className="drop-line" style={{ top: drop.top }} aria-hidden="true" />}
      </div>
    </section>
  );
}
