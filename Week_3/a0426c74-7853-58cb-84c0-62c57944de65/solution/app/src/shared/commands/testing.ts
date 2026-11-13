// Test support: a page in miniature around a CommandSession. It plays the store's part: it builds the environment from a drawing
// state, applies the submitted group with the engine (as the browser does optimistically), and reopens the stage when the engine refuses.
import { ApiError } from '../errors.ts';
import { buildScene, type Scene } from '../geometry/index.ts';
import { applyGroup, isServerOnlyOp, seedDrawing, type DrawingSeed } from '../model/index.ts';
import type { DrawingState, Entity, OperationGroup, Point, Role } from '../types.ts';
import { ownAnnouncement } from './announce.ts';
import type { CommandEnv } from './env.ts';
import { CommandSession, type CommandUpdate } from './session.ts';
import type { FocusTarget } from './stages.ts';

export interface BenchOptions {
  role?: Role;
  phone?: boolean;
  layer?: string;
  selection?: string[];
  /** screen px per world unit; the aperture is 10 px */
  zoom?: number;
  drawings?: CommandEnv['drawings'];
  host?: CommandEnv['host'];
}

/** The two end points of a line, sorted so that two lines can be compared whichever way they were drawn. */
export function endsOf(entity: Entity): Point[] {
  if (entity.type !== 'line') throw new Error(`${entity.handle} is not a line`);
  const start: Point = [entity.x1, entity.y1];
  const end: Point = [entity.x2, entity.y2];
  return [start, end].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

export class Bench {
  readonly session = new CommandSession();
  readonly groups: OperationGroup[] = [];
  readonly announcements: string[] = [];
  readonly focuses: FocusTarget[] = [];
  readonly views: 'zoomall'[] = [];
  state: DrawingState;
  update: CommandUpdate;
  options: BenchOptions;
  private scene: Scene;
  private counter = 0;

  constructor(seed: DrawingSeed = {}, options: BenchOptions = {}) {
    this.state = seedDrawing(seed);
    this.scene = buildScene(this.state);
    this.options = options;
    this.update = this.session.feed({ kind: 'text', text: '', terminator: 'enter' }, this.env());
  }

  env(): CommandEnv {
    const { role = 'edit', phone = false, layer = '0', selection = [], zoom = 10, drawings = [], host = { id: 'host', name: 'Host' } } = this.options;
    return {
      state: this.state, scene: this.scene, view: { zoom, panX: 0, panY: 0 }, username: 'a', role, phone, layer, selection, drawings, host,
      newOpId: () => `op${(this.counter += 1)}`,
    };
  }

  /** What `status "Command prompt"` reads. */
  get promptText(): string {
    return this.update.text;
  }

  /** The last announcement, or null. */
  get announced(): string | null {
    return this.announcements[this.announcements.length - 1] ?? null;
  }

  private deliver(update: CommandUpdate): CommandUpdate {
    this.update = update;
    if (update.focus) this.focuses.push(update.focus);
    if (update.view) this.views.push(update.view);
    if (update.submit) this.apply(update.submit);
    return this.update;
  }

  /** Like the store: a group with an op that needs server data is only sent, the rest is applied at once and refused when the engine says so. */
  private apply(group: OperationGroup): void {
    if (group.ops.some(isServerOnlyOp)) {
      this.groups.push(group);
      this.session.accept();
      return;
    }
    try {
      const outcome = applyGroup(this.state, group, { username: 'a' });
      const before = this.state;
      this.state = outcome.state;
      this.scene = buildScene(this.state);
      this.session.accept();
      this.groups.push(group);
      const sentence = ownAnnouncement(group, outcome.results, before);
      if (sentence) this.announcements.push(sentence);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      this.update = this.session.refuse(error.message);
    }
  }

  /** Types `text` and ends it with Enter or Space. */
  type(text: string, terminator: 'enter' | 'space' = 'enter'): CommandUpdate {
    return this.deliver(this.session.feed({ kind: 'text', text, terminator }, this.env()));
  }

  /** Like the browser tests' run(): every entry is typed, then Enter is pressed; an empty entry is only Enter. */
  run(...entries: string[]): void {
    for (const entry of entries) this.type(entry);
  }

  click(point: Point): CommandUpdate {
    return this.deliver(this.session.feed({ kind: 'point', point }, this.env()));
  }

  escape(): CommandUpdate {
    return this.deliver(this.session.feed({ kind: 'escape' }, this.env()));
  }

  entity(handle: string): Entity {
    return this.state.entities[handle];
  }

  ends(handle: string): Point[] {
    return endsOf(this.entity(handle));
  }

  /** Handles that exist now and did not exist in `before`, in handle order. */
  created(before: DrawingState): string[] {
    return Object.keys(this.state.entities).filter((handle) => !(handle in before.entities));
  }
}
