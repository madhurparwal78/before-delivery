/** Starts work nobody waits for; a failure is retried by the next kick or retry tick. */
export const background = (job: () => Promise<unknown>): void => {
  void job().catch(() => undefined);
};
