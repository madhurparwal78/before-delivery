import { query } from '../db';
import { fail } from '../http/errors';
import type { Route } from '../http/pipeline';
import { BAY_SELECT, CAR_SELECT, toBay, toCar, type BayRow, type CarRow } from '../domain/cars';
import { buildInvoiceList, loadInvoiceRows } from '../domain/invoices';
import { endSessionsOf } from '../domain/session';
import type { Member, Role } from '../../shared/types';

interface MemberRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  revoked_at: Date | null;
  last_sign_in_at: Date | null;
}

function toMember(row: MemberRow): Member {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    active: row.active,
    revoked_at: row.revoked_at?.toISOString() ?? null,
    last_sign_in_at: row.last_sign_in_at?.toISOString() ?? null,
  };
}

export const boardRoutes: readonly Route[] = [
  {
    method: 'GET',
    pattern: '/api/board',
    body: 'none',
    session: 'required',
    async handle(ctx) {
      ctx.requireRole('house_manager');
      const [bayRows, carRows, invoiceRows] = await Promise.all([
        query<BayRow>(BAY_SELECT),
        query<CarRow>(`${CAR_SELECT} where c.status = 'stored'`),
        loadInvoiceRows(null),
      ]);
      const bays = bayRows.map(toBay);
      const occupied = bays.filter((bay) => bay.car !== null).length;
      const overdue = carRows
        .map((row) => toCar(row, ctx.now))
        .filter((car) => car.startup.status === 'overdue')
        .map((car) => ({
          car: { id: car.id, name: car.name },
          bay_code: car.bay?.code ?? '',
          startup: car.startup,
        }))
        .sort((left, right) => left.bay_code.localeCompare(right.bay_code));
      const list = await buildInvoiceList(invoiceRows);
      const unpaidInvoices = list.invoices.filter((invoice) => invoice.status !== 'paid');
      return {
        kind: 'json',
        status: 200,
        body: {
          occupancy: { occupied, total: bays.length },
          bays,
          overdue,
          unpaid: {
            invoices: unpaidInvoices,
            total: list.unpaidTotal,
            live: list.live,
          },
        },
      };
    },
  },
  {
    method: 'GET',
    pattern: '/api/staff',
    body: 'none',
    session: 'required',
    async handle(ctx) {
      ctx.requireRole('house_manager');
      const rows = await query<MemberRow>(
        `select id, name, email, role, active, revoked_at, last_sign_in_at
         from users where role <> 'owner' order by name`,
      );
      return { kind: 'json', status: 200, body: { staff: rows.map(toMember) } };
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/staff/:id',
    body: 'json',
    session: 'required',
    async handle(ctx) {
      const memberId = ctx.params.id ?? '';
      const rows = await query<MemberRow>(
        `select id, name, email, role, active, revoked_at, last_sign_in_at
         from users where id = $1 and role <> 'owner'`,
        [memberId],
      );
      if (rows[0] === undefined) throw fail.notFound();
      ctx.requireRole('house_manager');
      if (memberId === ctx.user().id) throw fail.conflict('cannot_change_own_access');
      if (typeof ctx.body.active !== 'boolean') {
        throw fail.validation({ active: 'Choose whether access is active.' });
      }
      if (ctx.body.active) {
        await query('update users set active = true, revoked_at = null where id = $1', [memberId]);
      } else {
        await query('update users set active = false, revoked_at = $2 where id = $1', [
          memberId,
          ctx.now,
        ]);
        await endSessionsOf(memberId);
      }
      const after = await query<MemberRow>(
        `select id, name, email, role, active, revoked_at, last_sign_in_at
         from users where id = $1`,
        [memberId],
      );
      const member = after[0];
      if (member === undefined) throw fail.notFound();
      return { kind: 'json', status: 200, body: { member: toMember(member) } };
    },
  },
];
