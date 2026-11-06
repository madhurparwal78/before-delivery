import type { ImportReport } from "../../shared/api.js";
import { db, type Queryable } from "../db.js";
import { duplicateKey, emailDomain, normalEmail, planImport, readImport, type ImportPlan, type ImportRow, type ImportWorld, type Ref } from "../domain/legacyImport.js";
import { cleanBody, paragraphOf } from "../domain/noteBody.js";
import { invalid } from "../http/errors.js";
import { ANY, member, type MemberCtx, type Router } from "../http/router.js";
import { Fields } from "../http/validate.js";
import { audit } from "./records.js";

/** The contacts, domains and notes the file's emails can touch, read inside the caller's transaction. */
async function worldOf(q: Queryable, workspaceId: string, rows: readonly ImportRow[]): Promise<ImportWorld> {
  const emails = [...new Set(rows.map((r) => normalEmail(r.email)))];
  const domains = [...new Set(emails.map(emailDomain))];
  const contacts = await q.query<{ id: string; email: string; company_id: string | null }>(
    "SELECT id, email, company_id FROM contacts WHERE workspace_id = $1 AND email = ANY($2::text[])", [workspaceId, emails],
  );
  const owned = await q.query<{ domain: string; company_id: string }>(
    "SELECT domain, company_id FROM company_domains WHERE workspace_id = $1 AND domain = ANY($2::text[])", [workspaceId, domains],
  );
  const notes = await q.query<{ contact_id: string; text: string; received_on: string | null }>(
    "SELECT contact_id, text, received_on FROM notes WHERE contact_id = ANY($1::text[])", [contacts.map((c) => c.id)],
  );
  const noteKeys = new Map<string, Set<string>>();
  for (const note of notes) noteKeys.set(note.contact_id, (noteKeys.get(note.contact_id) ?? new Set()).add(duplicateKey(note.text, note.received_on)));
  return {
    contacts: new Map(contacts.map((c) => [c.email, { id: c.id, companyId: c.company_id }])),
    companiesByDomain: new Map(owned.map((d) => [d.domain, d.company_id])),
    noteKeys,
  };
}

/** Writes a plan: new companies (with their domain), new contacts, then one unprocessed csv_import note per kept row. */
async function writePlan(tx: Queryable, ctx: MemberCtx, workspaceId: string, plan: ImportPlan): Promise<string[]> {
  const companyIds: string[] = [];
  for (const company of plan.companies) {
    const [row] = await tx.query<{ id: string }>("INSERT INTO companies (workspace_id, name) VALUES ($1, $2) RETURNING id", [workspaceId, company.name]);
    await tx.query("INSERT INTO company_domains (workspace_id, domain, company_id) VALUES ($1, $2, $3)", [workspaceId, company.domain, row.id]);
    companyIds.push(row.id);
  }
  const resolve = (ref: Ref | null, created: string[]): string | null => (ref === null ? null : "existing" in ref ? ref.existing : created[ref.created] ?? null);
  const contactIds: string[] = [];
  for (const contact of plan.contacts) {
    const [row] = await tx.query<{ id: string }>(
      "INSERT INTO contacts (workspace_id, company_id, name, email) VALUES ($1, $2, $3, $4) RETURNING id",
      [workspaceId, resolve(contact.company, companyIds), contact.name, contact.email],
    );
    contactIds.push(row.id);
  }
  const noteIds: string[] = [];
  for (const note of plan.notes) {
    const { body, text } = cleanBody(paragraphOf(note.feedback));
    const [row] = await tx.query<{ id: string }>(
      `INSERT INTO notes (workspace_id, title, body, text, source, status, received_on, contact_id)
       VALUES ($1, $2, $3, $4, 'csv_import', 'unprocessed', $5, $6) RETURNING id`,
      [workspaceId, note.title, body, text, note.receivedOn, resolve(note.contact, contactIds)],
    );
    noteIds.push(row.id);
  }
  await audit(tx, ctx, workspaceId, "import.applied", noteIds[0] ?? "none", { notes: noteIds.length, companies: companyIds.length, contacts: contactIds.length });
  return noteIds;
}

function report(plan: ImportPlan, dryRun: boolean, noteIds: string[]): ImportReport {
  const count = (outcome: string): number => plan.rows.filter((r) => r.outcome === outcome).length;
  const created = count("created");
  const matched = count("matched");
  return {
    dryRun,
    totals: { rows: plan.rows.length, created, matched, skipped: count("skipped"), notes: created + matched, companiesCreated: plan.companies.length },
    rows: plan.rows.map((r) => ({ line: r.line, outcome: r.outcome, reason: r.reason, noteId: r.note === null ? null : noteIds[r.note] ?? null })),
  };
}

export function importRoutes(router: Router): void {
  router.add("/api/imports", {
    POST: member({
      roles: ANY,
      handle: async (ctx) => {
        const ws = ctx.session.workspace.id;
        const fields = new Fields(ctx.body);
        const csv = fields.text("csv", { min: 1, max: Number.MAX_SAFE_INTEGER, message: "Paste the CSV to import.", trim: false });
        const dryRun = fields.has("dryRun") ? fields.boolean("dryRun", "Say whether this is a preview.") : false;
        fields.check();
        const read = readImport(csv);
        if ("problem" in read) throw invalid({ csv: read.problem });
        const { rows } = read;
        if (dryRun) {
          const plan = planImport(rows, await worldOf(db, ws, rows));
          return { status: 200, json: report(plan, true, []) };
        }
        const result = await db.transaction(async (tx) => {
          await tx.query("SELECT pg_advisory_xact_lock(hashtext('import:' || $1))", [ws]);
          const plan = planImport(rows, await worldOf(tx, ws, rows));
          return report(plan, false, await writePlan(tx, ctx, ws, plan));
        });
        return { status: 201, json: result };
      },
    }),
  });
}
