import type { DrawingState, Entity } from '../types.ts';
import type { Change, ConflictProbe, TargetKind } from './index.ts';

/**
 * One group's touch of one target. `entityBefore` is kept only for entities, and only while a client may still ask for the entity as
 * it was at a base revision (`opWindow` behind); after that it is let go.
 */
interface Touch { revision: number; username: string; derived: boolean; entityBefore?: Entity | null }

const targetId = (kind: TargetKind, key: string): string => `${kind}\u0000${key}`;

/**
 * The drawing's change log in memory, in the form the Conflict rules and the Per-person undo rule ask for it: who touched a target
 * after a revision, and what an entity looked like at a revision. The revision of a touch is the drawing revision after its group.
 */
export class ChangeLog implements ConflictProbe {
  private readonly touches = new Map<string, Touch[]>();

  constructor(private readonly current: () => DrawingState, private readonly opWindow: number) {}

  /** Adds a touch read from the stored log. `entityBefore` is given only for groups still inside the window. */
  add(kind: TargetKind, key: string, touch: Touch): void {
    const id = targetId(kind, key);
    const list = this.touches.get(id);
    if (list) list.push(touch);
    else this.touches.set(id, [touch]);
  }

  /** Records what a committed group changed. */
  record(changes: readonly Change[], username: string, revision: number): void {
    for (const change of changes) {
      this.add(change.kind, change.key, {
        revision, username, derived: change.derived, ...(change.kind === 'entity' ? { entityBefore: change.before } : {}),
      });
      if (change.kind === 'entity') this.releaseOld(change.key, revision);
    }
  }

  otherChangeSince(kind: TargetKind, key: string, user: string, revision: number): { user: string; revision: number } | null {
    const list = this.touches.get(targetId(kind, key)) ?? [];
    for (let i = list.length - 1; i >= 0 && list[i].revision > revision; i--) {
      if (!list[i].derived && list[i].username !== user) return { user: list[i].username, revision: list[i].revision };
    }
    return null;
  }

  entityAt(handle: string, revision: number): Entity | null {
    const list = this.touches.get(targetId('entity', handle)) ?? [];
    const next = list.find((touch) => touch.revision > revision);
    if (next) return next.entityBefore ?? null;
    return this.current().entities[handle] ?? null;
  }

  private releaseOld(handle: string, revision: number): void {
    for (const touch of this.touches.get(targetId('entity', handle)) ?? []) {
      if (touch.revision > revision - this.opWindow) break;
      delete touch.entityBefore;
    }
  }
}
