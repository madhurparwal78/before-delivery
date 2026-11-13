// The state of one application: the workspace, the toasts being collected, the environment and the conflict lookups.
import { ApiError } from '../errors.ts';
import { HANDLE_LETTER } from '../types.ts';
import type { DrawingState, Entity, EntityType, OpStatus } from '../types.ts';
import * as copy from '../copy.ts';
import type { EngineEnv, Notice, ServerLoaders, TargetKind } from './index.ts';
import { Workspace } from './workspace.ts';

/** What one op did: its status, the handles it produced or affected and the toast text for `dropped` and `redirected`. */
export interface OpOutcome { status: OpStatus; handles: string[]; message?: string }

export class Context {
  readonly ws: Workspace;
  readonly notices: Notice[] = [];
  /** entities whose only change in this group is a recomputed dimension or hatch value */
  readonly derived = new Set<string>();
  purged: { blocks: number; layers: number } | null = null;
  /** the label an Over-constrained refusal names as the cause: the new constraint or the edited parameter */
  trigger: string | null = null;

  constructor(state: DrawingState, readonly env: EngineEnv, readonly baseRevision: number, readonly command: string) {
    this.ws = new Workspace(state);
  }

  get user(): string {
    return this.env.username;
  }

  notify(username: string, text: string): void {
    this.notices.push({ username, text });
  }

  /** Server data a server-only op needs; the browser never applies those. */
  get loaders(): ServerLoaders {
    if (!this.env.loaders) throw new Error('This operation needs the server loaders');
    return this.env.loaders;
  }

  newHandle(type: EntityType): string {
    if (this.env.assignHandle) return this.env.assignHandle(type);
    const handle = `${HANDLE_LETTER[type]}${this.ws.nextHandle}`;
    this.ws.nextHandle += 1;
    return handle;
  }

  /** Another person's latest change to the target after this group's base revision (Conflict rules). */
  otherChange(kind: TargetKind, key: string): { user: string; revision: number } | null {
    return this.env.conflicts?.otherChangeSince(kind, key, this.user, this.baseRevision) ?? null;
  }

  entityAtBase(handle: string): Entity | null {
    return this.env.conflicts?.entityAt(handle, this.baseRevision) ?? null;
  }

  /** `layer_locked` when the layer is locked. */
  assertUnlocked(layer: string): void {
    if (this.ws.layers.get(layer)?.locked) throw new ApiError('layer_locked', copy.layerLocked(layer));
  }
}
