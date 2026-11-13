/** Answers: how they are read, and how a submit is stored. */

import type { Answer } from '../shared/model.js';
import { normaliseText } from '../shared/text.js';
import type { Db } from './db.js';
import { one } from './db.js';
import { refuseSubmitUnlessOpen, roundRow } from './rounds.js';

export interface AnswerRow {
  id: number;
  round: number;
  team_id: number;
  team_name: string;
  question: number;
  text: string;
  submitted_at: Date;
  current: boolean;
  mark: number | null;
  ruled: number | null;
}

export const ANSWER_SELECT = `select a.id, a.round, a.team_id, t.name as team_name, a.question, a.text,
         a.submitted_at, a.current, a.mark, a.ruled
    from answers a join teams t on t.id = a.team_id`;

function point(value: number | null): 0 | 1 | null {
  if (value === null) return null;
  return value === 1 ? 1 : 0;
}

export function toAnswer(row: AnswerRow): Answer {
  return {
    id: row.id,
    round: row.round,
    team_id: row.team_id,
    team_name: row.team_name,
    question: row.question,
    text: row.text,
    submitted_at: row.submitted_at.toISOString(),
    current: row.current,
    mark: point(row.mark),
    ruled: point(row.ruled),
  };
}

/** Marks and rulings stay hidden from a captain until the round is marked. */
export function withoutMarks(answer: Answer): Answer {
  return { ...answer, mark: null, ruled: null };
}

export async function currentAnswers(db: Db, round: number, teamId: number | null): Promise<Answer[]> {
  const result = await db.query<AnswerRow>(
    `${ANSWER_SELECT} where a.round = $1 and a.current and ($2::int is null or a.team_id = $2)
      order by a.question asc, a.team_id asc`,
    [round, teamId],
  );
  return result.rows.map(toAnswer);
}

export async function answerById(db: Db, id: number): Promise<Answer | null> {
  const result = await db.query<AnswerRow>(`${ANSWER_SELECT} where a.id = $1`, [id]);
  const row = result.rows[0];
  return row === undefined ? null : toAnswer(row);
}

export interface SubmitItem {
  question: number;
  text: string;
}

/** Store a team's answers for an open round, superseding its earlier ones. */
export async function storeSubmit(
  db: Db,
  round: number,
  teamId: number,
  items: SubmitItem[],
): Promise<Answer[]> {
  return db.transaction(async (tx) => {
    const row = await roundRow(tx, round, true);
    refuseSubmitUnlessOpen(row.status);
    const accepted: AnswerRow[] = [];
    for (const item of [...items].sort((left, right) => left.question - right.question)) {
      await tx.query(
        `update answers set current = false
          where round = $1 and team_id = $2 and question = $3 and current`,
        [round, teamId, item.question],
      );
      const inserted = await tx.query<AnswerRow>(
        `with stored as (
           insert into answers (round, team_id, question, text) values ($1, $2, $3, $4)
           returning id, round, team_id, question, text, submitted_at, current, mark, ruled
         )
         select stored.*, t.name as team_name from stored join teams t on t.id = stored.team_id`,
        [round, teamId, item.question, normaliseText(item.text)],
      );
      accepted.push(one(inserted));
    }
    return accepted.map(toAnswer);
  });
}
