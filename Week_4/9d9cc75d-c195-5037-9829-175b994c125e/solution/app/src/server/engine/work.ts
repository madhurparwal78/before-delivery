// Query work is written as generators that yield between chunks of rows. `runTimed` drives a query on the server: it
// enforces the time budget and hands the event loop back every few milliseconds, so another user's small query
// answers meanwhile. `runNow` drives the bundled sample to the end at once.

export type Work<T> = Generator<void, T, void>;

const SLICE_MS = 8;

export class OverBudget extends Error {}

export async function runTimed<T>(work: Work<T>, budgetMs: number): Promise<T> {
  const started = performance.now();
  let slice = started;
  for (;;) {
    const step = work.next();
    if (step.done) return step.value;
    const now = performance.now();
    if (now - started > budgetMs) throw new OverBudget();
    if (now - slice >= SLICE_MS) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      slice = performance.now();
    }
  }
}

export function runNow<T>(work: Work<T>): T {
  for (;;) {
    const step = work.next();
    if (step.done) return step.value;
  }
}
