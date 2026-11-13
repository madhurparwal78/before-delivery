import type pg from "pg";
import { transaction } from "./db.js";
import { Touch, scheduleFlush } from "./publish.js";

let tail: Promise<unknown> = Promise.resolve();

/** Game changes run one at a time, so strikes apply in arrival order and live events leave in commit order. */
export function serialized<T>(work: () => Promise<T>): Promise<T> {
  const run = tail.then(work, work);
  tail = run.catch(() => undefined);
  return run;
}

export function mutate<T>(work: (db: pg.PoolClient, touch: Touch) => Promise<T>): Promise<T> {
  return serialized(async () => {
    const touch = new Touch();
    const result = await transaction((db) => work(db, touch));
    scheduleFlush(touch);
    return result;
  });
}
