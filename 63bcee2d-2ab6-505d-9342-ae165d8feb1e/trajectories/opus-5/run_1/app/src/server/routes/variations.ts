import type {
  Currency,
  Role,
  VariationAction,
  VariationState,
} from '../../shared/domain.js';
import { fieldErrorCopy } from '../../shared/fieldErrors.js';
import { newId } from '../db/ids.js';
import { firstRow, pool, rows, transact, type Queryable } from '../db/pool.js';
import {
  contractorHoldsContract,
  projectStores,
  requireProject,
  requireUuid,
  type ProjectRecord,
} from '../domain/access.js';
import { MAX_CENTS } from '../domain/money.js';
import {
  VARIATION_EDITABLE_STATES,
  variationAllows,
  variationStateAfter,
} from '../domain/transitions.js';
import { Fields } from '../domain/validate.js';
import { jsonReply, type Reply } from '../http/context.js';
import {
  forbidden,
  illegalTransition,
  notFound,
  overApprovalLimit,
  ownVariation,
  staleVersion,
} from '../http/errors.js';
import type { Router } from '../http/router.js';
import type { Member } from '../http/session.js';
import { withIdempotency } from './idempotency.js';

interface VariationRow {
  id: string;
  project_id: string;
  number: string;
  title: string;
  description: string;
  amount_cents: number;
  currency: Currency;
  store_code: string | null;
  state: VariationState;
  reject_reason: string | null;
  raised_by: string;
  raised_by_name: string;
  raised_by_role: Role;
  raised_by_org: string;
  raised_at: string;
  version: number;
  updated_by: string;
  updated_by_name: string;
  updated_by_role: Role;
  updated_by_org: string;
  updated_at: string;
}

const PERSON = `
  SELECT m.id, m.name, m.role,
         CASE WHEN m.role = 'client_approver' THEN b.name
              WHEN m.role = 'contractor' THEN c.name
              ELSE 'Marrow Hall Interiors' END AS organisation
    FROM members m
    LEFT JOIN brands b ON b.id = m.brand_id
    LEFT JOIN companies c ON c.id = m.company_id`;

const VARIATION_SELECT = `
  SELECT v.id, v.project_id, v.number, v.title, v.description, v.amount_cents, v.currency,
         v.store_code, v.state, v.reject_reason, v.raised_by, rb.name AS raised_by_name,
         rb.role AS raised_by_role, rb.organisation AS raised_by_org, v.raised_at, v.version,
         v.updated_by, ub.name AS updated_by_name, ub.role AS updated_by_role,
         ub.organisation AS updated_by_org, v.updated_at
    FROM variations v
    JOIN (${PERSON}) rb ON rb.id = v.raised_by
    JOIN (${PERSON}) ub ON ub.id = v.updated_by`;

function variationPayload(row: VariationRow): unknown {
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    description: row.description,
    amountCents: row.amount_cents,
    currency: row.currency,
    storeCode: row.store_code,
    state: row.state,
    rejectReason: row.reject_reason,
    raisedBy: {
      id: row.raised_by,
      name: row.raised_by_name,
      role: row.raised_by_role,
      organisation: row.raised_by_org,
    },
    raisedAt: new Date(row.raised_at).toISOString(),
    version: row.version,
    updatedBy: {
      id: row.updated_by,
      name: row.updated_by_name,
      role: row.updated_by_role,
      organisation: row.updated_by_org,
    },
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

/** Variations are open to studio roles and the contractor holding the contract. */
async function variationProject(
  member: Member,
  projectId: string,
): Promise<ProjectRecord> {
  const project = await requireProject(pool, projectId, member);
  if (member.role === 'contractor' && !(await contractorHoldsContract(pool, project.id, member))) {
    throw notFound();
  }
  return project;
}

async function loadVariation(
  member: Member,
  variationId: string,
): Promise<{ row: VariationRow; project: ProjectRecord }> {
  const row = await firstRow<VariationRow>(pool, `${VARIATION_SELECT} WHERE v.id = $1`, [
    requireUuid(variationId),
  ]);
  if (!row) throw notFound();
  const project = await variationProject(member, row.project_id);
  return { row, project };
}

async function readStoreCode(
  fields: Fields,
  value: unknown,
  project: ProjectRecord,
): Promise<string | null> {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    fields.add('storeCode', fieldErrorCopy.storeUnknown());
    return null;
  }
  const stores = await projectStores(pool, project.id);
  if (!stores.some((store) => store.code === value)) {
    fields.add('storeCode', fieldErrorCopy.storeUnknown());
    return null;
  }
  return value;
}

export function registerVariationRoutes(router: Router): void {
  router.get('/api/projects/:id/variations', async (context): Promise<Reply> => {
    const member = await context.member();
    const project = await variationProject(member, context.param('id'));
    const found = await rows<VariationRow>(
      pool,
      `${VARIATION_SELECT} WHERE v.project_id = $1 ORDER BY v.number`,
      [project.id],
    );
    return jsonReply(200, { variations: found.map(variationPayload) });
  });

  router.post('/api/projects/:id/variations', async (context): Promise<Reply> => {
    const member = await context.member();
    const project = await variationProject(member, context.param('id'));
    if (!['director', 'project_lead', 'contractor'].includes(member.role)) throw forbidden();

    return withIdempotency(context, member, async () => {
      const body = await context.json();
      const fields = new Fields();
      const title = fields.text('title', body.title, { label: 'Title', max: 120, oneLine: true });
      const description = fields.text('description', body.description, {
        label: 'Description',
        max: 2000,
      });
      const amountCents = fields.cents(
        'amountCents',
        body.amountCents,
        'Amount',
        -MAX_CENTS,
        MAX_CENTS,
      );
      if (body.amountCents === 0) {
        fields.add('amountCents', fieldErrorCopy.badAmount());
      }
      const storeCode = await readStoreCode(fields, body.storeCode, project);
      fields.finish();

      const variationId = newId();
      await transact(async (client) => {
        const sequence = await nextVariationNumber(client, project.id);
        await client.query(
          `INSERT INTO variations (id, project_id, number, title, description, amount_cents,
                                   currency, store_code, raised_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
          [
            variationId,
            project.id,
            sequence,
            title,
            description,
            amountCents,
            project.currency,
            storeCode,
            member.id,
          ],
        );
      });

      const row = await firstRow<VariationRow>(pool, `${VARIATION_SELECT} WHERE v.id = $1`, [
        variationId,
      ]);
      if (!row) throw notFound();
      return jsonReply(201, { variation: variationPayload(row) });
    });
  });

  router.get('/api/variations/:id', async (context): Promise<Reply> => {
    const member = await context.member();
    const { row } = await loadVariation(member, context.param('id'));
    const comments = await rows<{
      id: string;
      body: string;
      posted_at: string;
      author_id: string;
      author_name: string;
      author_role: Role;
      author_org: string;
    }>(
      pool,
      `SELECT vc.id, vc.body, vc.posted_at, p.id AS author_id, p.name AS author_name,
              p.role AS author_role, p.organisation AS author_org
         FROM variation_comments vc JOIN (${PERSON}) p ON p.id = vc.member_id
        WHERE vc.variation_id = $1 ORDER BY vc.posted_at`,
      [row.id],
    );
    return jsonReply(200, {
      variation: variationPayload(row),
      comments: comments.map((comment) => ({
        id: comment.id,
        body: comment.body,
        author: {
          id: comment.author_id,
          name: comment.author_name,
          role: comment.author_role,
          organisation: comment.author_org,
        },
        postedAt: new Date(comment.posted_at).toISOString(),
      })),
    });
  });

  router.patch('/api/variations/:id', async (context): Promise<Reply> => {
    const member = await context.member();
    const { row, project } = await loadVariation(member, context.param('id'));
    const isRaiser = row.raised_by === member.id;
    if (!['director', 'project_lead'].includes(member.role) && !isRaiser) throw forbidden();

    if (!VARIATION_EDITABLE_STATES.includes(row.state)) {
      throw illegalTransition(row.state, 'edit');
    }

    const body = await context.json();
    if (body.version !== row.version) {
      throw staleVersion(row.updated_by_name, new Date(row.updated_at).toISOString());
    }

    const fields = new Fields();
    const title =
      body.title === undefined
        ? row.title
        : fields.text('title', body.title, { label: 'Title', max: 120, oneLine: true });
    const description =
      body.description === undefined
        ? row.description
        : fields.text('description', body.description, { label: 'Description', max: 2000 });
    const amountCents =
      body.amountCents === undefined
        ? row.amount_cents
        : fields.cents('amountCents', body.amountCents, 'Amount', -MAX_CENTS, MAX_CENTS);
    if (body.amountCents === 0) fields.add('amountCents', fieldErrorCopy.badAmount());
    const storeCode =
      body.storeCode === undefined
        ? row.store_code
        : await readStoreCode(fields, body.storeCode, project);
    fields.finish();

    const updated = await rows<{ id: string }>(
      pool,
      `UPDATE variations
          SET title = $2, description = $3, amount_cents = $4, store_code = $5,
              version = version + 1, updated_by = $6, updated_at = now()
        WHERE id = $1 AND version = $7
      RETURNING id`,
      [row.id, title, description, amountCents, storeCode, member.id, row.version],
    );
    if (updated.length === 0) {
      const latest = await firstRow<VariationRow>(pool, `${VARIATION_SELECT} WHERE v.id = $1`, [
        row.id,
      ]);
      throw staleVersion(
        latest?.updated_by_name ?? member.name,
        new Date(latest?.updated_at ?? Date.now()).toISOString(),
      );
    }

    const after = await firstRow<VariationRow>(pool, `${VARIATION_SELECT} WHERE v.id = $1`, [row.id]);
    if (!after) throw notFound();
    return jsonReply(200, { variation: variationPayload(after) });
  });

  router.post('/api/variations/:id/transitions', async (context): Promise<Reply> => {
    const member = await context.member();
    const { row } = await loadVariation(member, context.param('id'));
    const body = await context.json();

    const fields = new Fields();
    const action = fields.enumeration<VariationAction>('action', body.action, 'Action', [
      'start_review',
      'approve',
      'reject',
      'withdraw',
    ]);
    fields.finish();

    checkTransitionRole(member, row, action);
    if (!variationAllows(row.state, action)) throw illegalTransition(row.state, action);

    const reasonFields = new Fields();
    const reason =
      action === 'reject'
        ? reasonFields.text('reason', body.reason, { label: 'Reason', max: 1000 })
        : null;
    reasonFields.finish();

    const nextState = variationStateAfter(action);
    const updated = await rows<{ id: string }>(
      pool,
      `UPDATE variations
          SET state = $2, reject_reason = COALESCE($3, reject_reason), version = version + 1,
              updated_by = $4, updated_at = now()
        WHERE id = $1 AND state = $5
      RETURNING id`,
      [row.id, nextState, reason, member.id, row.state],
    );
    if (updated.length === 0) throw illegalTransition(row.state, action);

    const after = await firstRow<VariationRow>(pool, `${VARIATION_SELECT} WHERE v.id = $1`, [row.id]);
    if (!after) throw notFound();
    return jsonReply(200, { variation: variationPayload(after) });
  });

  router.post('/api/variations/:id/comments', async (context): Promise<Reply> => {
    const member = await context.member();
    const { row } = await loadVariation(member, context.param('id'));
    const body = await context.json();

    const fields = new Fields();
    const text = fields.text('body', body.body, { label: 'Comment', max: 2000 });
    fields.finish();

    const commentId = newId();
    await pool.query(
      'INSERT INTO variation_comments (id, variation_id, member_id, body) VALUES ($1, $2, $3, $4)',
      [commentId, row.id, member.id, text],
    );
    const comment = await firstRow<{ id: string; posted_at: string }>(
      pool,
      'SELECT id, posted_at FROM variation_comments WHERE id = $1',
      [commentId],
    );
    if (!comment) throw notFound();
    return jsonReply(201, {
      comment: {
        id: comment.id,
        body: text,
        author: {
          id: member.id,
          name: member.name,
          role: member.role,
          organisation: member.organisation,
        },
        postedAt: new Date(comment.posted_at).toISOString(),
      },
    });
  });
}

/** Who may take each variation action, and the project lead's approval limit. */
function checkTransitionRole(member: Member, row: VariationRow, action: VariationAction): void {
  if (action === 'withdraw') {
    if (row.raised_by !== member.id) throw forbidden();
    return;
  }
  if (action === 'start_review') {
    if (!['director', 'project_lead'].includes(member.role)) throw forbidden();
    return;
  }
  if (!['director', 'project_lead'].includes(member.role)) throw forbidden();
  if (row.raised_by === member.id) throw ownVariation();
  if (member.role === 'project_lead') {
    const limit = member.approvalLimits?.[row.currency] ?? null;
    if (limit === null || Math.abs(row.amount_cents) > limit) {
      throw overApprovalLimit(limit ?? 0, row.currency);
    }
  }
}

async function nextVariationNumber(client: Queryable, projectId: string): Promise<string> {
  const row = await firstRow<{ count: number }>(
    client,
    'SELECT COUNT(*)::int AS count FROM variations WHERE project_id = $1',
    [projectId],
  );
  return `V-${String((row?.count ?? 0) + 1).padStart(3, '0')}`;
}
