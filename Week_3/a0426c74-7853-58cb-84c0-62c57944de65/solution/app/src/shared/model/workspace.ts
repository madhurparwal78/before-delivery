// A copy-on-write view of a DrawingState while a group is applied. Collections are copied shallowly on their first write, records
// are replaced and never mutated; the first value of every touched key is remembered so the net Change per target can be built.
import type { BlockDef, Constraint, DimStyle, DrawingState, Entity, Layer, LayerState, Parameter, Underlay, Xref } from '../types.ts';
import type { Change, TargetChange, TargetKind, TargetValue } from './index.ts';

export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  if (keysA.length !== Object.keys(b).length) return false;
  const other: Record<string, unknown> = { ...b };
  return keysA.every((key) => key in other && sameValue((a as Record<string, unknown>)[key], other[key]));
}

export class Table<V> {
  private data: Record<string, V>;
  private owned = false;
  private readonly first = new Map<string, V | null>();

  constructor(private readonly origin: Record<string, V>) {
    this.data = origin;
  }

  get(key: string): V | undefined {
    return Object.hasOwn(this.data, key) ? this.data[key] : undefined;
  }

  has(key: string): boolean {
    return Object.hasOwn(this.data, key);
  }

  keys(): string[] {
    return Object.keys(this.data);
  }

  values(): V[] {
    return Object.values(this.data);
  }

  get record(): Record<string, V> {
    return this.data;
  }

  get touched(): ReadonlyMap<string, V | null> {
    return this.first;
  }

  set(key: string, value: V): void {
    this.remember(key);
    this.data[key] = value;
  }

  delete(key: string): void {
    this.remember(key);
    delete this.data[key];
  }

  private remember(key: string): void {
    if (!this.owned) {
      this.data = { ...this.origin };
      this.owned = true;
    }
    if (!this.first.has(key)) this.first.set(key, Object.hasOwn(this.origin, key) ? this.origin[key] : null);
  }
}

const constraintNumber = (c: Constraint): number => Number(c.id.slice(1));
const byIdNumber = (a: Constraint, b: Constraint): number => constraintNumber(a) - constraintNumber(b);

const keyed = <V>(list: V[], key: (v: V) => string): Record<string, V> => Object.fromEntries(list.map((v) => [key(v), v]));

export class Workspace {
  readonly entities: Table<Entity>;
  readonly layers: Table<Layer>;
  readonly blocks: Table<BlockDef>;
  readonly dimStyles: Table<DimStyle>;
  readonly parameters: Table<Parameter>;
  readonly constraints: Table<Constraint>;
  readonly xrefs: Table<Xref>;
  readonly layerStates: Table<LayerState>;
  readonly underlays: Table<Underlay>;
  nextHandle: number;

  constructor(readonly origin: DrawingState) {
    this.entities = new Table(origin.entities);
    this.layers = new Table(origin.layers);
    this.blocks = new Table(origin.blocks);
    this.dimStyles = new Table(origin.dim_styles);
    this.parameters = new Table(origin.parameters);
    this.constraints = new Table(keyed(origin.constraints, (c) => c.id));
    this.xrefs = new Table(origin.xrefs);
    this.layerStates = new Table(origin.layer_states);
    this.underlays = new Table(keyed(origin.underlays, (u) => u.id));
    this.nextHandle = origin.next_handle;
  }

  /** The state with the group's revision; untouched collections are the origin's own objects. */
  state(revision: number): DrawingState {
    const o = this.origin;
    return {
      revision,
      next_handle: this.nextHandle,
      layers: this.layers.touched.size > 0 ? this.layers.record : o.layers,
      entities: this.entities.touched.size > 0 ? this.entities.record : o.entities,
      blocks: this.blocks.touched.size > 0 ? this.blocks.record : o.blocks,
      dim_styles: this.dimStyles.touched.size > 0 ? this.dimStyles.record : o.dim_styles,
      parameters: this.parameters.touched.size > 0 ? this.parameters.record : o.parameters,
      constraints: this.constraints.touched.size > 0 ? this.constraints.values().sort(byIdNumber) : o.constraints,
      xrefs: this.xrefs.touched.size > 0 ? this.xrefs.record : o.xrefs,
      layer_states: this.layerStates.touched.size > 0 ? this.layerStates.record : o.layer_states,
      underlays: this.underlays.touched.size > 0 ? this.underlays.values() : o.underlays,
    };
  }

  /** Net change per touched target, in first-touch order, skipping targets that ended up as they began. */
  changes(derivedEntities: ReadonlySet<string>): Change[] {
    return [
      ...tableChanges('entity', this.entities, derivedEntities),
      ...tableChanges('layer', this.layers),
      ...tableChanges('block', this.blocks),
      ...tableChanges('dim_style', this.dimStyles),
      ...tableChanges('parameter', this.parameters),
      ...tableChanges('constraint', this.constraints),
      ...tableChanges('xref', this.xrefs),
      ...tableChanges('layer_state', this.layerStates),
      ...tableChanges('underlay', this.underlays),
    ];
  }
}

function tableChanges<K extends TargetKind>(kind: K, table: Table<TargetValue[K]>, derivedKeys: ReadonlySet<string> = new Set()): TargetChange<K>[] {
  const out: TargetChange<K>[] = [];
  for (const [key, before] of table.touched) {
    const after = table.get(key) ?? null;
    if (!sameValue(before, after)) out.push({ kind, key, before, after, derived: derivedKeys.has(key) });
  }
  return out;
}
