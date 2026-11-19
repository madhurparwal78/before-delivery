/**
 * The search box, which answers from Meilisearch and nothing else, and the
 * public enquiry form.
 */
import { F } from '../../shared/feedback.ts';
import { ENQUIRY_LIMIT } from '../config.ts';
import { BUSINESS_ZONE, localMinuteCeil } from '../domain/time.ts';
import { fail } from '../http/errors.ts';
import { checkQueryText, Check, LIMITS } from '../http/validate.ts';
import { QUERY_TEXT_LIMIT } from '../http/request.ts';
import type { Route } from '../http/context.ts';
import type { Row } from '../present.ts';
import { SearchUnavailable } from '../services/search.ts';
import { queueEnquiryLetter } from '../features/letters.ts';

export const searchRoutes: readonly Route[] = [
  {
    method: 'GET',
    pattern: '/api/search',
    auth: 'required',
    async handle(ctx) {
      const desk = ctx.requireDesk();
      const text = ctx.query('q') ?? '';
      checkQueryText(text, QUERY_TEXT_LIMIT);
      if (text.trim().length === 0) {
        ctx.json(200, { results: [] });
        return;
      }
      try {
        const hits = await ctx.app.search.query(desk.id, text, 20);
        ctx.json(200, { results: hits });
      } catch (error) {
        if (!(error instanceof SearchUnavailable)) throw error;
        throw fail.unavailable(F.searchDown);
      }
    },
  },
];

export const enquiryRoutes: readonly Route[] = [
  {
    method: 'POST',
    pattern: '/api/enquiries',
    auth: 'none',
    body: 'json',
    async handle(ctx) {
      const check = new Check(ctx.body);
      const name = check.text('name', LIMITS.enquiryName);
      const email = check.email('email') as string | null;
      const message = check.text('message', LIMITS.enquiryMessage);

      // The limit is counted per address, so it needs a readable one first.
      if (email) {
        const windowMs = ctx.app.config.timers.enquiryRateWindowSeconds * 1000;
        const since = new Date(ctx.app.now() - windowMs);
        const rows = await ctx.app.db.query<Row>(
          `SELECT at FROM enquiries WHERE email_lower = lower($1) AND at > $2 ORDER BY at`,
          [email, since],
        );
        if (rows.length >= ENQUIRY_LIMIT) {
          // The window starts at the first one.
          const retryAt = new Date(rows[0]!.at as string).getTime() + windowMs;
          throw fail.rateLimited(
            F.enquiryBusy(localMinuteCeil(BUSINESS_ZONE, retryAt)),
            (retryAt - ctx.app.now()) / 1000,
          );
        }
      }
      check.done();

      await ctx.app.db.query(`INSERT INTO enquiries (email_lower) VALUES (lower($1))`, [email]);
      await queueEnquiryLetter(ctx.app, { name: name!, email: email!, message: message! });

      // The answer is the same for a new address and a known one.
      ctx.json(202, { received: true });
    },
  },
];
