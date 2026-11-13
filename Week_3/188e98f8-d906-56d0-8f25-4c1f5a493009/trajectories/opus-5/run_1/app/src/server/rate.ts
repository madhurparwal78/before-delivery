/** The one place the submit allowance is decided. */

import type { Db } from './db.js';
import { tooManySubmits } from './errors.js';

const SUBMIT_ALLOWANCE = 6;
const SUBMIT_WINDOW_SECONDS = 60;

/** Count this submit against the team's rolling allowance, or refuse it. */
export async function countSubmit(db: Db, teamId: number): Promise<void> {
  await db.transaction(async (tx) => {
    const result = await tx.query<{ used: number; wait: number | null }>(
      `select count(*)::int as used,
              ceil(extract(epoch from (min(at) + ($2::int * interval '1 second') - clock_timestamp())))::int as wait
         from submit_log
        where team_id = $1 and at > clock_timestamp() - ($2::int * interval '1 second')`,
      [teamId, SUBMIT_WINDOW_SECONDS],
    );
    const row = result.rows[0];
    const used = row?.used ?? 0;
    if (used >= SUBMIT_ALLOWANCE) {
      throw tooManySubmits(Math.max(1, row?.wait ?? 1));
    }
    await tx.query('insert into submit_log (team_id) values ($1)', [teamId]);
  });
}
