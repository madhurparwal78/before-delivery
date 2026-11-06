// Undo and redo for this tab: the newest 100 steps, never stored. Every step is undone and redone
// through the server, so remote edits made since are transformed, never overwritten.
import { announce, showAlert } from '../feedback.ts';
import { applyToText, composeOps, diffOps, invertOps, transformOffset, transformPair, type Op } from '../../shared/ot.ts';

const MAX_STEPS = 100;
const TYPING_GAP_MS = 1000;

export type StepName = 'typing' | 'new block' | 'block deletion' | 'block move' | 'quote' | 'quote removal' | 'restore';
export type Outcome = 'done' | 'conflict' | 'gone';

/** A step other than typing: how to undo and redo it, each returning the outcome. */
export interface ActionStep { name: Exclude<StepName, 'typing'>; undo: () => Promise<Outcome>; redo: () => Promise<Outcome> }

interface TypingStep {
  name: 'typing';
  id: number;
  blockId: string;
  kind: 'insert' | 'delete';
  /** text before the step, and the step's ops relative to it */
  before: string;
  forward: Op[];
  /** where the caret was left, and when the last edit happened */
  caret: number;
  at: number;
  /** the version the step's last commit produced (the first undo applies to it) */
  version: number | null;
  /** after an undo or redo through the server: the ops of the next redo or undo and their version */
  next: { ops: Op[]; version: number } | null;
}

type Step = TypingStep | (ActionStep & { id: number });

/** Sends one typing undo or redo: ops with the version they apply to; answers with the committed version and edit text. */
export type SendOps = (blockId: string, ops: Op[], baseVersion: number) => Promise<{ outcome: Outcome; version?: number; text?: string }>;

let seq = 0;
const undoStack: Step[] = [];
const redoStack: Step[] = [];
let sendOps: SendOps = async () => ({ outcome: 'gone' });
let flush: () => Promise<void> = async () => undefined;
let textOf: (blockId: string) => string | null = () => null;
let busy = false;

/** The object page wires how typing steps reach the server and how unsaved typing is flushed first. */
export function connectUndo(send: SendOps, flushTyping: () => Promise<void>, editText: (blockId: string) => string | null): void {
  sendOps = send;
  flush = flushTyping;
  textOf = editText;
}

function push(stack: Step[], step: Step): void {
  stack.push(step);
  if (stack.length > MAX_STEPS) stack.shift();
}

/** Records an edit typed in a block; returns the step id the typing belongs to. */
export function recordTyping(blockId: string, ops: Op[], before: string, caretBefore: number, caretAfter: number, now: number): number {
  const inserted = ops.some((o) => 'insert' in o);
  const deleted = ops.some((o) => 'delete' in o);
  const kind: TypingStep['kind'] = inserted ? 'insert' : 'delete';
  const last = undoStack[undoStack.length - 1];
  redoStack.length = 0;
  const continues = last && last.name === 'typing' && last.blockId === blockId && last.kind === kind && now - last.at < TYPING_GAP_MS
    && !(inserted && deleted) && last.caret === caretBefore;
  if (continues && last.name === 'typing') {
    last.forward = composeOps(last.forward, ops);
    last.caret = caretAfter;
    last.at = now;
    return last.id;
  }
  const step: TypingStep = { name: 'typing', id: ++seq, blockId, kind, before, forward: ops, caret: caretAfter, at: now, version: null, next: null };
  push(undoStack, step);
  return step.id;
}

/** The version a typing step's commit produced. */
export function stepCommitted(stepId: number, version: number): void {
  const step = undoStack.find((s) => s.id === stepId);
  if (step && step.name === 'typing') step.version = version;
}

/**
 * Incoming remote ops (against the text on screen) rebase the typing step still open in that block:
 * its text before and its ops follow the remote change, and so does the caret it continues from.
 */
export function remoteTyping(blockId: string, ops: Op[]): void {
  const last = undoStack[undoStack.length - 1];
  if (!last || last.name !== 'typing' || last.blockId !== blockId) return;
  if (last.version !== null) {
    // Already committed: its undo goes by version, so typing after a remote change starts a new step.
    last.at = -Infinity;
    return;
  }
  const after = applyToText(last.before, last.forward);
  const t = transformPair(ops, invertOps(last.forward, last.before));
  if (!t) {
    last.at = -Infinity;
    return;
  }
  const moved = applyToText(after, ops);
  last.before = applyToText(moved, t.incoming);
  last.forward = invertOps(t.incoming, moved);
  last.caret = transformOffset(last.caret, ops);
}

/** A finished typing step ends; the next edit starts a new one (caret jumps, other blocks). */
export function endTyping(): void {
  const last = undoStack[undoStack.length - 1];
  if (last && last.name === 'typing') last.at = -Infinity;
}

export function recordAction(step: ActionStep): void {
  redoStack.length = 0;
  push(undoStack, { ...step, id: ++seq });
}

async function perform(direction: 'undo' | 'redo'): Promise<void> {
  if (busy) return;
  const from = direction === 'undo' ? undoStack : redoStack;
  const to = direction === 'undo' ? redoStack : undoStack;
  const verb = direction === 'undo' ? 'Undid' : 'Redid';
  const cant = direction === 'undo' ? "Can't undo" : "Can't redo";
  busy = true;
  try {
    await flush();
    const step = from.pop();
    if (!step) {
      announce(direction === 'undo' ? 'Nothing to undo.' : 'Nothing to redo.');
      return;
    }
    let outcome: Outcome;
    if (step.name === 'typing') {
      // The first undo sends the step's inverse with the version it produced; after that, each
      // direction sends what the previous commit changed, reversed, with that commit's version.
      const plan = step.next ?? (step.version === null ? null : { ops: invertOps(step.forward, step.before), version: step.version });
      const before = textOf(step.blockId);
      if (!plan || before === null) {
        outcome = 'conflict';
      } else {
        const result = await sendOps(step.blockId, plan.ops, plan.version);
        outcome = result.outcome;
        if (result.version !== undefined && result.text !== undefined) step.next = { ops: diffOps(result.text, before), version: result.version };
      }
      // Typing after an undo or redo always starts a new step.
      step.at = -Infinity;
    } else {
      outcome = await (direction === 'undo' ? step.undo() : step.redo());
    }
    if (outcome === 'done') {
      push(to, step);
      announce(`${verb} ${step.name}.`);
    } else if (outcome === 'gone') {
      showAlert(`${cant}: the quoted block no longer exists.`);
    } else {
      showAlert(`${cant}: that text changed on another device.`);
    }
  } finally {
    busy = false;
  }
}

export const undo = (): Promise<void> => perform('undo');
export const redo = (): Promise<void> => perform('redo');
