import { errors } from './http';
import { MSG, copy } from '../shared/messages';
import {
  layerPropDef,
  scenePropDef,
  is2D,
  is3D,
  vectorGroupAxes,
} from '../shared/properties';
import type { PropDef } from '../shared/properties';
import {
  createLayer,
  nextLayerName,
  readLayerPath,
  writeLayerPath,
  completeLayer,
} from '../shared/scene-doc';
import { parseEasing } from '../shared/easing';
import { textRefusal } from '../shared/extrusion';
import { storeNumber } from '../shared/format';
import { isColour, normaliseColour } from '../shared/format';
import type {
  Breakpoint,
  JsonObject,
  JsonValue,
  Layer,
  LayerKind,
  OverrideLevel,
  Scene,
  SceneDocument,
  Variable,
  VariableType,
} from '../shared/types';
import { LAYER_KINDS } from '../shared/types';
import { readPath, writePath } from '../shared/properties';

export interface AssetState {
  id: string;
  status: string;
  kind: string;
}

export type Change =
  | { type: 'addLayer'; layer: JsonObject; ref?: string }
  | { type: 'updateLayer'; layerId: string; set: Record<string, JsonValue>; breakpoint?: Breakpoint }
  | { type: 'clearOverride'; layerId: string; breakpoint: OverrideLevel; path: string }
  | { type: 'deleteLayer'; layerId: string }
  | { type: 'moveLayer'; layerId: string; parentId: string | null; order: number }
  | { type: 'duplicateLayer'; layerId: string; ref?: string }
  | { type: 'group'; layerIds: string[]; ref?: string }
  | { type: 'ungroup'; groupId: string }
  | {
      type: 'setKeyframe';
      layerId: string;
      property: string;
      frame: number;
      value: JsonValue;
      easing?: JsonValue;
    }
  | { type: 'moveKeyframe'; layerId: string; property: string; fromFrame: number; toFrame: number }
  | { type: 'deleteKeyframe'; layerId: string; property: string; frame: number }
  | { type: 'updateScene'; set: Record<string, JsonValue>; breakpoint?: Breakpoint }
  | { type: 'addVariable'; variable: { name: string; type: string; value: JsonValue } }
  | { type: 'updateVariable'; name: string; value: JsonValue }
  | { type: 'deleteVariable'; name: string }
  | { type: 'bind'; layerId: string; property: string; variable: string }
  | { type: 'unbind'; layerId: string; property: string }
  | { type: 'savePreset'; name: string }
  | { type: 'applyPreset'; name: string }
  | { type: 'deletePreset'; name: string }
  | { type: 'restoreLayers'; sceneId: string; layers: Layer[] }
  | { type: 'restoreScene'; sceneId: string; settings: JsonObject }
  | { type: 'restoreVariables'; variables: Variable[] }
  | { type: 'restorePresets'; presets: SceneDocument['presets'] };

export interface ApplyContext {
  sceneId: string;
  assets: AssetState[];
  newId: () => string;
}

export interface ApplyResult {
  inverse: Change[];
  ids: Record<string, string>;
  touchedLayerIds: string[];
  variableDeleteCounts: Record<string, number>;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function sceneOf(document: SceneDocument, sceneId: string): Scene {
  const scene = document.scenes.find((candidate) => candidate.id === sceneId);
  if (!scene) throw errors.validation({ sceneId: 'Choose a scene that exists.' });
  return scene;
}

function layerOf(scene: Scene, layerId: string): Layer {
  const layer = scene.layers.find((candidate) => candidate.id === layerId);
  if (!layer) throw errors.validation({ layerId: 'Choose a layer that exists.' });
  return layer;
}

function siblings(scene: Scene, parentId: string | null): Layer[] {
  return scene.layers.filter((layer) => layer.parentId === parentId).sort((a, b) => a.order - b.order);
}

function reindex(scene: Scene, parentId: string | null): void {
  siblings(scene, parentId).forEach((layer, index) => {
    layer.order = index;
  });
}

function validateValue(def: PropDef | undefined, value: JsonValue, fieldPath: string): JsonValue {
  if (!def) throw errors.validation({ [fieldPath]: 'This property cannot be set.' });
  if (def.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw errors.validation({ [fieldPath]: copy.mustBeBetween(def.min ?? 0, def.max ?? 0) });
    }
    if (def.min !== undefined && def.max !== undefined && (value < def.min || value > def.max)) {
      throw errors.validation({ [fieldPath]: copy.mustBeBetween(def.min, def.max) });
    }
    return storeNumber(value);
  }
  if (def.type === 'colour') {
    if (typeof value !== 'string' || !isColour(value)) {
      throw errors.validation({ [fieldPath]: MSG.colourFormat });
    }
    return normaliseColour(value);
  }
  if (def.type === 'boolean') {
    if (typeof value !== 'boolean') {
      throw errors.validation({ [fieldPath]: 'Use true or false.' });
    }
    return value;
  }
  if (def.type === 'choice') {
    if (typeof value !== 'string' || !(def.choices ?? []).includes(value)) {
      if (def.path.endsWith('easing')) throw errors.validation({ [fieldPath]: MSG.chooseEasing });
      throw errors.validation({ [fieldPath]: 'Choose one of the listed values.' });
    }
    return value;
  }
  if (def.type === 'text') {
    if (typeof value !== 'string') throw errors.validation({ [fieldPath]: MSG.enterName });
    if (def.maxLength !== undefined && value.length > def.maxLength) {
      throw errors.validation({ [fieldPath]: copy.mustBeBetween(0, def.maxLength) });
    }
    return value;
  }
  if (def.type === 'list' && def.path === 'gradient.stops') {
    if (!Array.isArray(value) || value.length < 2 || value.length > 8) {
      throw errors.validation({ [fieldPath]: MSG.gradientStops });
    }
    for (const stop of value) {
      const record = stop as Record<string, JsonValue>;
      if (typeof record.color !== 'string' || !isColour(record.color)) {
        throw errors.validation({ [fieldPath]: MSG.colourFormat });
      }
      if (typeof record.position !== 'number' || record.position < 0 || record.position > 100) {
        throw errors.validation({ [fieldPath]: copy.mustBeBetween(0, 100) });
      }
    }
    return value;
  }
  return value;
}

function validateLayerName(value: JsonValue, fieldPath: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw errors.validation({ [fieldPath]: MSG.enterName });
  }
  if (value.length > 60) throw errors.validation({ [fieldPath]: copy.mustBeBetween(1, 60) });
  return value;
}

function checkTextProperty(layer: Layer, path: string, value: JsonValue): void {
  if (layer.kind !== 'Extrusion' || path !== 'text') return;
  if (typeof value !== 'string') return;
  const refusal = textRefusal(value);
  if (refusal) throw errors.validation({ 'set.text': refusal });
}

function assetConfirmed(context: ApplyContext, assetId: JsonValue): void {
  if (typeof assetId !== 'string' || assetId === '') return;
  const asset = context.assets.find((candidate) => candidate.id === assetId);
  if (!asset || asset.status !== 'confirmed') {
    throw errors.validation({ 'layer.assetId': MSG.uploadNotReady });
  }
}

const ASSET_PATHS = ['assetId', 'svgAssetId', 'modelAssetId'];

export function touchedLayerIdsOf(changes: Change[]): string[] {
  const ids = new Set<string>();
  for (const change of changes) {
    if ('layerId' in change && typeof change.layerId === 'string') ids.add(change.layerId);
    if (change.type === 'group') change.layerIds.forEach((id) => ids.add(id));
    if (change.type === 'ungroup') ids.add(change.groupId);
  }
  return [...ids];
}

/** Applies a list of changes to the document, returning the inverse for undo. */
export function applyChanges(
  document: SceneDocument,
  changes: Change[],
  context: ApplyContext,
): ApplyResult {
  const inverse: Change[] = [];
  const ids: Record<string, string> = {};
  const variableDeleteCounts: Record<string, number> = {};
  const scene = sceneOf(document, context.sceneId);

  const snapshotLayers = (): Change => ({
    type: 'restoreLayers',
    sceneId: scene.id,
    layers: cloneJson(scene.layers),
  });

  for (const change of changes) {
    switch (change.type) {
      case 'addLayer': {
        const kind = change.layer.kind;
        if (typeof kind !== 'string' || !(LAYER_KINDS as readonly string[]).includes(kind)) {
          throw errors.validation({ 'layer.kind': 'Choose one of the listed values.' });
        }
        for (const path of ASSET_PATHS) {
          const value = readPath(change.layer.props as JsonObject ?? {}, path);
          if (value !== undefined) assetConfirmed(context, value);
        }
        const before = snapshotLayers();
        const layerKind = kind as LayerKind;
        const id = context.newId();
        const parentId =
          typeof change.layer.parentId === 'string' ? change.layer.parentId : null;
        const existing = siblings(scene, parentId);
        const order =
          typeof change.layer.order === 'number' ? change.layer.order : existing.length;
        const name =
          typeof change.layer.name === 'string' && change.layer.name.length > 0
            ? validateLayerName(change.layer.name, 'layer.name')
            : nextLayerName(scene, layerKind === 'Primitive'
                ? String(readPath(change.layer.props as JsonObject ?? {}, 'primitive') ?? 'Cube')
                : layerKind);
        const layer = createLayer({ id, kind: layerKind, name, parentId, order });
        if (change.layer.props && typeof change.layer.props === 'object') {
          mergeProps(layer, change.layer.props as JsonObject);
        }
        if (typeof change.layer.visible === 'boolean') layer.visible = change.layer.visible;
        if (typeof change.layer.locked === 'boolean') layer.locked = change.layer.locked;
        if (typeof change.layer.maskAbove === 'boolean') layer.maskAbove = change.layer.maskAbove;
        if (typeof change.layer.blendMode === 'string') layer.blendMode = change.layer.blendMode;
        if (change.layer.events && typeof change.layer.events === 'object') {
          mergeEvents(layer, change.layer.events as JsonObject);
        }
        if (Array.isArray(change.layer.keyframes)) {
          layer.keyframes = cloneJson(change.layer.keyframes) as unknown as Layer['keyframes'];
        }
        if (change.layer.overrides && typeof change.layer.overrides === 'object') {
          layer.overrides = cloneJson(change.layer.overrides) as Layer['overrides'];
        }
        if (change.layer.bindings && typeof change.layer.bindings === 'object') {
          layer.bindings = cloneJson(change.layer.bindings) as Record<string, string>;
        }
        for (const sibling of siblings(scene, parentId)) {
          if (sibling.order >= order) sibling.order += 1;
        }
        scene.layers.push(layer);
        reindex(scene, parentId);
        if (change.ref) ids[change.ref] = id;
        inverse.push(before);
        break;
      }
      case 'updateLayer': {
        const layer = layerOf(scene, change.layerId);
        const breakpoint = change.breakpoint ?? 'desktop';
        const previous: Record<string, JsonValue> = {};
        const clears: Change[] = [];
        for (const [path, raw] of Object.entries(change.set)) {
          if (path === 'name') {
            if (breakpoint !== 'desktop') {
              throw errors.validation({ [`set.${path}`]: copy.notOverridable('Name') });
            }
            previous.name = layer.name;
            layer.name = validateLayerName(raw, 'set.name');
            continue;
          }
          const def = layerPropDef(layer.kind, path);
          if (!def) throw errors.validation({ [`set.${path}`]: 'This property cannot be set.' });
          if (breakpoint !== 'desktop' && !def.overridable) {
            throw errors.validation({ [`set.${path}`]: copy.notOverridable(def.field) });
          }
          const value = validateValue(def, raw, `set.${path}`);
          checkTextProperty(layer, path, value);
          if (breakpoint === 'desktop') {
            const before = readLayerPath(layer, path);
            previous[path] = before === undefined ? null : cloneJson(before);
            writeLayerPath(layer, path, value);
            if (path === 'material.kind') resetMaterialDefaults(layer, value);
          } else {
            const level = breakpoint as OverrideLevel;
            if (Object.prototype.hasOwnProperty.call(layer.overrides[level], path)) {
              previous[path] = cloneJson(layer.overrides[level][path]);
            } else {
              clears.push({ type: 'clearOverride', layerId: layer.id, breakpoint: level, path });
            }
            layer.overrides[level][path] = value;
          }
        }
        if (Object.keys(previous).length > 0) {
          inverse.push({
            type: 'updateLayer',
            layerId: layer.id,
            set: previous,
            breakpoint,
          });
        }
        inverse.push(...clears);
        break;
      }
      case 'clearOverride': {
        const layer = layerOf(scene, change.layerId);
        const level = change.breakpoint;
        if (level !== 'tablet' && level !== 'mobile') {
          throw errors.validation({ breakpoint: 'Choose one of the listed values.' });
        }
        if (Object.prototype.hasOwnProperty.call(layer.overrides[level], change.path)) {
          inverse.push({
            type: 'updateLayer',
            layerId: layer.id,
            set: { [change.path]: cloneJson(layer.overrides[level][change.path]) },
            breakpoint: level,
          });
          delete layer.overrides[level][change.path];
        }
        break;
      }
      case 'deleteLayer': {
        const layer = layerOf(scene, change.layerId);
        const before = snapshotLayers();
        const removeIds = new Set<string>([layer.id]);
        let changed = true;
        while (changed) {
          changed = false;
          for (const candidate of scene.layers) {
            if (candidate.parentId && removeIds.has(candidate.parentId) && !removeIds.has(candidate.id)) {
              removeIds.add(candidate.id);
              changed = true;
            }
          }
        }
        scene.layers = scene.layers.filter((candidate) => !removeIds.has(candidate.id));
        reindex(scene, layer.parentId);
        inverse.push(before);
        break;
      }
      case 'moveLayer': {
        const layer = layerOf(scene, change.layerId);
        const before = snapshotLayers();
        const targetParent = change.parentId;
        if (targetParent !== null) {
          const parent = scene.layers.find((candidate) => candidate.id === targetParent);
          if (!parent || parent.kind !== 'Group') {
            throw errors.validation({ parentId: 'Choose a group that exists.' });
          }
        }
        const oldParent = layer.parentId;
        layer.parentId = targetParent;
        const others = siblings(scene, targetParent).filter((candidate) => candidate.id !== layer.id);
        const clamped = Math.max(0, Math.min(Math.round(change.order), others.length));
        others.splice(clamped, 0, layer);
        others.forEach((candidate, index) => {
          candidate.order = index;
        });
        if (oldParent !== targetParent) reindex(scene, oldParent);
        inverse.push(before);
        break;
      }
      case 'duplicateLayer': {
        const layer = layerOf(scene, change.layerId);
        const before = snapshotLayers();
        const copyIds = new Map<string, string>();
        const copySubtree = (source: Layer, parentId: string | null, order: number): Layer => {
          const id = context.newId();
          copyIds.set(source.id, id);
          const copy = cloneJson(source);
          copy.id = id;
          copy.parentId = parentId;
          copy.order = order;
          copy.name = duplicateName(scene, source.name);
          scene.layers.push(copy);
          const children = siblings(scene, source.id);
          children.forEach((child, index) => copySubtree(child, id, index));
          return copy;
        };
        for (const sibling of siblings(scene, layer.parentId)) {
          if (sibling.order > layer.order) sibling.order += 1;
        }
        const copy = copySubtree(layer, layer.parentId, layer.order + 1);
        reindex(scene, layer.parentId);
        if (change.ref) ids[change.ref] = copy.id;
        inverse.push(before);
        break;
      }
      case 'group': {
        if (change.layerIds.length === 0) {
          throw errors.validation({ layerIds: 'Choose at least one layer.' });
        }
        const members = change.layerIds.map((id) => layerOf(scene, id));
        const parentId = members[0].parentId;
        if (members.some((member) => member.parentId !== parentId)) {
          throw errors.validation({ layerIds: 'Group layers that share a parent.' });
        }
        const before = snapshotLayers();
        const topmost = members.reduce((best, member) => (member.order > best.order ? member : best));
        const groupOrder = topmost.order;
        const groupId = context.newId();
        const group = createLayer({
          id: groupId,
          kind: 'Group',
          name: nextLayerName(scene, 'Group'),
          parentId,
          order: groupOrder,
        });
        scene.layers.push(group);
        const sorted = [...members].sort((a, b) => a.order - b.order);
        sorted.forEach((member, index) => {
          member.parentId = groupId;
          member.order = index;
        });
        const remaining = siblings(scene, parentId).filter(
          (candidate) => candidate.id !== groupId,
        );
        const ordered = [...remaining];
        const insertAt = Math.min(groupOrder, ordered.length);
        ordered.splice(insertAt, 0, group);
        ordered.forEach((candidate, index) => {
          candidate.order = index;
        });
        if (change.ref) ids[change.ref] = groupId;
        inverse.push(before);
        break;
      }
      case 'ungroup': {
        const group = layerOf(scene, change.groupId);
        if (group.kind !== 'Group') {
          throw errors.validation({ groupId: 'Choose a group that exists.' });
        }
        const before = snapshotLayers();
        const children = siblings(scene, group.id);
        const parentId = group.parentId;
        const outer = siblings(scene, parentId).filter((candidate) => candidate.id !== group.id);
        const insertAt = Math.min(group.order, outer.length);
        const ordered = [...outer];
        children.forEach((child, index) => {
          child.parentId = parentId;
          ordered.splice(insertAt + index, 0, child);
        });
        scene.layers = scene.layers.filter((candidate) => candidate.id !== group.id);
        ordered.forEach((candidate, index) => {
          candidate.order = index;
        });
        inverse.push(before);
        break;
      }
      case 'setKeyframe': {
        const layer = layerOf(scene, change.layerId);
        const def = layerPropDef(layer.kind, change.property);
        if (!def) throw errors.validation({ property: 'This property cannot be set.' });
        if (!Number.isInteger(change.frame) || change.frame < 0) {
          throw errors.validation({ frame: copy.mustBeBetween(0, 3600) });
        }
        const easing = parseEasing(change.easing ?? 'linear');
        if (easing === null) throw errors.validation({ easing: MSG.chooseEasing });
        const value = validateValue(def, change.value, 'value');
        const existing = layer.keyframes.find(
          (keyframe) => keyframe.property === change.property && keyframe.frame === change.frame,
        );
        if (existing) {
          inverse.push({
            type: 'setKeyframe',
            layerId: layer.id,
            property: change.property,
            frame: change.frame,
            value: cloneJson(existing.value),
            easing: cloneJson(existing.easing),
          });
          existing.value = value;
          existing.easing = easing;
        } else {
          inverse.push({
            type: 'deleteKeyframe',
            layerId: layer.id,
            property: change.property,
            frame: change.frame,
          });
          layer.keyframes.push({
            property: change.property,
            frame: change.frame,
            value,
            easing,
          });
        }
        break;
      }
      case 'moveKeyframe': {
        const layer = layerOf(scene, change.layerId);
        const keyframe = layer.keyframes.find(
          (candidate) =>
            candidate.property === change.property && candidate.frame === change.fromFrame,
        );
        if (!keyframe) throw errors.validation({ fromFrame: 'Choose a keyframe that exists.' });
        if (!Number.isInteger(change.toFrame) || change.toFrame < 0) {
          throw errors.validation({ toFrame: copy.mustBeBetween(0, 3600) });
        }
        const clash = layer.keyframes.find(
          (candidate) =>
            candidate.property === change.property && candidate.frame === change.toFrame,
        );
        if (clash && clash !== keyframe) {
          layer.keyframes = layer.keyframes.filter((candidate) => candidate !== clash);
        }
        keyframe.frame = change.toFrame;
        inverse.push({
          type: 'moveKeyframe',
          layerId: layer.id,
          property: change.property,
          fromFrame: change.toFrame,
          toFrame: change.fromFrame,
        });
        break;
      }
      case 'deleteKeyframe': {
        const layer = layerOf(scene, change.layerId);
        const keyframe = layer.keyframes.find(
          (candidate) => candidate.property === change.property && candidate.frame === change.frame,
        );
        if (!keyframe) throw errors.validation({ frame: 'Choose a keyframe that exists.' });
        inverse.push({
          type: 'setKeyframe',
          layerId: layer.id,
          property: change.property,
          frame: change.frame,
          value: cloneJson(keyframe.value),
          easing: cloneJson(keyframe.easing),
        });
        layer.keyframes = layer.keyframes.filter((candidate) => candidate !== keyframe);
        break;
      }
      case 'updateScene': {
        const breakpoint = change.breakpoint ?? 'desktop';
        const previous: Record<string, JsonValue> = {};
        for (const [path, raw] of Object.entries(change.set)) {
          const def = scenePropDef(path);
          if (!def) throw errors.validation({ [`set.${path}`]: 'This property cannot be set.' });
          const value = validateValue(def, raw, `set.${path}`);
          const container = scene as unknown as JsonObject;
          const before = readPath(container, path);
          previous[path] = before === undefined ? null : cloneJson(before);
          writePath(container, path, value);
        }
        if (Object.keys(previous).length > 0) {
          inverse.push({ type: 'updateScene', set: previous, breakpoint });
        }
        break;
      }
      case 'addVariable': {
        const name = change.variable?.name;
        if (typeof name !== 'string' || !/^[a-z][a-z0-9_]{0,31}$/.test(name)) {
          throw errors.validation({ 'variable.name': MSG.variableName });
        }
        if (document.variables.some((variable) => variable.name === name)) {
          throw errors.validation({ 'variable.name': copy.variableExists(name) });
        }
        const type = change.variable.type as VariableType;
        const allowed: VariableType[] = ['Number', 'Boolean', 'Text', 'Colour', 'Vector 2', 'Vector 3'];
        if (!allowed.includes(type)) {
          throw errors.validation({ 'variable.type': 'Choose one of the listed values.' });
        }
        const value = validateVariableValue(type, change.variable.value);
        document.variables.push({ name, type, value });
        inverse.push({ type: 'deleteVariable', name });
        break;
      }
      case 'updateVariable': {
        const variable = document.variables.find((candidate) => candidate.name === change.name);
        if (!variable) throw errors.validation({ name: 'Choose a variable that exists.' });
        inverse.push({
          type: 'updateVariable',
          name: variable.name,
          value: cloneJson(variable.value),
        });
        variable.value = validateVariableValue(variable.type, change.value);
        break;
      }
      case 'deleteVariable': {
        const variable = document.variables.find((candidate) => candidate.name === change.name);
        if (!variable) throw errors.validation({ name: 'Choose a variable that exists.' });
        const before = snapshotLayers();
        let count = 0;
        for (const candidate of scene.layers) {
          for (const [path, bound] of Object.entries(candidate.bindings)) {
            if (bound !== variable.name) continue;
            const axes = vectorGroupAxes(path, candidate.kind) ?? [path];
            for (const axis of axes) {
              const def = layerPropDef(candidate.kind, axis);
              writeLayerPath(candidate, axis, variableBoundValue(variable, axis, def));
            }
            delete candidate.bindings[path];
            count += 1;
          }
        }
        variableDeleteCounts[variable.name] = count;
        document.variables = document.variables.filter(
          (candidate) => candidate.name !== variable.name,
        );
        inverse.push(before, {
          type: 'addVariable',
          variable: { name: variable.name, type: variable.type, value: cloneJson(variable.value) },
        });
        break;
      }
      case 'bind': {
        const layer = layerOf(scene, change.layerId);
        const variable = document.variables.find((candidate) => candidate.name === change.variable);
        if (!variable) throw errors.validation({ variable: 'Choose a variable that exists.' });
        const axes = vectorGroupAxes(change.property, layer.kind);
        const def = axes ? undefined : layerPropDef(layer.kind, change.property);
        if (!axes && !def) throw errors.validation({ property: 'This property cannot be set.' });
        if (!bindingCompatible(variable.type, layer.kind, change.property, def)) {
          throw errors.validation({ variable: 'Choose a variable of a compatible type.' });
        }
        inverse.push({ type: 'unbind', layerId: layer.id, property: change.property });
        layer.bindings[change.property] = variable.name;
        break;
      }
      case 'unbind': {
        const layer = layerOf(scene, change.layerId);
        const bound = layer.bindings[change.property];
        if (!bound) throw errors.validation({ property: 'This property is not bound.' });
        inverse.push({
          type: 'bind',
          layerId: layer.id,
          property: change.property,
          variable: bound,
        });
        delete layer.bindings[change.property];
        break;
      }
      case 'savePreset': {
        if (typeof change.name !== 'string' || change.name.trim().length === 0) {
          throw errors.validation({ name: MSG.enterName });
        }
        const before = cloneJson(document.presets);
        const values: Record<string, JsonValue> = {};
        for (const variable of document.variables) values[variable.name] = cloneJson(variable.value);
        const existing = document.presets.find((preset) => preset.name === change.name);
        if (existing) existing.values = values;
        else document.presets.push({ name: change.name, values });
        inverse.push({ type: 'restorePresets', presets: before });
        break;
      }
      case 'applyPreset': {
        const preset = document.presets.find((candidate) => candidate.name === change.name);
        if (!preset) throw errors.validation({ name: 'Choose a preset that exists.' });
        inverse.push({ type: 'restoreVariables', variables: cloneJson(document.variables) });
        for (const [name, value] of Object.entries(preset.values)) {
          const variable = document.variables.find((candidate) => candidate.name === name);
          if (variable) variable.value = cloneJson(value);
        }
        break;
      }
      case 'deletePreset': {
        const preset = document.presets.find((candidate) => candidate.name === change.name);
        if (!preset) throw errors.validation({ name: 'Choose a preset that exists.' });
        inverse.push({ type: 'restorePresets', presets: cloneJson(document.presets) });
        document.presets = document.presets.filter((candidate) => candidate.name !== change.name);
        break;
      }
      case 'restoreLayers': {
        const target = sceneOf(document, change.sceneId);
        inverse.push({
          type: 'restoreLayers',
          sceneId: change.sceneId,
          layers: cloneJson(target.layers),
        });
        target.layers = cloneJson(change.layers).map((layer) => completeLayer(layer));
        break;
      }
      case 'restoreScene': {
        const target = sceneOf(document, change.sceneId);
        const container = target as unknown as JsonObject;
        const before: JsonObject = {};
        for (const key of Object.keys(change.settings)) {
          before[key] = cloneJson(container[key] as JsonValue);
          container[key] = cloneJson(change.settings[key]);
        }
        inverse.push({ type: 'restoreScene', sceneId: change.sceneId, settings: before });
        break;
      }
      case 'restoreVariables': {
        inverse.push({ type: 'restoreVariables', variables: cloneJson(document.variables) });
        document.variables = cloneJson(change.variables);
        break;
      }
      case 'restorePresets': {
        inverse.push({ type: 'restorePresets', presets: cloneJson(document.presets) });
        document.presets = cloneJson(change.presets);
        break;
      }
      default: {
        throw errors.validation({ changes: 'Choose one of the listed change types.' });
      }
    }
  }

  inverse.reverse();
  return { inverse, ids, touchedLayerIds: touchedLayerIdsOf(changes), variableDeleteCounts };
}

function duplicateName(scene: Scene, name: string): string {
  const base = name.replace(/ \d+$/, '');
  return nextLayerName(scene, base);
}

function mergeProps(layer: Layer, props: JsonObject): void {
  const walk = (value: JsonValue, prefix: string): void => {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      for (const [key, child] of Object.entries(value)) {
        walk(child, prefix ? `${prefix}.${key}` : key);
      }
      return;
    }
    const def = layerPropDef(layer.kind, prefix);
    if (!def) return;
    writeLayerPath(layer, prefix, value);
  };
  for (const [key, value] of Object.entries(props)) {
    const def = layerPropDef(layer.kind, key);
    if (def && (def.type === 'list' || def.type === 'asset')) {
      writeLayerPath(layer, key, value);
      continue;
    }
    walk(value, key);
  }
}

function mergeEvents(layer: Layer, events: JsonObject): void {
  const target = layer.events as unknown as JsonObject;
  for (const [group, value] of Object.entries(events)) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) continue;
    const existing = (target[group] ?? {}) as JsonObject;
    target[group] = { ...existing, ...(value as JsonObject) };
  }
}

function resetMaterialDefaults(layer: Layer, kind: JsonValue): void {
  if (kind === 'Glass') {
    writeLayerPath(layer, 'material.color', '#B7A4FF');
    writeLayerPath(layer, 'material.opacity', 0.35);
    return;
  }
  writeLayerPath(layer, 'material.color', '#FFFFFF');
  writeLayerPath(layer, 'material.opacity', 1);
}

export function validateVariableValue(type: VariableType, value: JsonValue): JsonValue {
  if (type === 'Number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw errors.validation({ 'variable.value': copy.mustBeBetween(-1000000, 1000000) });
    }
    if (value < -1000000 || value > 1000000) {
      throw errors.validation({ 'variable.value': copy.mustBeBetween(-1000000, 1000000) });
    }
    return storeNumber(value);
  }
  if (type === 'Boolean') {
    if (typeof value !== 'boolean') {
      throw errors.validation({ 'variable.value': 'Use true or false.' });
    }
    return value;
  }
  if (type === 'Text') {
    if (typeof value !== 'string' || value.length > 200) {
      throw errors.validation({ 'variable.value': copy.mustBeBetween(0, 200) });
    }
    return value;
  }
  if (type === 'Colour') {
    if (typeof value !== 'string' || !isColour(value)) {
      throw errors.validation({ 'variable.value': MSG.colourFormat });
    }
    return normaliseColour(value);
  }
  const axes = type === 'Vector 2' ? ['x', 'y'] : ['x', 'y', 'z'];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw errors.validation({ 'variable.value': copy.mustBeBetween(-1000000, 1000000) });
  }
  const record = value as Record<string, JsonValue>;
  const out: Record<string, JsonValue> = {};
  for (const axis of axes) {
    const component = record[axis];
    if (typeof component !== 'number' || !Number.isFinite(component)) {
      throw errors.validation({ 'variable.value': copy.mustBeBetween(-1000000, 1000000) });
    }
    out[axis] = storeNumber(component);
  }
  return out;
}

function variableBoundValue(
  variable: Variable,
  path: string,
  def: PropDef | undefined,
): JsonValue {
  if (variable.type === 'Vector 2' || variable.type === 'Vector 3') {
    const axis = path.split('.').pop() ?? 'x';
    const record = variable.value as Record<string, JsonValue>;
    const component = record?.[axis];
    const value = typeof component === 'number' ? component : 0;
    return clampTo(def, value);
  }
  if (variable.type === 'Number' && typeof variable.value === 'number') {
    return clampTo(def, variable.value);
  }
  return cloneJson(variable.value);
}

function clampTo(def: PropDef | undefined, value: number): number {
  if (!def || def.min === undefined || def.max === undefined) return value;
  return Math.max(def.min, Math.min(def.max, value));
}

function bindingCompatible(
  type: VariableType,
  kind: LayerKind,
  path: string,
  def: PropDef | undefined,
): boolean {
  if (type === 'Number') return def?.type === 'number';
  if (type === 'Boolean') return path === 'visible' || path === 'enabled';
  if (type === 'Text') return path === 'text';
  if (type === 'Colour') return def?.type === 'colour';
  if (type === 'Vector 2') return is2D(kind) && path === 'position';
  return is3D(kind) && ['position', 'rotation', 'scale'].includes(path);
}
