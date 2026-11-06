import { Router } from 'express';
import { many, one, pool, withTransaction } from '../db/pool.js';
import { hashPassword, newId } from '../lib/codes.js';
import { conflict, notFound, staleVersion, versionRequired } from '../lib/errors.js';
import { requireRole, type Role } from '../http/middleware.js';
import {
  asInteger,
  asString,
  asTrimmed,
  ErrorBag,
  expectObject,
  fail,
  looksLikeEmail,
} from '../http/validate.js';
import { writeAudit } from '../domain/audit.js';
import { loadEdition, loadPricePolicy } from '../domain/programme.js';
import { toUtcIso, isDateOnly } from '../lib/time.js';

export const adminRouter = Router();

const ROLES: readonly Role[] = [
  'visitor',
  'group_booker',
  'artist',
  'curator',
  'box_office',
  'finance',
  'admin',
];

interface StaffRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  organisation_id: string | null;
}

adminRouter.get('/admin/staff', async (req, res) => {
  requireRole(req, 'admin');
  const users = await many<StaffRow>(
    pool,
    `SELECT id, email, name, role, organisation_id FROM users ORDER BY role, email`,
  );
  res.status(200).json({ users });
});

adminRouter.post('/admin/staff', async (req, res) => {
  const caller = requireRole(req, 'admin');
  const body = expectObject(req.body);
  const bag = new ErrorBag();
  const email = asTrimmed(body['email']);
  const name = asTrimmed(body['name']);
  const password = asString(body['password']);
  const role = asTrimmed(body['role']);
  const organisationId = asTrimmed(body['organisation_id']);

  if (email === null || !looksLikeEmail(email)) bag.add('email', 'invalid');
  if (name === null) bag.add('name', 'required');
  if (password === null || password.length < 10 || password.length > 200) {
    bag.add('password', 'invalid');
  }
  if (role === null || !ROLES.includes(role as Role)) bag.add('role', 'unknown');
  if (role === 'group_booker' && organisationId === null) {
    bag.add('organisation_id', 'required');
  }
  bag.throwIfAny();

  if (organisationId !== null) {
    const organisation = await one<{ id: string }>(
      pool,
      `SELECT id FROM organisations WHERE id = $1`,
      [organisationId],
    );
    if (organisation === null) fail('organisation_id', 'unknown');
  }

  const lowered = (email as string).toLowerCase();
  const existing = await one<{ id: string }>(pool, `SELECT id FROM users WHERE email = $1`, [
    lowered,
  ]);
  if (existing !== null) throw conflict('email_taken');

  const id = newId();
  await withTransaction(async (tx) => {
    await tx.query(
      `INSERT INTO users (id, email, name, password_hash, role, organisation_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, lowered, name, hashPassword(password as string), role, organisationId],
    );
    await writeAudit(tx, {
      actor: caller.email,
      actorRole: caller.role,
      action: 'staff.created',
      targetType: 'user',
      targetId: id,
      detail: { role },
    });
  });
  res
    .status(201)
    .json({ id, email: lowered, name, role, organisation_id: organisationId });
});

adminRouter.patch('/admin/staff/:id', async (req, res) => {
  const caller = requireRole(req, 'admin');
  const body = expectObject(req.body);
  const role = asTrimmed(body['role']);
  const organisationId = asTrimmed(body['organisation_id']);

  const updated = await withTransaction(async (tx) => {
    const user = await one<StaffRow>(
      tx,
      `SELECT id, email, name, role, organisation_id FROM users WHERE id = $1 FOR UPDATE`,
      [req.params.id],
    );
    if (user === null) throw notFound();
    if (role === null || !ROLES.includes(role as Role)) fail('role', 'unknown');
    if (role === 'group_booker' && organisationId === null) {
      fail('organisation_id', 'required');
    }
    if (user.role === 'admin' && role !== 'admin') {
      const admins = await one<{ count: number }>(
        tx,
        `SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin'`,
      );
      if ((admins?.count ?? 0) <= 1) throw conflict('last_admin');
    }
    await tx.query(`UPDATE users SET role = $2, organisation_id = $3 WHERE id = $1`, [
      user.id,
      role,
      organisationId,
    ]);
    await writeAudit(tx, {
      actor: caller.email,
      actorRole: caller.role,
      action: 'staff.role_changed',
      targetType: 'user',
      targetId: user.id,
      detail: { from: user.role, to: role },
    });
    const row = await one<StaffRow>(
      tx,
      `SELECT id, email, name, role, organisation_id FROM users WHERE id = $1`,
      [user.id],
    );
    if (row === null) throw new Error('user vanished');
    return row;
  });

  res.status(200).json(updated);
});

adminRouter.get('/admin/venues', async (req, res) => {
  requireRole(req, 'admin');
  const venues = await many<{ id: string; name: string }>(
    pool,
    `SELECT id, name FROM venues ORDER BY position, id`,
  );
  res.status(200).json({ venues });
});

adminRouter.post('/admin/venues', async (req, res) => {
  const caller = requireRole(req, 'admin');
  const body = expectObject(req.body);
  const id = asTrimmed(body['id']);
  const name = asTrimmed(body['name']);
  const bag = new ErrorBag();
  if (id === null || !/^[a-z0-9-]+$/.test(id)) bag.add('id', 'invalid');
  if (name === null || name.length > 200) bag.add('name', 'required');
  bag.throwIfAny();

  const existing = await one<{ id: string }>(pool, `SELECT id FROM venues WHERE id = $1`, [id]);
  if (existing !== null) throw conflict('venue_exists');

  const position = await one<{ next: number }>(
    pool,
    `SELECT COALESCE(MAX(position), -1) + 1 AS next FROM venues`,
  );
  await withTransaction(async (tx) => {
    await tx.query(`INSERT INTO venues (id, name, position) VALUES ($1, $2, $3)`, [
      id,
      name,
      position?.next ?? 0,
    ]);
    await writeAudit(tx, {
      actor: caller.email,
      actorRole: caller.role,
      action: 'venue.created',
      targetType: 'venue',
      targetId: id as string,
      detail: { name },
    });
  });
  res.status(201).json({ id, name });
});

adminRouter.patch('/admin/venues/:id', async (req, res) => {
  const caller = requireRole(req, 'admin');
  const body = expectObject(req.body);
  const name = asTrimmed(body['name']);
  const venue = await one<{ id: string }>(pool, `SELECT id FROM venues WHERE id = $1`, [
    req.params.id,
  ]);
  if (venue === null) throw notFound();
  if (name === null || name.length > 200) fail('name', 'required');
  await withTransaction(async (tx) => {
    await tx.query(`UPDATE venues SET name = $2 WHERE id = $1`, [venue.id, name]);
    await writeAudit(tx, {
      actor: caller.email,
      actorRole: caller.role,
      action: 'venue.renamed',
      targetType: 'venue',
      targetId: venue.id,
      detail: { name },
    });
  });
  res.status(200).json({ id: venue.id, name });
});

adminRouter.get('/admin/edition', async (req, res) => {
  requireRole(req, 'admin');
  res.status(200).json(await loadEdition(pool));
});

adminRouter.put('/admin/edition', async (req, res) => {
  const caller = requireRole(req, 'admin');
  const body = expectObject(req.body);
  const name = asTrimmed(body['name']);
  const firstDay = asTrimmed(body['first_day']);
  const lastDay = asTrimmed(body['last_day']);
  const bag = new ErrorBag();
  if (name === null) bag.add('name', 'required');
  if (firstDay === null || !isDateOnly(firstDay)) bag.add('first_day', 'invalid');
  if (lastDay === null || !isDateOnly(lastDay)) bag.add('last_day', 'invalid');
  bag.throwIfAny();
  if ((lastDay as string) < (firstDay as string)) fail('last_day', 'before_first_day');

  const edition = await withTransaction(async (tx) => {
    const outside = await one<{ count: number }>(
      tx,
      `SELECT COUNT(*)::int AS count FROM programme_sessions
       WHERE starts_at < ($1::date - interval '1 day')
          OR starts_at >= ($2::date + interval '2 days')`,
      [firstDay, lastDay],
    );
    if ((outside?.count ?? 0) > 0) throw conflict('sessions_outside_edition');
    await tx.query(`UPDATE edition SET name = $1, first_day = $2, last_day = $3 WHERE id = 1`, [
      name,
      firstDay,
      lastDay,
    ]);
    await writeAudit(tx, {
      actor: caller.email,
      actorRole: caller.role,
      action: 'edition.saved',
      targetType: 'edition',
      targetId: '1',
      detail: { first_day: firstDay, last_day: lastDay },
    });
    return loadEdition(tx);
  });
  res.status(200).json(edition);
});

adminRouter.get('/admin/price-policy', async (req, res) => {
  requireRole(req, 'admin');
  res.status(200).json(await loadPricePolicy(pool));
});

adminRouter.put('/admin/price-policy', async (req, res) => {
  const caller = requireRole(req, 'admin');
  const body = expectObject(req.body);
  const bag = new ErrorBag();
  const cents = (field: string): number => {
    const value = asInteger(body[field]);
    if (value === null || value < 0 || value > 100_000) bag.add(field, 'out_of_range');
    return value ?? 0;
  };
  const fullFestivalFull = cents('full_festival_full_cents');
  const fullFestivalReduced = cents('full_festival_reduced_cents');
  const dayFull = cents('day_full_cents');
  const dayReduced = cents('day_reduced_cents');
  const percent = asInteger(body['group_discount_percent']);
  if (percent === null || percent < 0 || percent > 50) {
    bag.add('group_discount_percent', 'out_of_range');
  }

  const policy = await withTransaction(async (tx) => {
    const current = await one<{ version: number }>(
      tx,
      `SELECT version FROM price_policy WHERE id = 1 FOR UPDATE`,
    );
    if (current === null) throw notFound();
    const ifMatch = req.headers['if-match'];
    if (typeof ifMatch !== 'string' || ifMatch.trim().length === 0) throw versionRequired();
    const given = Number(ifMatch.replace(/"/g, '').trim());
    if (!Number.isInteger(given)) throw versionRequired();
    if (given !== current.version) throw staleVersion(current.version);
    bag.throwIfAny();

    await tx.query(
      `UPDATE price_policy SET full_festival_full_cents = $1, full_festival_reduced_cents = $2,
         day_full_cents = $3, day_reduced_cents = $4, group_discount_percent = $5,
         version = version + 1
       WHERE id = 1`,
      [fullFestivalFull, fullFestivalReduced, dayFull, dayReduced, percent],
    );
    await writeAudit(tx, {
      actor: caller.email,
      actorRole: caller.role,
      action: 'price_policy.saved',
      targetType: 'price_policy',
      targetId: '1',
      detail: { version: current.version + 1 },
    });
    return loadPricePolicy(tx);
  });

  res.status(200).json(policy);
});

adminRouter.get('/admin/audit', async (req, res) => {
  requireRole(req, 'admin', 'finance');
  const targetId = typeof req.query['target_id'] === 'string' ? req.query['target_id'] : null;
  const limitRaw = asInteger(req.query['limit']);
  const limit = limitRaw === null ? 100 : Math.min(Math.max(limitRaw, 1), 500);
  const rows =
    targetId === null
      ? await many<AuditRow>(
          pool,
          `SELECT id, at, actor, actor_role, action, target_type, target_id, detail
           FROM audit_entries ORDER BY at DESC, id DESC LIMIT $1`,
          [limit],
        )
      : await many<AuditRow>(
          pool,
          `SELECT id, at, actor, actor_role, action, target_type, target_id, detail
           FROM audit_entries WHERE target_id = $1 ORDER BY at DESC, id DESC LIMIT $2`,
          [targetId, limit],
        );
  res.status(200).json({
    entries: rows.map((row) => ({
      id: row.id,
      at: toUtcIso(row.at),
      actor: row.actor,
      actor_role: row.actor_role,
      action: row.action,
      target_type: row.target_type,
      target_id: row.target_id,
      detail: row.detail,
    })),
  });
});

interface AuditRow {
  id: string;
  at: Date;
  actor: string;
  actor_role: string;
  action: string;
  target_type: string;
  target_id: string;
  detail: unknown;
}
