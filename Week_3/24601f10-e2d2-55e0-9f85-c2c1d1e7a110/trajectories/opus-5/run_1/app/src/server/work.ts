import { type Db, transact } from './db';
import { Outbox, flushOutbox, publish } from './live';

/**
 * One tournament write: the tournament row is locked, so writes to one match are applied one at a
 * time in arrival order, live messages take their sequence numbers in order, and nothing is
 * published until the transaction has committed.
 */
export const withTournament = async <T>(
  tournamentId: string,
  fn: (db: Db, outbox: Outbox) => Promise<T>,
): Promise<T> => {
  const { value, messages } = await transact(async (db) => {
    await db.query('select id from tournaments where id = $1 for update', [tournamentId]);
    const outbox = new Outbox();
    const result = await fn(db, outbox);
    return { value: result, messages: await flushOutbox(db, tournamentId, outbox) };
  });
  publish(tournamentId, messages);
  return value;
};
