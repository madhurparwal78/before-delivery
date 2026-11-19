const TICK_MS = 2000;

/** Runs a job every two seconds at most, one at a time; rows hold the truth, so a failed pass just tries again. */
export function every2s(name: string, job: () => Promise<void>): void {
  const pass = async (): Promise<void> => {
    try {
      await job();
    } catch (error) {
      console.error(`${name} pass failed:`, error instanceof Error ? error.message : error);
    }
    setTimeout(() => void pass(), TICK_MS);
  };
  void pass();
}
