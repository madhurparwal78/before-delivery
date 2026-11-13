// The browser's copy of a drawing: the state the server confirmed plus the groups this person made that the server has not confirmed yet.
// What the screen shows is the confirmed state with every unconfirmed group dry-run on top by the same engine the server runs, so a
// remote change or a conflict result is simply a new confirmed state with the rest replayed over it.
import { ApiError } from '../../shared/errors.ts';
import { isOptimisticHandle, optimisticHandle } from '../../shared/geometry/index.ts';
import { applyGroup, applyPatch, isServerOnlyOp } from '../../shared/model/index.ts';
import type { DrawingState, EntityType, Op, OperationGroup, OpResult, StatePatch } from '../../shared/types.ts';

export interface PendingGroup {
  group: OperationGroup;
  /** the optimistic handle counter when the group was first applied, so a replay hands out the same `new-<n>` ids */
  firstHandle: number;
  /** the state the group was dry-run on, for its announcement (BLOCK says defined or redefined) */
  before: DrawingState | null;
  /** the dry run's handles per op (`new-<n>`), which the server's answer replaces */
  optimisticHandles: string[][];
  /** the POST was sent */
  sent: boolean;
  /** the server answered the POST; the group leaves when its `ops` message (the patch) arrives */
  answered: boolean;
}

/** Rewrites the handles an op carries through `mapping` (optimistic handle to real handle). */
function substituteHandles(op: Op, mapping: ReadonlyMap<string, string>): Op {
  const swap = (handle: string): string => mapping.get(handle) ?? handle;
  switch (op.type) {
    case 'modify': case 'explode': return { ...op, handle: swap(op.handle) };
    case 'move': case 'delete': case 'block_define': return { ...op, handles: op.handles.map(swap) };
    case 'add':
      return 'refs' in op.entity ? { ...op, entity: { ...op.entity, refs: op.entity.refs.map((ref) => ({ ...ref, handle: swap(ref.handle) })) } } : op;
    case 'constraint_add': return { ...op, refs: op.refs.map((ref) => ({ ...ref, handle: swap(ref.handle) })) };
    default: return op;
  }
}

export class Replica {
  private confirmedState: DrawingState;
  private shown: DrawingState;
  private queue: PendingGroup[] = [];
  private optimisticCounter = 1;

  constructor(confirmed: DrawingState, private readonly username: string) {
    this.confirmedState = confirmed;
    this.shown = confirmed;
  }

  /** The state the server confirmed. */
  get confirmed(): DrawingState {
    return this.confirmedState;
  }

  /** What the page shows: the confirmed state with the unconfirmed groups on top. */
  get visible(): DrawingState {
    return this.shown;
  }

  get pending(): readonly PendingGroup[] {
    return this.queue;
  }

  /** Operations sent or queued and not yet confirmed. */
  get pendingOps(): number {
    return this.queue.reduce((sum, entry) => sum + entry.group.ops.length, 0);
  }

  /** The counter behind the next optimistic `new-<n>` handle (kept across a reload with the offline queue). */
  get nextOptimistic(): number {
    return this.optimisticCounter;
  }

  /**
   * Dry-runs `group` on the visible state and queues it. Throws the engine's `ApiError` when it is refused, leaving everything as it was.
   * A group with an operation only the server can apply (xref, restore, import) is queued without a dry run and shows once confirmed.
   */
  submit(group: OperationGroup): PendingGroup {
    const entry: PendingGroup = {
      group, firstHandle: this.optimisticCounter, before: this.shown, optimisticHandles: [], sent: false, answered: false,
    };
    if (!group.ops.some(isServerOnlyOp)) {
      const outcome = applyGroup(this.shown, group, { username: this.username, assignHandle: this.handleSource(this.optimisticCounter) });
      entry.optimisticHandles = outcome.results.map((result) => result.handles);
      this.shown = outcome.state;
      this.optimisticCounter = this.counterAfter(entry);
    }
    this.queue.push(entry);
    return entry;
  }

  /** Puts back groups kept from before a reload (offline queue). Groups the current state refuses stay queued and show nothing. */
  restore(groups: readonly Pick<PendingGroup, 'group' | 'firstHandle'>[], nextOptimistic: number): void {
    this.optimisticCounter = nextOptimistic;
    this.queue = groups.map(({ group, firstHandle }) => ({ group, firstHandle, before: null, optimisticHandles: [], sent: false, answered: false }));
    this.rebase();
  }

  /**
   * The server's patch for a group: it joins the confirmed state. `confirmedGroup` is this person's own group in it (it leaves the queue and
   * the optimistic handles of later groups become the real ones); other people's groups pass null. The rest is replayed over the new state.
   */
  settle(patch: StatePatch, confirmedGroup: { groupId: string; results: readonly OpResult[] } | null): void {
    this.confirmedState = applyPatch(this.confirmedState, patch);
    if (confirmedGroup) this.leave(confirmedGroup.groupId, confirmedGroup.results);
    this.rebase();
  }

  /** The server refused or dropped the group: it leaves the queue and the screen falls back to the confirmed state plus the others. */
  drop(groupId: string): PendingGroup | undefined {
    const entry = this.queue.find((candidate) => candidate.group.group_id === groupId);
    if (!entry) return undefined;
    this.queue = this.queue.filter((candidate) => candidate !== entry);
    this.rebase();
    return entry;
  }

  /** Offline undo: the last queued group goes. */
  popLast(): PendingGroup | undefined {
    const entry = this.queue[this.queue.length - 1];
    if (!entry) return undefined;
    return this.drop(entry.group.group_id);
  }

  /** The document was loaded again: it already holds every group the server answered. */
  reset(confirmed: DrawingState): void {
    this.confirmedState = confirmed;
    this.queue = this.queue.filter((entry) => !entry.answered);
    this.rebase();
  }

  private handleSource(start: number): (type: EntityType) => string {
    let counter = start;
    return () => optimisticHandle(counter++);
  }

  private counterAfter(entry: PendingGroup): number {
    const used = entry.optimisticHandles.flat().filter(isOptimisticHandle).length;
    return Math.max(this.optimisticCounter, entry.firstHandle + used);
  }

  /** The group is confirmed: later groups that named its new entities by their optimistic handles now name the real ones. */
  private leave(groupId: string, results: readonly OpResult[]): void {
    const index = this.queue.findIndex((entry) => entry.group.group_id === groupId);
    if (index < 0) return;
    const [entry] = this.queue.splice(index, 1);
    const mapping = new Map<string, string>();
    entry.optimisticHandles.forEach((handles, i) => {
      handles.forEach((handle, k) => {
        const real = results[i]?.handles[k];
        if (isOptimisticHandle(handle) && real !== undefined) mapping.set(handle, real);
      });
    });
    if (mapping.size === 0) return;
    this.queue = this.queue.map((later) => ({ ...later, group: { ...later.group, ops: later.group.ops.map((op) => substituteHandles(op, mapping)) } }));
  }

  /** Replays the queue over the confirmed state; a group the new state refuses (its entity was deleted by someone else) shows nothing. */
  private rebase(): void {
    let state = this.confirmedState;
    for (const entry of this.queue) {
      if (entry.group.ops.some(isServerOnlyOp)) continue;
      try {
        const outcome = applyGroup(state, entry.group, { username: this.username, assignHandle: this.handleSource(entry.firstHandle) });
        entry.optimisticHandles = outcome.results.map((result) => result.handles);
        state = outcome.state;
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
      }
    }
    this.shown = state;
  }
}
