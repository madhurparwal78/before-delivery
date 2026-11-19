/** Runs work now and again `ms` after each run finishes; a failed run waits for the next. */
export function every(ms: number, work: () => Promise<unknown>): void {
  const run = async () => {
    await work().catch(() => undefined);
    setTimeout(run, ms).unref();
  };
  void run();
}
