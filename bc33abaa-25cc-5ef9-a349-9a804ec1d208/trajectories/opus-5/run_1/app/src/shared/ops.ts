import {
  CameraView,
  Graph,
  Layer,
  OverrideField,
  Primitive,
  REST_STATE_ID,
  SceneNode,
  Transition,
  Vec3,
  findNode,
  findState,
} from './graph';

export const OP_TYPES = [
  'node.add',
  'node.remove',
  'node.rename',
  'node.reparent',
  'transform.set',
  'material.layer.add',
  'material.layer.set',
  'material.layer.remove',
  'state.add',
  'state.remove',
  'state.override.set',
  'transition.set',
  'camera.view.set',
] as const;

export type OpType = (typeof OP_TYPES)[number];

export interface RawOp {
  type: string;
  payload: Record<string, unknown>;
}

export class OpError extends Error {
  readonly errors: Record<string, string>;
  constructor(errors: Record<string, string>) {
    super('operation validation failed');
    this.errors = errors;
  }
}

export interface OpContext {
  /** IDs of model assets in the caller's workspace. */
  modelAssetIds: ReadonlySet<string>;
}

const ID_PATTERN = /^[a-z0-9_-]{1,40}$/;
const NODE_KINDS = ['group', 'mesh', 'camera', 'light'] as const;
const PRIMITIVES = ['box', 'sphere', 'cylinder', 'plane'] as const;
const LAYER_TYPES = ['base', 'clearcoat', 'sheen', 'emission'] as const;
const OVERRIDE_FIELDS = ['position', 'rotation', 'scale', 'visible'] as const;
const TRIGGERS = ['hover', 'click', 'scroll'] as const;

export const FIELD_RANGES: Record<'position' | 'rotation' | 'scale', { min: number; max: number }> = {
  position: { min: -1000, max: 1000 },
  rotation: { min: -360, max: 360 },
  scale: { min: 0.001, max: 1000 },
};

class Reader {
  constructor(
    private readonly value: Record<string, unknown>,
    private readonly base: string,
  ) {}

  private failure(path: string, message: string): OpError {
    return new OpError({ [path]: message });
  }

  has(key: string): boolean {
    return this.value[key] !== undefined;
  }

  raw(key: string): unknown {
    return this.value[key];
  }

  path(key: string): string {
    return `${this.base}.${key}`;
  }

  id(key: string): string {
    const value = this.value[key];
    if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
      throw this.failure(this.path(key), 'Must be 1 to 40 characters of a-z, 0-9, _ or -');
    }
    return value;
  }

  name(key: string): string {
    const value = this.value[key];
    if (typeof value !== 'string' || value.length < 1 || value.length > 80) {
      throw this.failure(this.path(key), 'Must be 1 to 80 characters');
    }
    return value;
  }

  enumValue<T extends string>(key: string, allowed: readonly T[]): T {
    const value = this.value[key];
    if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
      throw this.failure(this.path(key), `Must be one of ${allowed.join(', ')}`);
    }
    return value as T;
  }

  boolean(key: string): boolean {
    const value = this.value[key];
    if (typeof value !== 'boolean') throw this.failure(this.path(key), 'Must be true or false');
    return value;
  }

  number(key: string, min: number, max: number): number {
    const value = this.value[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw this.failure(this.path(key), 'Must be a number');
    }
    if (value < min || value > max) {
      throw this.failure(this.path(key), `Must be between ${min} and ${max}`);
    }
    return value;
  }

  vec3(key: string, min: number, max: number): Vec3 {
    const value = this.value[key];
    if (!Array.isArray(value) || value.length !== 3) {
      throw this.failure(this.path(key), 'Must be an array of three numbers');
    }
    const out: number[] = [];
    for (const entry of value) {
      if (typeof entry !== 'number' || !Number.isFinite(entry)) {
        throw this.failure(this.path(key), 'Must be an array of three numbers');
      }
      if (entry < min || entry > max) {
        throw this.failure(this.path(key), `Each component must be between ${min} and ${max}`);
      }
      out.push(entry);
    }
    return [out[0] as number, out[1] as number, out[2] as number];
  }

  object(key: string): Reader {
    const value = this.value[key];
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw this.failure(this.path(key), 'Must be an object');
    }
    return new Reader(value as Record<string, unknown>, this.path(key));
  }

  array(key: string): unknown[] {
    const value = this.value[key];
    if (!Array.isArray(value)) throw this.failure(this.path(key), 'Must be an array');
    return value;
  }

  error(key: string, message: string): OpError {
    return this.failure(this.path(key), message);
  }
}

function readLayer(reader: Reader): Layer {
  return {
    id: reader.id('id'),
    type: reader.enumValue('type', LAYER_TYPES),
    color: reader.vec3('color', 0, 1),
    roughness: reader.number('roughness', 0, 1),
    metalness: reader.number('metalness', 0, 1),
  };
}

function readOverrideValue(reader: Reader, field: OverrideField, key: string): Vec3 | boolean {
  if (field === 'visible') return reader.boolean(key);
  const range = FIELD_RANGES[field];
  return reader.vec3(key, range.min, range.max);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function readNode(reader: Reader): SceneNode {
  const kind = reader.enumValue('kind', NODE_KINDS);
  const primitiveRaw = reader.raw('primitive');
  let primitive: Primitive | null = null;
  if (primitiveRaw !== null && primitiveRaw !== undefined) {
    primitive = reader.enumValue('primitive', PRIMITIVES);
  }
  const assetRaw = reader.raw('assetId');
  let assetId: string | null = null;
  if (assetRaw !== null && assetRaw !== undefined) {
    assetId = reader.id('assetId');
  }
  const parentRaw = reader.raw('parentId');
  let parentId: string | null = null;
  if (parentRaw !== null && parentRaw !== undefined) {
    parentId = reader.id('parentId');
  }
  const layers: Layer[] = [];
  if (reader.has('materialLayers')) {
    const entries = reader.array('materialLayers');
    entries.forEach((entry, index) => {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        throw reader.error('materialLayers', 'Must be an array of material layers');
      }
      layers.push(readLayer(new Reader(entry as Record<string, unknown>, `${reader.path('materialLayers')}[${index}]`)));
    });
  }
  return {
    id: reader.id('id'),
    name: reader.name('name'),
    kind,
    parentId,
    primitive,
    assetId,
    position: reader.has('position') ? reader.vec3('position', -1000, 1000) : [0, 0, 0],
    rotation: reader.has('rotation') ? reader.vec3('rotation', -360, 360) : [0, 0, 0],
    scale: reader.has('scale') ? reader.vec3('scale', 0.001, 1000) : [1, 1, 1],
    materialLayers: layers,
    visible: reader.has('visible') ? reader.boolean('visible') : true,
  };
}

export interface NewNodeOverride {
  stateId: string;
  field: OverrideField;
  value: Vec3 | boolean;
}

/**
 * Applies one operation to the graph in place and returns the operation that
 * exactly undoes it. Throws OpError with the field path on invalid input.
 */
export function applyOp(graph: Graph, op: RawOp, path: string, ctx: OpContext): RawOp {
  const payload = new Reader(op.payload, `${path}.payload`);
  switch (op.type as OpType) {
    case 'node.add': {
      const node = readNode(payload.object('node'));
      if (findNode(graph, node.id)) throw payload.error('node', 'A node with this ID already exists');
      if (node.parentId === null) throw payload.error('node', 'The new node needs a parent');
      if (!findNode(graph, node.parentId)) throw payload.error('node', 'Parent node does not exist');
      if (node.assetId !== null && !ctx.modelAssetIds.has(node.assetId)) {
        throw payload.error('node', 'assetId does not name a model asset');
      }
      const overrides: NewNodeOverride[] = [];
      if (payload.has('overrides')) {
        const entries = payload.array('overrides');
        entries.forEach((entry, index) => {
          if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
            throw payload.error('overrides', 'Must be an array of overrides');
          }
          const reader = new Reader(
            entry as Record<string, unknown>,
            `${payload.path('overrides')}[${index}]`,
          );
          const stateId = reader.id('stateId');
          const state = findState(graph, stateId);
          if (!state || stateId === REST_STATE_ID) throw reader.error('stateId', 'State does not exist');
          const field = reader.enumValue('field', OVERRIDE_FIELDS);
          overrides.push({ stateId, field, value: readOverrideValue(reader, field, 'value') });
        });
      }
      graph.nodes.push(node);
      for (const override of overrides) {
        const state = findState(graph, override.stateId);
        if (state) {
          state.overrides.push({ nodeId: node.id, field: override.field, value: override.value });
        }
      }
      return { type: 'node.remove', payload: { id: node.id } };
    }
    case 'node.remove': {
      const id = payload.id('id');
      const node = findNode(graph, id);
      if (!node) throw payload.error('id', 'Node does not exist');
      if (node.parentId === null) throw payload.error('id', 'The root node cannot be removed');
      if (graph.nodes.some((candidate) => candidate.parentId === id)) {
        throw payload.error('id', 'Node still has children');
      }
      const overrides: NewNodeOverride[] = [];
      for (const state of graph.states) {
        for (const override of state.overrides) {
          if (override.nodeId === id) {
            overrides.push({ stateId: state.id, field: override.field, value: clone(override.value) });
          }
        }
        state.overrides = state.overrides.filter((override) => override.nodeId !== id);
      }
      graph.nodes = graph.nodes.filter((candidate) => candidate.id !== id);
      return { type: 'node.add', payload: { node: clone(node), overrides } };
    }
    case 'node.rename': {
      const id = payload.id('id');
      const name = payload.name('name');
      const node = findNode(graph, id);
      if (!node) throw payload.error('id', 'Node does not exist');
      const previous = node.name;
      node.name = name;
      return { type: 'node.rename', payload: { id, name: previous } };
    }
    case 'node.reparent': {
      const id = payload.id('id');
      const parentId = payload.id('parentId');
      const node = findNode(graph, id);
      if (!node) throw payload.error('id', 'Node does not exist');
      if (node.parentId === null) throw payload.error('id', 'The root node cannot be reparented');
      const parent = findNode(graph, parentId);
      if (!parent) throw payload.error('parentId', 'Parent node does not exist');
      let walker: SceneNode | undefined = parent;
      while (walker) {
        if (walker.id === id) throw payload.error('parentId', 'That would create a cycle');
        walker = walker.parentId === null ? undefined : findNode(graph, walker.parentId);
      }
      const previous = node.parentId;
      node.parentId = parentId;
      return { type: 'node.reparent', payload: { id, parentId: previous } };
    }
    case 'transform.set': {
      const id = payload.id('id');
      const node = findNode(graph, id);
      if (!node) throw payload.error('id', 'Node does not exist');
      const fields: ('position' | 'rotation' | 'scale')[] = [];
      for (const field of ['position', 'rotation', 'scale'] as const) {
        if (payload.has(field)) fields.push(field);
      }
      if (fields.length === 0) throw payload.error('position', 'At least one of position, rotation or scale is required');
      const inverse: Record<string, unknown> = { id };
      for (const field of fields) {
        const range = FIELD_RANGES[field];
        const next = payload.vec3(field, range.min, range.max);
        inverse[field] = clone(node[field]);
        node[field] = next;
      }
      return { type: 'transform.set', payload: inverse };
    }
    case 'material.layer.add': {
      const id = payload.id('id');
      const node = findNode(graph, id);
      if (!node) throw payload.error('id', 'Node does not exist');
      const layer = readLayer(payload.object('layer'));
      if (node.materialLayers.length >= 8) throw payload.error('layer', 'A node may hold at most 8 material layers');
      if (node.materialLayers.some((existing) => existing.id === layer.id)) {
        throw payload.error('layer', 'A layer with this ID already exists on the node');
      }
      let index = node.materialLayers.length;
      if (payload.has('index')) index = payload.number('index', 0, node.materialLayers.length);
      node.materialLayers.splice(index, 0, layer);
      return { type: 'material.layer.remove', payload: { id, layerId: layer.id } };
    }
    case 'material.layer.set': {
      const id = payload.id('id');
      const node = findNode(graph, id);
      if (!node) throw payload.error('id', 'Node does not exist');
      const layerId = payload.id('layerId');
      const layer = node.materialLayers.find((candidate) => candidate.id === layerId);
      if (!layer) throw payload.error('layerId', 'Layer does not exist');
      const inverse: Record<string, unknown> = { id, layerId };
      let touched = false;
      if (payload.has('color')) {
        inverse.color = clone(layer.color);
        layer.color = payload.vec3('color', 0, 1);
        touched = true;
      }
      if (payload.has('roughness')) {
        inverse.roughness = layer.roughness;
        layer.roughness = payload.number('roughness', 0, 1);
        touched = true;
      }
      if (payload.has('metalness')) {
        inverse.metalness = layer.metalness;
        layer.metalness = payload.number('metalness', 0, 1);
        touched = true;
      }
      if (!touched) throw payload.error('color', 'At least one of color, roughness or metalness is required');
      return { type: 'material.layer.set', payload: inverse };
    }
    case 'material.layer.remove': {
      const id = payload.id('id');
      const node = findNode(graph, id);
      if (!node) throw payload.error('id', 'Node does not exist');
      const layerId = payload.id('layerId');
      const index = node.materialLayers.findIndex((candidate) => candidate.id === layerId);
      if (index < 0) throw payload.error('layerId', 'Layer does not exist');
      const [removed] = node.materialLayers.splice(index, 1);
      return { type: 'material.layer.add', payload: { id, layer: clone(removed as Layer), index } };
    }
    case 'state.add': {
      const state = payload.object('state');
      const id = state.id('id');
      const name = state.name('name');
      if (id === REST_STATE_ID) throw state.error('id', 'The rest state always exists');
      if (findState(graph, id)) throw state.error('id', 'A state with this ID already exists');
      graph.states.push({ id, name, overrides: [] });
      return { type: 'state.remove', payload: { id } };
    }
    case 'state.remove': {
      const id = payload.id('id');
      if (id === REST_STATE_ID) throw payload.error('id', 'The rest state cannot be removed');
      const state = findState(graph, id);
      if (!state) throw payload.error('id', 'State does not exist');
      if (state.overrides.length > 0) throw payload.error('id', 'State still holds overrides');
      if (graph.transitions.some((transition) => transition.from === id || transition.to === id)) {
        throw payload.error('id', 'A transition still names this state');
      }
      graph.states = graph.states.filter((candidate) => candidate.id !== id);
      return { type: 'state.add', payload: { state: { id: state.id, name: state.name } } };
    }
    case 'state.override.set': {
      const stateId = payload.id('stateId');
      const nodeId = payload.id('nodeId');
      if (stateId === REST_STATE_ID) throw payload.error('stateId', 'The rest state holds no overrides');
      const state = findState(graph, stateId);
      if (!state) throw payload.error('stateId', 'State does not exist');
      if (!findNode(graph, nodeId)) throw payload.error('nodeId', 'Node does not exist');
      const field = payload.enumValue('field', OVERRIDE_FIELDS);
      const existing = state.overrides.find(
        (override) => override.nodeId === nodeId && override.field === field,
      );
      const previous = existing ? clone(existing.value) : null;
      if (payload.raw('value') === null) {
        state.overrides = state.overrides.filter(
          (override) => !(override.nodeId === nodeId && override.field === field),
        );
      } else {
        const value = readOverrideValue(payload, field, 'value');
        if (existing) existing.value = value;
        else state.overrides.push({ nodeId, field, value });
      }
      return { type: 'state.override.set', payload: { stateId, nodeId, field, value: previous } };
    }
    case 'transition.set': {
      const from = payload.id('from');
      const to = payload.id('to');
      const trigger = payload.enumValue('trigger', TRIGGERS);
      if (!findState(graph, from)) throw payload.error('from', 'State does not exist');
      if (!findState(graph, to)) throw payload.error('to', 'State does not exist');
      if (from === to) throw payload.error('to', 'The two states must differ');
      const index = graph.transitions.findIndex(
        (transition) => transition.from === from && transition.trigger === trigger,
      );
      const previous = index < 0 ? null : clone(graph.transitions[index] as Transition);
      if (payload.raw('durationMs') === null) {
        if (index >= 0) graph.transitions.splice(index, 1);
      } else {
        const durationMs = payload.number('durationMs', 0, 2000);
        const next: Transition = { from, to, trigger, durationMs };
        if (index >= 0) graph.transitions[index] = next;
        else graph.transitions.push(next);
      }
      return {
        type: 'transition.set',
        payload: previous
          ? { from, to: previous.to, trigger, durationMs: previous.durationMs }
          : { from, to, trigger, durationMs: null },
      };
    }
    case 'camera.view.set': {
      const name = payload.name('name');
      const index = graph.cameraViews.findIndex((view) => view.name === name);
      const previous = index < 0 ? null : clone(graph.cameraViews[index] as CameraView);
      if (payload.raw('position') === null) {
        if (index >= 0) graph.cameraViews.splice(index, 1);
      } else {
        const view: CameraView = {
          name,
          position: payload.vec3('position', -1000, 1000),
          target: payload.vec3('target', -1000, 1000),
          fov: payload.number('fov', 10, 120),
        };
        if (index >= 0) graph.cameraViews[index] = view;
        else graph.cameraViews.push(view);
      }
      return {
        type: 'camera.view.set',
        payload: previous
          ? { name, position: previous.position, target: previous.target, fov: previous.fov }
          : { name, position: null, target: null, fov: null },
      };
    }
    default:
      throw new OpError({ [`${path}.type`]: 'Unknown operation' });
  }
}

/**
 * The node an operation names through `id` or `nodeId`, which is the node whose
 * lock the operation needs. State and scene-level operations name no node.
 */
export function lockedNodeOf(op: RawOp): string | null {
  const payload = op.payload;
  switch (op.type) {
    case 'node.add': {
      const node = payload.node;
      if (node !== null && typeof node === 'object' && !Array.isArray(node)) {
        const id = (node as Record<string, unknown>).id;
        return typeof id === 'string' ? id : null;
      }
      return null;
    }
    case 'node.remove':
    case 'node.rename':
    case 'node.reparent':
    case 'transform.set':
    case 'material.layer.add':
    case 'material.layer.set':
    case 'material.layer.remove':
      return typeof payload.id === 'string' ? payload.id : null;
    case 'state.override.set':
      return typeof payload.nodeId === 'string' ? payload.nodeId : null;
    default:
      return null;
  }
}

/** The state an operation names, used for undo conflict reporting. */
export function namedStateOf(op: RawOp): string | null {
  switch (op.type) {
    case 'state.add': {
      const state = op.payload.state;
      if (state !== null && typeof state === 'object' && !Array.isArray(state)) {
        const id = (state as Record<string, unknown>).id;
        return typeof id === 'string' ? id : null;
      }
      return null;
    }
    case 'state.remove':
      return typeof op.payload.id === 'string' ? op.payload.id : null;
    case 'state.override.set':
      return typeof op.payload.stateId === 'string' ? op.payload.stateId : null;
    default:
      return null;
  }
}
