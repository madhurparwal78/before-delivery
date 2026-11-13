import { randomUUID } from "node:crypto";
import { addDays, brusselsDate } from "../../shared/brussels";
import type { Ladder } from "../../shared/api";
import { formatDate } from "../../shared/format";
import { pool } from "../db";
import { conflict } from "../errors";
import { ladderTerms } from "../pieces";
import { reply, type Context, type Reply } from "../pipeline";
import { FieldProblems, isDate, isWholeNumber } from "../validate";

const DAYS_AHEAD = 365;

interface LadderRow {
  id: string;
  effective_on: string;
  first_percent: number;
  first_day: number;
  second_percent: number;
  second_day: number;
  period_end_day: number;
}

const ladderView = (row: LadderRow): Ladder => ({ id: row.id, effectiveOn: row.effective_on, ...ladderTerms(row) });

export async function listLadders(): Promise<Reply> {
  const { rows } = await pool.query<LadderRow>("SELECT * FROM ladders ORDER BY effective_on");
  return reply(200, { ladders: rows.map(ladderView) });
}

export async function createLadder({ body, now }: Context): Promise<Reply> {
  const { effectiveOn, firstMarkdownPercent: firstPercent, firstMarkdownDay: firstDay, secondMarkdownPercent: secondPercent, secondMarkdownDay: secondDay, periodEndDay: endDay } = body;
  const problems = new FieldProblems();
  const today = brusselsDate(now);
  if (!isDate(effectiveOn) || effectiveOn < today || effectiveOn > addDays(today, DAYS_AHEAD)) problems.add("effectiveOn", "Choose today or a date up to 365 days ahead.");
  const percentOk = (value: unknown): value is number => isWholeNumber(value) && value >= 1 && value <= 90;
  if (!percentOk(firstPercent)) problems.add("firstMarkdownPercent", "Enter a whole percentage from 1 to 90.");
  if (!percentOk(secondPercent)) problems.add("secondMarkdownPercent", "Enter a whole percentage from 1 to 90.");
  else if (percentOk(firstPercent) && firstPercent >= secondPercent) problems.add("firstMarkdownPercent", "The first percentage must be below the second.");
  if (!isWholeNumber(firstDay) || firstDay < 1) problems.add("firstMarkdownDay", "Enter a whole day from 1.");
  if (!isWholeNumber(secondDay) || !isWholeNumber(firstDay) || secondDay <= firstDay) problems.add("secondMarkdownDay", "The second markdown day must come after the first.");
  if (!isWholeNumber(endDay) || !isWholeNumber(secondDay) || endDay <= secondDay || endDay < 15 || endDay > 365) problems.add("periodEndDay", "The period end day must come after the second markdown, from day 15 to day 365.");
  problems.check();
  const { rows } = await pool.query<LadderRow>(
    `INSERT INTO ladders (id, effective_on, first_percent, first_day, second_percent, second_day, period_end_day)
     VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (effective_on) DO NOTHING RETURNING *`,
    [randomUUID(), effectiveOn, firstPercent, firstDay, secondPercent, secondDay, endDay],
  );
  const row = rows[0];
  if (!row) throw conflict("ladder_date_taken", `A ladder change already takes effect on ${formatDate(String(effectiveOn))}.`);
  return reply(201, { ladder: ladderView(row) });
}
