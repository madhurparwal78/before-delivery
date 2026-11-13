import { ApiError, layerLockedMessage } from './errors.js';
import { round6 } from './numbers.js';
import {
  BY_LAYER,
  type BlockDef,
  type Constraint,
  type DimensionEntity,
  type DrawingModel,
  type Entity,
  type HatchEntity,
  type Layer,
  findBlock,
  findEntity,
  findLayer,
  handleNumber,
  layerZero,
  nextHandle,
  roundEntity,
} from './model.js';
import type { EntityInput, ModelPatch, ModifySet, Notice, OpResult, OpStatus, Operation, OtherState } from './operations.js';
import { blockDrawnEntities, moveEntity, vec } from './geometry.js';
import { findHatchBoundary, refreshHatch } from './hatch.js';
import { linkFor, refreshDimension } from './dimensions.js';
import { constraintLabel, solveConstraints } from './constraints.js';
import { evaluateExpression, ExpressionError } from './expressions.js';

export interface ImportPayload {
  layers: Layer[];
  blocks: BlockDef[];
  entities: Entity[];
  renames: { from: string; to: string }[];
}

export interface ApplyContext {
  username: string;
  baseRevision: number;
  command: string;
  revision: number;
  /** The geometry of an entity as it stood at a revision, for the conflict rules. */
  entityAtRevision?: (handle: string, revision: number) => Entity | null;
  /** The model of a published version, for RESTORE. */
  versionModel?: (versionId: string) => DrawingModel | null;
  /** A stored import, for IMPORT. */
  importPayload?: (importId: string) => ImportPayload | null;
  /** Another drawing's name and xref chain, for the circular-reference rule. */
  drawingName?: (drawingId: string) => string | null;
  drawingXrefs?: (drawingId: string) => { name: string; source: string }[];
  /** The last published version number of a source drawing. */
  publishedVersion?: (drawingId: string) => number | null;
  thisDrawingId?: string;
  thisDrawingName?: string;
  /** Points held still by a grip drag, so the constraint solver keeps them. */
  draggedPoints?: string[];
}

export interface ApplyOutcome {
  results: OpResult[];
  notices: Notice[];
  revision: number;
  patch: ModelPatch;
  targets: string[];
}

function otherState(model: DrawingModel): OtherState {
  return {
    blocks: JSON.stringify(model.blocks),
    dim_styles: JSON.stringify(model.dim_styles),
    parameters: JSON.stringify(model.parameters),
    constraints: JSON.stringify(model.constraints),
    xrefs: JSON.stringify(model.xrefs),
    layer_states: JSON.stringify(model.layer_states),
    underlays: JSON.stringify(model.underlays),
  };
}

function sameOther(a: OtherState, b: OtherState): boolean {
  return (
    a.blocks === b.blocks &&
    a.dim_styles === b.dim_styles &&
    a.parameters === b.parameters &&
    a.constraints === b.constraints &&
    a.xrefs === b.xrefs &&
    a.layer_states === b.layer_states &&
    a.underlays === b.underlays
  );
}

export function diffModel(before: DrawingModel, after: DrawingModel): ModelPatch {
  const patch: ModelPatch = {
    entities: {},
    layers: {},
    other: null,
    next_handle: { before: before.next_handle, after: after.next_handle },
  };
  const beforeEntities = new Map(before.entities.map((entity) => [entity.handle, entity]));
  const afterEntities = new Map(after.entities.map((entity) => [entity.handle, entity]));
  for (const handle of new Set([...beforeEntities.keys(), ...afterEntities.keys()])) {
    const b = beforeEntities.get(handle) ?? null;
    const a = afterEntities.get(handle) ?? null;
    if (JSON.stringify(b) !== JSON.stringify(a)) {
      patch.entities[handle] = { before: b ? structuredClone(b) : null, after: a ? structuredClone(a) : null };
    }
  }
  const beforeLayers = new Map(before.layers.map((layer) => [layer.name, layer]));
  const afterLayers = new Map(after.layers.map((layer) => [layer.name, layer]));
  for (const name of new Set([...beforeLayers.keys(), ...afterLayers.keys()])) {
    const b = beforeLayers.get(name) ?? null;
    const a = afterLayers.get(name) ?? null;
    if (JSON.stringify(b) !== JSON.stringify(a)) {
      patch.layers[name] = { before: b ? structuredClone(b) : null, after: a ? structuredClone(a) : null };
    }
  }
  const beforeOther = otherState(before);
  const afterOther = otherState(after);
  if (!sameOther(beforeOther, afterOther)) patch.other = { before: beforeOther, after: afterOther };
  return patch;
}

export function patchTargets(patch: ModelPatch): string[] {
  return [...Object.keys(patch.entities), ...Object.keys(patch.layers).map((name) => `layer:${name}`)];
}

/** Put a recorded patch back on the model, either way round. */
export function applyPatch(model: DrawingModel, patch: ModelPatch, side: 'before' | 'after', username: string, startRevision: number): number {
  let revision = startRevision;
  for (const [handle, change] of Object.entries(patch.entities)) {
    const wanted = change[side];
    const index = model.entities.findIndex((entity) => entity.handle === handle);
    if (wanted === null) {
      if (index >= 0) model.entities.splice(index, 1);
      revision += 1;
      model.deleted_entities[handle] = { revision, username };
      delete model.touched[handle];
      continue;
    }
    const clone = structuredClone(wanted);
    if (index >= 0) model.entities[index] = clone;
    else model.entities.push(clone);
    revision += 1;
    model.touched[handle] = { revision, username };
    delete model.deleted_entities[handle];
  }
  for (const [name, change] of Object.entries(patch.layers)) {
    const wanted = change[side];
    const index = model.layers.findIndex((layer) => layer.name === name);
    if (wanted === null) {
      if (index >= 0) model.layers.splice(index, 1);
      revision += 1;
      model.deleted_layers[name] = { revision, username };
      continue;
    }
    if (index >= 0) model.layers[index] = structuredClone(wanted);
    else model.layers.push(structuredClone(wanted));
    revision += 1;
    delete model.deleted_layers[name];
  }
  if (patch.other) {
    const state = patch.other[side];
    model.blocks = JSON.parse(state.blocks) as DrawingModel['blocks'];
    model.dim_styles = JSON.parse(state.dim_styles) as DrawingModel['dim_styles'];
    model.parameters = JSON.parse(state.parameters) as DrawingModel['parameters'];
    model.constraints = JSON.parse(state.constraints) as DrawingModel['constraints'];
    model.xrefs = JSON.parse(state.xrefs) as DrawingModel['xrefs'];
    model.layer_states = JSON.parse(state.layer_states) as DrawingModel['layer_states'];
    model.underlays = JSON.parse(state.underlays) as DrawingModel['underlays'];
    revision += 1;
  }
  model.next_handle = Math.max(model.next_handle, patch.next_handle[side]);
  model.entities.sort((a, b) => entityOrder(a) - entityOrder(b));
  refreshDerived(model);
  return revision;
}

function entityOrder(entity: Entity): number {
  return Number(entity.handle.replace(/^[A-Z]+/, ''));
}

export function refreshDerived(model: DrawingModel): void {
  for (const entity of model.entities) {
    if (entity.type === 'hatch') refreshHatch(model, entity as HatchEntity);
  }
  for (const entity of model.entities) {
    if (entity.type === 'dimension') refreshDimension(model, entity as DimensionEntity);
  }
}

function invalid(message: string): ApiError {
  return new ApiError('invalid', message);
}

function requireLayer(model: DrawingModel, name: string): Layer {
  const layer = findLayer(model, name);
  if (!layer) throw invalid(`No layer named ${name}.`);
  return layer;
}

function assertUnlocked(model: DrawingModel, layerName: string): void {
  const layer = findLayer(model, layerName);
  if (layer?.locked) throw new ApiError('layer_locked', layerLockedMessage(layerName));
}

/** Build the stored entity from the operation entity form, deriving every derived value. */
export function materializeEntity(model: DrawingModel, input: EntityInput, handle: string): Entity {
  const common = {
    handle,
    layer: input.layer,
    colour: input.colour ?? BY_LAYER,
    linetype: input.linetype ?? BY_LAYER,
    lineweight: input.lineweight ?? BY_LAYER,
  };
  switch (input.type) {
    case 'line':
      return roundEntity({ ...common, type: 'line', x1: input.x1, y1: input.y1, x2: input.x2, y2: input.y2 });
    case 'circle':
      return roundEntity({ ...common, type: 'circle', cx: input.cx, cy: input.cy, r: input.r });
    case 'arc':
      return roundEntity({ ...common, type: 'arc', cx: input.cx, cy: input.cy, r: input.r, start: input.start, end: input.end });
    case 'pline':
      return roundEntity({ ...common, type: 'pline', points: input.points, closed: input.closed });
    case 'insert': {
      const block = findBlock(model, input.block);
      if (!block) throw invalid(`No block named ${input.block}.`);
      const attributes: Record<string, string> = {};
      for (const attribute of block.attributes) attributes[attribute.tag] = attribute.default;
      for (const [tag, value] of Object.entries(input.attributes ?? {})) {
        if (block.attributes.some((attribute) => attribute.tag === tag)) attributes[tag] = value;
      }
      return roundEntity({
        ...common,
        type: 'insert',
        block: input.block,
        x: input.x,
        y: input.y,
        scale: input.scale,
        rotation: input.rotation,
        attributes,
      });
    }
    case 'hatch': {
      const found = findHatchBoundary(model, vec(input.seed_x, input.seed_y));
      if (!found) throw invalid('No closed boundary around that point.');
      return roundEntity({
        ...common,
        type: 'hatch',
        seed_x: input.seed_x,
        seed_y: input.seed_y,
        boundary: found.boundary,
        islands: found.islands,
        area: found.area,
        associative: true,
      });
    }
    case 'dimension': {
      const points = input.points ?? [];
      const refs = input.refs.length
        ? input.refs
        : points.map((point) => linkFor(model, vec(point[0], point[1]))).filter((ref): ref is NonNullable<typeof ref> => ref !== null);
      const dimension: DimensionEntity = roundEntity({
        ...common,
        type: 'dimension',
        kind: input.kind,
        style: input.style,
        refs,
        points: points.length ? points : [],
        override: input.override ?? null,
        text_x: input.text_x,
        text_y: input.text_y,
        value: 0,
        associative: refs.length > 0,
      });
      if (dimension.points.length === 0) {
        const derived: [number, number][] = [];
        for (const ref of refs) {
          const entity = findEntity(model, ref.handle);
          if (!entity) continue;
          const named = ref.point;
          const point = named
            ? (() => {
                const found = namedPointOf(entity, named);
                return found ?? [0, 0];
              })()
            : [0, 0];
          derived.push(point as [number, number]);
        }
        dimension.points = derived;
      }
      refreshDimension(model, dimension);
      return dimension;
    }
  }
}

function namedPointOf(entity: Entity, point: 'start' | 'end' | 'centre'): [number, number] | null {
  switch (entity.type) {
    case 'line':
      if (point === 'start') return [entity.x1, entity.y1];
      if (point === 'end') return [entity.x2, entity.y2];
      return [(entity.x1 + entity.x2) / 2, (entity.y1 + entity.y2) / 2];
    case 'circle':
      return [entity.cx, entity.cy];
    case 'arc':
      return [entity.cx, entity.cy];
    default:
      return null;
  }
}

function deleteEntities(model: DrawingModel, handles: string[], username: string, revisionStart: number): number {
  let revision = revisionStart;
  for (const handle of handles) {
    const index = model.entities.findIndex((entity) => entity.handle === handle);
    if (index < 0) continue;
    model.entities.splice(index, 1);
    revision += 1;
    model.deleted_entities[handle] = { revision, username };
    delete model.touched[handle];
    model.constraints = model.constraints.filter((constraint) => !constraint.refs.some((ref) => ref.handle === handle));
  }
  return revision;
}

function applySet(entity: Entity, set: ModifySet): void {
  if (set.layer !== undefined) entity.layer = set.layer;
  if (set.colour !== undefined) entity.colour = set.colour;
  if (set.linetype !== undefined) entity.linetype = set.linetype;
  if (set.lineweight !== undefined) entity.lineweight = set.lineweight;
  switch (entity.type) {
    case 'line':
      if (set.x1 !== undefined) entity.x1 = set.x1;
      if (set.y1 !== undefined) entity.y1 = set.y1;
      if (set.x2 !== undefined) entity.x2 = set.x2;
      if (set.y2 !== undefined) entity.y2 = set.y2;
      break;
    case 'circle':
      if (set.cx !== undefined) entity.cx = set.cx;
      if (set.cy !== undefined) entity.cy = set.cy;
      if (set.r !== undefined) entity.r = set.r;
      break;
    case 'arc':
      if (set.cx !== undefined) entity.cx = set.cx;
      if (set.cy !== undefined) entity.cy = set.cy;
      if (set.r !== undefined) entity.r = set.r;
      if (set.start !== undefined) entity.start = set.start;
      if (set.end !== undefined) entity.end = set.end;
      break;
    case 'pline':
      if (set.points !== undefined) entity.points = set.points;
      if (set.closed !== undefined) entity.closed = set.closed;
      break;
    case 'insert':
      if (set.block !== undefined) entity.block = set.block;
      if (set.x !== undefined) entity.x = set.x;
      if (set.y !== undefined) entity.y = set.y;
      if (set.scale !== undefined) entity.scale = set.scale;
      if (set.rotation !== undefined) entity.rotation = set.rotation;
      if (set.attributes !== undefined) {
        entity.attributes = { ...entity.attributes, ...set.attributes };
      }
      break;
    case 'hatch':
      if (set.seed_x !== undefined) entity.seed_x = set.seed_x;
      if (set.seed_y !== undefined) entity.seed_y = set.seed_y;
      break;
    case 'dimension':
      if (set.style !== undefined) entity.style = set.style;
      if (set.override !== undefined) entity.override = set.override;
      if (set.text_x !== undefined) entity.text_x = set.text_x;
      if (set.text_y !== undefined) entity.text_y = set.text_y;
      if (set.refs !== undefined) entity.refs = set.refs;
      if (set.points !== undefined) entity.points = set.points;
      break;
  }
  roundEntity(entity);
}

function blockChain(model: DrawingModel, name: string, entities: Entity[]): string[] | null {
  const walk = (current: string, path: string[]): string[] | null => {
    const block = current === name ? { name, entities } : findBlock(model, current);
    if (!block) return null;
    for (const child of block.entities) {
      if (child.type !== 'insert') continue;
      if (child.block === name) return [...path, child.block];
      const found = walk(child.block, [...path, child.block]);
      if (found) return found;
    }
    return null;
  };
  const found = walk(name, [name]);
  return found;
}

function xrefChain(context: ApplyContext, source: string): string[] | null {
  const hostId = context.thisDrawingId;
  const hostName = context.thisDrawingName ?? '';
  if (!hostId) return null;
  const nameOf = (id: string): string => context.drawingName?.(id) ?? id;
  const walk = (current: string, path: string[], seen: Set<string>): string[] | null => {
    if (current === hostId) return path;
    if (seen.has(current)) return null;
    seen.add(current);
    for (const xref of context.drawingXrefs?.(current) ?? []) {
      const found = walk(xref.source, [...path, nameOf(xref.source)], seen);
      if (found) return found;
    }
    return null;
  };
  if (source === hostId) return [hostName, hostName];
  return walk(source, [hostName, nameOf(source)], new Set());
}

function conflictStatus(
  model: DrawingModel,
  context: ApplyContext,
  handle: string,
): { status: OpStatus; other: string } | null {
  const deleted = model.deleted_entities[handle];
  if (deleted && deleted.revision > context.baseRevision && deleted.username !== context.username) {
    return { status: 'dropped', other: deleted.username };
  }
  const touched = model.touched[handle];
  if (touched && touched.revision > context.baseRevision && touched.username !== context.username) {
    return { status: 'rebased', other: touched.username };
  }
  return null;
}

function baseGeometry(model: DrawingModel, context: ApplyContext, handle: string): Entity | null {
  const atBase = context.entityAtRevision?.(handle, context.baseRevision) ?? null;
  if (atBase) return structuredClone(atBase);
  return findEntity(model, handle) ?? null;
}

interface OpOutcome {
  handles: string[];
  status: OpStatus;
  message: string | null;
  notices: Notice[];
}

function runOperation(model: DrawingModel, operation: Operation, context: ApplyContext, revision: () => number, bump: () => number): OpOutcome {
  const notices: Notice[] = [];
  const me = context.username;
  switch (operation.type) {
    case 'add': {
      const input = operation.entity;
      let status: OpStatus = 'applied';
      let message: string | null = null;
      let layer = input.layer;
      const deletedLayer = model.deleted_layers[layer];
      if (!findLayer(model, layer) && deletedLayer) {
        status = 'redirected';
        message = `${deletedLayer.username} deleted layer ${layer}. Your entity is on layer 0.`;
        notices.push({ to: me, text: message });
        layer = '0';
      }
      assertUnlocked(model, layer);
      if (input.type === 'insert') {
        const redefined = model.redefined_blocks[input.block];
        if (redefined && redefined.revision > context.baseRevision && redefined.username !== me) {
          status = 'redirected';
          message = `${redefined.username} redefined ${input.block}. Your insert uses the new one.`;
          notices.push({ to: me, text: message });
        }
      }
      const handle = input.handle ?? nextHandle(model, input.type);
      if (input.handle) model.next_handle = Math.max(model.next_handle, handleNumber(input.handle) + 1);
      const entity = materializeEntity(model, { ...input, layer }, handle);
      model.entities.push(entity);
      model.touched[handle] = { revision: bump(), username: me };
      delete model.deleted_entities[handle];
      return { handles: [handle], status, message, notices };
    }
    case 'modify': {
      const conflict = conflictStatus(model, context, operation.handle);
      if (conflict && conflict.status === 'dropped') {
        const text = `${conflict.other} deleted ${operation.handle}. Your change was dropped.`;
        notices.push({ to: me, text });
        return { handles: [operation.handle], status: 'dropped', message: text, notices };
      }
      const existing = findEntity(model, operation.handle);
      if (!existing) throw invalid(`No entity ${operation.handle}.`);
      assertUnlocked(model, existing.layer);
      if (operation.set.layer) assertUnlocked(model, operation.set.layer);
      let status: OpStatus = 'applied';
      let message: string | null = null;
      if (conflict && conflict.status === 'rebased') {
        const base = baseGeometry(model, context, operation.handle);
        if (base) {
          const index = model.entities.findIndex((entity) => entity.handle === operation.handle);
          model.entities[index] = { ...base, handle: operation.handle };
        }
        status = 'rebased';
        message = `${conflict.other} changed ${operation.handle} after you.`;
        notices.push({ to: conflict.other, text: `${me} changed ${operation.handle} after you.` });
      }
      const target = findEntity(model, operation.handle) as Entity;
      applySet(target, operation.set);
      model.touched[operation.handle] = { revision: bump(), username: me };
      return { handles: [operation.handle], status, message, notices };
    }
    case 'move': {
      const handles: string[] = [];
      let status: OpStatus = 'applied';
      let message: string | null = null;
      for (const handle of operation.handles) {
        const conflict = conflictStatus(model, context, handle);
        if (conflict && conflict.status === 'dropped') {
          const text = `${conflict.other} deleted ${handle}. Your change was dropped.`;
          notices.push({ to: me, text });
          status = 'dropped';
          message = text;
          continue;
        }
        const entity = findEntity(model, handle);
        if (!entity) throw invalid(`No entity ${handle}.`);
        assertUnlocked(model, entity.layer);
        if (conflict && conflict.status === 'rebased') {
          const base = baseGeometry(model, context, handle);
          if (base) {
            const index = model.entities.findIndex((candidate) => candidate.handle === handle);
            model.entities[index] = { ...base, handle };
          }
          status = 'rebased';
          message = `${conflict.other} moved ${handle} after you.`;
          notices.push({ to: conflict.other, text: `${me} moved ${handle} after you.` });
        }
        const moved = findEntity(model, handle) as Entity;
        moveEntity(moved, operation.dx, operation.dy);
        model.touched[handle] = { revision: bump(), username: me };
        handles.push(handle);
      }
      return { handles, status, message, notices };
    }
    case 'delete': {
      for (const handle of operation.handles) {
        const entity = findEntity(model, handle);
        if (entity) assertUnlocked(model, entity.layer);
      }
      const authors = new Map<string, string[]>();
      for (const handle of operation.handles) {
        const entity = findEntity(model, handle);
        if (!entity) continue;
        for (const dimension of model.entities) {
          if (dimension.type !== 'dimension') continue;
          if (dimension.refs.some((ref) => ref.handle === handle)) {
            const list = authors.get(dimension.handle) ?? [];
            list.push(handle);
            authors.set(dimension.handle, list);
          }
        }
      }
      const revisionAfter = deleteEntities(model, operation.handles, me, revision());
      while (revision() < revisionAfter) bump();
      for (const dimensionHandle of authors.keys()) {
        const dimension = findEntity(model, dimensionHandle);
        if (dimension && dimension.type === 'dimension' && !dimension.associative) {
          notices.push({ to: me, text: `Dimension ${dimensionHandle} lost its geometry.` });
        }
      }
      for (const entity of model.entities) {
        if (entity.type !== 'hatch') continue;
        const touched = entity.boundary.some((handle) => operation.handles.includes(handle)) ||
          entity.islands.some((handle) => operation.handles.includes(handle));
        if (!touched) continue;
        refreshHatch(model, entity);
        if (!entity.associative) {
          notices.push({ to: me, text: `Hatch ${entity.handle}: boundary broken. It no longer follows its edges.` });
        }
      }
      return { handles: operation.handles, status: 'applied', message: null, notices };
    }
    case 'layer_add': {
      if (findLayer(model, operation.name)) throw invalid(`A layer named ${operation.name} already exists.`);
      model.layers.push({
        name: operation.name,
        colour: operation.colour,
        linetype: operation.linetype,
        lineweight: operation.lineweight,
        on: true,
        frozen: false,
        locked: false,
      });
      delete model.deleted_layers[operation.name];
      bump();
      return { handles: [], status: 'applied', message: null, notices };
    }
    case 'layer_set': {
      const layer = requireLayer(model, operation.name);
      const set = operation.set;
      if (set.rename !== undefined) {
        if (layer.name === '0') throw invalid('Layer 0 can\u2019t be deleted.');
        const old = layer.name;
        layer.name = set.rename;
        for (const entity of model.entities) if (entity.layer === old) entity.layer = set.rename;
      }
      if (set.on !== undefined) layer.on = set.on;
      if (set.frozen !== undefined) layer.frozen = set.frozen;
      if (set.locked !== undefined) layer.locked = set.locked;
      if (set.colour !== undefined) layer.colour = set.colour;
      if (set.linetype !== undefined) layer.linetype = set.linetype;
      if (set.lineweight !== undefined) layer.lineweight = set.lineweight;
      bump();
      return { handles: [], status: 'applied', message: null, notices };
    }
    case 'layer_delete': {
      if (operation.name === '0') throw invalid('Layer 0 can\u2019t be deleted.');
      const layer = requireLayer(model, operation.name);
      const count = model.entities.filter((entity) => entity.layer === layer.name).length;
      if (count > 0) throw invalid(`Layer ${layer.name} has ${count} entities. Move them first.`);
      model.layers = model.layers.filter((candidate) => candidate.name !== layer.name);
      model.deleted_layers[layer.name] = { revision: bump(), username: me };
      return { handles: [], status: 'applied', message: null, notices };
    }
    case 'layer_state_save': {
      const entry = { name: operation.name, layers: structuredClone(model.layers) };
      const index = model.layer_states.findIndex((state) => state.name === operation.name);
      if (index >= 0) model.layer_states[index] = entry;
      else model.layer_states.push(entry);
      bump();
      return { handles: [], status: 'applied', message: null, notices };
    }
    case 'layer_state_restore': {
      const entry = model.layer_states.find((state) => state.name === operation.name);
      if (!entry) throw invalid(`No layer state named ${operation.name}.`);
      for (const saved of entry.layers) {
        const layer = findLayer(model, saved.name);
        if (!layer) continue;
        layer.on = saved.on;
        layer.frozen = saved.frozen;
        layer.locked = saved.locked;
        layer.colour = saved.colour;
        layer.linetype = saved.linetype;
        layer.lineweight = saved.lineweight;
      }
      bump();
      return { handles: [], status: 'applied', message: null, notices };
    }
    case 'block_define': {
      const members = operation.handles
        .map((handle) => findEntity(model, handle))
        .filter((entity): entity is Entity => entity !== undefined);
      const definitionEntities = members.map((entity) => structuredClone(entity));
      const chain = blockChain(model, operation.name, definitionEntities);
      if (chain) {
        throw invalid(`Block ${operation.name} can\u2019t contain itself: ${chain.join(' -> ')}.`);
      }
      const existing = findBlock(model, operation.name);
      const definition: BlockDef = {
        name: operation.name,
        base: [round6(operation.base[0]), round6(operation.base[1])],
        entities: definitionEntities,
        attributes: operation.attributes,
      };
      if (existing) {
        const index = model.blocks.findIndex((block) => block.name === operation.name);
        model.blocks[index] = definition;
        model.redefined_blocks[operation.name] = { revision: revision() + 1, username: me };
        for (const entity of model.entities) {
          if (entity.type !== 'insert' || entity.block !== operation.name) continue;
          const kept: Record<string, string> = {};
          for (const attribute of definition.attributes) {
            kept[attribute.tag] = entity.attributes[attribute.tag] ?? attribute.default;
          }
          entity.attributes = kept;
          model.touched[entity.handle] = { revision: revision() + 1, username: me };
        }
        bump();
        return { handles: [], status: 'applied', message: null, notices };
      }
      model.blocks.push(definition);
      const deleteTo = deleteEntities(model, operation.handles, me, revision());
      while (revision() < deleteTo) bump();
      const handle = nextHandle(model, 'insert');
      const attributes: Record<string, string> = {};
      for (const attribute of definition.attributes) attributes[attribute.tag] = attribute.default;
      model.entities.push({
        handle,
        type: 'insert',
        layer: members[0]?.layer ?? '0',
        colour: BY_LAYER,
        linetype: BY_LAYER,
        lineweight: BY_LAYER,
        block: definition.name,
        x: definition.base[0],
        y: definition.base[1],
        scale: 1,
        rotation: 0,
        attributes,
      });
      model.touched[handle] = { revision: bump(), username: me };
      return { handles: [handle], status: 'applied', message: null, notices };
    }
    case 'explode': {
      const insert = findEntity(model, operation.handle);
      if (!insert || insert.type !== 'insert') throw invalid(`No block insert ${operation.handle}.`);
      assertUnlocked(model, insert.layer);
      const block = findBlock(model, insert.block);
      if (!block) throw invalid(`No block named ${insert.block}.`);
      const drawn = blockDrawnEntities(model, insert, block);
      const deleteTo = deleteEntities(model, [insert.handle], me, revision());
      while (revision() < deleteTo) bump();
      const handles: string[] = [];
      for (const child of drawn) {
        const handle = nextHandle(model, child.type);
        const entity = { ...structuredClone(child), handle, layer: child.layer };
        if (entity.type === 'insert') entity.attributes = {};
        model.entities.push(entity);
        model.touched[handle] = { revision: bump(), username: me };
        handles.push(handle);
      }
      return { handles, status: 'applied', message: null, notices };
    }
    case 'purge': {
      const used = new Set<string>();
      const walk = (block: BlockDef): void => {
        for (const child of block.entities) {
          if (child.type !== 'insert') continue;
          used.add(child.block);
          const nested = findBlock(model, child.block);
          if (nested) walk(nested);
        }
      };
      for (const entity of model.entities) {
        if (entity.type === 'insert') {
          used.add(entity.block);
          const block = findBlock(model, entity.block);
          if (block) walk(block);
        }
      }
      const removedBlocks = model.blocks.filter((block) => !used.has(block.name)).length;
      model.blocks = model.blocks.filter((block) => used.has(block.name));
      const emptyLayers = model.layers.filter(
        (layer) => layer.name !== '0' && !model.entities.some((entity) => entity.layer === layer.name),
      );
      for (const layer of emptyLayers) {
        model.layers = model.layers.filter((candidate) => candidate.name !== layer.name);
        model.deleted_layers[layer.name] = { revision: revision() + 1, username: me };
      }
      bump();
      return {
        handles: [],
        status: 'applied',
        message: `Purged ${removedBlocks} blocks, ${emptyLayers.length} layers.`,
        notices,
      };
    }
    case 'dim_style_set': {
      const style = {
        name: operation.name,
        precision: operation.precision,
        prefix: operation.prefix,
        suffix: operation.suffix,
        scale: operation.scale,
        text_height_mm: operation.text_height_mm,
      };
      const index = model.dim_styles.findIndex((candidate) => candidate.name === operation.name);
      if (index >= 0) model.dim_styles[index] = style;
      else model.dim_styles.push(style);
      bump();
      return { handles: [], status: 'applied', message: null, notices };
    }
    case 'constraint_add': {
      const constraint: Constraint = {
        id: `K${model.constraints.length + 1}-${Math.random().toString(36).slice(2, 8)}`,
        kind: operation.kind,
        refs: operation.refs,
        expression: operation.expression ?? null,
      };
      if (constraint.expression !== null) {
        evaluateExpression(constraint.expression, model.parameters, constraint.expression);
      }
      model.constraints.push(constraint);
      bump();
      return { handles: constraint.refs.map((ref) => ref.handle), status: 'applied', message: null, notices };
    }
    case 'constraint_delete': {
      model.constraints = model.constraints.filter((constraint) => constraint.id !== operation.id);
      bump();
      return { handles: [], status: 'applied', message: null, notices };
    }
    case 'parameter_set': {
      const index = model.parameters.findIndex((parameter) => parameter.name === operation.name);
      const candidates = structuredClone(model.parameters);
      if (index >= 0) candidates[index] = { name: operation.name, expression: operation.expression };
      else candidates.push({ name: operation.name, expression: operation.expression });
      evaluateExpression(operation.name, candidates, operation.name);
      model.parameters = candidates;
      bump();
      return { handles: [], status: 'applied', message: null, notices };
    }
    case 'parameter_delete': {
      model.parameters = model.parameters.filter((parameter) => parameter.name !== operation.name);
      bump();
      return { handles: [], status: 'applied', message: null, notices };
    }
    case 'xref_attach': {
      const chain = xrefChain(context, operation.source);
      if (chain) throw invalid(`Circular reference: ${chain.join(' -> ')}.`);
      const published = context.publishedVersion?.(operation.source) ?? null;
      model.xrefs.push({
        name: operation.name,
        source: operation.source,
        x: round6(operation.x),
        y: round6(operation.y),
        scale: round6(operation.scale),
        rotation: round6(operation.rotation),
        clip: null,
        version_number: published,
      });
      bump();
      return { handles: [], status: 'applied', message: null, notices };
    }
    case 'xref_clip': {
      const xref = model.xrefs.find((candidate) => candidate.name === operation.name);
      if (!xref) throw invalid(`No xref named ${operation.name}.`);
      xref.clip = operation.rect
        ? [round6(operation.rect[0]), round6(operation.rect[1]), round6(operation.rect[2]), round6(operation.rect[3])]
        : null;
      bump();
      return { handles: [], status: 'applied', message: null, notices };
    }
    case 'xref_reload': {
      const xref = model.xrefs.find((candidate) => candidate.name === operation.name);
      if (!xref) throw invalid(`No xref named ${operation.name}.`);
      xref.version_number = context.publishedVersion?.(xref.source) ?? xref.version_number;
      bump();
      return { handles: [], status: 'applied', message: null, notices };
    }
    case 'xref_bind': {
      const xref = model.xrefs.find((candidate) => candidate.name === operation.name);
      if (!xref) throw invalid(`No xref named ${operation.name}.`);
      const sourceModel = context.versionModel?.(`${xref.source}:${xref.version_number ?? 0}`) ?? null;
      if (!sourceModel) throw invalid(`No xref named ${operation.name}.`);
      for (const layer of sourceModel.layers) {
        const bound = `${xref.name}$${layer.name}`;
        if (!findLayer(model, bound)) model.layers.push({ ...layer, name: bound });
      }
      const entities = sourceModel.entities.map((entity) => {
        const clone = structuredClone(entity);
        clone.layer = `${xref.name}$${entity.layer}`;
        return clone;
      });
      model.blocks.push({ name: xref.name, base: [0, 0], entities, attributes: [] });
      const handle = nextHandle(model, 'insert');
      model.entities.push({
        handle,
        type: 'insert',
        layer: '0',
        colour: BY_LAYER,
        linetype: BY_LAYER,
        lineweight: BY_LAYER,
        block: xref.name,
        x: xref.x,
        y: xref.y,
        scale: xref.scale,
        rotation: xref.rotation,
        attributes: {},
      });
      model.xrefs = model.xrefs.filter((candidate) => candidate.name !== xref.name);
      model.touched[handle] = { revision: bump(), username: me };
      return { handles: [handle], status: 'applied', message: null, notices };
    }
    case 'version_restore': {
      const snapshot = context.versionModel?.(operation.version) ?? null;
      if (!snapshot) throw invalid('That version has no snapshot.');
      const wanted = new Map(snapshot.entities.map((entity) => [entity.handle, entity]));
      const current = new Map(model.entities.map((entity) => [entity.handle, entity]));
      for (const [handle, entity] of wanted) {
        const existing = current.get(handle);
        if (!existing || JSON.stringify(existing) !== JSON.stringify(entity)) {
          const index = model.entities.findIndex((candidate) => candidate.handle === handle);
          const clone = structuredClone(entity);
          if (index >= 0) model.entities[index] = clone;
          else model.entities.push(clone);
          model.touched[handle] = { revision: bump(), username: me };
          delete model.deleted_entities[handle];
        }
      }
      const removed = [...current.keys()].filter((handle) => !wanted.has(handle));
      const deleteTo = deleteEntities(model, removed, me, revision());
      while (revision() < deleteTo) bump();
      model.layers = structuredClone(snapshot.layers);
      model.blocks = structuredClone(snapshot.blocks);
      model.xrefs = structuredClone(snapshot.xrefs);
      model.entities.sort((a, b) => entityOrder(a) - entityOrder(b));
      bump();
      return { handles: [...wanted.keys()], status: 'applied', message: null, notices };
    }
    case 'import_merge': {
      const payload = context.importPayload?.(operation.import_id) ?? null;
      if (!payload) throw invalid('That import is no longer available.');
      for (const layer of payload.layers) {
        if (!findLayer(model, layer.name)) model.layers.push(structuredClone(layer));
      }
      for (const block of payload.blocks) {
        if (findBlock(model, block.name)) continue;
        const clone = structuredClone(block);
        clone.entities = clone.entities.map((child) => ({ ...child, handle: nextHandle(model, child.type) }));
        model.blocks.push(clone);
      }
      const renamedHandles = new Map<string, string>();
      const prepared = payload.entities.map((entity) => {
        const handle = nextHandle(model, entity.type);
        renamedHandles.set(entity.handle, handle);
        return { ...structuredClone(entity), handle };
      });
      const handles: string[] = [];
      for (const entity of prepared) {
        if (entity.type === 'dimension') {
          entity.refs = entity.refs.map((ref) => ({ ...ref, handle: renamedHandles.get(ref.handle) ?? ref.handle }));
        }
        model.entities.push(entity);
        model.touched[entity.handle] = { revision: bump(), username: me };
        handles.push(entity.handle);
      }
      return { handles, status: 'applied', message: null, notices };
    }
  }
}

/** Apply one operation group, all or nothing, in server order. */
export function applyGroup(model: DrawingModel, operations: Operation[], context: ApplyContext): ApplyOutcome {
  const before = structuredClone(model);
  const working = structuredClone(model);
  let revision = context.revision;
  const results: OpResult[] = [];
  const notices: Notice[] = [];
  const constraintsBefore = working.constraints.length;

  for (const operation of operations) {
    let outcome: OpOutcome;
    try {
      outcome = runOperation(working, operation, context, () => revision, () => {
        revision += 1;
        return revision;
      });
    } catch (error) {
      if (error instanceof ExpressionError) throw invalid(error.message);
      throw error;
    }
    results.push({ op_id: operation.op_id, status: outcome.status, handles: outcome.handles, message: outcome.message });
    notices.push(...outcome.notices);
  }

  if (!findLayer(working, '0')) working.layers.unshift(layerZero());
  working.entities.sort((a, b) => entityOrder(a) - entityOrder(b));

  if (working.constraints.length > 0) {
    const solved = solveConstraints(working, context.draggedPoints ?? []);
    if (!solved.ok && solved.unsatisfied) {
      const added = working.constraints.slice(constraintsBefore);
      const newest = added[added.length - 1] ?? solved.unsatisfied;
      throw invalid(`Over-constrained: ${constraintLabel(newest)} conflicts with ${constraintLabel(solved.unsatisfied)}.`);
    }
  }
  refreshDerived(working);

  for (const entity of working.entities) {
    if (entity.type !== 'hatch') continue;
    const was = before.entities.find((candidate) => candidate.handle === entity.handle);
    if (was && was.type === 'hatch' && was.associative && !entity.associative) {
      const text = `Hatch ${entity.handle}: boundary broken. It no longer follows its edges.`;
      if (!notices.some((notice) => notice.text === text)) notices.push({ to: context.username, text });
    }
  }
  for (const entity of working.entities) {
    if (entity.type !== 'dimension') continue;
    const was = before.entities.find((candidate) => candidate.handle === entity.handle);
    if (was && was.type === 'dimension' && was.associative && !entity.associative) {
      const text = `Dimension ${entity.handle} lost its geometry.`;
      if (!notices.some((notice) => notice.text === text)) notices.push({ to: context.username, text });
    }
  }

  const patch = diffModel(before, working);
  Object.assign(model, working);
  return { results, notices, revision, patch, targets: patchTargets(patch) };
}

export function supersededTarget(
  model: DrawingModel,
  targets: string[],
  groupRevision: number,
  username: string,
): { handle: string; user: string } | null {
  for (const target of targets) {
    if (target.startsWith('layer:')) continue;
    const touched = model.touched[target];
    if (touched && touched.revision > groupRevision && touched.username !== username) {
      return { handle: target, user: touched.username };
    }
    const deleted = model.deleted_entities[target];
    if (deleted && deleted.revision > groupRevision && deleted.username !== username) {
      return { handle: target, user: deleted.username };
    }
  }
  return null;
}

export function undoSkipMessage(user: string, handle: string): string {
  return `Can\u2019t undo: ${user} changed ${handle} after you.`;
}

/** The layer_locked error for a batch, which outranks a stale base. */
export function lockedLayerError(model: DrawingModel, operations: Operation[]): ApiError | null {
  const check = (layerName: string | undefined): ApiError | null => {
    if (!layerName) return null;
    const layer = findLayer(model, layerName);
    return layer?.locked ? new ApiError('layer_locked', layerLockedMessage(layerName)) : null;
  };
  for (const operation of operations) {
    if (operation.type === 'add') {
      const error = check(operation.entity.layer);
      if (error) return error;
    }
    const handles =
      operation.type === 'modify' || operation.type === 'explode'
        ? [operation.handle]
        : operation.type === 'move' || operation.type === 'delete'
          ? operation.handles
          : [];
    for (const handle of handles) {
      const entity = findEntity(model, handle);
      const error = check(entity?.layer);
      if (error) return error;
    }
    if (operation.type === 'modify') {
      const error = check(operation.set.layer);
      if (error) return error;
    }
  }
  return null;
}
