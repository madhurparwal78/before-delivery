import type { Route, RouteContext } from '../router.ts';
import { route } from '../router.ts';
import { ERRORS } from '../errors.ts';
import { asRecord, str, Validator } from '../validation.ts';
import { requireRole, MANAGER, STAFF } from './guards.ts';
import { revokeAllSessions } from '../session.ts';
import { startupState } from '../domain/care.ts';
import { zurichDateISO } from '../../shared/dates.ts';
import type { Tx } from '../db.ts';

function bodyOf(rc: RouteContext): Record<string, unknown> {
  return asRecord(rc.body);
}

export const boardRoutes: Route[] = [
  route('GET', '/api/board', {}, async (rc) => {
    requireRole(rc.viewer, MANAGER);
    const bays = await rc.ctx.db.query<{
      id: string; code: string; class: string; length_mm: number; width_mm: number;
      row_index: number; column_index: number; car_id: string | null; car_name: string | null;
    }>(
      `SELECT b.id, b.code, b.class, b.length_mm, b.width_mm, b.row_index, b.column_index,
        c.id AS car_id, CASE WHEN c.id IS NULL THEN NULL ELSE concat(c.year, ' ', c.make, ' ', c.model) END AS car_name
       FROM bays b LEFT JOIN cars c ON c.bay_id = b.id
       ORDER BY b.row_index, b.column_index`,
    );
    const overdue = await rc.ctx.db.query<{
      car_id: string; car_name: string; bay_code: string | null;
      startup_scheduled: boolean; intake_at: string | null;
    }>(
      `SELECT c.id AS car_id, concat(c.year, ' ', c.make, ' ', c.model) AS car_name, b.code AS bay_code,
        c.startup_scheduled, c.intake_at
       FROM cars c LEFT JOIN bays b ON b.id = c.bay_id
       WHERE c.status = 'stored'
       ORDER BY b.code`,
    );
    const overdueRows = [];
    for (const car of overdue) {
      const last = await rc.ctx.db.query<{ at: string }>(
        `SELECT at FROM care_entries WHERE car_id = $1 AND started = TRUE ORDER BY at DESC LIMIT 1`,
        [car.car_id],
      );
      const state = !car.startup_scheduled
        ? { scheduled: false, last_at: null, next_due: null, status: 'not_scheduled' }
        : startupState(true, last[0]?.at ?? null, car.intake_at, rc.ctx.env.timers.startupOverdueSeconds, Date.now(), (ms) => zurichDateISO(new Date(ms)));
      if (state.status === 'overdue') {
        overdueRows.push({
          car: { id: car.car_id, name: car.car_name },
          bay_code: car.bay_code ?? '',
          startup: state,
        });
      }
    }
    overdueRows.sort((a, b) => a.bay_code.localeCompare(b.bay_code));

    const invoices = await rc.ctx.db.query<{
      id: string; number: string; job_id: string; car_id: string; car_name: string;
      owner_id: string; owner_name: string; owner_email: string;
      net_total: string; vat_total: string; rounding: string; total: string; issued_at: string;
      balance: string; balance_live: boolean; paid_at: string | null;
      status_confirmed_at: string | null; killbill_invoice_id: string | null;
    }>(
      `SELECT i.id, i.number, i.job_id, j.car_id,
        concat(c.year, ' ', c.make, ' ', c.model) AS car_name,
        c.owner_id, u.name AS owner_name, u.email AS owner_email,
        i.net_total, i.vat_total, i.rounding, i.total, i.issued_at,
        i.balance, i.balance_live, i.paid_at, i.status_confirmed_at, i.killbill_invoice_id
       FROM invoices i
       JOIN jobs j ON j.id = i.job_id
       JOIN cars c ON c.id = j.car_id
       JOIN users u ON u.id = c.owner_id
       ORDER BY i.number`,
    );
    const { projectInvoice, refreshInvoice } = await import('./jobs.ts');
    const unpaidInvoices = [];
    let unpaidTotal = 0;
    let live = true;
    let earliestConfirmed: string | null = null;
    for (const invoice of invoices) {
      await refreshInvoice(rc, null, invoice);
      if (Number(invoice.balance) > 0) {
        unpaidTotal += Number(invoice.balance);
        unpaidInvoices.push(await projectInvoice(rc, invoice));
        if (!invoice.balance_live) {
          live = false;
          if (!earliestConfirmed || invoice.status_confirmed_at! < earliestConfirmed) {
            earliestConfirmed = invoice.status_confirmed_at;
          }
        }
      }
    }
    return {
      status: 200,
      body: {
        occupancy: {
          occupied: bays.filter((bay) => bay.car_id !== null).length,
          total: bays.length,
        },
        bays,
        overdue: overdueRows,
        unpaid: {
          invoices: unpaidInvoices,
          total: unpaidTotal.toFixed(2),
          live,
          last_confirmed_at: earliestConfirmed,
        },
      },
    };
  }),

  route('GET', '/api/staff', {}, async (rc) => {
    requireRole(rc.viewer, MANAGER);
    const staff = await rc.ctx.db.query<{
      id: string; name: string; email: string; role: string; active: boolean;
      revoked_at: string | null; last_sign_in_at: string | null;
    }>(
      `SELECT id, name, email, role, active, revoked_at, last_sign_in_at
       FROM users WHERE role <> 'owner' ORDER BY name`,
    );
    return {
      status: 200,
      body: {
        staff: staff.map((member) => ({
          id: member.id,
          name: member.name,
          email: member.email,
          role: member.role,
          active: member.active,
          revoked_at: member.revoked_at,
          last_sign_in_at: member.last_sign_in_at,
        })),
      },
    };
  }),

  route('PATCH', '/api/staff/{id}', {}, async (rc) => {
    const record = bodyOf(rc);
    const member = await rc.ctx.db.query<{ id: string; role: string; active: boolean }>(
      `SELECT id, role, active FROM users WHERE id = $1 AND role <> 'owner'`,
      [rc.params['id'] as string],
    );
    if (!member[0]) throw ERRORS.notFound();
    requireRole(rc.viewer, MANAGER);
    const v = new Validator();
    const active = record['active'];
    v.check(active === true || active === false, 'active', 'Choose a state.');
    v.throwIfInvalid();
    if (member[0].id === rc.viewer.id) {
      throw ERRORS.conflict('cannot_change_own_access');
    }
    const result = await rc.ctx.db.withTx(async (tx) => {
      await tx.query(`UPDATE users SET active = $2,
        revoked_at = CASE WHEN $2 THEN NULL ELSE now() END WHERE id = $1`, [member[0].id, active]);
      if (active === false) {
        await revokeAllSessionsInTx(tx, member[0].id);
      }
      const fresh = (
        await tx.query<{
          id: string; name: string; email: string; role: string; active: boolean;
          revoked_at: string | null; last_sign_in_at: string | null;
        }>(
          `SELECT id, name, email, role, active, revoked_at, last_sign_in_at FROM users WHERE id = $1`,
          [member[0].id],
        )
      ).rows[0];
      return fresh;
    });
    return {
      status: 200,
      body: {
        member: {
          id: result.id,
          name: result.name,
          email: result.email,
          role: result.role,
          active: result.active,
          revoked_at: result.revoked_at,
          last_sign_in_at: result.last_sign_in_at,
        },
      },
    };
  }),
];

async function revokeAllSessionsInTx(tx: Tx, userId: string): Promise<void> {
  await tx.query(
    `UPDATE sessions SET end_reason = 'revoked' WHERE user_id = $1 AND end_reason IS NULL`,
    [userId],
  );
}
