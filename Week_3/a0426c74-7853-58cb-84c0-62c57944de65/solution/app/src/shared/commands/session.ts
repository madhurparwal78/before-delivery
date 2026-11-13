// The typed command line as a state machine. One session lives as long as the drawing page: it holds the running command's
// stage, the steps U can go back to, the last point entered in any command, and what Enter on an empty line repeats.
import * as copy from '../copy.ts';
import { editRefusal } from '../rules.ts';
import type { EntityDraft, OperationGroup, Point } from '../types.ts';
import { definitionNamed } from './definitions/index.ts';
import type { CommandEnv } from './env.ts';
import { groupOf } from './ops.ts';
import type { Definition, Entry, Expects, FocusTarget, Stage, Step } from './stages.ts';

/** What the page feeds the command line. */
export type CommandInput =
  /** Text typed before Enter or Space. At a stage where Space is a character, Space leaves the text in the box (`consumed` false). */
  | { kind: 'text'; text: string; terminator: 'enter' | 'space' }
  /** A pointer click: the point resolved through Snap, Ortho, Polar and Grid for a point stage, the raw click for a pick stage. */
  | { kind: 'point'; point: Point }
  | { kind: 'escape' };

/** What the page shows and does after an input. */
export interface CommandUpdate {
  /** `status "Command prompt"`: the message while there is one, otherwise the stage prompt, or the Ready prompt. */
  text: string;
  prompt: string;
  /** a refusal, result or note that replaces the prompt until the next key press */
  message: string | null;
  expects: Expects;
  /** a command is waiting for more input */
  running: boolean;
  /** false when the box keeps its text: Space typed at a name, expression or text stage */
  consumed: boolean;
  /** the command ended with this one group to apply (one undo step) */
  submit: OperationGroup | null;
  /** the command ended (with or without a group) */
  done: boolean;
  cancelled: boolean;
  focus: FocusTarget | null;
  view: 'zoomall' | null;
}

interface Trail { stage: Stage; last: Point }
interface Run { definition: Definition; stage: Stage; trail: readonly Trail[] }
/** The run as it stood before the input that ended it, so a refused group can reopen the stage it came from. */
interface Retained { run: Run; last: Point }

const START: Point = [0, 0];

export class CommandSession {
  private run: Run | null = null;
  private last: Point = START;
  private repeat: Definition | null = null;
  private note: string | null = null;
  private retained: Retained | null = null;

  /** The last point entered in any command: `@` forms, Polar, Ortho and the perpendicular and tangent snaps measure from it. */
  get lastPoint(): Point {
    return this.last;
  }

  /** True at the Ready prompt, where U in an empty box is undo. */
  get atReady(): boolean {
    return this.run === null;
  }

  /** True when the box must keep a typed Space: the stage takes a name, an expression or text. */
  get spaceIsCharacter(): boolean {
    return this.run?.stage.expects === 'text';
  }

  /** Any key press ends a transient message, and `Cancelled.` along with it. */
  clearMessage(): void {
    this.note = null;
  }

  feed(input: CommandInput, env: CommandEnv): CommandUpdate {
    this.note = null;
    this.retained = null;
    if (input.kind === 'escape') return this.cancel();
    if (this.run === null) return input.kind === 'text' ? this.atReadyText(input.text.trim(), env) : this.update();
    const entry = this.entryFor(this.run, input);
    if (entry === 'kept') return this.update({ consumed: false });
    if (entry === 'back') return this.stepBack(this.run);
    return this.apply(this.run.stage.accept(entry, env, this.last), this.run, this.run.definition, env);
  }

  /**
   * The group just submitted was refused (the engine's dry run threw `invalid`): the command goes back to the stage before its last
   * input and shows `message` in place of the prompt.
   */
  refuse(message: string): CommandUpdate {
    if (this.retained) {
      this.run = this.retained.run;
      this.last = this.retained.last;
      this.retained = null;
    }
    this.note = message;
    return this.update();
  }

  /** The group just submitted was accepted: the stage it came from is not needed any more. */
  accept(): void {
    this.retained = null;
  }

  /** Rubber-band ghosts for the pointer at `cursor`, from the running stage. */
  preview(cursor: Point, env: CommandEnv): EntityDraft[] {
    return this.run?.stage.preview?.(cursor, env, this.last) ?? [];
  }

  private entryFor(run: Run, input: Exclude<CommandInput, { kind: 'escape' }>): Entry | 'kept' | 'back' {
    if (input.kind === 'point') return { kind: 'point', point: input.point };
    const text = input.text.trim();
    if (run.stage.expects === 'text') return input.terminator === 'space' ? 'kept' : { kind: 'text', text };
    return text.toUpperCase() === 'U' ? 'back' : { kind: 'text', text };
  }

  private atReadyText(text: string, env: CommandEnv): CommandUpdate {
    if (text === '') return this.repeat ? this.begin(this.repeat, env) : this.update();
    const definition = definitionNamed(text);
    if (!definition) {
      this.note = copy.unknownCommand(text);
      return this.update();
    }
    return this.begin(definition, env);
  }

  private begin(definition: Definition, env: CommandEnv): CommandUpdate {
    this.repeat = definition;
    const refusal = definition.edits ? editRefusal(env.role, env.phone) : null;
    if (refusal) {
      this.note = refusal;
      return this.update();
    }
    return this.apply(definition.begin(env), null, definition, env);
  }

  private apply(step: Step, run: Run | null, definition: Definition, env: CommandEnv): CommandUpdate {
    const before = this.last;
    if (step.point) this.last = step.point;
    switch (step.kind) {
      case 'stay':
        this.note = step.message ?? null;
        return this.update();
      case 'next':
        this.run = { definition, stage: step.stage, trail: run ? [...run.trail, { stage: run.stage, last: before }] : [] };
        return this.update();
      case 'finish': {
        this.run = null;
        this.retained = run ? { run, last: before } : null;
        this.note = step.finish.message ?? null;
        return this.update({
          done: true, submit: step.finish.ops.length > 0 ? groupOf(definition.name, step.finish.ops, env) : null, focus: step.finish.focus ?? null, view: step.finish.view ?? null,
        });
      }
    }
  }

  private stepBack(run: Run): CommandUpdate {
    const previous = run.trail[run.trail.length - 1];
    if (previous) {
      this.run = { definition: run.definition, stage: previous.stage, trail: run.trail.slice(0, -1) };
      this.last = previous.last;
    }
    return this.update();
  }

  private cancel(): CommandUpdate {
    const wasRunning = this.run !== null;
    this.run = null;
    this.note = wasRunning ? copy.PROMPT_CANCELLED : null;
    return this.update({ cancelled: wasRunning });
  }

  private update(extra: Partial<Pick<CommandUpdate, 'consumed' | 'submit' | 'done' | 'cancelled' | 'focus' | 'view'>> = {}): CommandUpdate {
    const prompt = this.run?.stage.prompt ?? copy.PROMPT_READY;
    return {
      text: this.note ?? prompt,
      prompt,
      message: this.note,
      expects: this.run?.stage.expects ?? 'command',
      running: this.run !== null,
      consumed: true,
      submit: null,
      done: false,
      cancelled: false,
      focus: null,
      view: null,
      ...extra,
    };
  }
}
