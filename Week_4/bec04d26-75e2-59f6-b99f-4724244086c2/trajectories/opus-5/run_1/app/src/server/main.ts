import { announceNewlyOverdue } from './actions/returns';
import { attemptDueReminders, pumpAllPractices } from './actions/schedule';
import { config } from './config';
import { query, waitForPostgres } from './db';
import { heartbeat, publish } from './events';
import { createAppServer } from './http/server';
import { applySchema } from './schema';
import { checkServices } from './services/status';

/** Watermarks for practices that follow real time, so each deadline is announced once. */
const sweptTo = new Map<string, number>();

async function sweepRealTimePractices(): Promise<void> {
  const practices = await query<{ id: string }>(
    'SELECT id FROM practices WHERE clock_now_ms IS NULL',
  );
  const now = Date.now();
  const live = new Set(practices.map((practice) => practice.id));
  for (const key of sweptTo.keys()) {
    if (!live.has(key)) sweptTo.delete(key);
  }
  for (const practice of practices) {
    const from = sweptTo.get(practice.id);
    sweptTo.set(practice.id, now);
    if (from === undefined) continue;
    const crossed = await query<{ id: string }>(
      `SELECT id FROM returns WHERE practice_id = $1
         AND status IN ('not_started','prepared','client_approved')
         AND due_at_ms >= $2 AND due_at_ms < $3 LIMIT 1`,
      [practice.id, from, now],
    );
    if (crossed.length > 0) {
      await announceNewlyOverdue(practice.id, from, now);
      publish(practice.id, { lines: [] });
    }
    await attemptDueReminders(practice.id);
  }
}

async function start(): Promise<void> {
  await waitForPostgres();
  await applySchema();

  const server = createAppServer();
  server.listen(config.port, '0.0.0.0', () => {
    console.log(`duefield listening on ${config.port}`);
  });

  void checkServices().then(() => pumpAllPractices());
  setInterval(() => {
    void checkServices()
      .then(() => pumpAllPractices())
      .catch((error) => console.error('retry sweep failed', error));
  }, config.serviceRetrySeconds * 1000);

  setInterval(() => {
    void sweepRealTimePractices().catch((error) => console.error('clock sweep failed', error));
  }, 1000);

  setInterval(() => heartbeat(), 15000);
}

void start().catch((error) => {
  console.error('duefield failed to start', error);
  process.exit(1);
});
