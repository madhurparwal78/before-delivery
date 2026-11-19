// Due refreshes and staleness flips: checked every second of real time and at once on any grading clock change.
import type { App } from '../http/app.ts';
import { refreshSource } from './refresh.ts';
import type { ExtractRow } from './state.ts';
import { isStale, nextRunAt, publishExtract, staleSeen } from './state.ts';

interface TickState {
  running: Promise<void> | null;
  queued: Promise<void> | null;
}

const ticks = new WeakMap<App, TickState>();

/**
 * One pass over every extract. Passes never overlap: a call while one runs waits for it and then runs one more pass
 * (shared by every caller that arrived meanwhile), so a clock change is always seen by a pass that starts after it.
 */
export function tick(app: App): Promise<void> {
  let state = ticks.get(app);
  if (!state) {
    state = { running: null, queued: null };
    ticks.set(app, state);
  }
  const own = state;
  if (own.queued) return own.queued;
  if (own.running) {
    own.queued = own.running.then(() => {
      own.queued = null;
      return tick(app);
    });
    return own.queued;
  }
  own.running = pass(app).finally(() => {
    own.running = null;
  });
  return own.running;
}

async function pass(app: App): Promise<void> {
  const rows = await app.db.rows<ExtractRow>(`SELECT * FROM extracts`);
  const now = app.clock.nowMs();
  const due = rows.filter((row) => (nextRunAt(row)?.getTime() ?? Infinity) <= now);
  await Promise.all(due.map((row) => refreshSource(app, row.source_id)));
  const dueIds = new Set(due.map((row) => row.source_id));
  for (const row of rows) {
    if (dueIds.has(row.source_id)) continue;
    if (staleSeen.get(row.source_id) !== isStale(row, app.clock.nowMs(), app.config.staleMs)) {
      await publishExtract(app, row.source_id);
    }
  }
}

export function startTicker(app: App): void {
  setInterval(() => {
    tick(app).catch((error: unknown) => {
      console.error('extract check failed:', error instanceof Error ? error.message : 'unknown error');
    });
  }, 1000);
}
