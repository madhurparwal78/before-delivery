import { randomBytes } from 'node:crypto';
import {
  isStudioRole,
  ROLES,
  STUDIO_ORGANISATION,
  type Role,
} from '../../shared/domain.js';
import { fieldErrorCopy } from '../../shared/fieldErrors.js';
import { formatInstant } from '../../shared/format.js';
import { HK_ZONE } from '../../shared/domain.js';
import { config } from '../config.js';
import { newId } from '../db/ids.js';
import { firstRow, pool, rows, transact, type Queryable } from '../db/pool.js';
import { asRecord, Fields } from '../domain/validate.js';
import { jsonReply, noContent, type Reply } from '../http/context.js';
import { conflict, notFound, staleVersion } from '../http/errors.js';
import type { Router } from '../http/router.js';
import {
  hashPassword,
  MEMBER_SELECT,
  PASSWORD_MAX,
  PASSWORD_MIN,
  sessionCookie,
  startSession,
  toMember,
  type Member,
  type MemberRow,
} from '../http/session.js';
import { nudgeMailDelivery, queueMail } from '../services/mail.js';
import { requireUuid } from '../domain/access.js';

/** The member directory, projected to the fields published for the caller's role. */
async function directoryFor(member: Member): Promise<unknown[]> {
  if (isStudioRole(member.role)) {
    const found = await rows<MemberRow>(pool, `${MEMBER_SELECT} ORDER BY m.name`);
    return found.map((row) => {
      const projected = toMember(row);
      return {
        id: projected.id,
        name: projected.name,
        email: projected.email,
        phone: projected.phone,
        role: projected.role,
        organisation: projected.organisation,
        status: projected.status,
        approvalLimits: projected.approvalLimits,
        version: projected.version,
      };
    });
  }

  const found = await rows<MemberRow>(
    pool,
    `${MEMBER_SELECT}
      WHERE m.status = 'active'
        AND (
          m.role IN ('director', 'project_lead', 'designer', 'finance')
          OR ($1::uuid IS NOT NULL AND m.brand_id = $1)
          OR ($2::uuid IS NOT NULL AND m.company_id = $2)
          OR ($1::uuid IS NOT NULL AND m.company_id IN (
                SELECT c.company_id FROM contracts c JOIN projects p ON p.id = c.project_id
                 WHERE p.brand_id = $1))
          OR ($2::uuid IS NOT NULL AND m.brand_id IN (
                SELECT p.brand_id FROM projects p
                 WHERE EXISTS (SELECT 1 FROM contracts c
                                WHERE c.project_id = p.id AND c.company_id = $2)
                    OR EXISTS (SELECT 1 FROM tender_bidders tb JOIN tenders t ON t.id = tb.tender_id
                                WHERE t.project_id = p.id AND tb.company_id = $2
                                  AND t.status <> 'draft')))
        )
      ORDER BY m.name`,
    [member.brandId, member.companyId],
  );
  return found.map((row) => {
    const projected = toMember(row);
    return {
      id: projected.id,
      name: projected.name,
      role: projected.role,
      organisation: projected.organisation,
    };
  });
}

function approvalLimits(
  fields: Fields,
  value: unknown,
  role: Role,
): { hkd: number | null; sgd: number | null } {
  if (role !== 'project_lead') return { hkd: null, sgd: null };
  const record = asRecord(value);
  const read = (key: 'HKD' | 'SGD'): number | null => {
    if (record[key] === undefined || record[key] === null) return null;
    return fields.cents(`approvalLimits.${key}`, record[key], `Approval limit ${key}`, 0, 99_999_999_999);
  };
  return { hkd: read('HKD'), sgd: read('SGD') };
}

async function companyIdByName(client: Queryable, name: string): Promise<string> {
  const existing = await firstRow<{ id: string }>(
    client,
    'SELECT id FROM companies WHERE lower(name) = lower($1)',
    [name],
  );
  if (existing) return existing.id;
  const created = await rows<{ id: string }>(
    client,
    `INSERT INTO companies (id, name) VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE SET name = companies.name RETURNING id`,
    [newId(), name],
  );
  const id = created[0]?.id;
  if (!id) throw new Error('Company could not be recorded');
  return id;
}

async function organisationForInvitation(
  client: Queryable,
  role: Role,
  brandId: string | null,
  companyName: string | null,
): Promise<string> {
  if (role === 'client_approver' && brandId) {
    const brand = await firstRow<{ name: string }>(client, 'SELECT name FROM brands WHERE id = $1', [
      brandId,
    ]);
    return brand?.name ?? '';
  }
  if (role === 'contractor') return companyName ?? '';
  return STUDIO_ORGANISATION;
}

export function registerMemberRoutes(router: Router): void {
  router.get('/api/members', async (context): Promise<Reply> => {
    const member = await context.member();
    return jsonReply(200, { members: await directoryFor(member) });
  });

  router.get('/api/brands', async (context): Promise<Reply> => {
    await context.memberWithRole('director', 'project_lead', 'designer', 'finance');
    return jsonReply(200, {
      brands: await rows(pool, 'SELECT id, name FROM brands ORDER BY name'),
    });
  });

  router.get('/api/companies', async (context): Promise<Reply> => {
    await context.memberWithRole('director', 'project_lead', 'designer', 'finance');
    return jsonReply(200, {
      companies: await rows(pool, 'SELECT id, name FROM companies ORDER BY name'),
    });
  });

  router.post('/api/invitations', async (context): Promise<Reply> => {
    const director = await context.memberWithRole('director');
    const body = await context.json();

    if (typeof body.email === 'string' && body.email !== '') {
      const clash = await firstRow(pool, 'SELECT 1 FROM members WHERE lower(email) = lower($1)', [
        body.email,
      ]);
      if (clash) throw conflict('member_exists');
    }

    const fields = new Fields();
    const email = fields.email('email', body.email);
    const name = fields.text('name', body.name, { label: 'Name', max: 120, oneLine: true });
    const role = fields.enumeration('role', body.role, 'Role', ROLES);
    const phone =
      body.phone === undefined || body.phone === null
        ? ''
        : fields.text('phone', body.phone, { label: 'Phone', min: 0, max: 30, oneLine: true });

    let brandId: string | null = null;
    if (role === 'client_approver') {
      if (typeof body.brandId !== 'string') {
        fields.add('brandId', fieldErrorCopy.required('Brand'));
      } else {
        const brand = await firstRow(pool, 'SELECT 1 FROM brands WHERE id = $1', [
          requireUuid(body.brandId),
        ]);
        if (!brand) fields.add('brandId', fieldErrorCopy.required('Brand'));
        else brandId = body.brandId;
      }
    }

    let companyName: string | null = null;
    if (role === 'contractor') {
      companyName = fields.text('companyName', body.companyName, {
        label: 'Company name',
        max: 120,
        oneLine: true,
      });
    }

    const limits = approvalLimits(fields, body.approvalLimits, role);
    fields.finish();

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + config.invitationTtlSeconds * 1000);

    await transact(async (client) => {
      await client.query(
        `INSERT INTO invitations (id, token, email, name, phone, role, brand_id, company_name,
                                  approval_limit_hkd_cents, approval_limit_sgd_cents, invited_by,
                                  expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          newId(),
          token,
          email,
          name,
          phone,
          role,
          brandId,
          companyName,
          limits.hkd,
          limits.sgd,
          director.id,
          expiresAt,
        ],
      );
      await queueMail(client, {
        to: email,
        subject: "You're invited to Marrow Hall Interiors on Plumbline",
        body: [
          `${director.name} has invited you to join Marrow Hall Interiors on Plumbline.`,
          '',
          `Your role: ${role}`,
          '',
          'Set your name and password here:',
          `${config.baseUrl}/invite/${token}`,
          '',
          `The invitation is open until ${formatInstant(expiresAt, HK_ZONE)}.`,
        ].join('\n'),
      });
    });
    nudgeMailDelivery();

    return jsonReply(201, {
      invitation: { id: token, email, role, expiresAt: expiresAt.toISOString() },
    });
  });

  router.get('/api/invitations/:token', async (context): Promise<Reply> => {
    const row = await firstRow<{
      email: string;
      name: string;
      role: Role;
      brand_id: string | null;
      company_name: string | null;
    }>(
      pool,
      `SELECT email, name, role, brand_id, company_name FROM invitations
        WHERE token = $1 AND accepted_at IS NULL AND expires_at > now()`,
      [context.param('token')],
    );
    if (!row) throw notFound();
    return jsonReply(200, {
      invitation: {
        email: row.email,
        name: row.name,
        role: row.role,
        organisation: await organisationForInvitation(
          pool,
          row.role,
          row.brand_id,
          row.company_name,
        ),
      },
    });
  });

  router.post('/api/invitations/:token/accept', async (context): Promise<Reply> => {
    const body = await context.json();
    const token = context.param('token');

    const invitation = await firstRow<{
      id: string;
      email: string;
      name: string;
      phone: string;
      role: Role;
      brand_id: string | null;
      company_name: string | null;
      approval_limit_hkd_cents: number | null;
      approval_limit_sgd_cents: number | null;
    }>(
      pool,
      `SELECT id, email, name, phone, role, brand_id, company_name,
              approval_limit_hkd_cents, approval_limit_sgd_cents
         FROM invitations
        WHERE token = $1 AND accepted_at IS NULL AND expires_at > now()`,
      [token],
    );
    if (!invitation) throw notFound();

    const fields = new Fields();
    const name = fields.text('name', body.name, { label: 'Your name', max: 120, oneLine: true });
    const password = fields.text('password', body.password, {
      label: 'Choose a password',
      min: PASSWORD_MIN,
      max: PASSWORD_MAX,
    });
    if (typeof body.password === 'string' && body.password.length > 0) {
      const length = body.password.length;
      if (length < PASSWORD_MIN || length > PASSWORD_MAX) {
        fields.add(
          'password',
          fieldErrorCopy.outOfRange(
            'Choose a password',
            `${PASSWORD_MIN} characters`,
            `${PASSWORD_MAX} characters`,
          ),
        );
      }
    }
    fields.finish();

    const memberId = newId();
    const created = await transact(async (client) => {
      const claimed = await rows(
        client,
        `UPDATE invitations SET accepted_at = now()
          WHERE id = $1 AND accepted_at IS NULL AND expires_at > now() RETURNING id`,
        [invitation.id],
      );
      if (claimed.length === 0) throw notFound();
      const companyId =
        invitation.role === 'contractor' && invitation.company_name
          ? await companyIdByName(client, invitation.company_name)
          : null;
      await client.query(
        `INSERT INTO members (id, name, email, phone, role, brand_id, company_id, password_hash,
                              approval_limit_hkd_cents, approval_limit_sgd_cents, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $1)`,
        [
          memberId,
          name,
          invitation.email,
          invitation.phone,
          invitation.role,
          invitation.brand_id,
          companyId,
          await hashPassword(password),
          invitation.approval_limit_hkd_cents,
          invitation.approval_limit_sgd_cents,
        ],
      );
      return firstRow<MemberRow>(client, `${MEMBER_SELECT} WHERE m.id = $1`, [memberId]);
    });
    if (!created) throw notFound();

    const member = toMember(created);
    context.setCookies.push(sessionCookie(await startSession(member.id)));
    return jsonReply(201, {
      member: {
        id: member.id,
        name: member.name,
        role: member.role,
        organisation: member.organisation,
      },
    });
  });

  router.patch('/api/members/:id', async (context): Promise<Reply> => {
    const director = await context.memberWithRole('director');
    const id = requireUuid(context.param('id'));
    const body = await context.json();

    const existing = await firstRow<MemberRow & { updated_at: string; updated_by: string | null }>(
      pool,
      `${MEMBER_SELECT}, m.updated_at, m.updated_by WHERE m.id = $1`,
      [id],
    );
    if (!existing) throw notFound();
    if (existing.id === director.id) throw conflict('own_membership');

    if (body.version !== existing.version) {
      const saver = existing.updated_by
        ? await firstRow<{ name: string }>(pool, 'SELECT name FROM members WHERE id = $1', [
            existing.updated_by,
          ])
        : null;
      throw staleVersion(
        saver?.name ?? director.name,
        new Date(existing.updated_at).toISOString(),
      );
    }

    const fields = new Fields();
    const role =
      body.role === undefined ? existing.role : fields.enumeration('role', body.role, 'Role', ROLES);
    const limits =
      body.approvalLimits === undefined
        ? {
            hkd: existing.approval_limit_hkd_cents,
            sgd: existing.approval_limit_sgd_cents,
          }
        : approvalLimits(fields, body.approvalLimits, role);
    fields.finish();

    const updated = await rows<MemberRow>(
      pool,
      `UPDATE members
          SET role = $2,
              approval_limit_hkd_cents = $3,
              approval_limit_sgd_cents = $4,
              version = version + 1,
              updated_by = $5,
              updated_at = now()
        WHERE id = $1 AND version = $6
      RETURNING id`,
      [id, role, limits.hkd, limits.sgd, director.id, existing.version],
    );
    if (updated.length === 0) throw staleVersion(director.name, new Date().toISOString());

    const after = await firstRow<MemberRow>(pool, `${MEMBER_SELECT} WHERE m.id = $1`, [id]);
    if (!after) throw notFound();
    const member = toMember(after);
    return jsonReply(200, {
      member: {
        id: member.id,
        name: member.name,
        email: member.email,
        phone: member.phone,
        role: member.role,
        organisation: member.organisation,
        status: member.status,
        approvalLimits: member.approvalLimits,
        version: member.version,
      },
    });
  });

  router.delete('/api/members/:id', async (context): Promise<Reply> => {
    const director = await context.memberWithRole('director');
    const id = requireUuid(context.param('id'));
    const existing = await firstRow<{ id: string }>(pool, 'SELECT id FROM members WHERE id = $1', [
      id,
    ]);
    if (!existing) throw notFound();
    if (existing.id === director.id) throw conflict('own_membership');
    await pool.query(
      `UPDATE members SET status = 'removed', version = version + 1, updated_by = $2,
                          updated_at = now()
        WHERE id = $1`,
      [id, director.id],
    );
    return noContent();
  });
}
