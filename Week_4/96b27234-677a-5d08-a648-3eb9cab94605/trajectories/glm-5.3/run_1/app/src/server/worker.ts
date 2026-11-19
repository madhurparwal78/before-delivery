// The periodic worker: processes due items in worlds on real time within 2
// seconds, and retries the mail outbox.
import { query } from './db';
import { runDue } from './grading';
import { flushAllOutboxes } from './mail';

export function startWorker(): void {
  const tick = async (): Promise<void> => {
    try {
      const worlds = await query<{ id: string; clock_mode: string; clock_at: Date | null }>('SELECT id, clock_mode, clock_at FROM worlds');
      for (const w of worlds) {
        // Held clocks are advanced only by the grading clock route.
        if (w.clock_mode === 'held') continue;
        await runDue(w.id, new Date());
      }
      await flushAllOutboxes();
    } catch {
      // retried on the next tick
    }
  };
  setInterval(() => void tick(), 2000);
}
