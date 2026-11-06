import { randomUUID } from 'node:crypto';
import { isTrade, type JobRole } from '../../shared/domain.js';
import { createPerson, findPersonByEmail } from '../auth.js';
import { db } from '../db.js';
import { ApiError, fail } from '../errors.js';
import { emitRoleEnded, emitVisitDeleted, jobWrite } from '../events.js';
import {
  body,
  requireAccount,
  route,
  sendEmpty,
  sendJson,
  type Ctx,
  type Route,
} from '../http.js';
import { memberById, requireJob, requireOpenJob, requireRole } from '../jobctx.js';
import { loadMembers, projectMember } from '../model.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const peopleRoutes: Route[] = [
  route('GET', '/api/jobs/:jobId/members', async (ctx: Ctx) => {
    const account = requireAccount(ctx);
    const jobCtx = await requireJob(db, account, ctx.params.jobId);
    sendJson(ctx.res, 200, {
      members: jobCtx.members.map((member) => projectMember(member, jobCtx.viewer)),
    });
  }),

  route('POST', '/api/jobs/:jobId/members', async (ctx: Ctx) => {
    const account = requireAccount(ctx);
    const jobCtx = await requireJob(db, account, ctx.params.jobId);
    requireRole(jobCtx, ['owner']);
    requireOpenJob(jobCtx);
    const raw = body(ctx);
    const fields: Record<string, string> = {};
    const name = raw.name;
    const email = raw.email;
    const phone = raw.phone;
    const role = raw.role;
    const trade = raw.trade ?? null;
    const initialPassword = raw.initial_password;

    if (typeof name !== 'string' || name.trim().length < 1 || name.length > 120) {
      fields.name = 'Give a name of 1 to 120 characters.';
    }
    if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
      fields.email = 'Give a valid email address.';
    }
    if (phone !== undefined && phone !== null && typeof phone !== 'string') {
      fields.phone = 'Give a phone number as text.';
    }
    if (role !== 'lead' && role !== 'trade' && role !== 'homeowner') {
      fields.role = 'Choose Lead carpenter, Trade or Homeowner.';
    }
    if (role === 'trade') {
      if (!isTrade(trade)) fields.trade = 'Choose the trade for this subcontractor.';
    } else if (trade !== null) {
      fields.trade = 'Only a trade subcontractor has a trade.';
    }

    const existing =
      typeof email === 'string' ? await findPersonByEmail(db, email.trim()) : null;
    if (existing === null) {
      if (
        typeof initialPassword !== 'string' ||
        initialPassword.length < 10 ||
        initialPassword.length > 200
      ) {
        fields.initial_password = 'Give an initial password of 10 to 200 characters.';
      }
    }
    if (Object.keys(fields).length > 0) throw new ApiError('validation', { fields });

    const member = await jobWrite(jobCtx.job.id, async (tx) => {
      const personId =
        existing !== null
          ? existing.id
          : await createPerson(
              tx,
              (name as string).trim(),
              (email as string).trim(),
              typeof phone === 'string' && phone.trim() !== '' ? phone.trim() : null,
              initialPassword as string,
            );
      const current = await tx.query(
        `select id, active from job_members where job_id = $1 and person_id = $2`,
        [jobCtx.job.id, personId],
      );
      if (current.rowCount > 0 && current.rows[0].active === true) fail('already_member');
      const memberId = current.rowCount > 0 ? (current.rows[0].id as string) : randomUUID();
      if (current.rowCount > 0) {
        await tx.query(
          `update job_members set role = $2, trade = $3, active = true where id = $1`,
          [memberId, role as JobRole, isTrade(trade) ? trade : null],
        );
      } else {
        await tx.query(
          `insert into job_members (id, job_id, person_id, role, trade, active)
           values ($1, $2, $3, $4, $5, true)`,
          [memberId, jobCtx.job.id, personId, role as JobRole, isTrade(trade) ? trade : null],
        );
      }
      const members = await loadMembers(tx, jobCtx.job.id);
      return members.find((candidate) => candidate.id === memberId)!;
    });
    sendJson(ctx.res, 201, projectMember(member, jobCtx.viewer));
  }),

  route('DELETE', '/api/jobs/:jobId/members/:memberId', async (ctx: Ctx) => {
    const account = requireAccount(ctx);
    const jobCtx = await requireJob(db, account, ctx.params.jobId);
    requireRole(jobCtx, ['owner']);
    requireOpenJob(jobCtx);
    const member = memberById(jobCtx, ctx.params.memberId);
    if (member.role === 'owner') fail('invalid_transition');

    await jobWrite(jobCtx.job.id, async (tx) => {
      await tx.query(`update job_members set active = false where id = $1`, [member.id]);
      const visits = await tx.query(`select id from visits where member_id = $1`, [member.id]);
      for (const row of visits.rows) {
        await tx.query(`delete from visits where id = $1`, [row.id]);
        await emitVisitDeleted(tx, jobCtx.job.id, row.id as string, member.personId);
      }
      await emitRoleEnded(tx, jobCtx.job.id, member.personId);
    });
    sendEmpty(ctx.res, 204);
  }),
];
