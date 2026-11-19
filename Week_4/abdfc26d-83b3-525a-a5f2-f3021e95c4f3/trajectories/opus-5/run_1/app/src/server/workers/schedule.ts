/**
 * Runs background work on a fixed interval, never letting two passes overlap and
 * never letting a failure stop the schedule.
 */
export function everySeconds(seconds: number, work: () => Promise<void>): void {
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await work();
    } catch (error) {
      process.stderr.write(`background work failed: ${String(error)}\n`);
    } finally {
      running = false;
    }
  };
  setInterval(() => void tick(), seconds * 1000).unref();
  void tick();
}
