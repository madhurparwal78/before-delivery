import crypto from 'node:crypto';
import { ApiError, ERROR_TEXT } from '../shared/errors.js';
import type { Entity, Pt, ResolvedEntity } from '../shared/geometry.js';
import { entityBounds, moveEntity, mirrorEntity, transformEntity, LINEWEIGHTS, LINETYPES, LAYER_COLOURS } from '../shared/geometry.js';
import { createEmptyModel, type DrawingModel, type LayerRecord } from '../shared/model.js';
import { findHatchBoundary, dimensionValue, dimensionAssociative } from '../shared/derived.js';
import { round6, nearly } from '../shared/num.js';
import type { OpResult } from '../shared/protocol.js';

// ---------------------------------------------------------------------------
// The server-ordered operation engine. One place decides every rule about
// how an operation group applies, conflicts and resolves.
// ---------------------------------------------------------------------------

export interface StoredOperation {
  op_id: string;
  type: string;
  [field: string]: unknown;
}

export interface GroupResult {
  revision: number;
  results: OpResult[];
}

export interface ApplyContext {
  author: string;
  command: string;
  baseRevision: number;
  groupId: string;
  now: Date;
}

export interface OpOutcome {
  status: 'applied' | 'rebased' | 'dropped' | 'redirected';
  handles: string[];
  message: string | null;
  recipient?: string;
}

const HANDLE_LETTER: Record<string, string> = {
  line: 'L',
  pline: 'P',
  circle: 'C',
  arc: 'A',
  hatch: 'H',
  dimension: 'D',
  insert: 'I',
};

export class DrawingEngine {
  readonly model: DrawingModel;
  private handleCounter: number;
  private readonly retired = new Set<string>();

  constructor(model: DrawingModel, nextHandle: number) {
    this.model = model;
    this.handleCounter = Math.max(1, nextHandle);
  }

  get nextHandle(): number {
    return this.handleCounter;
  }

  nextHandleFor(type: string): string {
    const letter = HANDLE_LETTER[type] ?? 'L';
    let candidate = `${letter}${this.handleCounter}`;
    while (this.model.entities[candidate] || this.retired.has(candidate)) {
      this.handleCounter += 1;
      candidate = `${letter}${this.handleCounter}`;
    }
    const taken = this.handleCounter;
    this.handleCounter += 1;
    void taken;
    return candidate;
  }

  retire(handle: string): void {
    this.retired.add(handle);
  }

  setNextHandle(value: number): void {
    this.handleCounter = Math.max(this.handleCounter, value);
  }

  entity(handle: string): Entity | undefined {
    return this.model.entities[handle];
  }

  layer(name: string): LayerRecord | undefined {
    return this.model.layers[name];
  }

  private checkEntityLayer(entity: Entity): ApiError | null {
    const layer = this.model.layers[entity.layer];
    if (!layer) return null;
    if (layer.locked) return new ApiError('layer_locked', ERROR_TEXT.layerLocked(layer.name));
    return null;
  }

  applyGroup(ops: StoredOperation[], context: ApplyContext): { results: OpResult[]; notes: Array<{ text: string; recipient: string }> } {
    const results: OpResult[] = [];
    const notes: Array<{ text: string; recipient: string }> = [];
    const recentAuthors = this.recentAuthors;
    for (const op of ops) {
      const outcome = this.applyOp(op, context, recentAuthors);
      results.push({ op_id: String(op.op_id), status: outcome.status, handles: outcome.handles, message: outcome.message });
      if (outcome.message) notes.push({ text: outcome.message, recipient: outcome.recipient ?? context.author });
    }
    return { results, notes };
  }

  private applyOp(op: StoredOperation, context: ApplyContext, recentAuthors: Map<string, string>): OpOutcome {
    switch (op.type) {
      case 'add':
        return this.opAdd(op, context);
      case 'modify':
        return this.opModify(op, context, recentAuthors);
      case 'move':
        return this.opMove(op, context, recentAuthors);
      case 'delete':
        return this.opDelete(op, context);
      case 'layer_add':
        return this.opLayerAdd(op);
      case 'layer_set':
        return this.opLayerSet(op);
      case 'layer_delete':
        return this.opLayerDelete(op);
      case 'layer_state_save':
        return this.opLayerStateSave(op);
      case 'layer_state_restore':
        return this.opLayerStateRestore(op);
      case 'block_define':
        return this.opBlockDefine(op);
      case 'explode':
        return this.opExplode(op, context);
      case 'purge':
        return this.opPurge();
      case 'dim_style_set':
        return this.opDimStyleSet(op);
      case 'constraint_add':
        return this.opConstraintAdd(op);
      case 'constraint_delete':
        return this.opConstraintDelete(op);
      case 'parameter_set':
        return this.opParameterSet(op);
      case 'parameter_delete':
        return this.opParameterDelete(op);
      case 'xref_attach':
        return this.opXrefAttach(op);
      case 'xref_clip':
        return this.opXrefClip(op);
      case 'xref_reload':
        return this.opXrefReload(op);
      case 'xref_bind':
        return this.opXrefBind(op);
      case 'version_restore':
        return this.opVersionRestore(op);
      case 'import_merge':
        return { status: 'applied', handles: [], message: null };
      default:
        return { status: 'dropped', handles: [], message: null };
    }
  }

  private opAdd(op: StoredOperation, context: ApplyContext): OpOutcome {
    const entity = op.entity as (Omit<Entity, 'handle'> & { handle?: string }) | undefined;
    if (!entity || !entity.type) return { status: 'dropped', handles: [], message: null };
    const layerName = entity.layer;
    const layer = this.model.layers[layerName];
    const redirect = !layer;
    const effectiveLayer = redirect ? '0' : layerName;
    if (!redirect && layer.locked) {
      throw new ApiError('layer_locked', ERROR_TEXT.layerLocked(layerName));
    }
    const handle = entity.handle ?? this.nextHandleFor(entity.type);
    const stored: Entity = { ...(entity as Omit<Entity, 'handle'>), handle, layer: effectiveLayer } as Entity;
    if (stored.type === 'insert' && !this.model.blocks[stored.block]) {
      throw new ApiError('invalid', `No block named ${stored.block}.`);
    }
    this.addEntity(stored);
    this.recordHistory(handle, context);
    return {
      status: redirect ? 'redirected' : 'applied',
      handles: [handle],
      message: redirect ? `${context.author} deleted layer ${layerName}. Your entity is on layer 0.` : null,
    };
  }

  addEntity(entity: Entity): void {
    this.model.entities[entity.handle] = entity;
    this.model.order.push(entity.handle);
    this.setNextHandle(handleNumber(entity.handle) + 1);
  }

  private opModify(op: StoredOperation, context: ApplyContext, recentAuthors: Map<string, string>): OpOutcome {
    const handle = String(op.handle ?? '');
    const set = (op.set ?? {}) as Record<string, unknown>;
    const existing = this.model.entities[handle];
    if (!existing) {
      const deleter = recentAuthors.get(handle) ?? context.author;
      return { status: 'dropped', handles: [handle], message: `${deleter} deleted ${handle}. Your change was dropped.`, recipient: context.author };
    }
    const layerError = this.checkEntityLayer(existing);
    if (layerError) throw layerError;
    const next = { ...existing, ...(set as Partial<Entity>) } as Entity;
    if (next.type === 'insert' && !this.model.blocks[next.block]) {
      return { status: 'redirected', handles: [handle], message: `${context.author} redefined ${next.block}. Your insert uses the new one.` };
    }
    this.model.entities[handle] = next;
    this.recordHistory(handle, context);
    return { status: 'applied', handles: [handle], message: null };
  }

  private opMove(op: StoredOperation, context: ApplyContext, recentAuthors: Map<string, string>): OpOutcome {
    const handles = (op.handles ?? []) as string[];
    const dx = Number(op.dx ?? 0);
    const dy = Number(op.dy ?? 0);
    const applied: string[] = [];
    let rebased = false;
    let rebasedHandle = '';
    for (const handle of handles) {
      const existing = this.model.entities[handle];
      if (!existing) {
        const deleter = recentAuthors.get(handle) ?? context.author;
        return { status: 'dropped', handles: [handle], message: `${deleter} deleted ${handle}. Your change was dropped.`, recipient: context.author };
      }
      const layerError = this.checkEntityLayer(existing);
      if (layerError) throw layerError;
      const earlier = recentAuthors.get(handle);
      if (earlier !== undefined && earlier !== context.author) {
        rebased = true;
        rebasedHandle = handle;
      }
    }
    for (const handle of handles) {
      const existing = this.model.entities[handle];
      if (!existing) continue;
      this.model.entities[handle] = moveEntity(existing, round6(dx), round6(dy));
      this.recordHistory(handle, context);
      applied.push(handle);
    }
    if (rebased) {
      const earlier = recentAuthors.get(rebasedHandle) ?? context.author;
      return { status: 'rebased', handles: applied, message: `${context.author} moved ${rebasedHandle} after you.`, recipient: earlier };
    }
    return { status: 'applied', handles: applied, message: null };
  }

  private opDelete(op: StoredOperation, context: ApplyContext): OpOutcome {
    const handles = (op.handles ?? []) as string[];
    const applied: string[] = [];
    for (const handle of handles) {
      const existing = this.model.entities[handle];
      if (!existing) continue;
      const layerError = this.checkEntityLayer(existing);
      if (layerError) throw layerError;
      delete this.model.entities[handle];
      this.model.order = this.model.order.filter((h) => h !== handle);
      this.retire(handle);
      this.recordHistory(handle, context);
      this.noteAuthor(handle, context.author);
      applied.push(handle);
    }
    return { status: 'applied', handles: applied, message: null };
  }

  private opLayerAdd(op: StoredOperation): OpOutcome {
    const name = String(op.name ?? '');
    if (!name || this.model.layers[name]) return { status: 'dropped', handles: [], message: null };
    this.model.layers[name] = {
      name,
      colour: colourOr(op.colour, 'white'),
      linetype: linetypeOr(op.linetype, 'Continuous'),
      lineweight: lineweightOr(op.lineweight, 0.25),
      on: op.on !== false,
      frozen: op.frozen === true,
      locked: op.locked === true,
    };
    return { status: 'applied', handles: [], message: null };
  }

  private opLayerSet(op: StoredOperation): OpOutcome {
    const name = String(op.name ?? '');
    const set = (op.set ?? {}) as Record<string, unknown>;
    const layer = this.model.layers[name];
    if (!layer) return { status: 'dropped', handles: [], message: null };
    if (set.rename !== undefined && set.rename !== name) {
      const rename = String(set.rename);
      if (this.model.layers[rename]) throw new ApiError('invalid', `Layer ${rename} already exists.`);
      const uses = this.model.order.filter((h) => this.model.entities[h]?.layer === name).length;
      if (name === '0') throw new ApiError('invalid', 'Layer 0 can\u2019t be renamed.');
      if (uses > 0) {
        for (const handle of this.model.order) {
          const entity = this.model.entities[handle];
          if (entity && entity.layer === name) this.model.entities[handle] = { ...entity, layer: rename } as Entity;
        }
      }
      delete this.model.layers[name];
      const renamed: LayerRecord = { ...layer, name: rename };
      this.model.layers[rename] = renamed;
      if (this.model.current_layer === name) this.model.current_layer = rename;
      return { status: 'applied', handles: [], message: null };
    }
    if (set.on !== undefined) layer.on = Boolean(set.on);
    if (set.frozen !== undefined) {
      const frozen = Boolean(set.frozen);
      if (frozen && this.model.current_layer === name) throw new ApiError('invalid', 'Frozen layers can\u2019t be current.');
      layer.frozen = frozen;
    }
    if (set.locked !== undefined) layer.locked = Boolean(set.locked);
    if (set.colour !== undefined) layer.colour = colourOr(set.colour, layer.colour);
    if (set.linetype !== undefined) layer.linetype = linetypeOr(set.linetype, layer.linetype);
    if (set.lineweight !== undefined) layer.lineweight = lineweightOr(set.lineweight, layer.lineweight);
    return { status: 'applied', handles: [], message: null };
  }

  private opLayerDelete(op: StoredOperation): OpOutcome {
    const name = String(op.name ?? '');
    if (name === '0') throw new ApiError('invalid', ERROR_TEXT.layerCantDelete);
    if (!this.model.layers[name]) return { status: 'dropped', handles: [], message: null };
    const uses = this.model.order.filter((h) => this.model.entities[h]?.layer === name).length;
    if (uses > 0) throw new ApiError('invalid', ERROR_TEXT.layerHasEntities(name, uses));
    delete this.model.layers[name];
    if (this.model.current_layer === name) this.model.current_layer = '0';
    return { status: 'applied', handles: [], message: null };
  }

  private opLayerStateSave(op: StoredOperation): OpOutcome {
    const name = String(op.name ?? '');
    const state: LayerRecord[] = Object.values(this.model.layers);
    const existing = this.model.layer_states.find((s) => s.name === name);
    const saved = { name, state: Object.fromEntries(state.map((layer): [string, LayerRecord] => [layer.name, { ...layer }])) };
    if (existing) {
      existing.state = saved.state;
    } else {
      this.model.layer_states.push(saved);
    }
    return { status: 'applied', handles: [], message: null };
  }

  private opLayerStateRestore(op: StoredOperation): OpOutcome {
    const name = String(op.name ?? '');
    const saved = this.model.layer_states.find((s) => s.name === name);
    if (!saved) return { status: 'dropped', handles: [], message: null };
    for (const [layerName, layer] of Object.entries(saved.state)) {
      const existing = this.model.layers[layerName];
      this.model.layers[layerName] = { ...layer, name: layerName };
    }
    return { status: 'applied', handles: [], message: null };
  }

  blockChain(name: string): string[] | null {
    const seen: string[] = [];
    const walk = (block: string): string[] | null => {
      if (seen.includes(block)) return [...seen.slice(seen.indexOf(block)), block];
      seen.push(block);
      const record = this.model.blocks[block];
      if (!record) return null;
      for (const entity of record.entities) {
        if (entity.type === 'insert') {
          const cycle = walk(entity.block);
          if (cycle) return cycle;
        }
      }
      seen.pop();
      return null;
    };
    return walk(name);
  }

  private opBlockDefine(op: StoredOperation): OpOutcome {
    const name = String(op.name ?? '');
    const base = op.base as Pt | undefined ?? { x: 0, y: 0 };
    const handles = (op.handles ?? []) as string[];
    const attributes = (op.attributes ?? []) as Array<{ tag: string; default: string }>;
    const entities: Entity[] = [];
    for (const handle of handles) {
      const existing = this.model.entities[handle];
      if (!existing) continue;
      const layerError = this.checkEntityLayer(existing);
      if (layerError) throw layerError;
      entities.push(existing);
    }
    if (!entities.length) return { status: 'dropped', handles: [], message: null };
    const previous = this.model.blocks[name];
    if (previous) {
      for (const entity of previous.entities) {
        if (entity.type === 'insert' && entity.block === name) {
          throw new ApiError('invalid', ERROR_TEXT.blockSelfReference(name, name));
        }
      }
    }
    const wouldContain = this.collectNested(namesOf(entities));
    if (wouldContain.includes(name)) {
      const chain = [name, ...wouldContainsChain(wouldContain, name)].join(' -> ');
      throw new ApiError('invalid', ERROR_TEXT.blockSelfReference(name, `${name} -> ${chain}`.replace(/ -> $/, '')));
    }
    const existingValues = new Map<string, Map<string, string>>();
    if (previous) {
      for (const handle of this.model.order) {
        const entity = this.model.entities[handle];
        if (entity?.type === 'insert' && entity.block === name) {
          existingValues.set(handle, new Map(Object.entries(entity.attributes)));
        }
      }
    }
    this.model.blocks[name] = { name, base, entities, attributes };
    for (const handle of handles) {
      delete this.model.entities[handle];
      this.model.order = this.model.order.filter((h) => h !== handle);
      this.retire(handle);
    }
    const insertHandle = this.nextHandleFor('insert');
    const insert: Entity = {
      type: 'insert',
      handle: insertHandle,
      layer: '0',
      block: name,
      x: base.x,
      y: base.y,
      scale: 1,
      rotation: 0,
      attributes: Object.fromEntries(attributes.map((attribute) => [attribute.tag, attribute.default])),
    };
    this.addEntity(insert);
    for (const [handle, values] of existingValues) {
      const entity = this.model.entities[handle];
      if (entity?.type === 'insert') {
        const kept: Record<string, string> = {};
        for (const attribute of attributes) {
          if (values.has(attribute.tag)) kept[attribute.tag] = values.get(attribute.tag) ?? attribute.default;
          else kept[attribute.tag] = entity.attributes[attribute.tag] ?? attribute.default;
        }
        this.model.entities[handle] = { ...entity, attributes: kept };
      }
    }
    return { status: 'applied', handles: [insertHandle], message: null };
  }

  private collectNested(names: Set<string>): string[] {
    const chain: string[] = [];
    const walk = (block: string, path: string[]): string[] | null => {
      if (path.includes(block)) return path.slice(path.indexOf(block));
      const record = this.model.blocks[block];
      if (!record) return null;
      for (const entity of record.entities) {
        if (entity.type === 'insert' && names.has(entity.block)) {
          const result = walk(entity.block, [...path, block]);
          if (result) return result;
        }
        if (entity.type === 'insert' && !names.has(entity.block)) {
          const nested = walk(entity.block, [...path, block]);
          if (nested) return nested;
        }
      }
      return null;
    };
    for (const name of names) {
      const result = walk(name, []);
      if (result) {
        chain.push(...result);
        return chain;
      }
    }
    return chain;
  }

  private opExplode(op: StoredOperation, context: ApplyContext): OpOutcome {
    const handle = String(op.handle ?? '');
    const insert = this.model.entities[handle];
    if (!insert || insert.type !== 'insert') return { status: 'dropped', handles: [handle], message: null };
    const layerError = this.checkEntityLayer(insert);
    if (layerError) throw layerError;
    const block = this.model.blocks[insert.block];
    if (!block) return { status: 'dropped', handles: [handle], message: null };
    delete this.model.entities[handle];
    this.model.order = this.model.order.filter((h) => h !== handle);
    this.retire(handle);
    const added: string[] = [];
    for (const definition of block.entities) {
      const drawn = transformEntity(definition, block.base, insert.scale, insert.rotation);
      const moved = moveEntity(drawn, insert.x - block.base.x, insert.y - block.base.y);
      const handleNew = this.nextHandleFor(moved.type);
      const stored = { ...moved, handle: handleNew, layer: insert.layer } as Entity;
      this.addEntity(stored);
      this.recordHistory(handleNew, context);
      added.push(handleNew);
    }
    return { status: 'applied', handles: added, message: null };
  }

  private opPurge(): OpOutcome {
    const usedBlocks = new Set<string>();
    for (const handle of this.model.order) {
      const entity = this.model.entities[handle];
      if (entity?.type === 'insert') usedBlocks.add(entity.block);
    }
    let blocks = 0;
    for (const name of Object.keys(this.model.blocks)) {
      if (!usedBlocks.has(name)) {
        delete this.model.blocks[name];
        blocks += 1;
      }
    }
    let layers = 0;
    for (const name of Object.keys(this.model.layers)) {
      if (name === '0') continue;
      const uses = this.model.order.some((h) => this.model.entities[h]?.layer === name);
      if (!uses) {
        delete this.model.layers[name];
        layers += 1;
      }
    }
    return { status: 'applied', handles: [], message: `Purged ${blocks} blocks, ${layers} layers.` };
  }

  private opDimStyleSet(op: StoredOperation): OpOutcome {
    const name = String(op.name ?? '');
    if (!name) return { status: 'dropped', handles: [], message: null };
    this.model.dim_styles[name] = {
      name,
      precision: Number(op.precision ?? 2),
      prefix: String(op.prefix ?? ''),
      suffix: String(op.suffix ?? ''),
      scale: Number(op.scale ?? 1),
      text_height_mm: Number(op.text_height_mm ?? 2.5),
    };
    return { status: 'applied', handles: [], message: null };
  }

  private opConstraintAdd(op: StoredOperation): OpOutcome {
    const kind = String(op.kind ?? '');
    const refs = (op.refs ?? []) as Array<{ handle: string; point: null | 'start' | 'end' }>;
    const expression = op.expression === undefined || op.expression === null ? null : String(op.expression);
    const id = `c${crypto.randomBytes(4).toString('hex')}`;
    this.model.constraints.push({ id, kind: kind as never, refs, expression });
    return { status: 'applied', handles: refs.map((r) => r.handle), message: null };
  }

  private opConstraintDelete(op: StoredOperation): OpOutcome {
    const id = String(op.id ?? '');
    const before = this.model.constraints.length;
    this.model.constraints = this.model.constraints.filter((c) => c.id !== id);
    return before === this.model.constraints.length ? { status: 'dropped', handles: [], message: null } : { status: 'applied', handles: [], message: null };
  }

  private opParameterSet(op: StoredOperation): OpOutcome {
    const name = String(op.name ?? '');
    const expression = String(op.expression ?? '');
    const existing = this.model.parameters.find((p) => p.name === name);
    if (existing) existing.expression = expression;
    else this.model.parameters.push({ name, expression });
    return { status: 'applied', handles: [], message: null };
  }

  private opParameterDelete(op: StoredOperation): OpOutcome {
    const name = String(op.name ?? '');
    const before = this.model.parameters.length;
    this.model.parameters = this.model.parameters.filter((p) => p.name !== name);
    return before === this.model.parameters.length ? { status: 'dropped', handles: [], message: null } : { status: 'applied', handles: [], message: null };
  }

  private opXrefAttach(op: StoredOperation): OpOutcome {
    const name = String(op.name ?? '');
    if (!name) return { status: 'dropped', handles: [], message: null };
    this.model.xrefs = this.model.xrefs.filter((x) => x.name !== name);
    this.model.xrefs.push({
      name,
      source: String(op.source ?? ''),
      x: Number(op.x ?? 0),
      y: Number(op.y ?? 0),
      scale: Number(op.scale ?? 1),
      rotation: Number(op.rotation ?? 0),
      clip: (op.clip as XrefClipRect | null) ?? null,
    });
    return { status: 'applied', handles: [], message: null };
  }

  private opXrefClip(op: StoredOperation): OpOutcome {
    const name = String(op.name ?? '');
    const xref = this.model.xrefs.find((x) => x.name === name);
    if (!xref) return { status: 'dropped', handles: [], message: null };
    const rect = op.rect as Array<[number, number, number, number]> | null | undefined;
    xref.clip = rect ?? null;
    return { status: 'applied', handles: [], message: null };
  }

  private opXrefReload(op: StoredOperation): OpOutcome {
    void op;
    return { status: 'applied', handles: [], message: null };
  }

  private opXrefBind(op: StoredOperation): OpOutcome {
    void op;
    return { status: 'applied', handles: [], message: null };
  }

  // Restoring makes the model equal to that version's model, with entities
  // coming back with their handles.
  private restoreSnapshot: { entities: Record<string, Entity>; order: string[] } | null = null;

  setRestoreSnapshot(snapshot: { entities: Record<string, Entity>; order: string[] }): void {
    this.restoreSnapshot = snapshot;
  }

  private opVersionRestore(op: StoredOperation): OpOutcome {
    if (!this.restoreSnapshot) {
      this.pendingRestoreVersion = String(op.version ?? '');
      return { status: 'applied', handles: [], message: null };
    }
    const restored = this.restoreSnapshot;
    this.model.entities = structuredClone(restored.entities);
    this.model.order = [...restored.order];
    return { status: 'applied', handles: [...restored.order], message: null };
  }

  private pendingRestoreVersion: string | null = null;

  takePendingRestore(): string | null {
    return this.pendingRestoreVersion;
  }

  recordHistory(handle: string, context: ApplyContext): void {
    this.history.push({ handle, revision: context.baseRevision, username: context.author, command: context.command, at: context.now });
    this.recentAuthors.set(handle, context.author);
  }

  readonly history: Array<{ handle: string; revision: number; username: string; command: string; at: Date }> = [];

  // The last author of each handle, used by the conflict rules.
  private readonly recentAuthors = new Map<string, string>();

  noteAuthor(handle: string, username: string): void {
    this.recentAuthors.set(handle, username);
  }

  // Conflict rule: the later change in server order wins; earlier base is rebased.
  rebase(entity: Entity, base: Entity | undefined, move: { dx: number; dy: number }): Entity {
    const from = base ?? entity;
    return moveEntity(from, round6(move.dx), round6(move.dy));
  }

  hatchBoundary(seed: Pt): { handles: string[]; area: number; polygon: Pt[] } | null {
    const boundary = findHatchBoundary(this.model, seed);
    if (!boundary) return null;
    return { handles: boundary.handles, area: boundary.area, polygon: boundary.outer };
  }

  refreshAssociations(): void {
    for (const handle of this.model.order) {
      const entity = this.model.entities[handle];
      if (!entity) continue;
      if (entity.type === 'hatch') {
        const resolved = entity as ResolvedHatch;
        const boundary = findHatchBoundary(this.model, { x: entity.seed_x, y: entity.seed_y });
        resolved.associative = Boolean(boundary);
        resolved.area = boundary ? boundary.area : resolved.area ?? 0;
        resolved.polygon = boundary ? boundary.outer : resolved.polygon ?? [];
        resolved.boundary_handles = boundary ? boundary.handles : resolved.boundary_handles ?? [];
      }
      if (entity.type === 'dimension') {
        const resolved = entity as ResolvedDimension;
        resolved.associative = dimensionAssociative(this.model, entity.refs);
        resolved.value = dimensionValue(this.model, entity.kind, entity.refs);
      }
    }
  }
}

type XrefClipRect = Array<[number, number, number, number]>;

type ResolvedHatch = Extract<ResolvedEntity, { type: 'hatch' }>;
type ResolvedDimension = Extract<ResolvedEntity, { type: 'dimension' }>;

function namesOf(entities: Entity[]): Set<string> {
  const names = new Set<string>();
  for (const entity of entities) {
    if (entity.type === 'insert') names.add(entity.block);
  }
  return names;
}

function wouldContainsChain(chain: string[], name: string): string[] {
  const index = chain.indexOf(name);
  return index >= 0 ? [...chain.slice(index), name] : chain;
}

export function handleNumber(handle: string): number {
  const match = handle.match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function colourOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && (LAYER_COLOURS as readonly string[]).includes(value) ? value : fallback;
}

function linetypeOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && (LINETYPES as readonly string[]).includes(value) ? value : fallback;
}

function lineweightOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && (LINEWEIGHTS as readonly number[]).includes(value) ? value : fallback;
}

export function emptyModelWithDefaults(): DrawingModel {
  return createEmptyModel();
}

export { entityBounds };
