import { pool } from './db';
import {
  autoConfirmDue,
  closeCheckinIfDue,
  type Effects,
  refreshOverdue,
} from './domain/engine';
import { loadTournament, type TournamentRow } from './domain/tournaments';
import { withTournament } from './work';

let queue: Promise<void> = Promise.resolve();

/** Due deadlines are applied in time order, at least once a second and after a clock move. */
export const applyDueDeadlines = (): Promise<void> => {
  const run = queue.then(applyOnce);
  queue = run.catch(() => undefined);
  return run;
};

const applyOnce = async (): Promise<void> => {
  const { rows } = await pool.query<{ id: string }>(
    `select id from tournaments where state in ('checkin_open', 'running') order by created_at`,
  );
  for (const row of rows) {
    await withTournament(row.id, async (db, outbox) => {
      const tournament = await loadTournament(db, row.id);
      if (tournament === null) return;
      const effects: Effects = {
        db,
        outbox,
        tournament: tournament as TournamentRow,
        sentences: [],
        actor: 'system',
      };
      await closeCheckinIfDue(effects);
      await autoConfirmDue(effects);
      await refreshOverdue(effects);
    });
  }
};

export const startDeadlineLoop = (): NodeJS.Timeout =>
  setInterval(() => {
    void applyDueDeadlines().catch((error: unknown) => {
      process.stderr.write(`deadline loop: ${(error as Error).message}\n`);
    });
  }, 1000);
