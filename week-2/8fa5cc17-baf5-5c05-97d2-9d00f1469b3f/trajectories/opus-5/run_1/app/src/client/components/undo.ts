import { Op, diffToOps } from '../../shared/ops';
import { COPY, redoneCopy, undoneCopy } from '../../shared/copy';
import { UNDO_COALESCE_MS, UNDO_STACK_LIMIT } from '../../shared/motion';
import { frame } from '../frame';

export type StepKind =
  | 'typing'
  | 'new block'
  | 'block deletion'
  | 'block move'
  | 'quote'
  | 'quote removal'
  | 'restore';

export type Outcome = { ok: true; version?: number } | { ok: false; reason: 'conflict' | 'gone' };

export type TypingRecord = {
  blockId: string;
  beforeText: string;
  afterText: string;
  version: number;
  caretEnd: number;
  isDelete: boolean;
  time: number;
};

type Step =
  | { kind: 'typing'; typing: TypingRecord }
  | { kind: StepKind; undo: () => Promise<Outcome>; redo: () => Promise<Outcome> };

export type TypingExecutor = (blockId: string, ops: Op[], baseVersion: number) => Promise<Outcome>;

/** Undo and redo belong to the tab, hold the newest 100 steps and are never stored. */
export class UndoStack {
  private undoSteps: Step[] = [];
  private redoSteps: Step[] = [];

  constructor(private readonly applyTyping: TypingExecutor) {}

  pushTyping(record: Omit<TypingRecord, 'time'>): void {
    const now = performance.now();
    const last = this.undoSteps[this.undoSteps.length - 1];
    if (
      last !== undefined &&
      last.kind === 'typing' &&
      'typing' in last &&
      last.typing.blockId === record.blockId &&
      last.typing.isDelete === record.isDelete &&
      now - last.typing.time < UNDO_COALESCE_MS &&
      last.typing.caretEnd === startOffsetOf(record.beforeText, record.afterText)
    ) {
      last.typing.afterText = record.afterText;
      last.typing.version = record.version;
      last.typing.caretEnd = record.caretEnd;
      last.typing.time = now;
      this.redoSteps = [];
      return;
    }
    this.push({ kind: 'typing', typing: { ...record, time: now } });
  }

  push(step: Step): void {
    this.undoSteps.push(step);
    if (this.undoSteps.length > UNDO_STACK_LIMIT) this.undoSteps.shift();
    this.redoSteps = [];
  }

  async undo(): Promise<void> {
    const step = this.undoSteps.pop();
    if (step === undefined) {
      frame().announce(COPY.nothingToUndo);
      return;
    }
    const outcome = await this.run(step, 'undo');
    if (!outcome.ok) {
      frame().showAlert(outcome.reason === 'conflict' ? COPY.undoConflict : COPY.undoGoneOrigin);
      return;
    }
    this.redoSteps.push(step);
    frame().announce(undoneCopy(step.kind));
  }

  async redo(): Promise<void> {
    const step = this.redoSteps.pop();
    if (step === undefined) {
      frame().announce(COPY.nothingToRedo);
      return;
    }
    const outcome = await this.run(step, 'redo');
    if (!outcome.ok) {
      frame().showAlert(outcome.reason === 'conflict' ? COPY.redoConflict : COPY.redoGoneOrigin);
      return;
    }
    this.undoSteps.push(step);
    frame().announce(redoneCopy(step.kind));
  }

  private async run(step: Step, direction: 'undo' | 'redo'): Promise<Outcome> {
    if (step.kind === 'typing' && 'typing' in step) {
      const record = step.typing;
      const ops =
        direction === 'undo'
          ? diffToOps(record.afterText, record.beforeText)
          : diffToOps(record.beforeText, record.afterText);
      if (ops.length === 0) return { ok: true };
      const outcome = await this.applyTyping(record.blockId, ops, record.version);
      if (outcome.ok && outcome.version !== undefined) record.version = outcome.version;
      return outcome;
    }
    if ('undo' in step) return direction === 'undo' ? step.undo() : step.redo();
    return { ok: true };
  }
}

let activeStack: UndoStack | null = null;

/** The text column's undo stack of the screen now open. */
export function setActiveUndoStack(stack: UndoStack | null): void {
  activeStack = stack;
}

export function activeUndoStack(): UndoStack | null {
  return activeStack;
}

function startOffsetOf(before: string, after: string): number {
  let index = 0;
  const limit = Math.min(before.length, after.length);
  while (index < limit && before.charAt(index) === after.charAt(index)) index += 1;
  return index;
}
