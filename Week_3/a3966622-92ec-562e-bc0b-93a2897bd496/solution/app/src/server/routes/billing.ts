// Billing routes: tariff revisions, invoices, invoice issue and the moves export.
import type { TariffRevision } from "../../shared/types.js";
import { mayReadMove, readableInvoice, requireRole } from "../access.js";
import type { App } from "../app.js";
import { commitInvoice, invoiceView, refreshBalance } from "../domain/billing.js";
import { movesCsv } from "../domain/exportCsv.js";
import { publishTariffRevision } from "../domain/revisions.js";
import { created, ok, type Router } from "../http.js";
import { keyed } from "../idempotency.js";
import type { TariffRevisionRecord, UserRecord } from "../store.js";

export function billingRoutes(router: Router, app: App): void {
  const { store } = app;

  /** A revision's `moves`: the moves whose stored lines it priced that this reader may see. */
  const revisionView = (user: UserRecord, revision: TariffRevisionRecord): TariffRevision => {
    const priced = new Set(store.invoices.all().filter((i) => i.revision_id === revision.id).map((i) => i.move_ref));
    const moves = [...priced].filter((ref) => {
      const move = store.moves.get(ref);
      return move !== null && mayReadMove(user, move);
    });
    const { effective_instant: _instant, ...published } = revision;
    return { ...published, moves };
  };

  router.add("GET", "/api/tariff-revisions", ({ user }) => {
    const revisions = store.tariffRevisions.all().sort((a, b) => a.effective_instant - b.effective_instant);
    return ok({ revisions: revisions.map((r) => revisionView(user, r)) });
  });

  router.add("POST", "/api/tariff-revisions", ({ user, body }) => {
    requireRole(user, "clerk");
    return created(revisionView(user, publishTariffRevision(app, body, Date.now())));
  });

  router.add("GET", "/api/invoices", ({ user }) => {
    requireRole(user, "clerk", "agent");
    const invoices = store.invoices
      .all()
      .filter((i) => user.role === "clerk" || i.agency_code === user.agency_code)
      .sort((a, b) => b.seq - a.seq);
    return ok({ invoices: invoices.map(invoiceView) });
  });

  router.add("GET", "/api/invoices/:id", async ({ user, params }) => {
    const invoice = readableInvoice(store, user, params.id ?? "");
    return ok(invoiceView(await refreshBalance(app, invoice)));
  });

  router.add("POST", "/api/invoices/:id/issue", (request) => {
    const invoice = readableInvoice(store, request.user, request.params.id ?? "");
    requireRole(request.user, "clerk");
    return keyed(store, request, async () => {
      const current = store.invoices.get(invoice.id) ?? invoice;
      if (current.state === "issued") return ok(invoiceView(current));
      if (!current.issue_requested_by) store.invoices.put({ ...current, issue_requested_by: request.user.name });
      const issued = app.services.up("billing") && (await commitInvoice(app, invoice.id));
      const latest = invoiceView(store.invoices.get(invoice.id) ?? current);
      return issued ? ok(latest) : { status: 202, body: latest };
    });
  });

  router.add("GET", "/api/exports/moves.csv", ({ user }) => {
    requireRole(user, "agent", "dispatcher", "clerk");
    const csv = movesCsv(store, store.moves.all().filter((m) => mayReadMove(user, m)));
    return {
      status: 200,
      bytes: Buffer.from(csv, "utf8"),
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="moves.csv"',
        "Cache-Control": "no-store",
      },
    };
  });
}
