import type pg from "pg";
import { formatAmount, formatTime } from "../../shared/format.js";
import { isStudio, memberById, memberRef, requireRole, STUDIO_ROLES, type Member } from "../auth.js";
import { pool, rows, tx } from "../db.js";
import { currentStage, stageActions, stageName, stageRefusal, type StageAction } from "../domain/stages.js";
import { conflict, illegalTransition, notFound } from "../http/errors.js";
import { ok, type Ctx, type Route } from "../http/router.js";
import { Fields, record } from "../http/validate.js";
import { raiseStageInvoice, voidInvoice, type StageInvoice } from "../services/billing.js";
import { queueMail } from "../services/mail.js";
import { visibleProject, type Project } from "../scope.js";

interface StageRow {
  key: string;
  fee_cents: number | null;
  state: string;
  requested_at: Date | null;
  requested_by: string | null;
  signed_off_at: Date | null;
  signed_off_by: string | null;
  returned_reason: string | null;
  internal_note: string;
  invoice: StageInvoice | null;
}

async function stageRows(db: pg.PoolClient | typeof pool, projectId: string, lock = false): Promise<StageRow[]> {
  return rows<StageRow>(db,
    `SELECT key, fee_cents, state, requested_at, requested_by, signed_off_at, signed_off_by, returned_reason, internal_note, invoice
     FROM stages WHERE project_id = $1 ORDER BY position ${lock ? "FOR UPDATE" : ""}`, [projectId]);
}

async function stageJson(db: pg.PoolClient | typeof pool, row: StageRow, stages: StageRow[], project: Project, viewer: Member) {
  const ref = async (id: string | null) => {
    const member = id ? await memberById(db, id) : undefined;
    return member ? memberRef(member) : null;
  };
  return {
    key: row.key, name: stageName(row.key), feeCents: row.fee_cents, currency: project.currency, state: row.state,
    requestedAt: row.requested_at?.toISOString() ?? null, requestedBy: await ref(row.requested_by),
    signedOffAt: row.signed_off_at?.toISOString() ?? null, signedOffBy: await ref(row.signed_off_by),
    returnedReason: row.returned_reason, invoice: row.invoice, actions: stageActions(stages, row, viewer.role),
    ...(isStudio(viewer) ? { internalNote: row.internal_note } : {}),
  };
}

/** The project (404 outside scope) and its stage, for a known stage key. */
async function scopedStage(db: pg.PoolClient | typeof pool, ctx: Ctx, lock: boolean) {
  const project = await visibleProject(db, ctx.me, ctx.params.id, lock);
  const stages = await stageRows(db, project.id, lock);
  const stage = stages.find((row) => row.key === ctx.params.key);
  if (!stage) throw notFound();
  return { project, stages, stage };
}

async function refuse(db: pg.PoolClient, projectId: string, stages: StageRow[], stage: StageRow, action: StageAction): Promise<void> {
  const refusal = stageRefusal(stages, stage, action);
  if (!refusal) return;
  if (refusal.kind === "previous_stage_open") throw conflict("previous_stage_open", { stage: refusal.stage });
  if (refusal.kind === "already_signed_off") {
    const [signer] = await rows<{ name: string; at: Date }>(db,
      `SELECT m.name, s.signed_off_at AS at FROM stages s JOIN members m ON m.id = s.signed_off_by
       WHERE s.project_id = $1 AND s.key = $2`, [projectId, stage.key]);
    throw conflict("already_signed_off", { by: signer.name, at: signer.at.toISOString() });
  }
  throw illegalTransition(refusal.from, action);
}

export const routes: Route[] = [
  {
    method: "GET", path: "/api/projects/:id/stages", auth: "member",
    handler: async (ctx) => {
      const project = await visibleProject(pool, ctx.me, ctx.params.id);
      requireRole(ctx.me, ...STUDIO_ROLES, "client_approver");
      const stages = await stageRows(pool, project.id);
      return ok({
        stages: await Promise.all(stages.map((row) => stageJson(pool, row, stages, project, ctx.me))),
        currentStage: currentStage(stages),
      });
    },
  },
  {
    method: "PATCH", path: "/api/projects/:id/stages/:key", auth: "member",
    handler: async (ctx) => {
      const { project, stages, stage } = await scopedStage(pool, ctx, false);
      requireRole(ctx.me, "director", "project_lead");
      const fields = new Fields(record(ctx.json()));
      const note = fields.text("internalNote", "Internal note", { min: 0, max: 1000 });
      fields.done();
      await pool.query("UPDATE stages SET internal_note = $3 WHERE project_id = $1 AND key = $2", [project.id, stage.key, note]);
      return ok({ stage: await stageJson(pool, { ...stage, internal_note: note }, stages, project, ctx.me) });
    },
  },
  {
    method: "POST", path: "/api/projects/:id/stages/:key/request", auth: "member",
    handler: async (ctx) => tx(async (client) => {
      const { project, stages, stage } = await scopedStage(client, ctx, true);
      requireRole(ctx.me, "director", "project_lead");
      await refuse(client, project.id, stages, stage, "request");
      const fields = new Fields(record(ctx.json()));
      const message = fields.text("message", "Message to approvers", { min: 0, max: 1000 });
      fields.done();
      const { rows: [saved] } = await client.query<StageRow>(
        `UPDATE stages SET state = 'requested', requested_at = now(), requested_by = $3, request_message = $4, returned_reason = NULL
         WHERE project_id = $1 AND key = $2
         RETURNING key, fee_cents, state, requested_at, requested_by, signed_off_at, signed_off_by, returned_reason, internal_note, invoice`,
        [project.id, stage.key, ctx.me.id, message]);
      return ok({ stage: await stageJson(client, saved, stages.map((row) => (row.key === saved.key ? saved : row)), project, ctx.me) });
    }),
  },
  {
    method: "POST", path: "/api/projects/:id/stages/:key/sign-off", auth: "member",
    handler: async (ctx) => {
      const raised: { invoice?: StageInvoice } = {};
      try {
        return await tx(async (client) => {
          const { project, stages, stage } = await scopedStage(client, ctx, true);
          requireRole(ctx.me, "client_approver");
          await refuse(client, project.id, stages, stage, "sign_off");
          record(ctx.json());
          const name = stageName(stage.key);
          const invoice = await raiseStageInvoice({
            externalKey: `plumbline-${project.reference}`, accountName: `${project.brandName} - ${project.name}`,
            currency: project.currency, amountCents: Number(stage.fee_cents), description: `${project.reference} ${name} stage fee`,
          });
          raised.invoice = invoice;
          const signedAt = new Date();
          const { rows: [saved] } = await client.query<StageRow>(
            `UPDATE stages SET state = 'signed_off', signed_off_at = $3, signed_off_by = $4, invoice = $5
             WHERE project_id = $1 AND key = $2
             RETURNING key, fee_cents, state, requested_at, requested_by, signed_off_at, signed_off_by, returned_reason, internal_note, invoice`,
            [project.id, stage.key, signedAt.toISOString(), ctx.me.id, JSON.stringify(invoice)]);
          await queueMail(client, {
            to: ctx.me.email,
            subject: `Signed off: ${project.reference} ${name}`,
            text: [
              `${ctx.me.name} signed off the ${name} stage of ${project.name} (${project.reference}).`,
              "",
              `Project: ${project.name}`,
              `Stage: ${name}`,
              `Fee: ${formatAmount(project.currency, Number(stage.fee_cents))}`,
              `Kill Bill invoice: ${invoice.invoiceNumber}`,
              `Signed off by: ${ctx.me.name}`,
              `Signed off at: ${formatTime(signedAt)}`,
              "",
              "Marrow Hall Interiors",
            ].join("\n"),
          });
          return ok({ stage: await stageJson(client, saved, stages.map((row) => (row.key === saved.key ? saved : row)), project, ctx.me) });
        });
      } catch (error) {
        // A Kill Bill invoice exists only for a signed-off stage.
        if (raised.invoice) {
          await voidInvoice(raised.invoice.killbillInvoiceId)
            .catch((voidError: unknown) => console.error("could not void Kill Bill invoice:", voidError));
        }
        throw error;
      }
    },
  },
  {
    method: "POST", path: "/api/projects/:id/stages/:key/return", auth: "member",
    handler: async (ctx) => tx(async (client) => {
      const { project, stages, stage } = await scopedStage(client, ctx, true);
      requireRole(ctx.me, "client_approver");
      await refuse(client, project.id, stages, stage, "return");
      const fields = new Fields(record(ctx.json()));
      const reason = fields.text("reason", "Reason", { max: 1000 });
      fields.done();
      const { rows: [saved] } = await client.query<StageRow>(
        `UPDATE stages SET state = 'returned', returned_reason = $3 WHERE project_id = $1 AND key = $2
         RETURNING key, fee_cents, state, requested_at, requested_by, signed_off_at, signed_off_by, returned_reason, internal_note, invoice`,
        [project.id, stage.key, reason]);
      return ok({ stage: await stageJson(client, saved, stages.map((row) => (row.key === saved.key ? saved : row)), project, ctx.me) });
    }),
  },
];
