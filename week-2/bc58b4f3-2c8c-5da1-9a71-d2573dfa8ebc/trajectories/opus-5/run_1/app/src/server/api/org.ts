import type { SchedulerEntry } from '../../shared/contract.js';
import { hashPassword } from '../auth/passwords.js';
import { initialsFor } from '../db/seed.js';
import { queryAssignments } from '../db/assignments.js';
import { pool } from '../db/pool.js';
import { agencyDateString, instantOf } from '../../shared/zone.js';
import { billableKindOf } from '../domain/billing.js';
import { ApiError, fail } from '../http/errors.js';
import type { Reply, Route } from '../http/router.js';
import { FieldErrors, parseJsonBody, stringField } from '../http/validation.js';
import { chargesFor } from '../services/billing.js';
import { requireOrgId, requireRole } from './support.js';

const EMAIL_PATTERN = /^[^@\s]+@[^@\s.]+(?:\.[^@\s.]+)+$/;

const listSchedulers: Route = {
  method: 'GET',
  pattern: '/api/org/schedulers',
  body: 'none',
  auth: true,
  handler: async (ctx): Promise<Reply> => {
    requireRole(ctx, ['org_admin']);
    const orgId = requireOrgId(ctx);
    const result = await pool.query<SchedulerEntry>(
      `SELECT id, name, email, phone FROM users
       WHERE org_id = $1 AND role = 'scheduler' AND active
       ORDER BY id ASC`,
      [orgId],
    );
    return { status: 200, body: { schedulers: result.rows } };
  },
};

const addScheduler: Route = {
  method: 'POST',
  pattern: '/api/org/schedulers',
  body: 'json',
  auth: true,
  handler: async (ctx): Promise<Reply> => {
    requireRole(ctx, ['org_admin']);
    const orgId = requireOrgId(ctx);
    const body = parseJsonBody(ctx.rawBody);
    const name = stringField(body, 'name');
    const email = stringField(body, 'email');
    const phone = stringField(body, 'phone');
    const password = stringField(body, 'password');

    const taken = await pool.query('SELECT 1 FROM users WHERE lower(email) = lower($1)', [email]);
    if (taken.rows.length > 0) {
      fail('email_taken');
    }

    const errors = new FieldErrors();
    if (name.trim() === '' || name.length > 80) {
      errors.add('name', 'Give a name of up to 80 characters.');
    }
    if (!EMAIL_PATTERN.test(email)) {
      errors.add('email', 'Give a valid email address.');
    }
    if (phone.length < 7 || phone.length > 20) {
      errors.add('phone', 'Give a phone number of 7 to 20 characters.');
    }
    if (password.length < 12) {
      errors.add('password', 'Use at least 12 characters.');
    }
    errors.throwIfAny();

    const inserted = await pool.query<SchedulerEntry>(
      `INSERT INTO users (name, email, password_hash, role, org_id, phone, initials)
       VALUES ($1, $2, $3, 'scheduler', $4, $5, $6)
       RETURNING id, name, email, phone`,
      [name, email, await hashPassword(password), orgId, phone, initialsFor(name)],
    );
    const scheduler = inserted.rows[0];
    if (scheduler === undefined) {
      throw new Error('scheduler insert returned nothing');
    }
    return { status: 201, body: scheduler };
  },
};

const removeScheduler: Route = {
  method: 'DELETE',
  pattern: '/api/org/schedulers/:id',
  body: 'none',
  auth: true,
  handler: async (ctx): Promise<Reply> => {
    requireRole(ctx, ['org_admin']);
    const orgId = requireOrgId(ctx);
    const id = Number(ctx.params['id']);
    if (!Number.isInteger(id)) {
      fail('not_found');
    }
    const removed = await pool.query(
      "UPDATE users SET active = false WHERE id = $1 AND org_id = $2 AND role = 'scheduler' AND active",
      [id, orgId],
    );
    if (removed.rowCount === 0) {
      fail('not_found');
    }
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [id]);
    return { status: 204 };
  },
};

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

const STATEMENT_HEADER =
  'number,date,kind,language,setting,seats,billable_minutes,mileage_cents,total_cents,invoice_id';

const monthlyStatement: Route = {
  method: 'GET',
  pattern: '/api/org/statement',
  body: 'none',
  auth: true,
  handler: async (ctx): Promise<Reply> => {
    requireRole(ctx, ['org_admin']);
    const orgId = requireOrgId(ctx);
    const month = ctx.query.get('month') ?? '';
    const match = /^(\d{4})-(\d{2})$/.exec(month);
    if (match === null || Number(match[2]) < 1 || Number(match[2]) > 12) {
      throw new ApiError('validation', { month: 'Give a month as YYYY-MM.' });
    }
    const year = Number(match[1]);
    const monthNumber = Number(match[2]);
    const from = instantOf(year, monthNumber, 1, 0, 0);
    const to = instantOf(year, monthNumber + 1, 1, 0, 0);

    const records = await queryAssignments(pool, {
      orgId,
      billingStatuses: ['posted'],
      startsBetween: { from, to },
    });
    const lines = [STATEMENT_HEADER];
    for (const record of records) {
      const kind = billableKindOf(record);
      const charges = await chargesFor(pool, record);
      if (kind === null || charges === null) {
        continue;
      }
      const billableMinutes = charges.lines.reduce((sum, line) => sum + line.billable_minutes, 0);
      const mileageCents = charges.lines.reduce((sum, line) => sum + line.mileage_cents, 0);
      lines.push(
        [
          record.number,
          agencyDateString(record.start_at),
          kind,
          record.language_name,
          record.setting,
          String(record.seats.length),
          String(billableMinutes),
          String(mileageCents),
          String(charges.total_cents),
          record.invoice_id ?? '',
        ]
          .map(csvCell)
          .join(','),
      );
    }
    return {
      status: 200,
      raw: Buffer.from(`${lines.join('\n')}\n`, 'utf8'),
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="teamseat-${ctx.session.user.org_code ?? 'statement'}-${month}.csv"`,
      },
    };
  },
};

export const orgRoutes = [listSchedulers, addScheduler, removeScheduler, monthlyStatement];
