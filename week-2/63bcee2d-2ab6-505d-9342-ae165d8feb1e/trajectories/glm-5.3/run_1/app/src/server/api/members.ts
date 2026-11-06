// Members, invitations (token parts are public), brands and companies.

import { Router } from 'express';
import express from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { one, query } from '../lib/db.js';
import { conflict, forbidden, notFound, staleVersion, validationError, FIELD_ERRORS } from '../lib/errors.js';
import {
  hashPassword,
  requireSession,
  validatePassword,
  memberById,
} from '../lib/auth.js';
import { memberRow, projectMemberFor } from '../lib/scope.js';
import type { AuthedRequest } from '../lib/auth.js';
import { checkLength, checkOneLine, requireString, throwValidation, wrap } from './helpers.js';
import type { Config } from '../lib/config.js';
import type { Role } from '../lib/types.js';
import { queueMail } from '../lib/outbox.js';

const ROLES: Role[] = ['director', 'project_lead', 'designer', 'finance', 'client_approver', 'contractor'];

export interface InvitationRow {
  token: string;
  email: string;
  name: string;
  role: string;
  phone: string | null;
  brand_id: string | null;
  company_name: string | null;
  approval_hkd: string | null;
  approval_sgd: string | null;
  expires_at: Date;
  used_at: Date | null;
}

async function invitationByToken(token: string): Promise<InvitationRow | null> {
  const row = await one<InvitationRow>('SELECT * FROM invitations WHERE token = $1', [token]);
  if (!row) return null;
  if (Date.now() > row.expires_at.getTime()) return null;
  return row;
}

async function sessionCookieFor(res: express.Response, memberId: string, config: Config): Promise<void> {
  const token = randomBytes(32).toString('base64url');
  await query('INSERT INTO sessions (token, member_id) VALUES ($1, $2)', [token, memberId]);
  res.setHeader('Set-Cookie', `plumbline_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${config.timing.sessionIdleTimeout}`);
}

export function invitationsPublicRouter(config: Config): Router {
  const router = Router();

  router.get('/api/invitations/:token', wrap(async (req, res) => {
    const invitation = await invitationByToken(req.params.token);
    if (!invitation || invitation.used_at) throw notFound();
    const organisation = invitation.role === 'contractor' ? invitation.company_name ?? '' : 'Marrow Hall Interiors';
    res.json({ invitation: { email: invitation.email, name: invitation.name, role: invitation.role, organisation } });
  }));

  router.post('/api/invitations/:token/accept', express.json({ limit: '65536b' }), wrap(async (req, res) => {
    const invitation = await invitationByToken(req.params.token);
    if (!invitation || invitation.used_at) throw notFound();
    const body = (req.body ?? {}) as Record<string, unknown>;
    const errors: Record<string, string> = {};
    const name = requireString(body.name, 'name', 'Your name', errors);
    if (name) checkLength(name, 'name', 'Your name', 120, errors);
    const password = typeof body.password === 'string' ? body.password : '';
    validatePassword(password, errors);
    throwValidation(errors);
    let companyId: string | null = null;
    if (invitation.role === 'contractor' && invitation.company_name) {
      const company = await one<{ id: string }>('SELECT id FROM companies WHERE lower(name) = lower($1)', [invitation.company_name]);
      if (company) {
        companyId = company.id;
      } else {
        const newId = randomUUID();
        await query('INSERT INTO companies (id, name) VALUES ($1,$2)', [newId, invitation.company_name]);
        companyId = newId;
      }
    }
    const memberId = randomUUID();
    const claimed = await query<{ token: string }>(
      'UPDATE invitations SET used_at = now() WHERE token = $1 AND used_at IS NULL RETURNING token',
      [req.params.token],
    );
    if (claimed.length === 0) throw notFound();
    await query(
      `INSERT INTO members (id, email, name, role, phone, brand_id, company_id, password_hash, approval_hkd, approval_sgd)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [memberId, invitation.email, name, invitation.role, invitation.phone, invitation.brand_id, companyId, hashPassword(password), invitation.approval_hkd, invitation.approval_sgd],
    );
    await sessionCookieFor(res, memberId, config);
    const member = await memberById(memberId);
    const full = await memberRow(memberId);
    res.status(201).json({ member: projectMemberFor(member!, full!) });
  }));

  return router;
}

export function membersRouter(config: Config): Router {
  const router = Router();
  router.use('/api', requireSession(config.timing.sessionIdleTimeout));

  router.get('/api/members', wrap(async (req, res) => {
    const caller = req.member!;
    const rows = await query<{ id: string }>("SELECT id FROM members WHERE status = 'active' ORDER BY name");
    const full = (await Promise.all(rows.map((r) => memberRow(r.id)))).filter((r): r is NonNullable<typeof r> => r !== null);
    let visible = full;
    if (caller.role === 'client_approver' || caller.role === 'contractor') {
      visible = full.filter((row) => {
        if (row.id === caller.id) return true;
        if (['director', 'project_lead', 'designer', 'finance'].includes(row.role)) return true;
        if (caller.role === 'client_approver') return row.brand_id === caller.brandId;
        return row.company_id === caller.companyId;
      });
    }
    res.json({ members: visible.map((row) => projectMemberFor(caller, row)) });
  }));

  router.post('/api/invitations', express.json({ limit: '65536b' }), wrap(async (req, res) => {
    const caller = req.member!;
    if (caller.role !== 'director') throw forbidden();
    const body = (req.body ?? {}) as Record<string, unknown>;
    const errors: Record<string, string> = {};
    const email = requireString(body.email, 'email', 'Email', errors).trim().toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = FIELD_ERRORS.badEmail('Email');
    const name = requireString(body.name, 'name', 'Name', errors);
    if (name) checkLength(name, 'name', 'Name', 120, errors);
    const role = typeof body.role === 'string' ? (body.role as Role) : '';
    if (!ROLES.includes(role as Role)) errors.role = FIELD_ERRORS.required('Role');
    const phone = typeof body.phone === 'string' ? body.phone : null;
    const brandId = typeof body.brandId === 'string' ? body.brandId : null;
    const companyName = typeof body.companyName === 'string' ? body.companyName : null;
    if (companyName) {
      checkLength(companyName, 'companyName', 'Company name', 120, errors);
      checkOneLine(companyName, 'companyName', 'Company name', errors);
    }
    const limits = (body.approvalLimits ?? null) as { HKD?: unknown; SGD?: unknown } | null;
    let approvalHkd: number | null = null;
    let approvalSgd: number | null = null;
    if (role === 'project_lead') {
      if (typeof limits?.HKD !== 'number' || !Number.isInteger(limits.HKD)) errors['approvalLimits.HKD'] = FIELD_ERRORS.required('Approval limit HKD');
      else approvalHkd = limits.HKD;
      if (typeof limits?.SGD !== 'number' || !Number.isInteger(limits.SGD)) errors['approvalLimits.SGD'] = FIELD_ERRORS.required('Approval limit SGD');
      else approvalSgd = limits.SGD;
    }
    if (role === 'client_approver' && !brandId) errors.brandId = FIELD_ERRORS.required('Brand');
    if (role === 'contractor' && !companyName) errors.companyName = FIELD_ERRORS.required('Company name');
    // Conflicts before validation, per the one precedence.
    const existingMember = await one<{ id: string }>('SELECT id FROM members WHERE lower(email) = $1', [email]);
    if (existingMember) throw conflict('member_exists');
    if (role === 'client_approver' && brandId) {
      const brand = await one('SELECT id FROM brands WHERE id = $1', [brandId]);
      if (!brand) throw validationError({ brandId: FIELD_ERRORS.required('Brand') });
    }
    if (role === 'contractor' && companyName) {
      const company = await one<{ id: string }>('SELECT id FROM companies WHERE lower(name) = lower($1)', [companyName]);
      if (!company) {
        const newId = randomUUID();
        await query('INSERT INTO companies (id, name) VALUES ($1,$2)', [newId, companyName]);
      }
    }
    throwValidation(errors);
    const token = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + config.timing.invitationTtl * 1000);
    await query(
      `INSERT INTO invitations (token, email, name, role, phone, brand_id, company_name, approval_hkd, approval_sgd, invited_by, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [token, email, name, role, phone, role === 'client_approver' ? brandId : null, role === 'contractor' ? companyName : null, approvalHkd, approvalSgd, caller.id, expiresAt],
    );
    res.status(201).json({ invitation: { id: token, email, role, expiresAt: expiresAt.toISOString() } });
    await queueMail({
      to: email,
      subject: "You're invited to Marrow Hall Interiors on Plumbline",
      body: [
        `${caller.name} has invited you to Marrow Hall Interiors on Plumbline.`,
        `Your role: ${role}.`,
        `Accept your invitation within 7 days: ${config.baseUrl}/invite/${token}`,
      ].join('\n'),
    });
  }));

  router.patch('/api/members/:id', express.json({ limit: '65536b' }), wrap(async (req, res) => {
    const caller = req.member!;
    if (caller.role !== 'director') throw forbidden();
    const target = await one<{ id: string; role: string; version: number; approval_hkd: string | null; approval_sgd: string | null }>(
      "SELECT id, role, version, approval_hkd, approval_sgd FROM members WHERE id = $1 AND status = 'active'",
      [req.params.id],
    );
    if (!target) throw notFound();
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (typeof body.version !== 'number' || !Number.isInteger(body.version)) {
      throw validationError({ version: 'Version is required.' });
    }
    if (body.version !== target.version) {
      const latest = await one<{ name: string; updated_at: Date }>('SELECT name, updated_at FROM members WHERE id = $1', [target.id]);
      throw staleVersion(latest?.name ?? 'Someone', latest?.updated_at.toISOString() ?? new Date().toISOString());
    }
    const errors: Record<string, string> = {};
    const role = typeof body.role === 'string' ? (body.role as Role) : target.role;
    if (role !== target.role) {
      if (caller.id === target.id) throw conflict('own_membership');
      if (!ROLES.includes(role as Role)) errors.role = FIELD_ERRORS.required('Role');
    }
    let approvalHkd = target.approval_hkd === null ? null : parseInt(target.approval_hkd, 10);
    let approvalSgd = target.approval_sgd === null ? null : parseInt(target.approval_sgd, 10);
    const limits = (body.approvalLimits ?? null) as { HKD?: unknown; SGD?: unknown } | null;
    if (role === 'project_lead' && limits) {
      if (typeof limits.HKD === 'number' && Number.isInteger(limits.HKD)) approvalHkd = limits.HKD;
      if (typeof limits.SGD === 'number' && Number.isInteger(limits.SGD)) approvalSgd = limits.SGD;
    }
    if (role !== 'project_lead') {
      approvalHkd = null;
      approvalSgd = null;
    }
    throwValidation(errors);
    await query(
      'UPDATE members SET role = $1, approval_hkd = $2, approval_sgd = $3, version = version + 1, updated_at = now() WHERE id = $4',
      [role, approvalHkd, approvalSgd, target.id],
    );
    const full = await memberRow(target.id);
    res.json({ member: projectMemberFor(caller, full!) });
  }));

  router.delete('/api/members/:id', wrap(async (req, res) => {
    const caller = req.member!;
    if (caller.role !== 'director') throw forbidden();
    if (caller.id === req.params.id) throw conflict('own_membership');
    const target = await one<{ id: string }>("SELECT id FROM members WHERE id = $1 AND status = 'active'", [req.params.id]);
    if (!target) throw notFound();
    await query("UPDATE members SET status = 'removed', version = version + 1, updated_at = now() WHERE id = $1", [req.params.id]);
    res.status(204).end();
  }));

  router.get('/api/brands', wrap(async (_req, res) => {
    const rows = await query('SELECT id, name FROM brands ORDER BY name');
    res.json({ brands: rows });
  }));

  router.get('/api/companies', wrap(async (_req, res) => {
    const rows = await query('SELECT id, name FROM companies ORDER BY name');
    res.json({ companies: rows });
  }));

  return router;
}

export type { AuthedRequest };
