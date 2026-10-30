import { findAssignments } from '../../db/assignments.js';
import { query, queryOne } from '../../db/pool.js';
import { listRateEntries } from '../../db/rateCards.js';
import { initialsOf } from '../../db/seed.js';
import { centralDateKey, instantFromCentral } from '../../../shared/centralTime.js';
import { hashPassword } from '../../security.js';
import { chargesOf } from '../../services/billing.js';
import { fail } from '../errors.js';
import type { Route } from '../router.js';
import { deleteSessionsOfUser } from '../session.js';
import { EMAIL_PATTERN, stringOf } from '../validation.js';

const STATEMENT_HEADER =
  'number,date,kind,language,setting,seats,billable_minutes,mileage_cents,total_cents,invoice_id';

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const orgRoutes: Route[] = [
  {
    kind: 'session',
    method: 'GET',
    path: '/api/org/schedulers',
    body: 'none',
    roles: ['org_admin'],
    async handler(ctx) {
      const rows = await query<{ id: string; name: string; email: string; phone: string }>(
        `select id, name, email, phone from users
         where org_code = $1 and role = 'scheduler' and active order by name`,
        [ctx.user.orgCode ?? ''],
      );
      return { status: 200, json: { schedulers: rows } };
    },
  },
  {
    kind: 'session',
    method: 'POST',
    path: '/api/org/schedulers',
    body: 'json',
    roles: ['org_admin'],
    async handler(ctx) {
      const name = stringOf(ctx.json['name']);
      const email = stringOf(ctx.json['email']);
      const phone = stringOf(ctx.json['phone']);
      const password = stringOf(ctx.json['password']);

      if (email !== null) {
        const taken = await queryOne<{ id: string }>(
          'select id from users where lower(email) = lower($1)',
          [email],
        );
        if (taken !== null) fail('email_taken');
      }

      const errors: Record<string, string> = {};
      if (name === null || name.trim() === '' || name.length > 80) {
        errors['name'] = 'Enter a name of up to 80 characters.';
      }
      if (email === null || !EMAIL_PATTERN.test(email)) {
        errors['email'] = 'Enter a valid email address.';
      }
      if (phone === null || phone.trim().length < 7 || phone.trim().length > 20) {
        errors['phone'] = 'Enter a phone number of 7 to 20 characters.';
      }
      if (password === null || password.length < 12) {
        errors['password'] = 'Use at least 12 characters.';
      }
      if (
        name === null ||
        email === null ||
        phone === null ||
        password === null ||
        Object.keys(errors).length > 0
      ) {
        fail('validation', errors);
      }

      const created = await queryOne<{ id: string; name: string; email: string; phone: string }>(
        `insert into users (name, email, role, org_code, phone, initials, password_hash)
         values ($1, $2, 'scheduler', $3, $4, $5, $6)
         returning id, name, email, phone`,
        [
          name.trim(),
          email,
          ctx.user.orgCode ?? '',
          phone.trim(),
          initialsOf(name.trim()),
          await hashPassword(password),
        ],
      );
      if (created === null) throw new Error('Scheduler insert returned no row');
      return { status: 201, json: created };
    },
  },
  {
    kind: 'session',
    method: 'DELETE',
    path: '/api/org/schedulers/:id',
    body: 'none',
    roles: ['org_admin'],
    async handler(ctx) {
      const id = ctx.params['id'] ?? '';
      if (!/^[0-9a-fA-F-]{36}$/.test(id)) fail('not_found');
      const scheduler = await queryOne<{ id: string }>(
        `select id from users where id = $1 and org_code = $2 and role = 'scheduler' and active`,
        [id, ctx.user.orgCode ?? ''],
      );
      if (scheduler === null) fail('not_found');
      await query('update users set active = false where id = $1', [scheduler.id]);
      await deleteSessionsOfUser(scheduler.id);
      return { status: 204 };
    },
  },
  {
    kind: 'session',
    method: 'GET',
    path: '/api/org/statement',
    body: 'none',
    roles: ['org_admin'],
    async handler(ctx) {
      const month = ctx.url.searchParams.get('month') ?? '';
      const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
      if (match === null) fail('validation', { month: 'Use a month written as YYYY-MM.' });
      const year = Number.parseInt(match[1] as string, 10);
      const monthNumber = Number.parseInt(match[2] as string, 10);
      const from = instantFromCentral(year, monthNumber, 1, 0, 0);
      const to = instantFromCentral(monthNumber === 12 ? year + 1 : year, (monthNumber % 12) + 1, 1, 0, 0);

      const records = await findAssignments(
        `a.org_code = $1 and a.billing_status = 'posted' and a.start_at >= $2 and a.start_at < $3`,
        [ctx.user.orgCode ?? '', from, to],
      );
      const rates = await listRateEntries(ctx.user.orgCode ?? '');
      const lines = [STATEMENT_HEADER];
      for (const record of records) {
        const charges = chargesOf(record, rates);
        const billableMinutes = charges.lines.reduce((sum, line) => sum + line.billableMinutes, 0);
        const mileageCents = charges.lines.reduce((sum, line) => sum + line.mileageCents, 0);
        lines.push(
          [
            record.number,
            centralDateKey(record.startAt),
            charges.kind,
            record.languageName,
            record.setting,
            record.seatCount,
            billableMinutes,
            mileageCents,
            record.totalCents ?? charges.totalCents,
            record.invoiceId ?? '',
          ]
            .map(csvCell)
            .join(','),
        );
      }
      return {
        status: 200,
        body: Buffer.from(`${lines.join('\n')}\n`, 'utf8'),
        contentType: 'text/csv; charset=utf-8',
        headers: {
          'Content-Disposition': `attachment; filename="statement-${ctx.user.orgCode ?? ''}-${month}.csv"`,
        },
      };
    },
  },
];
