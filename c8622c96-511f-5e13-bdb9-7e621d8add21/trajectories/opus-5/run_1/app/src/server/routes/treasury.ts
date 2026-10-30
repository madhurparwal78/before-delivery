import { coopDateOf, isValidLocalDate, isValidMonth } from '../../domain/time.js';
import { integerField, parseBody, stringField } from '../../domain/validate.js';
import { serverNow } from '../clock.js';
import { db, queryOn, UNIQUE_VIOLATION } from '../db/pool.js';
import { apiError, notFound, validationFailed } from '../http/errors.js';
import { jsonBody, requireRole, type Reply, type Route } from '../http/router.js';
import { createPayouts, readStatement, runStatement } from '../statements.js';

const DATE_MESSAGE = 'Use YYYY-MM-DD';
const FUTURE_MESSAGE = 'Effective date must be after today in co-op time';
const RATE_MESSAGE = 'Rate must be 0 to 10000 basis points';
const MONTH_MESSAGE = 'Use YYYY-MM';

export const treasuryRoutes: Route[] = [
  {
    method: 'GET',
    pattern: '/api/commission-rates',
    roles: ['treasurer'],
    async handle(ctx): Promise<Reply> {
      requireRole(ctx, 'treasurer');
      const now = await serverNow();
      const today = coopDateOf(now);
      const result = await queryOn<{ effective_from: string; rate_bp: number }>(
        db,
        `select to_char(effective_from, 'YYYY-MM-DD') as effective_from, rate_bp
         from commission_rates order by effective_from`,
      );
      const started = result.rows.filter((row) => row.effective_from <= today);
      const current = started[started.length - 1] ?? null;
      const rates = result.rows.map((row) => ({
        effective_from: row.effective_from,
        rate_bp: row.rate_bp,
        status:
          row.effective_from > today
            ? 'scheduled'
            : current && row.effective_from === current.effective_from
              ? 'current'
              : 'past',
      }));
      return {
        status: 200,
        json: {
          current: current ? { effective_from: current.effective_from, rate_bp: current.rate_bp } : null,
          rates,
        },
      };
    },
  },
  {
    method: 'POST',
    pattern: '/api/commission-rates',
    roles: ['treasurer'],
    async handle(ctx): Promise<Reply> {
      requireRole(ctx, 'treasurer');
      const now = await serverNow();
      const today = coopDateOf(now);
      const parsed = parseBody<{ effective_from: string; rate_bp: number }>(jsonBody(ctx), {
        effective_from: stringField(DATE_MESSAGE, (value) => {
          if (!isValidLocalDate(value)) return DATE_MESSAGE;
          return value > today ? null : FUTURE_MESSAGE;
        }),
        rate_bp: integerField(RATE_MESSAGE, (value) =>
          value >= 0 && value <= 10000 ? null : RATE_MESSAGE,
        ),
      });
      if (!parsed.ok) throw validationFailed(parsed.fields);
      try {
        await queryOn(db, 'insert into commission_rates (effective_from, rate_bp) values ($1, $2)', [
          parsed.value.effective_from,
          parsed.value.rate_bp,
        ]);
      } catch (error) {
        if (typeof error === 'object' && error !== null && (error as { code?: string }).code === UNIQUE_VIOLATION) {
          throw apiError(409, 'rate_date_taken', 'A rate already starts on that co-op date.');
        }
        throw error;
      }
      return {
        status: 201,
        json: {
          effective_from: parsed.value.effective_from,
          rate_bp: parsed.value.rate_bp,
          status: 'scheduled',
        },
      };
    },
  },
  {
    method: 'POST',
    pattern: '/api/royalty-statements',
    roles: ['treasurer'],
    async handle(ctx): Promise<Reply> {
      requireRole(ctx, 'treasurer');
      const parsed = parseBody<{ month: string }>(jsonBody(ctx), {
        month: stringField(MONTH_MESSAGE, (value) => (isValidMonth(value) ? null : MONTH_MESSAGE)),
      });
      if (!parsed.ok) throw validationFailed(parsed.fields);
      const result = await runStatement(parsed.value.month);
      return { status: result.status, json: result.body };
    },
  },
  {
    method: 'GET',
    pattern: '/api/royalty-statements/:month',
    roles: ['treasurer'],
    async handle(ctx): Promise<Reply> {
      requireRole(ctx, 'treasurer');
      const month = ctx.params.month as string;
      if (!isValidMonth(month)) throw notFound();
      const statement = await readStatement(db, month);
      if (!statement) throw notFound();
      return { status: 200, json: statement };
    },
  },
  {
    method: 'POST',
    pattern: '/api/royalty-statements/:month/payouts',
    roles: ['treasurer'],
    async handle(ctx): Promise<Reply> {
      requireRole(ctx, 'treasurer');
      const month = ctx.params.month as string;
      if (!isValidMonth(month)) throw notFound();
      const statement = await readStatement(db, month);
      if (!statement) throw notFound();
      const parsed = parseBody<Record<string, never>>(jsonBody(ctx), {});
      if (!parsed.ok) throw validationFailed(parsed.fields);
      const alreadyRecorded = statement.payouts.length > 0;
      const body = await createPayouts(month);
      return { status: alreadyRecorded ? 200 : 202, json: body };
    },
  },
];
