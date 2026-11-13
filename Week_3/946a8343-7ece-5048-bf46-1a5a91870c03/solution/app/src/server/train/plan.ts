// The pure parts of the merge train: what a rebuild keeps and drops, which cars changed, and what a pipeline status means.
import { shortId } from "../lib/objects.ts";

export interface CarSnapshot {
  readonly iid: number;
  readonly position: number;
  readonly sha: string;
}

type PipelineVerdict = "passed" | "failed" | "unfinished";

const PASSED = new Set(["success", "warning", "skipped"]);
const FAILED = new Set(["failed"]);
const FINISHED = new Set(["success", "warning", "skipped", "failed", "canceled"]);

export function verdictOf(status: string): PipelineVerdict {
  if (PASSED.has(status)) return "passed";
  return FAILED.has(status) ? "failed" : "unfinished";
}

export function isFinished(status: string): boolean {
  return FINISHED.has(status);
}

/** A car whose pipeline was created at `createdAt` is stalled once the job timeout has passed. */
export function isStalled(createdAt: number, nowMs: number, timeoutMs: number): boolean {
  return createdAt + timeoutMs <= nowMs;
}

/** `!<iid> is now position <n>, testing <short>` for every car whose position or stored commit differs from before, front to back. */
export function positionAnnouncements(before: readonly CarSnapshot[], after: readonly CarSnapshot[]): { iid: number; text: string }[] {
  const previous = new Map(before.map((car) => [car.iid, car]));
  const lines: { iid: number; text: string }[] = [];
  for (const car of [...after].sort((a, b) => a.position - b.position)) {
    const was = previous.get(car.iid);
    if (was === undefined || was.position !== car.position || was.sha !== car.sha) {
      lines.push({ iid: car.iid, text: `!${car.iid} is now position ${car.position}, testing ${shortId(car.sha)}` });
    }
  }
  return lines;
}

export type BuildResult<B> = { readonly built: B } | { readonly refused: string };

interface Kept<C, B> {
  readonly car: C;
  readonly built: B;
}

interface Dropped<C> {
  readonly car: C;
  readonly reason: string;
}

/** Rebuilds `cars` (front to back) on top of `ahead`. Each build gets the stored commit of the nearest car that stayed in front
 *  of it; a refused car leaves and the cars behind it build on what remains. */
export async function rebuildChain<C, B extends { readonly sha: string }>(
  ahead: string,
  cars: readonly C[],
  build: (car: C, base: string) => Promise<BuildResult<B>>,
): Promise<{ kept: Kept<C, B>[]; dropped: Dropped<C>[] }> {
  const kept: Kept<C, B>[] = [];
  const dropped: Dropped<C>[] = [];
  let base = ahead;
  for (const car of cars) {
    const result = await build(car, base);
    if ("refused" in result) {
      dropped.push({ car, reason: result.refused });
      continue;
    }
    kept.push({ car, built: result.built });
    base = result.built.sha;
  }
  return { kept, dropped };
}
