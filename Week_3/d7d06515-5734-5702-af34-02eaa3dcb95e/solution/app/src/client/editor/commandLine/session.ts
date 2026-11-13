// Binds the pure command-line machine to the editor: builds its environment, runs its effects and says what happened.
import type { CommandName } from '../../../shared/commands.ts';
import { formatLength } from '../../../shared/format.ts';
import { pickObject, visibleLayerNames } from '../../../shared/geometry.ts';
import type { ApiObject, CommandSuccess, Layer, Point } from '../../../shared/types.ts';
import { ApiError, post } from '../../api.ts';
import { announce } from '../../ui/announce.tsx';
import { WHEEL_STEP } from '../canvas/camera.ts';
import { constrain, snapNow } from '../canvas/snap.ts';
import type { EditorStore } from '../store.ts';
import {
  anchorOf, expects, startCommand, step, type Effect, type Env, type InsertPresets, type Input, type Step, type Target,
} from './machine.ts';

const COMMAND_FAILED = 'The command could not be completed.';

/** The lines to show for a failed API call: the server's field messages, or a plain failure. */
export function describeError(error: unknown): string[] {
  if (!(error instanceof ApiError)) throw error;
  const messages = Object.values(error.fields);
  return messages.length > 0 ? messages : [COMMAND_FAILED];
}

const hintOf = (object: ApiObject): Point =>
  object.snaps.midpoint[0] ?? object.snaps.endpoint[0] ?? object.snaps.center[0] ?? [0, 0];

/** The nearest selectable object, as the API object the pick was made among. */
function pickIn(objects: ApiObject[], layers: Layer[], point: Point, tolerance: number): ApiObject | undefined {
  const picked = pickObject(objects, layers, point, tolerance);
  return objects.find((candidate) => candidate.handle === picked?.handle);
}

export class Session {
  constructor(private readonly store: EditorStore) {}

  /** What the machine may act on: selectable objects, and the access rules of this person. */
  environment(): Env {
    const { drawing, activeTrace, trial } = this.store.current;
    const trace = activeTrace?.state === 'open' ? activeTrace : null;
    const base = drawing?.objects ?? [];
    const layers = drawing?.layers ?? [];
    const visible = visibleLayerNames(layers);
    const target = (object: ApiObject, inTrace: boolean): Target => ({ handle: object.handle, inTrace, hint: hintOf(object) });
    return {
      units: drawing?.units ?? 'mm',
      access: drawing?.access ?? 'view',
      trialEnded: trial?.ended ?? false,
      trace: trace !== null,
      lookup: (handle) => {
        const own = trace?.objects.find((object) => object.handle === handle);
        if (own) return target(own, true);
        const object = base.find((candidate) => candidate.handle === handle);
        return object && visible.has(object.layer) ? target(object, false) : null;
      },
      pick: (point, tolerance) => {
        const own = trace ? pickIn(trace.objects, layers, point, tolerance) : undefined;
        if (own) return target(own, true);
        const object = pickIn(base, layers, point, tolerance);
        return object ? target(object, false) : null;
      },
    };
  }

  start(name: CommandName, presets?: InsertPresets): void {
    this.store.focusCommandLine();
    this.apply(startCommand(this.store.current.machine, name, this.environment(), presets ?? null));
  }

  /** A line from the command box (Enter or Space). */
  submit(text: string): void {
    const machine = this.store.current.machine;
    if (text === '' && expects(machine) === 'point') {
      const snap = snapNow(this.store);
      if (snap) {
        this.pick(snap.point, 0);
        return;
      }
    }
    this.run({ kind: 'line', text });
  }

  /** A point picked on the canvas; `tolerance` is the pick distance in model millimetres. */
  pick(point: Point, tolerance: number): void {
    this.store.hud.update({ cleared: true });
    this.run({ kind: 'point', point, tolerance });
  }

  escape(): void {
    if (this.store.current.machine.running) this.run({ kind: 'escape' });
    else if (this.store.current.playback) this.store.endPlayback();
    else if (this.store.current.selection.length > 0) this.store.select([]);
  }

  /** The picked point after the drafting aids have had their say. */
  constrained(raw: Point): Point {
    return constrain(raw, this.store.current.aids, anchorOf(this.store.current.machine));
  }

  private run(input: Input): void {
    this.apply(step(this.store.current.machine, input, this.environment()));
  }

  private apply({ state, effects }: Step): void {
    if (state.running && !this.store.current.machine.running) this.store.clearWayToCanvas();
    this.store.setMachine(state);
    for (const effect of effects) this.perform(effect);
  }

  private perform(effect: Effect): void {
    switch (effect.type) {
      case 'history': this.store.pushHistory(effect.line); break;
      case 'select': this.store.select(effect.handles); break;
      case 'panel': this.store.showPanel(effect.panel); break;
      case 'zoom': this.zoom(effect.mode); break;
      case 'measure': void this.measure(effect.first, effect.second); break;
      case 'send': void this.send(effect); break;
    }
  }

  private zoom(mode: 'extents' | 'in' | 'out'): void {
    if (mode === 'extents') this.store.fitView();
    else this.store.camera.zoomBy(mode === 'in' ? WHEEL_STEP : 1 / WHEEL_STEP);
  }

  private async measure(first: Point, second: Point): Promise<void> {
    const drawing = this.store.current.drawing;
    if (!drawing) return;
    try {
      const { text } = await post<{ text: string }>(`/api/drawings/${drawing.id}/measure`, { first, second });
      this.store.pushHistory(text);
      announce(`${text} (${drawing.units === 'm' ? 'meters' : 'millimeters'})`);
    } catch (error) {
      this.failed(error);
    }
  }

  private async send(effect: Extract<Effect, { type: 'send' }>): Promise<void> {
    try {
      if (effect.target === 'trace') {
        await this.store.runTraceCommand(effect.command, effect.args);
        return;
      }
      const result = await this.store.runCommand(effect.command, effect.args);
      if (result) this.said(effect.command, result);
    } catch (error) {
      this.failed(error);
    }
  }

  private failed(error: unknown): void {
    if (error instanceof ApiError && (error.code === 'link_expired' || error.code === 'link_revoked')) {
      this.store.linkEnded(error.code === 'link_expired' ? 'expired' : 'revoked');
      return;
    }
    for (const line of describeError(error)) this.store.pushHistory(line);
  }

  /** The announcements a finished command makes (brief: Feedback states > Announcements). */
  private said(command: string, result: CommandSuccess): void {
    const units = this.store.current.drawing?.units ?? 'mm';
    for (const object of result.objects) {
      if (command === 'INSERT' && object.type === 'insert') {
        announce(`Block ${object.block} inserted at ${formatLength(object.position[0], units)}, ${formatLength(object.position[1], units)}.`);
      } else if (command.startsWith('DIM') && object.type === 'dimension') {
        announce(`Dimension added: ${object.text}`);
      }
    }
  }
}
