import { StaffRow } from '../data';
import { newId, query, queryOne } from '../db';
import { conflict, notFound } from '../http/errors';
import { Route, defineRoute, jsonBody } from '../http/kernel';
import { Role, endAllSessions, hashPassword } from '../http/sessions';
import { copy } from '../shared/copy';
import { FieldErrors, validEmail, validName, validPassword } from './validate';

const STAFF_ROLES: Role[] = ['specialist', 'coordinator', 'billingLead'];

function staffView(staff: StaffRow): { id: string; name: string; email: string; role: Role } {
  return { id: staff.id, name: staff.name, email: staff.email, role: staff.role };
}

async function requireStaff(id: string): Promise<StaffRow> {
  const staff = await queryOne<StaffRow>(
    'select * from staff where id = $1 and removed_at is null',
    [id],
  );
  if (!staff) throw notFound();
  return staff;
}

function validRole(value: unknown): Role | null {
  return typeof value === 'string' && (STAFF_ROLES as string[]).includes(value)
    ? (value as Role)
    : null;
}

export const staffRoutes: Route[] = [
  defineRoute({
    method: 'GET',
    path: '/api/staff',
    access: ['owner'],
    handler: async () => {
      const rows = await query<StaffRow>(
        'select * from staff where removed_at is null order by role, name',
      );
      return { status: 200, json: { staff: rows.map(staffView) } };
    },
  }),
  defineRoute({
    method: 'POST',
    path: '/api/staff',
    access: ['owner'],
    handler: async (ctx) => {
      const body = jsonBody<Record<string, unknown>>(ctx);
      const errors = new FieldErrors();
      const name = validName(body.name);
      if (!name) errors.add('name', copy.fieldName);
      const email = validEmail(body.email);
      if (!email) errors.add('email', copy.fieldEmail);
      const password = validPassword(body.password);
      if (!password) errors.add('password', copy.fieldPassword);
      const role = validRole(body.role);
      if (!role) errors.add('role', copy.fieldChooseOption);
      errors.throwIfAny();
      const takenStaff = await queryOne<{ id: string }>(
        'select id from staff where lower(email) = lower($1) and removed_at is null',
        [email],
      );
      const takenMember = await queryOne<{ id: string }>(
        'select id from members where lower(email) = lower($1)',
        [email],
      );
      if (takenStaff || takenMember) throw conflict('email_taken', copy.emailTaken);
      const id = newId();
      await query(
        'insert into staff (id, name, email, password_hash, role) values ($1, $2, $3, $4, $5)',
        [id, name, email, hashPassword(password as string), role],
      );
      const created = await requireStaff(id);
      return { status: 201, json: { staff: staffView(created) } };
    },
  }),
  defineRoute({
    method: 'GET',
    path: '/api/staff/:staffId',
    access: ['owner'],
    resolve: async (ctx) => requireStaff(ctx.params.staffId as string),
    handler: async (_ctx, staff) => ({ status: 200, json: { staff: staffView(staff) } }),
  }),
  defineRoute({
    method: 'PATCH',
    path: '/api/staff/:staffId',
    access: ['owner'],
    resolve: async (ctx) => requireStaff(ctx.params.staffId as string),
    handler: async (ctx, staff) => {
      const body = jsonBody<Record<string, unknown>>(ctx);
      const errors = new FieldErrors();
      const role = validRole(body.role);
      if (!role) errors.add('role', copy.fieldChooseOption);
      errors.throwIfAny();
      if (staff.role === 'owner') throw conflict('owner_stays', copy.ownerStays);
      await query('update staff set role = $2 where id = $1', [staff.id, role]);
      const updated = await requireStaff(staff.id);
      return { status: 200, json: { staff: staffView(updated) } };
    },
  }),
  defineRoute({
    method: 'DELETE',
    path: '/api/staff/:staffId',
    access: ['owner'],
    resolve: async (ctx) => requireStaff(ctx.params.staffId as string),
    handler: async (_ctx, staff) => {
      if (staff.role === 'owner') throw conflict('owner_stays', copy.ownerStays);
      await query('update staff set removed_at = now() where id = $1', [staff.id]);
      await endAllSessions('staff', staff.id);
      return { status: 204 };
    },
  }),
];
