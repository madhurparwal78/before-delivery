// The two borrowing checks a member passes before a new hold or loan: the borrowing pause (any loan
// overdue now) and the borrowing limit (requested holds, ready holds before their pickup deadline, and
// out or overdue loans). Both are judged at request time from the effective statuses.

import type { Db } from "../db.js";
import { ApiError } from "../http/errors.js";
import { library } from "./library.js";
import { holdStatusSql, loanStatusSql } from "./status.js";

type Queryable = Pick<Db, "query">;

export async function assertNotPaused(db: Queryable, now: Date, memberId: string): Promise<void> {
  const overdue = await db.query(`SELECT 1 FROM loan l WHERE l.member_id = $2 AND l.status = 'out' AND ${loanStatusSql()} = 'overdue' LIMIT 1`, [
    now,
    memberId,
  ]);
  if (overdue.rowCount) throw ApiError.of("borrowing_paused");
}

async function activeCount(db: Queryable, now: Date, memberId: string): Promise<number> {
  const found = await db.query<{ count: number }>(
    `SELECT (SELECT count(*) FROM hold h WHERE h.member_id = $2 AND ${holdStatusSql()} IN ('requested', 'ready'))::int
          + (SELECT count(*) FROM loan l WHERE l.member_id = $2 AND l.status = 'out')::int AS count`,
    [now, memberId],
  );
  return found.rows[0]?.count ?? 0;
}

export async function assertUnderLimit(db: Queryable, now: Date, memberId: string): Promise<void> {
  if ((await activeCount(db, now, memberId)) >= library().maxActivePerMember) throw ApiError.of("borrowing_limit");
}
