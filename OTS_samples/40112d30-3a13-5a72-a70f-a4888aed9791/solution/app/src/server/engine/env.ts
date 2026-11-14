import type { FormulaLimits } from './formula/parser.ts';

export interface EngineEnv {
  /** Server date in APP_TZ, YYYY-MM-DD (TODAY()). */
  today: string;
  /** SHUFFLE_SEED. */
  shuffleSeed: string;
  /** FORMULA_MAX_CHARS (inclusive). */
  formulaMaxChars: number;
  /** FORMULA_MAX_DEPTH (inclusive). */
  formulaMaxDepth: number;
}

export function formulaLimits(env: EngineEnv): FormulaLimits {
  return { maxChars: env.formulaMaxChars, maxDepth: env.formulaMaxDepth };
}
