// Change application and inversion for the ops/undo/redo engine.
// Each user action is one undo step; the inverse of every change is
// computed here so undo/redo reuses the same apply path.
import type {
  Breakpoint,
  Easing,
  Layer,
  SceneBundle,
  SceneDocument,
  Variable,
} from './types';
import { getPath, setPath, deletePath, getOverrideValue } from './paths';

export type Change =
  | { type: 'addLayer'; layer: Layer; ref: string }
  | { type: 'updateLayer'; layerId: string; set: string; value: unknown; breakpoint?: Breakpoint }
  | { type: 'clearOverride'; layerId: string; breakpoint: 'tablet' | 'mobile'; path: string }
  | { type: 'deleteLayer'; layerId: string }
  | { type: 'moveLayer'; layerId: string; parentId: string | null; order: number }
  | { type: 'duplicateLayer'; layerId: string; newId: string }
  | { type: 'group'; layerIds: string[]; groupId: string }
  | { type: 'ungroup'; groupId: string }
  | { type: 'setKeyframe'; layerId: string; property: string; frame: number; value: number | string | boolean; easing: Easing }
  | { type: 'moveKeyframe'; layerId: string; property: string; fromFrame: number; toFrame: number }
  | { type: 'deleteKeyframe'; layerId: string; property: string; frame: number }
  | { type: 'updateScene'; set: string; value: unknown; breakpoint?: Breakpoint }
  | { type: 'addVariable'; variable: Variable }
  | { type: 'updateVariable'; name: string; value: Variable['value'] }
  | { type: 'deleteVariable'; name: string }
  | { type: 'bind'; layerId: string; property: string; variable: string }
  | { type: 'unbind'; layerId: string; property: string }
  | { type: 'savePreset'; name: string }
  | { type: 'applyPreset'; name: string; values: Record<string, Variable['value']> }
  | { type: 'deletePreset'; name: string };

export function findLayer(doc: SceneDocument, id: string): Layer | undefined {
  return doc.layers.find((l) => l.id === id);
}

export interface ApplyResult {
  ids: Record<string, string>;
}

// Applies a change in place. Returns client-ref -> new id mappings.
export function applyChange(bundle: SceneBundle, sceneId: string, ch: Change): ApplyResult {
  const doc = bundle.scenes.find((s) => s.id === sceneId);
  if (!doc) return { ids: {} };
  const ids: Record<string, string> = {};
  switch (ch.type) {
    case 'addLayer': {
      const layer = structuredClone(ch.layer) as Layer;
      doc.layers.push(layer);
      if (ch.ref) ids[ch.ref] = layer.id;
      break;
    }
    case 'updateLayer': {
      const layer = findLayer(doc, ch.layerId);
      if (!layer) return { ids };
      if (ch.breakpoint && ch.breakpoint !== 'desktop') {
        setPath(layer.overrides[ch.breakpoint], ch.set, ch.value);
      } else {
        setPath(layer.props, ch.set, ch.value);
      }
      break;
    }
    case 'clearOverride': {
      const layer = findLayer(doc, ch.layerId);
      if (!layer) return { ids };
      deletePath(layer.overrides[ch.breakpoint], ch.path);
      break;
    }
    case 'deleteLayer': {
      const idx = doc.layers.findIndex((l) => l.id === ch.layerId);
      if (idx >= 0) doc.layers.splice(idx, 1);
      break;
    }
    case 'moveLayer': {
      const layer = findLayer(doc, ch.layerId);
      if (!layer) return { ids };
      layer.parentId = ch.parentId;
      layer.order = ch.order;
      break;
    }
    case 'duplicateLayer': {
      const layer = findLayer(doc, ch.layerId);
      if (!layer) return { ids };
      const copy = structuredClone(layer);
      copy.id = ch.newId;
      // Duplicating places the copy directly above the original.
      copy.order = layer.order + 1;
      // shift later layers up by one
      for (const l of doc.layers) {
        if (l.id !== layer.id && l.parentId === layer.parentId && l.order > layer.order) {
          l.order += 1;
        }
      }
      doc.layers.push(copy);
      ids['__dup__'] = ch.newId;
      break;
    }
    case 'group': {
      const members = ch.layerIds
        .map((id) => findLayer(doc, id))
        .filter((l): l is Layer => !!l);
      if (members.length === 0) return { ids };
      const parentId = members[0]!.parentId;
      const topOrder = Math.min(...members.map((m) => m.order));
      const group: Layer = {
        id: ch.groupId,
        name: 'Group',
        kind: 'Group',
        parentId,
        order: topOrder,
        visible: true,
        locked: false,
        maskAbove: false,
        blendMode: 'Normal',
        props: {},
        overrides: { tablet: {}, mobile: {} },
        keyframes: [],
        events: {},
        bindings: {},
      };
      for (const m of members) {
        m.parentId = ch.groupId;
      }
      for (const l of doc.layers) {
        if (l.parentId === parentId && l.order > topOrder && !ch.layerIds.includes(l.id)) {
          l.order += 1;
        }
      }
      doc.layers.push(group);
      ids['__group__'] = ch.groupId;
      break;
    }
    case 'ungroup': {
      const group = findLayer(doc, ch.groupId);
      if (!group || group.kind !== 'Group') return { ids };
      const members = doc.layers.filter((l) => l.parentId === group.id);
      for (const m of members) {
        m.parentId = group.parentId;
      }
      const idx = doc.layers.findIndex((l) => l.id === group.id);
      if (idx >= 0) doc.layers.splice(idx, 1);
      break;
    }
    case 'setKeyframe': {
      const layer = findLayer(doc, ch.layerId);
      if (!layer) return { ids };
      const existing = layer.keyframes.find(
        (k) => k.property === ch.property && k.frame === ch.frame,
      );
      if (existing) {
        existing.value = ch.value;
        existing.easing = ch.easing;
      } else {
        layer.keyframes.push({
          property: ch.property,
          frame: ch.frame,
          value: ch.value,
          easing: ch.easing,
        });
      }
      break;
    }
    case 'moveKeyframe': {
      const layer = findLayer(doc, ch.layerId);
      if (!layer) return { ids };
      const kf = layer.keyframes.find(
        (k) => k.property === ch.property && k.frame === ch.fromFrame,
      );
      if (kf) kf.frame = ch.toFrame;
      break;
    }
    case 'deleteKeyframe': {
      const layer = findLayer(doc, ch.layerId);
      if (!layer) return { ids };
      const idx = layer.keyframes.findIndex(
        (k) => k.property === ch.property && k.frame === ch.frame,
      );
      if (idx >= 0) layer.keyframes.splice(idx, 1);
      break;
    }
    case 'updateScene': {
      if (ch.breakpoint && ch.breakpoint !== 'desktop') {
        // Scene-level fields are not per-breakpoint; stored as-is.
        setPath(doc as unknown as Record<string, unknown>, ch.set, ch.value);
      } else {
        setPath(doc as unknown as Record<string, unknown>, ch.set, ch.value);
      }
      break;
    }
    case 'addVariable': {
      if (!bundle.variables.some((v) => v.name === ch.variable.name)) {
        bundle.variables.push(structuredClone(ch.variable));
      }
      break;
    }
    case 'updateVariable': {
      const v = bundle.variables.find((x) => x.name === ch.name);
      if (v) v.value = ch.value;
      break;
    }
    case 'deleteVariable': {
      const idx = bundle.variables.findIndex((x) => x.name === ch.name);
      if (idx >= 0) bundle.variables.splice(idx, 1);
      // Unbind every property; each keeps the variable's last value.
      for (const scene of bundle.scenes) {
        for (const layer of scene.layers) {
          for (const [path, varName] of Object.entries(layer.bindings)) {
            if (varName === ch.name) {
              const last = getPath(layer.props, path);
              void last;
              delete layer.bindings[path];
            }
          }
        }
      }
      break;
    }
    case 'bind': {
      const layer = findLayer(doc, ch.layerId);
      if (layer) layer.bindings[ch.property] = ch.variable;
      break;
    }
    case 'unbind': {
      const layer = findLayer(doc, ch.layerId);
      if (layer) delete layer.bindings[ch.property];
      break;
    }
    case 'savePreset': {
      const values: Record<string, Variable['value']> = {};
      for (const v of bundle.variables) values[v.name] = structuredClone(v.value);
      const existing = bundle.presets.find((p) => p.name === ch.name);
      if (existing) existing.values = values;
      else bundle.presets.push({ name: ch.name, values });
      break;
    }
    case 'applyPreset': {
      for (const [name, value] of Object.entries(ch.values)) {
        const v = bundle.variables.find((x) => x.name === name);
        if (v) v.value = structuredClone(value);
      }
      break;
    }
    case 'deletePreset': {
      const idx = bundle.presets.findIndex((p) => p.name === ch.name);
      if (idx >= 0) bundle.presets.splice(idx, 1);
      break;
    }
  }
  return { ids };
}

// The inverse of a change, for undo. Reads the state before the change was
// applied (the bundle passed in has NOT yet been modified).
export function invertChange(
  bundle: SceneBundle,
  sceneId: string,
  ch: Change,
): Change | null {
  const doc = bundle.scenes.find((s) => s.id === sceneId);
  if (!doc) return null;
  switch (ch.type) {
    case 'addLayer': {
      return { type: 'deleteLayer', layerId: ch.layer.id };
    }
    case 'updateLayer': {
      const layer = findLayer(doc, ch.layerId);
      if (!layer) return null;
      const prev =
        ch.breakpoint && ch.breakpoint !== 'desktop'
          ? getOverrideValue(layer.overrides, ch.breakpoint, ch.set)
          : getPath(layer.props, ch.set);
      if (prev === undefined) {
        // no previous value: undo must remove it — represented as a clear of
        // the override, or the default value for props.
        if (ch.breakpoint && ch.breakpoint !== 'desktop') {
          return { type: 'clearOverride', layerId: ch.layerId, breakpoint: ch.breakpoint, path: ch.set };
        }
        return null;
      }
      return { type: 'updateLayer', layerId: ch.layerId, set: ch.set, value: prev, breakpoint: ch.breakpoint };
    }
    case 'clearOverride': {
      const layer = findLayer(doc, ch.layerId);
      if (!layer) return null;
      const prev = getOverrideValue(layer.overrides, ch.breakpoint, ch.path);
      if (prev === undefined) return null;
      return { type: 'updateLayer', layerId: ch.layerId, set: ch.path, value: prev, breakpoint: ch.breakpoint };
    }
    case 'deleteLayer': {
      const layer = findLayer(doc, ch.layerId);
      if (!layer) return null;
      return { type: 'addLayer', layer: structuredClone(layer), ref: '__undo__' };
    }
    case 'moveLayer': {
      const layer = findLayer(doc, ch.layerId);
      if (!layer) return null;
      return { type: 'moveLayer', layerId: ch.layerId, parentId: layer.parentId, order: layer.order };
    }
    case 'duplicateLayer': {
      return { type: 'deleteLayer', layerId: ch.newId };
    }
    case 'group': {
      return { type: 'ungroup', groupId: ch.groupId };
    }
    case 'ungroup': {
      const group = findLayer(doc, ch.groupId);
      if (!group) return null;
      const members = doc.layers.filter((l) => l.parentId === group.id);
      return {
        type: 'group',
        layerIds: members.map((m) => m.id),
        groupId: ch.groupId,
      };
    }
    case 'setKeyframe': {
      const layer = findLayer(doc, ch.layerId);
      if (!layer) return null;
      const existing = layer.keyframes.find(
        (k) => k.property === ch.property && k.frame === ch.frame,
      );
      if (!existing) {
        return { type: 'deleteKeyframe', layerId: ch.layerId, property: ch.property, frame: ch.frame };
      }
      return {
        type: 'setKeyframe',
        layerId: ch.layerId,
        property: ch.property,
        frame: ch.frame,
        value: existing.value,
        easing: existing.easing,
      };
    }
    case 'moveKeyframe': {
      return { type: 'moveKeyframe', layerId: ch.layerId, property: ch.property, fromFrame: ch.toFrame, toFrame: ch.fromFrame };
    }
    case 'deleteKeyframe': {
      const layer = findLayer(doc, ch.layerId);
      if (!layer) return null;
      const kf = layer.keyframes.find(
        (k) => k.property === ch.property && k.frame === ch.frame,
      );
      if (!kf) return null;
      return {
        type: 'setKeyframe',
        layerId: ch.layerId,
        property: ch.property,
        frame: ch.frame,
        value: kf.value,
        easing: kf.easing,
      };
    }
    case 'updateScene': {
      const prev = getPath(doc as unknown as Record<string, unknown>, ch.set);
      if (prev === undefined) return null;
      return { type: 'updateScene', set: ch.set, value: prev, breakpoint: ch.breakpoint };
    }
    case 'addVariable': {
      return { type: 'deleteVariable', name: ch.variable.name };
    }
    case 'updateVariable': {
      const v = bundle.variables.find((x) => x.name === ch.name);
      if (!v) return null;
      return { type: 'updateVariable', name: ch.name, value: structuredClone(v.value) };
    }
    case 'deleteVariable': {
      const v = bundle.variables.find((x) => x.name === ch.name);
      if (!v) return null;
      return { type: 'addVariable', variable: structuredClone(v) };
    }
    case 'bind': {
      return { type: 'unbind', layerId: ch.layerId, property: ch.property };
    }
    case 'unbind': {
      const layer = findLayer(doc, ch.layerId);
      if (!layer) return null;
      const varName = layer.bindings[ch.property];
      if (!varName) return null;
      return { type: 'bind', layerId: ch.layerId, property: ch.property, variable: varName };
    }
    case 'savePreset': {
      const existing = bundle.presets.find((p) => p.name === ch.name);
      if (!existing) return { type: 'deletePreset', name: ch.name };
      return {
        type: 'applyPreset',
        name: ch.name,
        values: structuredClone(existing.values),
      };
    }
    case 'applyPreset': {
      const values: Record<string, Variable['value']> = {};
      for (const name of Object.keys(ch.values)) {
        const v = bundle.variables.find((x) => x.name === name);
        if (v) values[name] = structuredClone(v.value);
      }
      return { type: 'applyPreset', name: ch.name, values };
    }
    case 'deletePreset': {
      const p = bundle.presets.find((x) => x.name === ch.name);
      if (!p) return null;
      return { type: 'savePreset', name: ch.name };
    }
  }
  return null;
}
