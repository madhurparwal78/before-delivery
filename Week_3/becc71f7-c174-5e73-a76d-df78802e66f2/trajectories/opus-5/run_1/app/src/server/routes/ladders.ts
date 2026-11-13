import { randomUUID } from 'node:crypto';
import { jsonResponse } from '../http/context.js';
import { conflict } from '../http/errors.js';
import { route, type CompiledRoute } from '../http/router.js';
import { FieldProblems, readInteger, readTrimmed } from '../http/validate.js';
import { instantParam, isUniqueViolation } from '../db.js';
import { addDays, brusselsDate, formatDateOnly, isValidBrusselsDate } from '../../shared/brussels.js';
import { copy } from '../../shared/copy.js';
import type { Ladder } from '../domain/ladder.js';

const MAX_EFFECTIVE_DAYS_AHEAD = 365;
const MAX_DAY = 365;
const MIN_PERIOD_END_DAY = 15;

function ladderJson(ladder: Ladder): unknown {
  return {
    id: ladder.id,
    effectiveOn: ladder.effectiveOn,
    firstMarkdownPercent: ladder.firstMarkdownPercent,
    firstMarkdownDay: ladder.firstMarkdownDay,
    secondMarkdownPercent: ladder.secondMarkdownPercent,
    secondMarkdownDay: ladder.secondMarkdownDay,
    periodEndDay: ladder.periodEndDay,
  };
}

function ladderOf(row: Record<string, unknown>): Ladder {
  return {
    id: row['id'] as string,
    effectiveOn: row['effective_on'] as string,
    firstMarkdownPercent: Number(row['first_markdown_percent']),
    firstMarkdownDay: Number(row['first_markdown_day']),
    secondMarkdownPercent: Number(row['second_markdown_percent']),
    secondMarkdownDay: Number(row['second_markdown_day']),
    periodEndDay: Number(row['period_end_day']),
  };
}

const LADDER_COLUMNS = `id, effective_on, first_markdown_percent, first_markdown_day,
  second_markdown_percent, second_markdown_day, period_end_day`;

export const ladderRoutes: CompiledRoute[] = [
  route({
    method: 'GET',
    path: '/api/ladders',
    access: 'owner',
    handle: async (ctx) => {
      const { rows } = await ctx.app.db.query(
        `SELECT ${LADDER_COLUMNS} FROM ladders ORDER BY effective_on DESC`,
      );
      return jsonResponse(200, { ladders: rows.map((row) => ladderJson(ladderOf(row))) });
    },
  }),

  route({
    method: 'POST',
    path: '/api/ladders',
    access: 'owner',
    handle: async (ctx) => {
      const body = ctx.json();
      const problems = new FieldProblems();

      const effectiveOn = readTrimmed(body, 'effectiveOn');
      const today = brusselsDate(ctx.now);
      if (
        !isValidBrusselsDate(effectiveOn) ||
        effectiveOn < today ||
        effectiveOn > addDays(today, MAX_EFFECTIVE_DAYS_AHEAD)
      ) {
        problems.add('effectiveOn', 'Choose today or a date up to 365 days ahead.');
      }

      const firstMarkdownPercent = readInteger(body, 'firstMarkdownPercent');
      const secondMarkdownPercent = readInteger(body, 'secondMarkdownPercent');
      const firstMarkdownDay = readInteger(body, 'firstMarkdownDay');
      const secondMarkdownDay = readInteger(body, 'secondMarkdownDay');
      const periodEndDay = readInteger(body, 'periodEndDay');

      const percentInRange = (value: number | null): boolean =>
        value !== null && value >= 1 && value <= 90;
      if (!percentInRange(firstMarkdownPercent)) {
        problems.add('firstMarkdownPercent', 'Enter a percentage from 1 to 90.');
      }
      if (!percentInRange(secondMarkdownPercent)) {
        problems.add('secondMarkdownPercent', 'Enter a percentage from 1 to 90.');
      }
      if (
        percentInRange(firstMarkdownPercent) &&
        percentInRange(secondMarkdownPercent) &&
        (firstMarkdownPercent as number) >= (secondMarkdownPercent as number)
      ) {
        problems.add(
          'secondMarkdownPercent',
          'The second markdown must take more off than the first.',
        );
      }

      const dayInRange = (value: number | null): boolean =>
        value !== null && value >= 1 && value <= MAX_DAY;
      if (!dayInRange(firstMarkdownDay)) {
        problems.add('firstMarkdownDay', 'Enter a day from 1 to 365.');
      }
      if (!dayInRange(secondMarkdownDay)) {
        problems.add('secondMarkdownDay', 'Enter a day from 1 to 365.');
      }
      if (!dayInRange(periodEndDay) || (periodEndDay as number) < MIN_PERIOD_END_DAY) {
        problems.add('periodEndDay', 'Enter a day from 15 to 365.');
      }
      if (
        dayInRange(firstMarkdownDay) &&
        dayInRange(secondMarkdownDay) &&
        (firstMarkdownDay as number) >= (secondMarkdownDay as number)
      ) {
        problems.add('secondMarkdownDay', 'The second markdown must come after the first.');
      }
      if (
        dayInRange(secondMarkdownDay) &&
        dayInRange(periodEndDay) &&
        (secondMarkdownDay as number) >= (periodEndDay as number)
      ) {
        problems.add('periodEndDay', 'The period must end after the second markdown.');
      }
      problems.throwIfAny();

      const id = randomUUID();
      try {
        await ctx.app.db.query(
          `INSERT INTO ladders (id, effective_on, first_markdown_percent, first_markdown_day,
                                second_markdown_percent, second_markdown_day, period_end_day,
                                created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            id,
            effectiveOn,
            firstMarkdownPercent,
            firstMarkdownDay,
            secondMarkdownPercent,
            secondMarkdownDay,
            periodEndDay,
            instantParam(ctx.now),
          ],
        );
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw conflict('ladder_date_taken', copy.ladderDateTaken(formatDateOnly(effectiveOn)));
        }
        throw error;
      }
      const { rows } = await ctx.app.db.query(
        `SELECT ${LADDER_COLUMNS} FROM ladders WHERE id = $1`,
        [id],
      );
      return jsonResponse(201, { ladder: ladderJson(ladderOf(rows[0] as Record<string, unknown>)) });
    },
  }),
];
