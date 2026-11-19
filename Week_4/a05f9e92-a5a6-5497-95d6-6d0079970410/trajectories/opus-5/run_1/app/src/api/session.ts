/**
 * Session, users, groups, departments, impersonation and the audit log.
 */

import { iso, now } from '../clock';
import { query, transaction } from '../db';
import { ApiError, notFound, operatorOnly, validation } from '../errors';
import { isRoleKey, type RoleKey } from '../domain/roles';
import { isValidZone } from '../domain/zone';
import {
  callerOf,
  checkLoginRate,
  createSession,
  deleteSession,
  requireCaller,
  requireOperator,
  requireRoles,
  sessionCookie,
  type RequestContext,
} from '../http/context';
import { publishToUser } from '../services/live';
import { loadGroups, loadPerson, loadPeople, type Person } from '../services/store';
import { hashPassword, newSalt, verifyPassword } from '../seed';
import { created, noContent, ok, route, type RouteResult } from './router';

function userJson(person: Person): Record<string, unknown> {
  return {
    username: person.username,
    display_name: person.displayName,
    roles: person.roles,
    department: person.department,
    time_zone: person.timeZone,
  };
}

function fullUserJson(person: Person): Record<string, unknown> {
  return {
    ...userJson(person),
    out_of_office: person.outOfOffice,
    capacity: person.capacity,
    active: person.active,
    delegate: person.delegate,
  };
}

route('POST', '/api/session', async (context): Promise<RouteResult> => {
  const username = String(context.body.username ?? '');
  const password = String(context.body.password ?? '');
  // The attempt is counted and checked before the credentials are read.
  checkLoginRate(username);
  const person = await loadPerson(username);
  const stored = person
    ? (await query<{ password_hash: string | null }>(`SELECT password_hash FROM person WHERE username = $1`, [
        username,
      ]))[0]?.password_hash
    : null;
  if (!person || !person.canSignIn || !person.active || !verifyPassword(password, stored ?? null)) {
    throw new ApiError(401, 'bad_credentials', 'That username and password do not match.');
  }
  const id = await createSession(username);
  return {
    status: 200,
    body: { user: userJson(person) },
    headers: {
      'set-cookie': `${sessionCookie}=${id}; Path=/; HttpOnly; SameSite=Lax`,
    },
  };
});

route('GET', '/api/session', async (context) => {
  const caller = requireCaller(context);
  const actor = await loadPerson(caller.actor);
  const subject = await loadPerson(caller.username);
  return ok({
    user: subject ? fullUserJson(subject) : null,
    workspace: caller.workspace,
    impersonating: caller.impersonating && subject ? { username: subject.username, display_name: subject.displayName } : null,
    actor: actor ? { username: actor.username, display_name: actor.displayName } : null,
  });
});

route('DELETE', '/api/session', async (context) => {
  requireCaller(context);
  if (context.session) await deleteSession(context.session.id);
  return {
    status: 204,
    headers: { 'set-cookie': `${sessionCookie}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` },
  };
});

route('PUT', '/api/session/workspace', async (context) => {
  requireOperator(context);
  const workspace = context.body.workspace === 'test' ? 'test' : 'live';
  if (context.session) {
    await query(`UPDATE session SET workspace = $2 WHERE id = $1`, [context.session.id, workspace]);
  }
  return ok({ workspace });
});

route('POST', '/api/impersonate', async (context) => {
  const caller = requireOperator(context);
  const username = String(context.body.username ?? '');
  const target = await loadPerson(username);
  if (!target) throw notFound();
  await transaction(async (client) => {
    await client.query(`UPDATE session SET impersonating = $2 WHERE id = $1`, [
      context.session?.id ?? '',
      username,
    ]);
    await client.query(
      `INSERT INTO audit_log (at, kind, actor, target) VALUES ($1, 'impersonation_started', $2, $3)`,
      [now(), caller.actor, username],
    );
  });
  return ok({ impersonating: { username: target.username, display_name: target.displayName } });
});

route('DELETE', '/api/impersonate', async (context) => {
  // The operator behind the impersonation stops it, so the actor is checked,
  // not the person being impersonated.
  const caller = requireCaller(context);
  const actor = await loadPerson(caller.actor);
  if (!actor || !actor.roles.includes('operator')) throw operatorOnly();
  if (!caller.impersonating) throw notFound();
  await transaction(async (client) => {
    await client.query(`UPDATE session SET impersonating = NULL WHERE id = $1`, [context.session?.id ?? '']);
    await client.query(
      `INSERT INTO audit_log (at, kind, actor, target) VALUES ($1, 'impersonation_stopped', $2, $3)`,
      [now(), caller.actor, caller.username],
    );
  });
  return noContent();
});

route('GET', '/api/audit-log', async (context) => {
  requireOperator(context);
  const kind = context.url.searchParams.get('kind');
  const rows = kind
    ? await query<{ at: Date; kind: string; actor: string; target: string | null }>(
        `SELECT at, kind, actor, target FROM audit_log WHERE kind = $1 ORDER BY id DESC`,
        [kind],
      )
    : await query<{ at: Date; kind: string; actor: string; target: string | null }>(
        `SELECT at, kind, actor, target FROM audit_log ORDER BY id DESC`,
      );
  return ok({
    entries: rows.map((r) => ({ at: iso(r.at), kind: r.kind, actor: r.actor, target: r.target })),
  });
});

route('GET', '/api/users', async (context) => {
  requireRoles(context, ['operator', 'technician']);
  const people = await loadPeople();
  return ok({ users: people.filter((p) => p.canSignIn).map(fullUserJson) });
});

function readRoles(value: unknown): RoleKey[] {
  if (!Array.isArray(value)) return [];
  const roles: RoleKey[] = [];
  for (const item of value) {
    const text = String(item);
    if (!isRoleKey(text)) throw validation(`"${text}" is not a role.`);
    roles.push(text);
  }
  return roles;
}

route('POST', '/api/users', async (context) => {
  requireOperator(context);
  const username = String(context.body.username ?? '').trim();
  if (username === '') throw validation('Username is required.', { username: 'Username is required.' });
  if (await loadPerson(username)) throw validation('That username is taken.', { username: 'That username is taken.' });
  const password = String(context.body.password ?? '');
  const zone = String(context.body.time_zone ?? 'Europe/Berlin');
  if (!isValidZone(zone)) throw validation('Time zone is not a zone.', { time_zone: 'Time zone is not a zone.' });
  await query(
    `INSERT INTO person (username, display_name, department, password_hash, roles, time_zone,
                         out_of_office, capacity, active, can_sign_in)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, TRUE)`,
    [
      username,
      String(context.body.display_name ?? username),
      context.body.department ?? null,
      password === '' ? null : hashPassword(password, newSalt()),
      JSON.stringify(readRoles(context.body.roles)),
      zone,
      context.body.out_of_office === true,
      context.body.capacity === null || context.body.capacity === undefined ? null : Number(context.body.capacity),
      context.body.active !== false,
    ],
  );
  const person = await loadPerson(username);
  return created({ user: person ? fullUserJson(person) : null });
});

route('PATCH', '/api/users/:username', async (context, params) => {
  requireOperator(context);
  const person = await loadPerson(params.username);
  if (!person) throw notFound();
  const body = context.body;
  const sets: string[] = [];
  const values: unknown[] = [params.username];
  const add = (column: string, value: unknown, cast = ''): void => {
    values.push(value);
    sets.push(`${column} = $${values.length}${cast}`);
  };
  if ('display_name' in body) add('display_name', String(body.display_name ?? ''));
  if ('department' in body) add('department', body.department ?? null);
  if ('roles' in body) add('roles', JSON.stringify(readRoles(body.roles)), '::jsonb');
  if ('time_zone' in body) {
    const zone = String(body.time_zone ?? '');
    if (!isValidZone(zone)) throw validation('Time zone is not a zone.', { time_zone: 'Time zone is not a zone.' });
    add('time_zone', zone);
  }
  if ('out_of_office' in body) add('out_of_office', body.out_of_office === true);
  if ('capacity' in body) add('capacity', body.capacity === null ? null : Number(body.capacity));
  if ('active' in body) add('active', body.active !== false);
  if ('password' in body) add('password_hash', hashPassword(String(body.password ?? ''), newSalt()));
  if (sets.length > 0) {
    await query(`UPDATE person SET ${sets.join(', ')} WHERE username = $1`, values);
  }
  const updated = await loadPerson(params.username);
  // A role change reaches the affected person's open pages without a reload.
  publishToUser(params.username, { topic: 'session', event: 'access', data: { reason: 'roles' } });
  return ok({ user: updated ? fullUserJson(updated) : null });
});

route('PUT', '/api/users/:username/delegate', async (context, params) => {
  const caller = requireCaller(context);
  const isSelf = caller.username === params.username && caller.roles.includes('approver');
  if (!isSelf && !caller.roles.includes('operator')) throw operatorOnly();
  const person = await loadPerson(params.username);
  if (!person) throw notFound();
  const delegate = context.body.delegate;
  if (delegate === null) {
    await query(
      `UPDATE person SET delegate = NULL, delegate_from = NULL, delegate_to = NULL WHERE username = $1`,
      [params.username],
    );
  } else {
    const target = await loadPerson(String(delegate));
    if (!target) throw validation('That delegate does not exist.', { delegate: 'That delegate does not exist.' });
    const from = Date.parse(String(context.body.from ?? ''));
    const to = Date.parse(String(context.body.to ?? ''));
    if (Number.isNaN(from) || Number.isNaN(to)) {
      throw validation('A delegation needs a from and a to.', { from: 'A delegation needs a from and a to.' });
    }
    await query(`UPDATE person SET delegate = $2, delegate_from = $3, delegate_to = $4 WHERE username = $1`, [
      params.username,
      target.username,
      new Date(from),
      new Date(to),
    ]);
  }
  const updated = await loadPerson(params.username);
  return ok({ user: updated ? fullUserJson(updated) : null });
});

route('GET', '/api/groups', async (context) => {
  requireRoles(context, ['operator', 'technician']);
  const groups = await loadGroups();
  return ok({
    groups: groups.map((g) => ({
      name: g.name,
      members: g.members,
      escalation_policy: g.escalationPolicy,
    })),
  });
});

route('POST', '/api/groups', async (context) => {
  requireOperator(context);
  const name = String(context.body.name ?? '').trim();
  if (name === '') throw validation('Name is required.', { name: 'Name is required.' });
  await query(
    `INSERT INTO work_group (name, members, escalation_policy) VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (name) DO UPDATE SET members = $2::jsonb, escalation_policy = $3`,
    [name, JSON.stringify(context.body.members ?? []), context.body.escalation_policy ?? null],
  );
  return created({
    group: { name, members: context.body.members ?? [], escalation_policy: context.body.escalation_policy ?? null },
  });
});

route('PATCH', '/api/groups/:name', async (context, params) => {
  requireOperator(context);
  const groups = await loadGroups();
  const group = groups.find((g) => g.name === params.name);
  if (!group) throw notFound();
  const members = 'members' in context.body ? context.body.members : group.members;
  const policy = 'escalation_policy' in context.body ? context.body.escalation_policy : group.escalationPolicy;
  await query(`UPDATE work_group SET members = $2::jsonb, escalation_policy = $3 WHERE name = $1`, [
    params.name,
    JSON.stringify(members ?? []),
    policy ?? null,
  ]);
  return ok({ group: { name: params.name, members, escalation_policy: policy ?? null } });
});

route('GET', '/api/departments', async (context) => {
  requireCaller(context);
  const people = await loadPeople();
  const counts = new Map<string, number>();
  for (const person of people) {
    if (!person.department) continue;
    counts.set(person.department, (counts.get(person.department) ?? 0) + 1);
  }
  const rows = await query<{ name: string }>(`SELECT name FROM department ORDER BY name`);
  return ok({ departments: rows.map((r) => ({ name: r.name, members: counts.get(r.name) ?? 0 })) });
});

export { callerOf };
