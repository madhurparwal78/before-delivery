import { config } from './config.js';
import type { Queryable } from './db.js';
import { refuse } from './errors.js';
import { versionContent } from './automations.js';
import { contentOf } from './draft.js';
import { msg } from './messages.js';
import type { Content, Draft } from './model.js';

/** Attempts a step may make: the first plus every retry. */
export function totalAttempts(): number {
  return config.retryCount + 1;
}

/** The retry rule: after `failedAttempts` failures at `at`, the next attempt's time, or null when attempts are used up. */
export function planRetry(failedAttempts: number, at: number): number | null {
  return failedAttempts < totalAttempts() ? at + config.retryDelaySeconds * 1000 : null;
}

/** The step limit: true when one more step execution would pass it. */
export function exceedsStepLimit(executionsSoFar: number): boolean {
  return executionsSoFar >= config.stepLimit;
}

interface Binding {
  version: number | null;
  content: Content;
}

interface LiveState {
  id: string;
  live_version: number | null;
  draft: Draft;
}

/**
 * Version binding: a test run takes a snapshot of the draft and shows no version; every other run takes the
 * live version (or the one named, for grading setup) and finishes on it however many versions follow.
 */
export async function bindRun(client: Queryable, automation: LiveState, test: boolean, version?: number): Promise<Binding> {
  if (test) return { version: null, content: structuredClone(contentOf(automation.draft)) };
  const wanted = version ?? automation.live_version;
  if (wanted === null) throw refuse.conflict(msg.publishFirst);
  const found = await versionContent(client, automation.id, wanted);
  if (found === null) throw refuse.notFound();
  return { version: wanted, content: found.content };
}

/** A replay finishes on the version, or the test snapshot, its original ran on. */
export function bindReplay(original: { test: boolean; version: number | null; content: Content }): Binding {
  return { version: original.version, content: structuredClone(original.content) };
}
