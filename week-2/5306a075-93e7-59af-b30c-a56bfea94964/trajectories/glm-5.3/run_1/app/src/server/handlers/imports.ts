import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { errors } from "../errors.js";
import { route, type Route, type RequestContext } from "../router.js";
import { audit } from "../audit.js";
import { bodyToText, plainTextToBody } from "../body.js";
import { parseCsv } from "../../shared/csv.js";
import type { ImportReport, ImportRow } from "../../shared/types.js";

const PERSONAL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
]);

/** Feedback compared after trimming and collapsing inner whitespace. */
function normalizeFeedback(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function isValidEmail(value: string): boolean {
  const at = value.indexOf("@");
  if (at === -1) return false;
  if (value.indexOf("@", at + 1) !== -1) return false;
  const domain = value.slice(at + 1);
  return domain.includes(".");
}

function isRealDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (m === null) return false;
  const year = Number.parseInt(m[1]!, 10);
  const month = Number.parseInt(m[2]!, 10);
  const day = Number.parseInt(m[3]!, 10);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** A stable 32-bit key for the per-workspace import advisory lock. */
function importLockKey(workspaceId: string): string {
  let hash = 0;
  const key = `import:${workspaceId}`;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return String(hash);
}

export const importRoutes: Route[] = [
  {
    pattern: route("imports"),
    methods: ["POST"],
    roles: "any",
    handler: async (ctx: RequestContext) => {
      const workspaceId = ctx.member!.workspaceId;
      const csv = typeof ctx.body.csv === "string" ? ctx.body.csv : null;
      const dryRun = ctx.body.dryRun === true;
      if (csv === null || csv.trim().length === 0) {
        throw errors.validationFailed({ csv: "Paste the CSV to import." });
      }
      const parsed = parseCsv(csv);
      if (!parsed.headerOk) {
        throw errors.validationFailed({
          csv: "The CSV header does not match the legacy feedback format.",
        });
      }
      if (parsed.tooManyRows) {
        throw errors.validationFailed({ csv: "A file may hold at most 2000 rows." });
      }

      const client = await ctx.pool.connect();
      try {
        await client.query("BEGIN");
        // Real imports in one workspace run one at a time (DP-48).
        if (!dryRun) {
          await client.query("SELECT pg_advisory_xact_lock($1)", [importLockKey(workspaceId)]);
        }
        const report = await runImport(client, workspaceId, parsed.records, dryRun);
        await audit(client, workspaceId, ctx.member!.id, "import", "import", workspaceId, {
          dryRun,
          totals: report.totals,
        });
        if (!dryRun) await client.query("COMMIT");
        else await client.query("ROLLBACK");
        return { status: dryRun ? 200 : 201, body: report };
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
  },
];

interface KeptContact {
  contactId: string;
  created: boolean;
}

async function runImport(
  client: PoolClient,
  workspaceId: string,
  records: Array<{ line: number; fields: string[] }>,
  dryRun: boolean,
): Promise<ImportReport> {
  const rows: ImportRow[] = [];
  const seenFeedback = new Map<string, Array<{ contactId: string; receivedOn: string | null }>>();
  let created = 0;
  let matched = 0;
  let skipped = 0;
  let notesCreated = 0;
  let companiesCreatedCount = 0;

  for (const record of records) {
    const [rawEmail, rawName, rawCompany, rawFeedback, rawDate] = [
      record.fields[0] ?? "",
      record.fields[1] ?? "",
      record.fields[2] ?? "",
      record.fields[3] ?? "",
      record.fields[4] ?? "",
    ];
    const email = rawEmail.trim().toLowerCase();

    // The skip reasons in their stated order.
    let reason: string | null = null;
    if (email.length === 0) {
      reason = "missing_email";
    } else if (!isValidEmail(email)) {
      reason = "invalid_email";
    } else if (rawFeedback.trim().length === 0) {
      reason = "missing_feedback";
    } else if (rawDate.trim().length > 0 && !isRealDate(rawDate.trim())) {
      reason = "invalid_date";
    }
    const normalizedFeedback = normalizeFeedback(rawFeedback);
    const receivedOn = rawDate.trim().length === 0 ? null : rawDate.trim();

    const domain = email.slice(email.indexOf("@") + 1);

    if (reason === null) {
      // Duplicate: the same contact with the same feedback and received_on,
      // in earlier kept rows or in existing notes.
      const existingContact = await findContact(client, workspaceId, email);
      if (existingContact !== null) {
        const priorRows = seenFeedback.get(normalizedFeedback) ?? [];
        const dupeInFile = priorRows.some(
          (p) => p.contactId === existingContact.id && p.receivedOn === receivedOn,
        );
        const dupeInDb = await contactHasNote(
          client,
          workspaceId,
          existingContact.id,
          normalizedFeedback,
          receivedOn,
        );
        if (dupeInFile || dupeInDb) reason = "duplicate";
      }
    }

    if (reason !== null) {
      skipped++;
      rows.push({ line: record.line, outcome: "skipped", reason, noteId: null });
      continue;
    }

    // Keep the row: create or match the contact and company.
    const existingContact = await findContact(client, workspaceId, email);
    let entry: KeptContact;
    let noteId: string | null = null;
    if (existingContact === null) {
      const contactId = randomUUID();
      const strippedDomain = domain.replace(/^www\./, "");
      const isPersonal = PERSONAL_DOMAINS.has(strippedDomain);
      let companyId: string | null = null;
      if (!isPersonal) {
        const company = await client.query<{ id: string }>(
          "SELECT company_id AS id FROM company_domains WHERE workspace_id = $1 AND domain = $2",
          [workspaceId, strippedDomain],
        );
        if (company.rowCount === 0) {
          const newCompanyId = randomUUID();
          const companyName =
            rawCompany.trim().length > 0 ? rawCompany.trim() : strippedDomain;
          await client.query(
            "INSERT INTO companies (id, workspace_id, name) VALUES ($1, $2, $3)",
            [newCompanyId, workspaceId, companyName],
          );
          await client.query(
            "INSERT INTO company_domains (company_id, workspace_id, domain) VALUES ($1, $2, $3)",
            [newCompanyId, workspaceId, strippedDomain],
          );
          companyId = newCompanyId;
          companiesCreatedCount++;
        } else {
          companyId = company.rows[0]!.id;
        }
      }
      await client.query(
        "INSERT INTO contacts (id, workspace_id, company_id, name, email) VALUES ($1, $2, $3, $4, $5)",
        [
          contactId,
          workspaceId,
          companyId,
          rawName.trim().length > 0 ? rawName.trim() : email.slice(0, email.indexOf("@")),
          email,
        ],
      );
      entry = { contactId, created: true };
      created++;
    } else {
      entry = { contactId: existingContact.id, created: false };
      matched++;
    }

    const title = cutTitle(rawFeedback);
    const body = plainTextToBody(rawFeedback);
    const text = bodyToText(body);
    const noteIdNew = randomUUID();
    if (!dryRun) {
      await client.query(
        `INSERT INTO notes (id, workspace_id, title, body, text, source, status, contact_id, received_on, created_at)
         VALUES ($1, $2, $3, $4, $5, 'csv_import', 'unprocessed', $6, $7, now())`,
        [noteIdNew, workspaceId, title, body, text, entry.contactId, receivedOn],
      );
      noteId = noteIdNew;
    }
    notesCreated++;
    rows.push({
      line: record.line,
      outcome: entry.created ? "created" : "matched",
      reason: null,
      noteId,
    });
    const prior = seenFeedback.get(normalizedFeedback) ?? [];
    prior.push({ contactId: entry.contactId, receivedOn });
    seenFeedback.set(normalizedFeedback, prior);
  }

  return {
    dryRun,
    totals: {
      rows: records.length,
      created,
      matched,
      skipped,
      notes: notesCreated,
      companiesCreated: companiesCreatedCount,
    },
    rows,
  };
}

function cutTitle(feedback: string): string {
  const trimmed = feedback.trim();
  if (trimmed.length <= 60) return trimmed;
  return `${trimmed.slice(0, 60)}…`;
}

async function findContact(
  client: PoolClient,
  workspaceId: string,
  email: string,
): Promise<{ id: string; company_id: string | null } | null> {
  const result = await client.query<{ id: string; company_id: string | null }>(
    "SELECT id, company_id FROM contacts WHERE workspace_id = $1 AND lower(email) = $2",
    [workspaceId, email],
  );
  return result.rows[0] ?? null;
}

async function contactHasNote(
  client: PoolClient,
  workspaceId: string,
  contactId: string,
  normalizedFeedback: string,
  receivedOn: string | null,
): Promise<boolean> {
  const result = await client.query<{ id: string }>(
    `SELECT n.id FROM notes n
     WHERE n.workspace_id = $1 AND n.contact_id = $2
       AND btrim(regexp_replace(n.text, '\\s+', ' ', 'g')) = $3
       AND COALESCE(n.received_on::text, '') = COALESCE($4, '')`,
    [workspaceId, contactId, normalizedFeedback, receivedOn],
  );
  return result.rowCount !== 0;
}
