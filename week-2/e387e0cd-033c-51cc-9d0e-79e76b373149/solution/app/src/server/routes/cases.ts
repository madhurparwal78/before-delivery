// Withdrawal cases: creation, the case actions, request pages, archive and bring back.
import { allow, staff, type Staff } from "../auth.js";
import { pool, tx, type Db } from "../db.js";
import { refuse } from "../errors.js";
import { objectBody, type Reply, type Router } from "../http.js";
import { codePoints } from "../names.js";
import { deliverLater, type Mail } from "../smtp.js";
import type { PoolClient } from "pg";
import { createCase, issueRequestPage, validateCaseInput } from "../cases/decide.js";
import { archivedSummary, caseBody, caseExtras, isOpen, pageStatus, effectiveStatus, type CaseRow } from "../cases/record.js";
import {
  assertOpen, assertOwnershipPending, assertReasonNeeded, findCase, listCases, recordOwnership, recordReleaseReason, release,
  returnWithdrawal,
} from "../cases/transitions.js";
import { isBusinessDate } from "./rules.js";
import { businessDate, stamp } from "../../shared/format.js";

export async function caseBodies(db: Db, found: CaseRow[], masked: boolean) {
  const extras = await caseExtras(db, found.map((c) => c.id));
  const now = Date.now();
  return found.map((c) => caseBody(c, extras.get(c.id)!, masked, now));
}

const masks = (who: Staff): boolean => who.member.role === "support_agent";

export async function caseReply(db: Db, who: Staff, id: string, status = 200): Promise<Reply> {
  const c = await findCase(db, who.workspace, id);
  if (c.archived_at) return { status, json: { case: archivedSummary(c) } };
  const [body] = await caseBodies(db, [c], masks(who));
  return { status, json: { case: body } };
}

/** A 1 to 1,000 code point reason, trimmed, or null. */
export function validReason(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text === "" || codePoints(text) > 1000 ? null : text;
}

function reasonText(value: unknown): string {
  const text = validReason(value);
  if (text === null) throw refuse.invalid({ reason: "Enter a reason." });
  return text;
}

/** Runs a case action on the locked case, then answers with the case as it now stands. */
async function act(who: Staff, id: string, work: (db: PoolClient, c: CaseRow, now: number) => Promise<void>, status = 200): Promise<Reply> {
  await tx(async (db) => {
    const c = await findCase(db, who.workspace, id, true);
    if (c.archived_at) throw refuse.notFound();
    await work(db, c, Date.now());
  });
  return caseReply(pool, who, id, status);
}

export function registerCases(router: Router): void {
  router.add("GET", "/api/w/:slug/cases", async (ctx) => {
    const who = await staff(ctx);
    const show = ctx.query.get("show") ?? "open";
    const where = {
      open: "c.archived_at IS NULL AND c.outcome IS NULL",
      closed: "c.archived_at IS NULL AND c.outcome IS NOT NULL",
      archived: "c.archived_at IS NOT NULL",
    }[show];
    if (!where) throw refuse.invalid({ show: "Choose open, closed or archived." });
    const found = await listCases(pool, who.workspace, where);
    const bodies = await caseBodies(pool, found, masks(who));
    return {
      status: 200,
      json: { cases: show === "archived" ? bodies.map((b, i) => ({ ...b, archived: true, archivedAt: archivedSummary(found[i]).archivedAt })) : bodies },
    };
  });

  router.add("GET", "/api/w/:slug/cases/:caseId", async (ctx) => caseReply(pool, await staff(ctx), ctx.params.caseId));

  router.add("POST", "/api/w/:slug/cases", async (ctx) => {
    const who = await staff(ctx);
    allow(who, "compliance_officer", "compliance_analyst");
    const body = objectBody(ctx.json());
    const input = await validateCaseInput(pool, who.workspace, body);
    const created = await tx((db) => createCase(db, who.workspace, input, { kind: "member", name: who.member.name }));
    if (created.mail) deliverLater(created.mail);
    return caseReply(pool, who, created.id, 201);
  });

  router.add("POST", "/api/w/:slug/cases/:caseId/release", async (ctx) => {
    const who = await staff(ctx);
    await findCase(pool, who.workspace, ctx.params.caseId);
    allow(who, "operations_lead");
    ctx.json();
    return act(who, ctx.params.caseId, (db, c, now) => release(db, c, now));
  });

  router.add("POST", "/api/w/:slug/cases/:caseId/return", async (ctx) => {
    const who = await staff(ctx);
    await findCase(pool, who.workspace, ctx.params.caseId);
    allow(who, "operations_lead");
    const body = objectBody(ctx.json());
    return act(who, ctx.params.caseId, async (db, c, now) => {
      assertOpen(c);
      await returnWithdrawal(db, c, reasonText(body.reason), now);
    });
  });

  router.add("POST", "/api/w/:slug/cases/:caseId/release-reason", async (ctx) => {
    const who = await staff(ctx);
    await findCase(pool, who.workspace, ctx.params.caseId);
    allow(who, "compliance_officer");
    const body = objectBody(ctx.json());
    return act(who, ctx.params.caseId, async (db, c, now) => {
      assertReasonNeeded(c, now);
      await recordReleaseReason(db, c, reasonText(body.reason), who.member.name, now);
    });
  });

  router.add("POST", "/api/w/:slug/cases/:caseId/ownership", async (ctx) => {
    const who = await staff(ctx);
    await findCase(pool, who.workspace, ctx.params.caseId);
    allow(who, "compliance_officer", "compliance_analyst");
    const body = objectBody(ctx.json());
    return act(who, ctx.params.caseId, async (db, c, now) => {
      assertOwnershipPending(c);
      const day = body.confirmedOn;
      const today = businessDate(who.workspace.timeZone, now);
      const caseDay = businessDate(who.workspace.timeZone, c.created_at.getTime());
      if (!isBusinessDate(day) || day > today || day < caseDay) {
        throw refuse.invalid({ confirmedOn: "Choose a date from the case's business date up to today." });
      }
      await recordOwnership(db, c, day, who.member.name, now);
    });
  });

  router.add("POST", "/api/w/:slug/cases/:caseId/request-page", async (ctx) => {
    const who = await staff(ctx);
    await findCase(pool, who.workspace, ctx.params.caseId);
    allow(who, "compliance_officer", "compliance_analyst");
    ctx.json();
    let mail: Mail | null = null;
    const reply = await act(who, ctx.params.caseId, async (db, c, now) => {
      const status = effectiveStatus(c, now);
      const open = isOpen(status) && c.data_sent_channel === "request_page" && c.answer_decision === null
        && (status === "awaiting_answer" || status === "no_response" || (c.route === "sunrise" && status === "cleared"));
      if (!open) throw refuse.conflict("request_page_not_open", "This case has no open data request.");
      const page = (await caseExtras(db, [c.id])).get(c.id)!.requestPage!;
      mail = await issueRequestPage(db, who.workspace, { ...c, counterparty_id: c.counterparty_id! }, page.contact_email, now);
    }, 201);
    if (mail) deliverLater(mail);
    return reply;
  });

  router.add("DELETE", "/api/w/:slug/cases/:caseId/request-page", async (ctx) => {
    const who = await staff(ctx);
    await findCase(pool, who.workspace, ctx.params.caseId);
    allow(who, "compliance_officer", "compliance_analyst");
    return act(who, ctx.params.caseId, async (db, c, now) => {
      const page = (await caseExtras(db, [c.id])).get(c.id)!.requestPage;
      if (!page || pageStatus(page, now) !== "live") throw refuse.conflict("request_page_not_open", "This case has no open data request.");
      await db.query("UPDATE request_pages SET ended_at = $2, ends_at = LEAST(ends_at, $2) WHERE id = $1", [page.id, stamp(now)]);
    });
  });

  router.add("POST", "/api/w/:slug/cases/:caseId/archive", async (ctx) => {
    const who = await staff(ctx);
    await findCase(pool, who.workspace, ctx.params.caseId);
    allow(who, "compliance_officer");
    ctx.json();
    await tx(async (db) => {
      const c = await findCase(db, who.workspace, ctx.params.caseId, true);
      if (!c.outcome || c.archived_at) throw refuse.conflict("case_not_closed", "Only a closed case can be archived.");
      await db.query("UPDATE cases SET archived_at = date_trunc('second', now()) WHERE id = $1", [c.id]);
    });
    return caseReply(pool, who, ctx.params.caseId);
  });

  router.add("POST", "/api/w/:slug/cases/:caseId/restore", async (ctx) => {
    const who = await staff(ctx);
    await findCase(pool, who.workspace, ctx.params.caseId);
    allow(who, "compliance_officer");
    ctx.json();
    await tx(async (db) => {
      const c = await findCase(db, who.workspace, ctx.params.caseId, true);
      if (!c.archived_at) throw refuse.conflict("case_not_archived", "This case is not archived.");
      await db.query("UPDATE cases SET archived_at = NULL WHERE id = $1", [c.id]);
    });
    return caseReply(pool, who, ctx.params.caseId);
  });
}
