import type { Context } from './context.ts';
import type { FormulaError } from './formula-error.ts';
import type { Refusal } from './sync.ts';

/** One group of logic controls for the selected page or question. `show` re-reads the draft into the boxes. */
export interface Editor { element: HTMLElement; show: () => void }

export interface EditorEnv { context: Context; errors: FormulaError }

/** A refused formula goes to `#formula-error` and keeps the focus in its box; any other refusal goes to the alert. */
export function refused(env: EditorEnv, refusal: Refusal, box: HTMLElement): void {
  if (refusal.code === 'FORMULA_INVALID') env.errors.show(refusal.message, box);
  else env.context.sync.report(refusal);
}
