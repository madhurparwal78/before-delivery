// Variations: lifecycle, approval limits, idempotent raise, optimistic saves,
// comments.

import { Router } from 'express';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { one, query, withTransaction } from '../lib/db.js';
import { ApiError, forbidden, illegalTransition, notFound, staleVersion, validationError, FIELD_ERRORS } from '../lib/errors.js';
import { requireSession } from '../lib/auth.js';
import type { AuthedRequest } from '../lib/auth.js';
import { scopedProject } from '../lib/scope.js';
import { checkLength, requireString, throwValidation, wrap, withIdempotency } from './helpers.js';
import type { Config } from '../lib/config.js';
import { memberSummaryOf } from './projects.js';
import { STUDIO_ROLES } from '../lib/types.js';
import { memberRow } from '../lib/scope.js';

interface VariationRow {
  id: string;
  project_id: string;
  number: string;
  seq: number;
  title: string;
  description: string;
  amount_cents: string;
  store_code: string | null;
  state: 'raised' | 'under_review' | 'approved' | 'rejected' | 'withdrawn';
  raised_by: string;
  raised_at: Date;
  version: number;
  updated_by: string;
  updated_at: Date;
}

async function variationById(id: string): Promise<VariationRow | null> {
  return one<VariationRow>('SELECT * FROM variations WHERE id = $1', [id]);
}

/** Who may see the variation's project: studio or the contract-holding contractor. */
async function scopedVariation(req: AuthedRequest, variationId: string): Promise<{ variation: VariationRow; projectId: string }> {
  const variation = await variationById(variationId);
  if (!variation) throw notFound();
  const project = await scopedProject(req, variation.project_id);
  if (req.member!.role === 'contractor' && req.member!.companyId !== project.contractCompany) throw notFound();
  if (req.member!.role === 'client_approver') throw notFound();
  return { variation, projectId: project.id };
}

export async function variationPayload(variation: VariationRow, currency: string): Promise<Record<string, unknown>> {
  return {
    id: variation.id,
    number: variation.number,
    title: variation.title,
    description: variation.description,
    amountCents: parseInt(variation.amount_cents, 10),
    currency,
    storeCode: variation.store_code,
    state: variation.state,
    raisedBy: await memberSummaryOf(variation.raised_by),
    raisedAt: variation.raised_at.toISOString(),
    version: variation.version,
    updatedBy: await memberSummaryOf(variation.updated_by),
    updatedAt: variation.updated_at.toISOString(),
  };
}

export function variationsRouter(config: Config): Router {
  const router = Router();
  router.use('/api', requireSession(config.timing.sessionIdleTimeout));

  router.get('/api/projects/:id/variations', wrap(async (req, res) => {
    const member = req.member!;
    const project = await scopedProject(req, req.params.id);
    if (member.role === 'client_approver') throw notFound();
    if (member.role === 'contractor' && member.companyId !== project.contractCompany) throw notFound();
    const rows = await query<VariationRow>('SELECT * FROM variations WHERE project_id = $1 ORDER BY seq', [project.id]);
    res.json({ variations: await Promise.all(rows.map((row) => variationPayload(row, project.currency))) });
  }));

  router.post('/api/projects/:id/variations', express.json({ limit: '65536b' }), wrap(async (req, res) => {
    const member = req.member!;
    const project = await scopedProject(req, req.params.id);
    const canRaise =
      STUDIO_ROLES.includes(member.role) &&
      ['director', 'project_lead'].includes(member.role) ||
      (member.role === 'contractor' && member.companyId === project.contractCompany);
    if (!canRaise) {
      if (member.role === 'designer' || member.role === 'finance' || member.role === 'client_approver') throw forbidden();
      throw notFound();
    }
    const outcome = await withIdempotency(req, async () => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const errors: Record<string, string> = {};
      const title = requireString(body.title, 'title', 'Title', errors);
      if (title) checkLength(title, 'title', 'Title', 120, errors);
      const description = requireString(body.description, 'description', 'Description', errors);
      if (description) checkLength(description, 'description', 'Description', 2000, errors);
      const amountCents = body.amountCents;
      if (typeof amountCents !== 'number' || !Number.isInteger(amountCents) || amountCents === 0 || Math.abs(amountCents) > 99_999_999_999) {
        errors.amountCents = FIELD_ERRORS.range('Amount', '-99,999,999,999 and 99,999,999,999 cents');
      }
      const storeCode = typeof body.storeCode === 'string' && body.storeCode ? body.storeCode : null;
      if (storeCode) {
        const store = await one('SELECT id FROM stores WHERE project_id = $1 AND code = $2', [project.id, storeCode]);
        if (!store) errors.storeCode = FIELD_ERRORS.storeUnknown;
      }
      throwValidation(errors);
      const created = await withTransaction(async (client) => {
        const seqRow = await client.query<Record<'value', string>>(
          `INSERT INTO counter_state (name, value) VALUES ($1, 1) ON CONFLICT (name) DO UPDATE SET value = counter_state.value + 1 RETURNING value`,
          [`variation_seq_${project.id}`],
        );
        const seq = parseInt(seqRow.rows[0].value, 10);
        const id = randomUUID();
        await client.query(
          `INSERT INTO variations (id, project_id, number, seq, title, description, amount_cents, store_code, raised_by, updated_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`,
          [id, project.id, `V-${seq.toString().padStart(3, '0')}`, seq, title, description, amountCents, storeCode, member.id],
        );
        return id;
      });
      const variation = await variationById(created);
      return { status: 201, body: { variation: await variationPayload(variation!, project.currency) } };
    });
    res.status(outcome.status).json(outcome.body);
  }));

  router.get('/api/variations/:id', wrap(async (req, res) => {
    const { variation, projectId } = await scopedVariation(req, req.params.id);
    const project = await one<{ currency: string }>('SELECT currency FROM projects WHERE id = $1', [projectId]);
    const comments = await query<{ id: string; author_id: string; body: string; posted_at: Date }>(
      'SELECT id, author_id, body, posted_at FROM variation_comments WHERE variation_id = $1 ORDER BY posted_at',
      [variation.id],
    );
    res.json({
      variation: await variationPayload(variation, project!.currency),
      comments: await Promise.all(
        comments.map(async (comment) => ({
          id: comment.id,
          body: comment.body,
          author: await memberSummaryOf(comment.author_id),
          postedAt: comment.posted_at.toISOString(),
        })),
      ),
    });
  }));

  router.patch('/api/variations/:id', express.json({ limit: '65536b' }), wrap(async (req, res) => {
    const member = req.member!;
    const { variation, projectId } = await scopedVariation(req, req.params.id);
    const project = await one<{ currency: string }>('SELECT currency FROM projects WHERE id = $1', [projectId]);
    const isStudioEdit = ['director', 'project_lead'].includes(member.role);
    const isRaiser = variation.raised_by === member.id;
    if (!isStudioEdit && !isRaiser) throw forbidden();
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (typeof body.version !== 'number' || !Number.isInteger(body.version)) {
      throw validationError({ version: 'Version is required.' });
    }
    if (body.version !== variation.version) {
      const latest = await variationById(variation.id);
      const latestName = (await memberRow(latest!.updated_by))?.name ?? 'Someone';
      throw staleVersion(latestName, latest!.updated_at.toISOString());
    }
    if (variation.state !== 'raised' && variation.state !== 'under_review') {
      throw illegalTransition(variation.state, 'edit');
    }
    const errors: Record<string, string> = {};
    const title = typeof body.title === 'string' ? body.title : variation.title;
    checkLength(title, 'title', 'Title', 120, errors);
    const description = typeof body.description === 'string' ? body.description : variation.description;
    checkLength(description, 'description', 'Description', 2000, errors);
    let amountCents = parseInt(variation.amount_cents, 10);
    if (body.amountCents !== undefined) {
      if (typeof body.amountCents !== 'number' || !Number.isInteger(body.amountCents) || body.amountCents === 0 || Math.abs(body.amountCents) > 99_999_999_999) {
        errors.amountCents = FIELD_ERRORS.range('Amount', '-99,999,999,999 and 99,999,999,999 cents');
      } else {
        amountCents = body.amountCents;
      }
    }
    let storeCode = variation.store_code;
    if (body.storeCode !== undefined) {
      if (typeof body.storeCode !== 'string' || !body.storeCode) {
        storeCode = null;
      } else {
        const store = await one('SELECT id FROM stores WHERE project_id = $1 AND code = $2', [projectId, body.storeCode]);
        if (!store) errors.storeCode = FIELD_ERRORS.storeUnknown;
        else storeCode = body.storeCode;
      }
    }
    throwValidation(errors);
    await withTransaction(async (client) => {
      const locked = (
        await client.query('SELECT version, updated_by FROM variations WHERE id = $1 FOR UPDATE', [variation.id])
      ).rows[0] as { version: number; updated_by: string } | undefined;
      if (!locked || locked.version !== body.version) {
        const latest = await variationById(variation.id);
        const latestName = (await memberRow(latest!.updated_by))?.name ?? 'Someone';
        throw staleVersion(latestName, latest!.updated_at.toISOString());
      }
      await client.query(
        'UPDATE variations SET title = $1, description = $2, amount_cents = $3, store_code = $4, version = version + 1, updated_by = $5, updated_at = now() WHERE id = $6',
        [title, description, amountCents, storeCode, member.id, variation.id],
      );
    });
    const fresh = await variationById(variation.id);
    res.json({ variation: await variationPayload(fresh!, project!.currency) });
  }));

  router.post('/api/variations/:id/transitions', express.json({ limit: '65536b' }), wrap(async (req, res) => {
    const member = req.member!;
    const { variation, projectId } = await scopedVariation(req, req.params.id);
    const project = await one<{ currency: string }>('SELECT currency FROM projects WHERE id = $1', [projectId]);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const action = typeof body.action === 'string' ? body.action : '';
    if (!['start_review', 'approve', 'reject', 'withdraw'].includes(action)) throw validationError({ action: 'Choose an action.' });
    const reason = typeof body.reason === 'string' ? body.reason : '';

    if (action === 'start_review') {
      if (!['director', 'project_lead'].includes(member.role)) throw forbidden();
      if (variation.state !== 'raised') throw illegalTransition(variation.state, 'start_review');
    }
    if (action === 'withdraw') {
      if (variation.raised_by !== member.id) throw forbidden();
      if (variation.state !== 'raised' && variation.state !== 'under_review') throw illegalTransition(variation.state, 'withdraw');
    }
    if (action === 'approve' || action === 'reject') {
      if (variation.raised_by === member.id) throw new ApiError(403, { error: 'own_variation' });
      if (member.role !== 'director' && member.role !== 'project_lead') throw forbidden();
      if (variation.state !== 'under_review') throw illegalTransition(variation.state, action);
      if (member.role === 'project_lead') {
        const limit = project!.currency === 'HKD' ? member.approvalHkd : member.approvalSgd;
        const amount = Math.abs(parseInt(variation.amount_cents, 10));
        if (limit === null || amount > limit) {
          throw new ApiError(403, { error: 'over_approval_limit', limitCents: limit ?? 0, currency: project!.currency });
        }
      }
      if (action === 'reject') {
        const errors: Record<string, string> = {};
        requireString(reason, 'reason', 'Reason', errors);
        if (reason) checkLength(reason, 'reason', 'Reason', 1000, errors);
        throwValidation(errors);
      }
    }

    const nextState =
      action === 'start_review'
        ? 'under_review'
        : action === 'approve'
          ? 'approved'
          : action === 'reject'
            ? 'rejected'
            : 'withdrawn';
    await withTransaction(async (client) => {
      const locked = (
        await client.query('SELECT state, version FROM variations WHERE id = $1 FOR UPDATE', [variation.id])
      ).rows[0] as { state: string } | undefined;
      if (!locked) throw notFound();
      await client.query(
        'UPDATE variations SET state = $1, version = version + 1, updated_by = $2, updated_at = now() WHERE id = $3',
        [nextState, member.id, variation.id],
      );
      if (action === 'reject') {
        await client.query('INSERT INTO variation_comments (id, variation_id, author_id, body) VALUES ($1,$2,$3,$4)', [
          randomUUID(),
          variation.id,
          member.id,
          `Rejected: ${reason}`,
        ]);
      }
    });
    const fresh = await variationById(variation.id);
    res.json({ variation: await variationPayload(fresh!, project!.currency) });
  }));

  router.post('/api/variations/:id/comments', express.json({ limit: '65536b' }), wrap(async (req, res) => {
    const member = req.member!;
    const { variation } = await scopedVariation(req, req.params.id);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const errors: Record<string, string> = {};
    const text = requireString(body.body, 'body', 'Comment', errors);
    if (text) checkLength(text, 'body', 'Comment', 2000, errors);
    throwValidation(errors);
    const id = randomUUID();
    await query('INSERT INTO variation_comments (id, variation_id, author_id, body) VALUES ($1,$2,$3,$4)', [id, variation.id, member.id, text]);
    res.status(201).json({
      comment: {
        id,
        body: text,
        author: await memberSummaryOf(member.id),
        postedAt: new Date().toISOString(),
      },
    });
  }));

  return router;
}
