// The forester's review link: read its set, decide findings, send the decisions.
import { loadCorridor } from "../domain/corridor.js";
import { decisionSummaryEmail } from "../domain/emails.js";
import { COMMENT_MAX, deriveFinding, findingsOf, MESSAGES } from "../domain/finding.js";
import { completionState, decisionsOf, loadSet, requireReviewOpen, setJson } from "../domain/findingsSet.js";
import { reviewOpen } from "../../shared/findingsSetRules.js";
import { findingLabel } from "../../shared/text.js";
import { firstRow } from "../db.js";
import { fail } from "../http/errors.js";
import { json, noInput, reviewRoute, type ReviewContext, type Route } from "../http/pipeline.js";
import { deliverRecorded, recordEmail } from "../outbox.js";
import { flightAnswer } from "../domain/flight.js";
import { activeTrack, corridorDetail, validFlightQuery } from "./corridors.js";
import { fileReply, loadStoredFile, readRange } from "./assets.js";

async function loadReview(ctx: ReviewContext, lock: boolean) {
  const set = await loadSet(ctx.db, ctx.link.tenantId, ctx.link.setId, lock);
  return { set, corridor: await loadCorridor(ctx.db, ctx.link.tenantId, ctx.link.corridorId) };
}

export const reviewRoutes: Route[] = [
  reviewRoute({
    method: "GET",
    path: "/api/review/:token",
    load: (ctx) => loadReview(ctx, false),
    validate: noInput,
    perform: async (ctx, { set, corridor }) => {
      const tenant = firstRow(await ctx.db.query<{ name: string }>("SELECT name FROM tenants WHERE id = $1", [ctx.link.tenantId]));
      return json(200, {
        set: await setJson(ctx.db, set, false),
        ...(await corridorDetail(ctx.db, corridor)),
        findings: (await findingsOf(ctx.db, set.id)).map((f) => deriveFinding(f, corridor)),
        contractor: { name: tenant.name },
        expires_at: ctx.link.expiresAt.toISOString(),
        read_only: !reviewOpen(set.state),
      });
    },
  }),

  reviewRoute({
    method: "PUT",
    path: "/api/review/:token/findings/:findingId/decision",
    load: async (ctx) => {
      const loaded = await loadReview(ctx, true);
      const finding = await ctx.db.query<{ id: string }>("SELECT id FROM findings WHERE id = $1 AND set_id = $2", [
        ctx.params.findingId ?? "",
        loaded.set.id,
      ]);
      const row = finding.rows[0];
      if (row === undefined) throw fail.notFound();
      return { ...loaded, findingId: row.id };
    },
    conflict: (_ctx, { set }) => requireReviewOpen(set.state),
    validate: (ctx) => {
      const { decision, note } = ctx.json;
      const choice = decision === "accept" || decision === "dispute" ? decision : null;
      const text = typeof note === "string" ? note : "";
      const fields: Record<string, string> = {};
      if (choice === null) fields.decision = MESSAGES.decision;
      if ([...text].length > COMMENT_MAX) fields.note = MESSAGES.comment;
      else if (choice === "dispute" && text.trim() === "") fields.note = MESSAGES.disputeNote;
      if (choice === null || Object.keys(fields).length > 0) throw fail.validation(fields);
      return { decision: choice, note: text };
    },
    perform: async (ctx, { set, findingId }, input) => {
      await ctx.db.query(
        `INSERT INTO decisions (set_id, finding_id, decision, note) VALUES ($1, $2, $3, $4)
         ON CONFLICT (set_id, finding_id) DO UPDATE SET decision = EXCLUDED.decision, note = EXCLUDED.note,
           decided_at = clock_timestamp()`,
        [set.id, findingId, input.decision, input.note],
      );
      return json(200, { decision: { finding_id: findingId, decision: input.decision, note: input.note } });
    },
  }),

  reviewRoute({
    method: "POST",
    path: "/api/review/:token/complete",
    idempotent: true,
    load: async (ctx) => {
      const loaded = await loadReview(ctx, true);
      return { ...loaded, findings: await findingsOf(ctx.db, loaded.set.id), decisions: await decisionsOf(ctx.db, loaded.set.id) };
    },
    conflict: (_ctx, { set }) => requireReviewOpen(set.state),
    validate: (_ctx, { findings, decisions }) => {
      const lines: Array<{ label: string; decision: string; note: string }> = [];
      for (const f of findings) {
        const decided = decisions[f.id];
        if (decided === undefined) throw fail.validation({ decisions: "Decide every finding before sending." });
        lines.push({ label: findingLabel(f.label_number), decision: decided.decision, note: decided.note });
      }
      return lines;
    },
    perform: async (ctx, { set, corridor }, lines) => {
      const outcome = completionState(lines.map((l) => l.decision));
      await ctx.db.query("UPDATE findings_sets SET state = $2 WHERE id = $1", [set.id, outcome]);
      const analyst = firstRow(
        await ctx.db.query<{ email: string }>(
          "SELECT st.email FROM findings_sets s JOIN staff st ON st.id = s.submitted_by WHERE s.id = $1",
          [set.id],
        ),
      );
      const emailId = await recordEmail(ctx.db, decisionSummaryEmail(corridor, set.revision, outcome, analyst.email, lines), null);
      const summary = {
        accepted: lines.filter((l) => l.decision === "accept").length,
        disputed: lines.filter((l) => l.decision === "dispute").length,
      };
      const after = await loadSet(ctx.db, set.tenant_id, set.id, false);
      const body = { set: await setJson(ctx.db, after, false), summary };
      return {
        afterCommit: async () => {
          await deliverRecorded(emailId);
          return json(200, body);
        },
      };
    },
  }),

  reviewRoute({
    method: "GET",
    path: "/api/review/:token/assets/:assetId/files/*path",
    load: (ctx) => loadStoredFile(ctx.db, ctx.link.tenantId, ctx.params.assetId ?? "", ctx.params.path ?? "", ctx.link.corridorId),
    validate: (ctx, stored) => readRange(ctx, stored.file.size_bytes),
    perform: (ctx, stored, range) => fileReply(ctx, stored, range),
  }),

  reviewRoute({
    method: "GET",
    path: "/api/review/:token/flight",
    load: (ctx) => loadCorridor(ctx.db, ctx.link.tenantId, ctx.link.corridorId),
    validate: (ctx, corridor) => validFlightQuery(ctx.query, corridor),
    perform: async (ctx, corridor, query) => json(200, flightAnswer(await activeTrack(ctx.db, corridor.id), corridor, query)),
  }),
];
