/** Marks: 0 or 1 points on a current answer of a closed round. */

import type { Answer } from '../shared/model.js';
import { ANSWER_SELECT, toAnswer, type AnswerRow } from './answers.js';
import { one, type Db } from './db.js';
import { conflict } from './errors.js';
import { refuseMarkUnlessClosed, roundRow } from './rounds.js';

/** The answer the marker named, or null when the round holds no such answer. */
export async function answerInRound(db: Db, round: number, answerId: number): Promise<Answer | null> {
  const result = await db.query<AnswerRow>(`${ANSWER_SELECT} where a.id = $1 and a.round = $2`, [
    answerId,
    round,
  ]);
  const row = result.rows[0];
  return row === undefined ? null : toAnswer(row);
}

/** Marks land only on a current answer. */
export function refuseUnlessCurrent(answer: { current: boolean }): void {
  if (!answer.current) throw conflict('answer_superseded');
}

export async function recordMark(db: Db, round: number, answerId: number, points: 0 | 1): Promise<Answer> {
  return db.transaction(async (tx) => {
    const row = await roundRow(tx, round, true);
    refuseMarkUnlessClosed(row.status);
    const held = await tx.query<{ current: boolean }>(
      'select current from answers where id = $1 and round = $2 for update',
      [answerId, round],
    );
    refuseUnlessCurrent(one(held));
    const marked = await tx.query<AnswerRow>(
      `with scored as (
         update answers set mark = $3, ruled = $3 where id = $1 and round = $2
         returning id, round, team_id, question, text, submitted_at, current, mark, ruled
       )
       select scored.*, t.name as team_name from scored join teams t on t.id = scored.team_id`,
      [answerId, round, points],
    );
    return toAnswer(one(marked));
  });
}
