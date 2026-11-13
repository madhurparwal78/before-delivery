// Test support: a miniature server around applyGroup that keeps the change log the conflict probe and the undo stacks read.
import { ApiError } from '../errors.ts';
import type { ArcEntity, CircleEntity, DistributiveOmit, DrawingState, Entity, EntityDraft, InsertEntity, Layer, LineEntity, Op, PlineEntity } from '../types.ts';
import { ChangeLog } from './changelog.ts';
import { applyGroup, applyRestore, findSuperseded, seedDrawing } from './index.ts';
import type { Change, DrawingSeed, RestoreDirection, EngineEnv, GroupOutcome, Notice, SeedEntity } from './index.ts';

let counter = 0;
export type OpInput = DistributiveOmit<Op, 'op_id'>;
export const withIds = (ops: readonly OpInput[]): Op[] => ops.map((op): Op => ({ ...op, op_id: `op${(counter += 1)}` }));

export const layer = (name: string, extra: Partial<Layer> = {}): Layer =>
  ({ name, colour: 'white', linetype: 'Continuous', lineweight: 0.25, on: true, frozen: false, locked: false, ...extra });
export const line = (handle: string, x1: number, y1: number, x2: number, y2: number, layerName = '0'): LineEntity =>
  ({ type: 'line', handle, layer: layerName, x1, y1, x2, y2 });
export const circle = (handle: string, cx: number, cy: number, r: number, layerName = '0'): CircleEntity =>
  ({ type: 'circle', handle, layer: layerName, cx, cy, r });
export const arc = (handle: string, cx: number, cy: number, r: number, start: number, end: number, layerName = '0'): ArcEntity =>
  ({ type: 'arc', handle, layer: layerName, cx, cy, r, start, end });
export const pline = (handle: string, points: [number, number][], closed: boolean, layerName = '0'): PlineEntity =>
  ({ type: 'pline', handle, layer: layerName, points, closed });
export const insert = (handle: string, block: string, x: number, y: number, scale = 1, rotation = 0, attributes: Record<string, string> = {}): InsertEntity =>
  ({ type: 'insert', handle, layer: '0', block, x, y, scale, rotation, attributes });
export const dimension = (handle: string, kind: 'linear' | 'aligned' | 'angular' | 'radial', refs: { handle: string; point?: 'start' | 'end' | 'centre' | null }[]): SeedEntity =>
  ({ type: 'dimension', handle, layer: '0', kind, style: 'Standard', refs, override: null, text_x: 0, text_y: 0 });
export const hatch = (handle: string, x: number, y: number): SeedEntity => ({ type: 'hatch', handle, layer: '0', seed_x: x, seed_y: y });
export const draft = (entity: SeedEntity): EntityDraft => {
  const { handle: _handle, ...rest } = entity;
  return rest;
};
export const add = (entity: SeedEntity): OpInput => ({ type: 'add', entity: draft(entity) });

interface LogEntry { user: string; revision: number; command: string; changes: Change[] }
interface Stack { undo: LogEntry[]; redo: LogEntry[] }

export class Harness {
  state: DrawingState;
  /** what the server's change log would answer: other people's changes and entities at a revision */
  readonly probe: ChangeLog = new ChangeLog(() => this.state, Number.POSITIVE_INFINITY);
  private readonly stacks = new Map<string, Stack>();
  readonly notices: Notice[] = [];
  env: Pick<EngineEnv, 'loaders'> = {};

  constructor(seed: DrawingSeed = {}) {
    this.state = seedDrawing(seed);
  }

  private stack(user: string): Stack {
    let stack = this.stacks.get(user);
    if (!stack) {
      stack = { undo: [], redo: [] };
      this.stacks.set(user, stack);
    }
    return stack;
  }

  private commit(user: string, command: string, outcome: GroupOutcome): LogEntry {
    this.state = outcome.state;
    this.notices.push(...outcome.notices);
    this.probe.record(outcome.changes, user, outcome.state.revision);
    return { user, revision: outcome.state.revision, command, changes: outcome.changes };
  }

  /** A group from `user` made at `base` (default: the current revision). Throws `ApiError` like the server would answer. */
  apply(user: string, ops: readonly OpInput[], options: { base?: number; command?: string } = {}): GroupOutcome {
    const command = options.command ?? 'EDIT';
    const outcome = applyGroup(this.state, { base_revision: options.base ?? this.state.revision, group_id: `g${(counter += 1)}`, command, ops: withIds(ops) },
      { username: user, conflicts: this.probe, ...this.env });
    const entry = this.commit(user, command, outcome);
    const stack = this.stack(user);
    if (outcome.changes.length > 0) stack.undo.push(entry);
    stack.redo = [];
    return outcome;
  }

  undo(user: string, direction: RestoreDirection = 'undo'): string {
    const from = this.stack(user)[direction];
    const entry = from[from.length - 1];
    if (!entry) throw new ApiError(direction === 'undo' ? 'nothing_to_undo' : 'nothing_to_redo', direction);
    const superseded = findSuperseded(entry.changes, user, entry.revision, this.probe);
    if (superseded) {
      from.pop();
      throw new ApiError('undo_superseded', `Can't undo: ${superseded.user} changed ${superseded.target} after you.`);
    }
    const outcome = applyRestore(this.state, entry.changes, direction, { username: user });
    from.pop();
    const done = this.commit(user, entry.command, outcome);
    this.stack(user)[direction === 'undo' ? 'redo' : 'undo'].push({ ...entry, revision: done.revision });
    return entry.command;
  }

  get entities(): Record<string, Entity> {
    return this.state.entities;
  }
}

