// The markdown ladder (DP-14, DP-17).

import crypto from 'node:crypto';
import type { Route, RouteContext } from '../http.js';
import { sendJson, parseJsonBody, asObject, str, num } from '../http.js';
import { ApiError } from '../errors.js';
import { brusselsDateOf, daysBetween } from '../../shared/time.js';
import { ladderJson } from '../views.js';

export const ladderRoutes: Route[] = [
  {
    method: 'GET', pattern: '/api/ladders', bodyLimit: 0, auth: 'owner',
    handle: async (ctx) => {
      const { rows } = await ctx.services.pool.query(
        'SELECT * FROM ladders ORDER BY effective_on'
      );
      sendJson(ctx.res, 200, { ladders: rows.map(ladderJson) });
    },
  },
  {
    method: 'POST', pattern: '/api/ladders', bodyLimit: 65536, auth: 'owner',
    handle: async (ctx) => {
      requireJson(ctx);
      const body = asObject(parseJsonBody(ctx));
      const fields: Record<string, string> = {};
      const effectiveOn = str(body.effectiveOn);
      const firstPercent = num(body.firstMarkdownPercent);
      const firstDay = num(body.firstMarkdownDay);
      const secondPercent = num(body.secondMarkdownPercent);
      const secondDay = num(body.secondMarkdownDay);
      const periodEndDay = num(body.periodEndDay);

      const today = brusselsDateOf(new Date());
      if (!effectiveOn || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveOn)) {
        fields.effectiveOn = 'Choose a Brussels date.';
      } else if (daysBetween(effectiveOn, today) > 365 || daysBetween(effectiveOn, today) < 0) {
        fields.effectiveOn = 'Choose today or a date up to 365 days ahead.';
      }
      const whole = (v: number | undefined) => v !== undefined && Number.isInteger(v);
      if (!whole(firstPercent) || firstPercent! < 1 || firstPercent! > 90) fields.firstMarkdownPercent = 'Enter a whole number from 1 to 90.';
      if (!whole(secondPercent) || secondPercent! < 1 || secondPercent! > 90) fields.secondMarkdownPercent = 'Enter a whole number from 1 to 90.';
      if (!whole(firstDay) || firstDay! < 1) fields.firstMarkdownDay = 'Enter a whole number from 1 up.';
      if (!whole(secondDay) || secondDay! < 1) fields.secondMarkdownDay = 'Enter a whole number from 1 up.';
      if (!whole(periodEndDay) || periodEndDay! < 15 || periodEndDay! > 365) fields.periodEndDay = 'Enter a whole number from 15 to 365.';
      if (firstPercent !== undefined && secondPercent !== undefined && firstPercent >= secondPercent) {
        fields.secondMarkdownPercent = 'The first markdown must be below the second.';
      }
      if (firstDay !== undefined && secondDay !== undefined && periodEndDay !== undefined) {
        if (!(firstDay < secondDay && secondDay < periodEndDay)) {
          fields.periodEndDay = 'The days must rise: first markdown, second markdown, period end.';
        }
      }
      if (Object.keys(fields).length > 0) throw new ApiError(422, 'validation_failed', 'There\u2019s a problem.', fields);

      const taken = await ctx.services.pool.query('SELECT 1 FROM ladders WHERE effective_on = $1', [effectiveOn!]);
      if (taken.rows.length > 0) {
        throw new ApiError(409, 'ladder_date_taken', `A ladder change already takes effect on ${effectiveOn}.`);
      }
      const id = crypto.randomUUID();
      await ctx.services.pool.query(
        `INSERT INTO ladders (id, effective_on, first_markdown_percent, first_markdown_day, second_markdown_percent, second_markdown_day, period_end_day)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, effectiveOn!, firstPercent!, firstDay!, secondPercent!, secondDay!, periodEndDay!]
      );
      const { rows } = await ctx.services.pool.query('SELECT * FROM ladders WHERE id = $1', [id]);
      sendJson(ctx.res, 201, { ladder: ladderJson(rows[0]!) });
    },
  },
];

function requireJson(ctx: RouteContext): void {
  const type = ctx.req.headers['content-type'] ?? '';
  if (!type.toLowerCase().startsWith('application/json')) {
    throw new ApiError(415, 'unsupported_media_type', 'Send JSON with a content type of application/json.');
  }
}
