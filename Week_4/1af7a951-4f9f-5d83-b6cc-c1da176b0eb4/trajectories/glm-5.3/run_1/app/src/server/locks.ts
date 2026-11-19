// A per-cohort async mutex so the seat hold spans the provider call. Only
// one server process holds seats, so an in-process chain is exact: each
// caller waits on the previous holder's completion promise.

export class CohortLocks {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(cohortId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(cohortId) ?? Promise.resolve();
    const run = previous.then(fn, fn);
    // keep a non-rejecting tail so later callers always proceed
    this.tails.set(
      cohortId,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }
}
