import { Router, type Request } from 'express';
import { config } from '../config';
import { serverNow } from '../clock';
import { newId, one, query, transaction } from '../db';
import { AppError, invalid } from '../errors';
import { body, created, ok, route } from '../http';
import {
  createSession,
  hashPassword,
  isRole,
  newInviteToken,
  requireActor,
  requireCapability,
  ROLE_LABELS,
} from '../auth';
import { closeUserStreams, publish, publishToUser } from '../live';
import { sendMail } from '../mail';
import { loadProfile } from './session';

export const staffRouter = Router();

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function appUrl(request: Request): string {
  if (config.publicUrl) return config.publicUrl.replace(/\/$/, '');
  return `${request.protocol}://${request.get('host') ?? `127.0.0.1:${config.port}`}`;
}

staffRouter.get(
  '/api/staff',
  route(async (request) => {
    const actor = await requireActor(request);
    requireCapability(actor, 'manage.clinic');
    const rows = await query<{
      id: string;
      name: string;
      email: string;
      role: string;
      status: string;
    }>(
      'select id, name, email, role, status from users where clinic_id = $1 order by created_at',
      [actor.clinicId],
    );
    return ok({ staff: rows });
  }),
);

staffRouter.post(
  '/api/staff/invitations',
  route(async (request) => {
    const actor = await requireActor(request);
    requireCapability(actor, 'manage.clinic');
    const input = body(request);
    const email = typeof input.email === 'string' ? input.email.trim() : '';
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name) throw invalid('name', 'missing');
    if (name.length > 80) throw invalid('name');
    if (!email) throw invalid('email', 'missing');
    if (!EMAIL_PATTERN.test(email) || email.length > 200) throw invalid('email');
    if (!isRole(input.role)) throw invalid('role', input.role === undefined ? 'missing' : 'invalid');
    const role = input.role;

    const active = await one<{ id: string }>(
      `select id from users where lower(email) = lower($1) and status = 'Active'`,
      [email],
    );
    if (active) throw new AppError('email_taken');

    const result = await transaction(async (tx) => {
      const existing = await tx.one<{ id: string }>(
        'select id from users where lower(email) = lower($1) and clinic_id = $2',
        [email, actor.clinicId],
      );
      let userId: string;
      if (existing) {
        userId = existing.id;
        await tx.query(
          `update users set name = $2, role = $3, status = 'Invited', password_hash = null where id = $1`,
          [userId, name, role],
        );
        await tx.query('delete from invitations where user_id = $1', [userId]);
      } else {
        userId = newId();
        await tx.query(
          `insert into users (id, clinic_id, name, email, role, status) values ($1,$2,$3,$4,$5,'Invited')`,
          [userId, actor.clinicId, name, email, role],
        );
      }
      const token = newInviteToken();
      await tx.query('insert into invitations (token, user_id) values ($1,$2)', [token, userId]);
      return { userId, token };
    });

    const clinic = await one<{ name: string }>('select name from clinics where id = $1', [
      actor.clinicId,
    ]);
    await sendMail({
      to: email,
      subject: `You're invited to ${clinic?.name ?? 'Roundbook'} on Roundbook`,
      body: `Hello ${name},\n\nYou have been invited to ${clinic?.name ?? 'the clinic'} on Roundbook as ${
        ROLE_LABELS[role]
      }.\n\nSet your password here: ${appUrl(request)}/invite/${result.token}\n`,
    });
    publish(actor.clinicId, { kind: 'changed', topics: ['staff'] });
    return created({ id: result.userId, email, role, status: 'Invited' });
  }),
);

staffRouter.patch(
  '/api/staff/:id',
  route(async (request) => {
    const actor = await requireActor(request);
    const member = await one<{ id: string; name: string; status: string }>(
      `select id, name, status from users where id = $1 and clinic_id = $2 and status <> 'Removed'`,
      [request.params.id, actor.clinicId],
    );
    if (!member) throw new AppError('not_found');
    requireCapability(actor, 'manage.clinic');
    if (member.id === actor.id) throw new AppError('own_access');
    const input = body(request);
    if (!isRole(input.role)) throw invalid('role', input.role === undefined ? 'missing' : 'invalid');
    await query('update users set role = $2 where id = $1', [member.id, input.role]);
    publish(actor.clinicId, { kind: 'changed', topics: ['staff'] });
    publishToUser(member.id, { kind: 'role', role: input.role });
    return ok({
      id: member.id,
      name: member.name,
      role: input.role,
      status: member.status,
    });
  }),
);

staffRouter.delete(
  '/api/staff/:id',
  route(async (request) => {
    const actor = await requireActor(request);
    const member = await one<{ id: string; status: string }>(
      `select id, status from users where id = $1 and clinic_id = $2 and status <> 'Removed'`,
      [request.params.id, actor.clinicId],
    );
    if (!member) throw new AppError('not_found');
    requireCapability(actor, 'manage.clinic');
    if (member.id === actor.id) throw new AppError('own_access');
    await transaction(async (tx) => {
      await tx.query(`update users set status = 'Removed' where id = $1`, [member.id]);
      await tx.query('delete from sessions where user_id = $1', [member.id]);
    });
    closeUserStreams(member.id);
    publish(actor.clinicId, { kind: 'changed', topics: ['staff'] });
    return ok({ id: member.id, status: 'Removed' });
  }),
);

staffRouter.get(
  '/api/invitations/:token',
  route(async (request) => {
    const row = await one<{ email: string; name: string; clinic_name: string }>(
      `select u.email, u.name, c.name as clinic_name
         from invitations i join users u on u.id = i.user_id join clinics c on c.id = u.clinic_id
        where i.token = $1 and i.used_at is null`,
      [request.params.token],
    );
    if (!row) throw new AppError('not_found');
    return ok({ clinicName: row.clinic_name, email: row.email, name: row.name });
  }),
);

staffRouter.post(
  '/api/invitations/:token/accept',
  route(async (request, response) => {
    const row = await one<{ user_id: string }>(
      'select user_id from invitations where token = $1 and used_at is null',
      [request.params.token],
    );
    if (!row) throw new AppError('not_found');
    const input = body(request);
    const password = typeof input.password === 'string' ? input.password : '';
    if (password.length < 10) throw new AppError('weak_password', { field: 'password' });
    await transaction(async (tx) => {
      await tx.query(`update users set password_hash = $2, status = 'Active' where id = $1`, [
        row.user_id,
        hashPassword(password),
      ]);
      await tx.query('update invitations set used_at = $2 where token = $1', [
        request.params.token,
        new Date(serverNow()).toISOString(),
      ]);
    });
    await createSession(row.user_id, response);
    const profile = await loadProfile(row.user_id);
    publish(String((profile.clinic as { id: string }).id), { kind: 'changed', topics: ['staff'] });
    return ok({ user: profile });
  }),
);

