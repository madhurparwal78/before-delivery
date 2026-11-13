// Commissions: list, detail, ledger, transitions and documents (brief: API › Commissions, Documents).
import { requireCaller, type Caller } from "../auth.js";
import { applyMove, commissionFor, commissionView, endLapsedHolds, invoiceMilestone, isAssignedCrew, storedMilestones, venueById } from "../commissions.js";
import { notify, one, pool, query, tx } from "../db.js";
import { fail, jsonBody, ok, record, UUID, type Request, type Router } from "../http.js";
import { getObject } from "../providers/s3.js";
import { findMove, illegalTransitionMessage, requestableBy, type Actor } from "../rules/transitions.js";

async function list(req: Request) {
  const caller = await requireCaller(req);
  const producer = caller.roles.includes("producer");
  const rows = await query<Record<string, unknown> & { id: string }>(
    `SELECT c.id, c.title, c.state, c.venue_id, u.name AS client_name, q.total_cents,
       COALESCE((SELECT sum(amount_cents) FROM ledger_entries l WHERE l.commission_id = c.id), 0) AS paid_cents,
       d.date AS install_date,
       (SELECT min(due) FROM (
          SELECT due_at AS due FROM milestones m WHERE m.commission_id = c.id AND m.state <> 'paid' AND m.due_at IS NOT NULL
          UNION ALL SELECT due_at FROM funders f WHERE f.commission_id = c.id AND f.state = 'accepted' AND f.removed_at IS NULL) x) AS next_due_at,
       (SELECT amount FROM (
          SELECT due_at AS due, amount_cents AS amount FROM milestones m WHERE m.commission_id = c.id AND m.state <> 'paid' AND m.due_at IS NOT NULL
          UNION ALL SELECT due_at, amount_cents FROM funders f WHERE f.commission_id = c.id AND f.state = 'accepted' AND f.removed_at IS NULL) y
        ORDER BY due LIMIT 1) AS next_due_cents
     FROM commissions c JOIN users u ON u.id = c.client_id LEFT JOIN quotes q ON q.id = c.quote_id
     LEFT JOIN install_days d ON d.commission_id = c.id AND d.released_at IS NULL
     WHERE ($1 OR c.client_id = $2) ORDER BY c.created_at DESC`,
    [producer, caller.id],
  );
  return ok({
    commissions: rows.map((r) => ({
      id: r.id, title: r.title, state: r.state, venueName: venueById(String(r.venue_id))?.name ?? "",
      clientName: r.client_name, totalCents: r.total_cents ?? 0, paidCents: r.paid_cents,
      nextDueAt: r.next_due_at instanceof Date ? r.next_due_at.toISOString() : null, nextDueCents: r.next_due_cents ?? null,
      installDate: r.install_date ?? null,
    })),
  });
}

async function detail(req: Request) {
  const caller = await requireCaller(req);
  const now = Date.now();
  const c = await commissionFor(pool, caller, req.params.id, ["owner", "producer"]);
  await tx((db) => endLapsedHolds(db, now, { commissionId: c.id }));
  return ok(await commissionView(pool, await commissionFor(pool, caller, c.id, ["owner", "producer"]), now));
}

async function ledger(req: Request) {
  const caller = await requireCaller(req);
  const c = await commissionFor(pool, caller, req.params.id, ["owner", "producer"]);
  const rows = await query<{ id: string; payer_name: string; label: string; amount_cents: number; killbill_payment_id: string; at: Date }>(
    "SELECT * FROM ledger_entries WHERE commission_id = $1 ORDER BY at", [c.id],
  );
  return ok({ entries: rows.map((r) => ({ id: r.id, payerName: r.payer_name, label: r.label, amountCents: r.amount_cents, killbillPaymentId: r.killbill_payment_id, at: r.at.toISOString() })) });
}

function actorsOf(caller: Caller, clientId: string, crewAssigned: boolean): Actor[] {
  const actors: Actor[] = [];
  if (caller.id === clientId) actors.push("client");
  if (caller.roles.includes("producer")) actors.push("producer");
  if (crewAssigned) actors.push("crew");
  return actors;
}

/** Each move that triggers a milestone invoices it in Kill Bill. */
const INVOICED_ON: Record<string, string> = { concept_approved: "Concept approval", fabricating: "Fabrication", accepted: "Signed acceptance" };

async function transition(req: Request) {
  const caller = await requireCaller(req);
  const to = String(record(jsonBody(req)).to ?? "");
  return tx(async (db) => {
    const now = Date.now();
    const c = await commissionFor(db, caller, req.params.id, ["owner", "producer", "crew"], true);
    await endLapsedHolds(db, now, { commissionId: c.id });
    const assigned = caller.roles.includes("crew") && (await isAssignedCrew(db, c.id, caller.id));
    const allowed = requestableBy(to);
    if (allowed.length && !actorsOf(caller, c.clientId, assigned).some((a) => allowed.includes(a))) fail(403, "forbidden");
    const move = allowed.length ? findMove(c.state, to) : null;
    if (!move) fail(409, "illegal_transition", { message: illegalTransitionMessage(c.state, to), from: c.state, to });
    const milestones = await storedMilestones(db, c.id, true);
    if (move.needsPaid) {
      const guard = milestones.find((m) => m.label === move.needsPaid);
      if (guard && guard.state !== "paid") fail(409, "milestone_unpaid", { milestoneId: guard.id });
    }
    const invoiced = milestones.find((m) => m.label === INVOICED_ON[to]);
    if (invoiced) await invoiceMilestone(db, c, invoiced, now);
    if (to === "cancelled") {
      await db.query("UPDATE holds SET status = 'released', ended_at = $2 WHERE commission_id = $1 AND status IN ('held', 'booked')", [c.id, new Date(now)]);
      await db.query("UPDATE install_days SET released_at = $2 WHERE commission_id = $1 AND released_at IS NULL", [c.id, new Date(now)]);
      await notify(db, "hold.updated", { commissionId: c.id, status: "released" });
    }
    await applyMove(db, c, move.to, actorsOf(caller, c.clientId, assigned).find((a) => move.by.includes(a)) ?? "system");
    return ok(await commissionView(db, c, now));
  });
}

interface DocumentRow {
  id: string; commission_id: string; kind: string; version: number; label: string; status: string;
  size_bytes: number | null; sha256: string | null; issued_at: Date | null; storage_key: string; snapshot: { payerEmail?: string };
}

const documentView = (d: DocumentRow) => ({
  id: d.id, kind: d.kind, version: d.version, label: d.label, status: d.status, sizeBytes: d.size_bytes, sha256: d.sha256,
  issuedAt: d.issued_at ? d.issued_at.toISOString() : null,
});

async function documents(req: Request) {
  const caller = await requireCaller(req);
  const c = await commissionFor(pool, caller, req.params.id, ["owner", "producer"]);
  const rows = await query<DocumentRow & Record<string, unknown>>("SELECT * FROM documents WHERE commission_id = $1 ORDER BY created_at", [c.id]);
  return ok({ documents: rows.map(documentView) });
}

async function pdf(req: Request) {
  const caller = await requireCaller(req);
  if (!UUID.test(req.params.id)) fail(404, "not_found");
  const doc = await one<DocumentRow & Record<string, unknown>>("SELECT * FROM documents WHERE id = $1", [req.params.id]);
  if (!doc) fail(404, "not_found");
  const sponsorOwn = Boolean(await one("SELECT 1 FROM funders WHERE document_id = $1 AND user_id = $2", [doc.id, caller.id]));
  if (!sponsorOwn) await commissionFor(pool, caller, doc.commission_id, ["owner", "producer"]);
  if (doc.status !== "issued") fail(409, "document_preparing");
  const bytes = await getObject(doc.storage_key);
  return { status: 200, bytes, headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${doc.kind}-v${doc.version}.pdf"`, "Cache-Control": "private, no-store" } };
}

export function registerCommissions(router: Router): void {
  router.add("GET", "/api/commissions", list);
  router.add("GET", "/api/commissions/:id", detail);
  router.add("GET", "/api/commissions/:id/ledger", ledger);
  router.add("POST", "/api/commissions/:id/transitions", transition);
  router.add("GET", "/api/commissions/:id/documents", documents);
  router.add("GET", "/api/documents/:id/pdf", pdf);
}
