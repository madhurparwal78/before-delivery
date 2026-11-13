/** Pointer-driven state of a stage: cursor tilt, light focus and hover progress, stepped by the page clock. */
import {
  advanceHover,
  FollowEngine,
  hoverProgress,
  type FollowConfig,
  type FollowSnapshot,
} from '../../shared/evaluator/follow';
import { bool, easingOf, num } from '../../shared/evaluator/resolve';
import type { Assets } from '../../shared/evaluator/solids';
import { ARTBOARDS, type Breakpoint, type Json } from '../../shared/types';
import { SOLID_KIND_SET, type Dynamics, type Prepared } from './display';
import { overSolid } from './interaction';

interface DynamicsInput {
  prepared: Prepared | null;
  assets: Assets;
  breakpoint: Breakpoint;
  lightEnabled: boolean;
  lightMomentum: number;
  reduced: boolean;
  /** Whether the pointer drives anything (Preview on in the editor, always in the embed). */
  active: boolean;
}

function configOf(input: DynamicsInput): FollowConfig {
  const tilts = (input.prepared?.scenery.layers ?? [])
    .filter((rl) => rl.layer.kind !== 'Group')
    .map((rl) => ({
      id: rl.layer.id,
      enabled: bool(rl.values, 'events.tilt.enabled'),
      maxTilt: num(rl.values, 'events.tilt.maxTilt', 12),
      sensitivity: num(rl.values, 'events.tilt.sensitivity', 1),
      momentum: num(rl.values, 'events.tilt.momentum', 1),
    }));
  return { tilts, light: { enabled: input.lightEnabled, momentum: input.lightMomentum }, reduced: input.reduced };
}

interface DynamicsStep {
  /** Something moved since the last step, so the stage needs a redraw. */
  moved: boolean;
  snapshot: FollowSnapshot;
  dynamics: Dynamics;
}

export class StageDynamics {
  readonly follow = new FollowEngine();
  private readonly hoverMs = new Map<string, number>();
  private last: number | null = null;

  reset(): void {
    this.follow.reset();
    this.hoverMs.clear();
    this.last = null;
  }

  step(now: number, input: DynamicsInput): DynamicsStep {
    const config = configOf(input);
    const dt = this.last === null ? 0 : Math.min(Math.max(now - this.last, 0), 100);
    this.last = now;
    let moved = false;
    const hover = new Map<string, number>();
    if (input.active) {
      moved = this.follow.tick(now, config);
      const pointer = this.follow.pointerPosition;
      const board = ARTBOARDS[input.breakpoint];
      const x = pointer ? ((pointer.n + 1) / 2) * board.width : 0;
      const y = pointer ? ((pointer.m + 1) / 2) * board.height : 0;
      for (const rl of input.prepared?.scenery.layers ?? []) {
        if (rl.layer.kind === 'Group' || input.reduced || !bool(rl.values, 'events.hover.enabled')) continue;
        const settings = {
          durationMs: num(rl.values, 'events.hover.durationMs', 300),
          delayMs: num(rl.values, 'events.hover.delayMs', 0),
          forwardsOnly: bool(rl.values, 'events.hover.forwardsOnly'),
          easing: easingOf(rl.values['events.hover.easing'] as Json | undefined, 'glide'),
        };
        const over = pointer !== null && input.prepared !== null && SOLID_KIND_SET.has(rl.layer.kind) && overSolid(input.prepared, input.assets, rl.layer.id, x, y);
        const before = this.hoverMs.get(rl.layer.id) ?? 0;
        const after = advanceHover(before, dt, over, settings);
        if (after !== before) {
          this.hoverMs.set(rl.layer.id, after);
          moved = true;
        }
        if (after > 0) hover.set(rl.layer.id, hoverProgress(after, settings));
      }
    }
    const snapshot = this.follow.snapshot(config);
    const tilt = new Map<string, { x: number; y: number }>();
    if (input.active) for (const [id, values] of snapshot.tilt) if (values.x !== 0 || values.y !== 0) tilt.set(id, { x: values.x, y: values.y });
    return { moved, snapshot, dynamics: { tilt, hover } };
  }
}
