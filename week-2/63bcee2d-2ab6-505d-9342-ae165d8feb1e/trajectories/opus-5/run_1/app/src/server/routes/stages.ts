import {
  FEE_STAGE_KEYS,
  HK_ZONE,
  isStudioRole,
  STAGE_KEYS,
  STAGE_NAMES,
  type Currency,
  type StageKey,
  type StageState,
} from '../../shared/domain.js';
import { formatAmount, formatInstant } from '../../shared/format.js';
import { firstRow, pool, rows, transact, type Queryable } from '../db/pool.js';
import { requireProject, type ProjectRecord } from '../domain/access.js';
import { stageAllows } from '../domain/transitions.js';
import { Fields } from '../domain/validate.js';
import { jsonReply, type Reply } from '../http/context.js';
import { conflict, forbidden, illegalTransition, notFound } from '../http/errors.js';
import type { Router } from '../http/router.js';
import type { Member } from '../http/session.js';
import { raiseStageInvoice, voidInvoice } from '../services/killbill.js';
import { nudgeMailDelivery, queueMail } from '../services/mail.js';

interface StageRow {
  id: string;
  key: StageKey;
  fee_cents: number | null;
  state: StageState;
  requested_at: string | null;
  requested_by: string | null;
  requested_by_name: string | null;
  signed_off_at: string | null;
  signed_off_by: string | null;
  signed_off_by_name: string | null;
  returned_reason: string | null;
  internal_note: string;
  killbill_invoice_id: string | null;
  invoice_number: string | null;
  invoice_amount_cents: number | null;
}

const STAGE_SELECT = `
  SELECT s.id, s.key, s.fee_cents, s.state, s.requested_at, s.requested_by,
         rq.name AS requested_by_name, s.signed_off_at, s.signed_off_by,
         so.name AS signed_off_by_name, s.returned_reason, s.internal_note,
         s.killbill_invoice_id, s.invoice_number, s.invoice_amount_cents
    FROM stages s
    LEFT JOIN members rq ON rq.id = s.requested_by
    LEFT JOIN members so ON so.id = s.signed_off_by`;

function stagePayload(row: StageRow, currency: Currency, includeNote: boolean): unknown {
  return {
    key: row.key,
    name: STAGE_NAMES[row.key],
    feeCents: row.fee_cents,
    currency,
    state: row.state,
    requestedAt: row.requested_at ? new Date(row.requested_at).toISOString() : null,
    requestedBy: row.requested_by_name,
    signedOffAt: row.signed_off_at ? new Date(row.signed_off_at).toISOString() : null,
    signedOffBy: row.signed_off_by_name,
    returnedReason: row.returned_reason,
    invoice:
      row.killbill_invoice_id && row.invoice_number
        ? {
            killbillInvoiceId: row.killbill_invoice_id,
            invoiceNumber: row.invoice_number,
            amountCents: row.invoice_amount_cents ?? 0,
            currency,
          }
        : null,
    ...(includeNote ? { internalNote: row.internal_note } : {}),
  };
}

async function stageRow(
  client: Queryable,
  projectId: string,
  key: string,
): Promise<StageRow> {
  if (!STAGE_KEYS.includes(key as StageKey)) throw notFound();
  const row = await firstRow<StageRow>(
    client,
    `${STAGE_SELECT} WHERE s.project_id = $1 AND s.key = $2`,
    [projectId, key],
  );
  if (!row) throw notFound();
  return row;
}

/** Stages are visible to studio roles and the brand's client approvers only. */
async function stageProject(
  context: { member: () => Promise<Member>; param: (name: string) => string },
): Promise<{ member: Member; project: ProjectRecord }> {
  const member = await context.member();
  const project = await requireProject(pool, context.param('id'), member);
  if (!isStudioRole(member.role) && member.role !== 'client_approver') throw forbidden();
  return { member, project };
}

function feeBearing(row: StageRow): void {
  if (!FEE_STAGE_KEYS.includes(row.key)) throw illegalTransition(row.state, 'request');
}

export function registerStageRoutes(router: Router): void {
  router.get('/api/projects/:id/stages', async (context): Promise<Reply> => {
    const { member, project } = await stageProject(context);
    const found = await rows<StageRow>(
      pool,
      `${STAGE_SELECT} WHERE s.project_id = $1 ORDER BY s.ord`,
      [project.id],
    );
    return jsonReply(200, {
      stages: found.map((row) => stagePayload(row, project.currency, isStudioRole(member.role))),
    });
  });

  router.patch('/api/projects/:id/stages/:key', async (context): Promise<Reply> => {
    const member = await context.memberWithRole('director', 'project_lead');
    const project = await requireProject(pool, context.param('id'), member);
    const existing = await stageRow(pool, project.id, context.param('key'));
    const body = await context.json();

    const fields = new Fields();
    const internalNote = fields.text('internalNote', body.internalNote ?? '', {
      label: 'Internal note',
      min: 0,
      max: 1000,
    });
    fields.finish();

    await pool.query('UPDATE stages SET internal_note = $2 WHERE id = $1', [
      existing.id,
      internalNote,
    ]);
    const after = await stageRow(pool, project.id, existing.key);
    return jsonReply(200, { stage: stagePayload(after, project.currency, true) });
  });

  router.post('/api/projects/:id/stages/:key/request', async (context): Promise<Reply> => {
    const member = await context.memberWithRole('director', 'project_lead');
    const project = await requireProject(pool, context.param('id'), member);
    const existing = await stageRow(pool, project.id, context.param('key'));
    const body = await context.json();

    feeBearing(existing);
    if (!stageAllows(existing.state, 'request')) {
      throw illegalTransition(existing.state, 'request');
    }
    const all = await rows<{ key: StageKey; state: StageState }>(
      pool,
      'SELECT key, state FROM stages WHERE project_id = $1 ORDER BY ord',
      [project.id],
    );
    const position = FEE_STAGE_KEYS.indexOf(existing.key);
    const blocking = FEE_STAGE_KEYS.slice(0, position).find(
      (key) => all.find((stage) => stage.key === key)?.state !== 'signed_off',
    );
    if (blocking) throw conflict('previous_stage_open', { stage: blocking });

    const fields = new Fields();
    const message = fields.text('message', body.message ?? '', {
      label: 'Message to approvers',
      min: 0,
      max: 1000,
    });
    fields.finish();

    await pool.query(
      `UPDATE stages SET state = 'requested', requested_at = now(), requested_by = $2,
                         request_message = $3, returned_reason = NULL
        WHERE id = $1`,
      [existing.id, member.id, message],
    );
    const after = await stageRow(pool, project.id, existing.key);
    return jsonReply(200, { stage: stagePayload(after, project.currency, true) });
  });

  router.post('/api/projects/:id/stages/:key/sign-off', async (context): Promise<Reply> => {
    const member = await context.member();
    const project = await requireProject(pool, context.param('id'), member);
    if (member.role !== 'client_approver' || member.brandId !== project.brandId) throw forbidden();
    const key = context.param('key');
    if (!STAGE_KEYS.includes(key as StageKey)) throw notFound();

    const payload = await signOffStage({ project, member, key: key as StageKey });
    nudgeMailDelivery();
    return jsonReply(200, { stage: payload });
  });

  router.post('/api/projects/:id/stages/:key/return', async (context): Promise<Reply> => {
    const member = await context.member();
    const project = await requireProject(pool, context.param('id'), member);
    if (member.role !== 'client_approver' || member.brandId !== project.brandId) throw forbidden();
    const existing = await stageRow(pool, project.id, context.param('key'));
    const body = await context.json();

    feeBearing(existing);
    if (!stageAllows(existing.state, 'return')) throw illegalTransition(existing.state, 'return');

    const fields = new Fields();
    const reason = fields.text('reason', body.reason, { label: 'Reason', max: 1000 });
    fields.finish();

    const updated = await rows(
      pool,
      `UPDATE stages SET state = 'returned', returned_reason = $2
        WHERE id = $1 AND state = 'requested' RETURNING id`,
      [existing.id, reason],
    );
    if (updated.length === 0) throw illegalTransition(existing.state, 'return');
    const after = await stageRow(pool, project.id, existing.key);
    return jsonReply(200, { stage: stagePayload(after, project.currency, false) });
  });
}

/**
 * One sign-off, one Kill Bill invoice, one receipt, as one unit. The stage row is
 * locked for the whole unit, so of any number of simultaneous sign-offs exactly
 * one succeeds.
 */
async function signOffStage(options: {
  project: ProjectRecord;
  member: Member;
  key: StageKey;
}): Promise<unknown> {
  const { project, member, key } = options;
  let raisedInvoiceId: string | null = null;
  try {
    return await transact(async (client) => {
      // The stage row is locked on its own: a lock taken through a join would
      // leave the joined signer name on the snapshot read before the wait.
      const locked = await firstRow<{
        id: string;
        state: StageState;
        fee_cents: number | null;
        signed_off_at: string | null;
        signed_off_by: string | null;
      }>(
        client,
        `SELECT id, state, fee_cents, signed_off_at, signed_off_by
           FROM stages WHERE project_id = $1 AND key = $2 FOR NO KEY UPDATE`,
        [project.id, key],
      );
      if (!locked) throw notFound();
      if (!FEE_STAGE_KEYS.includes(key)) throw illegalTransition(locked.state, 'sign_off');
      if (locked.state === 'signed_off') {
        const signer = locked.signed_off_by
          ? await firstRow<{ name: string }>(client, 'SELECT name FROM members WHERE id = $1', [
              locked.signed_off_by,
            ])
          : null;
        throw conflict('already_signed_off', {
          by: signer?.name ?? '',
          at: locked.signed_off_at ? new Date(locked.signed_off_at).toISOString() : '',
        });
      }
      if (!stageAllows(locked.state, 'sign_off')) {
        throw illegalTransition(locked.state, 'sign_off');
      }

      const feeCents = locked.fee_cents ?? 0;
      const invoice = await raiseStageInvoice({
        projectReference: project.reference,
        projectName: project.name,
        brandName: project.brandName,
        stageName: STAGE_NAMES[key],
        feeCents,
        currency: project.currency,
      });
      raisedInvoiceId = invoice.killbillInvoiceId;

      await client.query(
        `UPDATE stages SET state = 'signed_off', signed_off_at = now(), signed_off_by = $2,
                           killbill_invoice_id = $3, invoice_number = $4,
                           invoice_amount_cents = $5
          WHERE id = $1`,
        [locked.id, member.id, invoice.killbillInvoiceId, invoice.invoiceNumber, feeCents],
      );

      const signedRow = await firstRow<{ signed_off_at: string }>(
        client,
        'SELECT signed_off_at FROM stages WHERE id = $1',
        [locked.id],
      );
      const signedAt = new Date(signedRow?.signed_off_at ?? Date.now());

      await queueMail(client, {
        to: member.email,
        subject: `Signed off: ${project.reference} ${STAGE_NAMES[key]}`,
        body: [
          `${STAGE_NAMES[key]} has been signed off on ${project.name}.`,
          '',
          `Project: ${project.reference} ${project.name}`,
          `Stage: ${STAGE_NAMES[key]}`,
          `Stage fee: ${formatAmount(feeCents, project.currency)}`,
          `Kill Bill invoice: ${invoice.invoiceNumber}`,
          `Signed off by: ${member.name}`,
          `Signed off at: ${formatInstant(signedAt, HK_ZONE)}`,
        ].join('\n'),
      });

      const after = await firstRow<StageRow>(
        client,
        `${STAGE_SELECT} WHERE s.project_id = $1 AND s.key = $2`,
        [project.id, key],
      );
      if (!after) throw notFound();
      raisedInvoiceId = null;
      return stagePayload(after, project.currency, false);
    });
  } catch (error) {
    if (raisedInvoiceId) await voidInvoice(raisedInvoiceId);
    throw error;
  }
}
