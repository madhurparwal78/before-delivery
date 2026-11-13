import type { ForfeitRecord, InputRecord, RoundKind } from '../types.js';
import { RoundEngine } from './engine.js';

export * from './engine.js';
export * from './course.js';

/**
 * Runs a whole round from its seed, starters, effective inputs and forfeits.
 * Re-simulating a stored round this way reproduces every broadcast tick exactly.
 */
export function simulateRound(
  kind: RoundKind,
  seed: number,
  starters: readonly number[],
  inputs: readonly InputRecord[],
  forfeits: readonly ForfeitRecord[],
): RoundEngine {
  const engine = new RoundEngine(kind, seed, starters);
  const byTick = new Map<number, InputRecord[]>();
  for (const input of inputs) {
    const bucket = byTick.get(input.tick);
    if (bucket) bucket.push(input);
    else byTick.set(input.tick, [input]);
  }
  for (const forfeit of forfeits) engine.forfeitAt(forfeit.userId, forfeit.tick);
  while (!engine.resolved) {
    for (const input of byTick.get(engine.tick) ?? []) {
      engine.setButtons(input.userId, input.buttons);
    }
    engine.step();
  }
  return engine;
}
export * from './ranking.js';
