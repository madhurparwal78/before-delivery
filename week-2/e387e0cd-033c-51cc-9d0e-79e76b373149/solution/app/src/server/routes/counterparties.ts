// Counterparties with checked LEIs, renames with history, the spreadsheet import, customers and the address registry.
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { allow, staff, type Staff } from "../auth.js";
import { lockName, one, pool, rows, tx, type Db } from "../db.js";
import { FieldCheck, refuse } from "../errors.js";
import { objectBody, type Ctx, type Router } from "../http.js";
import { parseCsv } from "../csv.js";
import { ADDRESS_MESSAGE, isValidAddress, isValidLei } from "../lei.js";
import { codePoints, initials, maskIdentity, normaliseName } from "../names.js";
import { isUuid } from "../cases/transitions.js";
import { businessDate, isoInstant } from "../../shared/format.js";

const DUE_DILIGENCE = ["trusted", "pending", "restricted", "blocked"] as const;
type DueDiligence = (typeof DUE_DILIGENCE)[number];
const NOTES_MAX = 2000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const IMPORT_HEADER = ["Legal name", "LEI", "Jurisdiction", "Licence number", "Due diligence", "Contact email", "Notes"];

interface CounterpartyRow {
  id: string;
  legal_name: string;
  normalised_name: string;
  lei: string;
  jurisdiction_code: string;
  licence_number: string;
  due_diligence: DueDiligence;
  network: "on_network" | "off_network";
  contact_email: string | null;
  notes: string;
  name_since: string;
  updated_at: Date;
}

const counterpartyBody = (c: CounterpartyRow) => ({
  id: c.id, legalName: c.legal_name, lei: c.lei, jurisdictionCode: c.jurisdiction_code, licenceNumber: c.licence_number,
  dueDiligence: c.due_diligence, network: c.network, contactEmail: c.contact_email, notes: c.notes,
  updatedAt: isoInstant(c.updated_at.getTime()),
});

async function findCounterparty(db: Db, who: Staff, id: string): Promise<CounterpartyRow> {
  const found = isUuid(id)
    ? await one<CounterpartyRow>(db, "SELECT * FROM counterparties WHERE id = $1 AND workspace_slug = $2", [id, who.workspace.slug])
    : null;
  if (!found) throw refuse.notFound();
  return found;
}

const isDueDiligence = (value: unknown): value is DueDiligence =>
  typeof value === "string" && (DUE_DILIGENCE as readonly string[]).includes(value);

const nameTaken = () => refuse.conflict("name_taken", "A counterparty with this legal name already exists.");

async function knownJurisdiction(code: unknown): Promise<boolean> {
  return typeof code === "string" && (await one(pool, "SELECT 1 FROM jurisdictions WHERE code = $1", [code])) !== null;
}

function checkEditable(check: FieldCheck, body: Record<string, unknown>, partial: boolean, network: string): void {
  const present = (key: string) => !partial || key in body;
  if (present("legalName") && (typeof body.legalName !== "string" || body.legalName.trim() === "" || codePoints(body.legalName.trim()) > 200)) {
    check.fail("legalName", "Enter the legal name.");
  }
  if (present("licenceNumber") && (typeof body.licenceNumber !== "string" || body.licenceNumber.trim() === ""
    || codePoints(body.licenceNumber.trim()) > 60)) {
    check.fail("licenceNumber", "Enter the licence number, up to 60 characters.");
  }
  if (present("dueDiligence") && !isDueDiligence(body.dueDiligence)) check.fail("dueDiligence", "Choose a due diligence status.");
  if (present("contactEmail")) {
    const email = typeof body.contactEmail === "string" ? body.contactEmail.trim() : null;
    const optional = network === "on_network" && (email === "" || body.contactEmail === null);
    if (!optional && (email === null || !EMAIL.test(email))) check.fail("contactEmail", "Enter the compliance contact's email.");
  }
  if (present("notes") && body.notes !== undefined && (typeof body.notes !== "string" || codePoints(body.notes) > NOTES_MAX)) {
    check.fail("notes", "Notes can be at most 2,000 characters.");
  }
}

interface ImportRow {
  row: number;
  legalName: string;
  outcome: "matched" | "new" | "refused";
  matchedBy: "lei" | "legal_name" | null;
  counterpartyId: string | null;
  changedFields: string[];
  reason: string | null;
}

interface PlannedRow extends ImportRow {
  values: { legalName: string; lei: string; jurisdictionCode: string; licenceNumber: string; dueDiligence: DueDiligence;
    contactEmail: string; notes: string };
}

/** Reads the spreadsheet and decides every row against the stored counterparties; nothing is written here. */
async function planImport(db: Db, who: Staff, csvText: string): Promise<PlannedRow[]> {
  const table = parseCsv(csvText);
  const header = (table[0] ?? []).map((h) => h.trim());
  if (header.length !== IMPORT_HEADER.length || header.some((h, i) => h !== IMPORT_HEADER[i])) {
    throw refuse.invalid({ file: `The header row must be exactly: ${IMPORT_HEADER.join(",")}.` });
  }
  const existing = await rows<CounterpartyRow>(db, "SELECT * FROM counterparties WHERE workspace_slug = $1", [who.workspace.slug]);
  const codes = new Set((await rows<{ code: string }>(db, "SELECT code FROM jurisdictions")).map((j) => j.code));
  const byLei = new Map(existing.map((c) => [c.lei, c]));
  const byName = new Map(existing.map((c) => [c.normalised_name, c]));
  const taken: { row: number; id: string | null; lei: string; name: string }[] = [];
  const planned: PlannedRow[] = [];
  table.slice(1).forEach((raw, index) => {
    if (raw.every((cell) => cell.trim() === "")) return;
    const [name, leiCell, jurisdictionCell, licence, ddCell, email, notes] = IMPORT_HEADER.map((_, i) => (raw[i] ?? "").trim());
    const rowNumber = index + 2;
    const lei = leiCell.toUpperCase();
    const normalised = normaliseName(name);
    const matched = lei ? byLei.get(lei) : byName.get(normalised);
    const dd = ddCell.toLowerCase();
    const jurisdiction = jurisdictionCell.toUpperCase();
    const earlier = taken.find((t) => matched
      ? t.id === matched.id
      : t.lei === lei && lei !== "" || t.name === normalised);
    let reason: string | null = null;
    if (!name) reason = "Legal name is required";
    else if (lei && !isValidLei(lei)) reason = "LEI check digits do not match";
    else if ((jurisdiction && !codes.has(jurisdiction)) || (!jurisdiction && !matched)) reason = "Unknown jurisdiction";
    else if (dd && !isDueDiligence(dd)) reason = "Unknown due diligence status";
    else if (codePoints(notes) > NOTES_MAX) reason = "Notes are longer than 2,000 characters";
    else if (earlier) reason = `Same counterparty as row ${earlier.row}`;
    else if (!matched && lei && byName.has(normalised)) reason = "Legal name matches another counterparty with a different LEI";
    else if (!matched && !lei) reason = "LEI is required for a new counterparty";
    else if (!matched && !licence) reason = "Licence number is required for a new counterparty";
    else if (!matched && !email) reason = "Contact email is required";
    const values = {
      legalName: name, lei, jurisdictionCode: jurisdiction, licenceNumber: licence,
      dueDiligence: (dd || "pending") as DueDiligence, contactEmail: email, notes,
    };
    if (reason) {
      planned.push({ row: rowNumber, legalName: name, outcome: "refused", matchedBy: null, counterpartyId: null, changedFields: [], reason, values });
      return;
    }
    if (matched) {
      const changedFields = [
        licence && licence !== matched.licence_number ? "licenceNumber" : null,
        dd && dd !== matched.due_diligence ? "dueDiligence" : null,
        email && email !== (matched.contact_email ?? "") ? "contactEmail" : null,
        notes && notes !== matched.notes ? "notes" : null,
      ].filter((f): f is string => f !== null);
      taken.push({ row: rowNumber, id: matched.id, lei: matched.lei, name: matched.normalised_name });
      planned.push({ row: rowNumber, legalName: name, outcome: "matched", matchedBy: lei ? "lei" : "legal_name",
        counterpartyId: matched.id, changedFields, reason: null, values });
      return;
    }
    taken.push({ row: rowNumber, id: null, lei, name: normalised });
    planned.push({ row: rowNumber, legalName: name, outcome: "new", matchedBy: null, counterpartyId: null, changedFields: [], reason: null, values });
  });
  return planned;
}

const publicRow = ({ values: _values, ...row }: PlannedRow): ImportRow => row;

async function applyImport(db: PoolClient, who: Staff, planned: PlannedRow[]) {
  const today = businessDate(who.workspace.timeZone, Date.now());
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  const out: ImportRow[] = [];
  for (const row of planned) {
    if (row.outcome === "new") {
      const id = randomUUID();
      await db.query(
        `INSERT INTO counterparties (id, workspace_slug, legal_name, normalised_name, lei, jurisdiction_code, licence_number,
           due_diligence, network, contact_email, notes, name_since, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'off_network', $9, $10, $11, now(), now())`,
        [id, who.workspace.slug, row.values.legalName, normaliseName(row.values.legalName), row.values.lei, row.values.jurisdictionCode,
          row.values.licenceNumber, row.values.dueDiligence, row.values.contactEmail, row.values.notes, today]);
      created += 1;
      out.push({ ...publicRow(row), counterpartyId: id });
    } else if (row.outcome === "matched" && row.changedFields.length > 0) {
      const v = row.values;
      await db.query(
        `UPDATE counterparties SET
           licence_number = CASE WHEN $2 <> '' THEN $2 ELSE licence_number END,
           due_diligence = CASE WHEN $3 THEN $4 ELSE due_diligence END,
           contact_email = CASE WHEN $5 <> '' THEN $5 ELSE contact_email END,
           notes = CASE WHEN $6 <> '' THEN $6 ELSE notes END,
           updated_at = now()
         WHERE id = $1`,
        [row.counterpartyId, v.licenceNumber, row.changedFields.includes("dueDiligence"), v.dueDiligence, v.contactEmail, v.notes]);
      updated += 1;
      out.push(publicRow(row));
    } else {
      if (row.outcome === "matched") unchanged += 1;
      out.push(publicRow(row));
    }
  }
  return { created, updated, unchanged, refused: planned.filter((r) => r.outcome === "refused").length, rows: out };
}

function csvBody(ctx: Ctx): string {
  ctx.expectBody("text/csv");
  const text = new TextDecoder("utf-8", { fatal: true });
  try {
    return text.decode(ctx.body);
  } catch {
    throw refuse.invalid({ file: "Save the spreadsheet as UTF-8 CSV." });
  }
}

export function registerCounterparties(router: Router): void {
  router.add("GET", "/api/w/:slug/counterparties", async (ctx) => {
    const who = await staff(ctx);
    const found = await rows<CounterpartyRow>(pool,
      "SELECT * FROM counterparties WHERE workspace_slug = $1 ORDER BY normalised_name", [who.workspace.slug]);
    return { status: 200, json: { counterparties: found.map(counterpartyBody) } };
  });

  router.add("GET", "/api/w/:slug/counterparties/:id", async (ctx) => {
    const who = await staff(ctx);
    const c = await findCounterparty(pool, who, ctx.params.id);
    const previous = await rows<{ name: string; from_date: string; until_date: string }>(pool,
      "SELECT * FROM counterparty_previous_names WHERE counterparty_id = $1 ORDER BY id", [c.id]);
    const addresses = await rows<{ address: string }>(pool,
      "SELECT address FROM address_registry WHERE counterparty_id = $1 ORDER BY address", [c.id]);
    return {
      status: 200,
      json: {
        counterparty: {
          ...counterpartyBody(c),
          previousNames: previous.map((p) => ({ name: p.name, from: p.from_date, until: p.until_date })),
          addresses: addresses.map((a) => a.address),
        },
      },
    };
  });

  router.add("POST", "/api/w/:slug/counterparties", async (ctx) => {
    const who = await staff(ctx);
    allow(who, "compliance_officer", "compliance_analyst");
    const body = objectBody(ctx.json());
    const check = new FieldCheck();
    checkEditable(check, body, false, "off_network");
    const lei = typeof body.lei === "string" ? body.lei.trim().toUpperCase() : "";
    const leiOk = isValidLei(lei);
    if (!leiOk) check.fail("lei", "Enter a 20-character LEI whose check digits are valid.");
    if (!(await knownJurisdiction(body.jurisdictionCode))) check.fail("jurisdictionCode", "Choose a jurisdiction.");
    const addresses = body.addresses === undefined ? [] : body.addresses;
    const list = Array.isArray(addresses) ? [...new Set(addresses as unknown[])] : [null];
    const addressesOk = list.every(isValidAddress);
    if (!addressesOk) check.fail("addresses", ADDRESS_MESSAGE);
    const legalName = typeof body.legalName === "string" ? body.legalName.trim() : "";
    return tx(async (db) => {
      await lockName(db, `counterparties:${who.workspace.slug}`);
      if (leiOk && await one(db, "SELECT 1 FROM counterparties WHERE workspace_slug = $1 AND lei = $2", [who.workspace.slug, lei])) {
        throw refuse.conflict("lei_taken", "A counterparty with this LEI already exists.");
      }
      if (legalName && await one(db, "SELECT 1 FROM counterparties WHERE workspace_slug = $1 AND normalised_name = $2",
        [who.workspace.slug, normaliseName(legalName)])) {
        throw nameTaken();
      }
      if (addressesOk && list.length > 0 && await one(db,
        "SELECT 1 FROM address_registry WHERE workspace_slug = $1 AND address = ANY($2)", [who.workspace.slug, list])) {
        throw refuse.conflict("address_taken", "An address is already in the address registry.");
      }
      check.throwIfAny();
      const id = randomUUID();
      const created = await one<CounterpartyRow>(db,
        `INSERT INTO counterparties (id, workspace_slug, legal_name, normalised_name, lei, jurisdiction_code, licence_number,
           due_diligence, network, contact_email, notes, name_since, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'off_network', $9, $10, $11, now(), now()) RETURNING *`,
        [id, who.workspace.slug, legalName, normaliseName(legalName), lei, body.jurisdictionCode, (body.licenceNumber as string).trim(),
          body.dueDiligence, (body.contactEmail as string).trim(), typeof body.notes === "string" ? body.notes : "",
          businessDate(who.workspace.timeZone, Date.now())]);
      for (const address of list as string[]) {
        await db.query("INSERT INTO address_registry VALUES ($1, $2, $3)", [who.workspace.slug, address, id]);
      }
      return { status: 201, json: { counterparty: counterpartyBody(created!) } };
    });
  });

  router.add("PATCH", "/api/w/:slug/counterparties/:id", async (ctx) => {
    const who = await staff(ctx);
    const existing = await findCounterparty(pool, who, ctx.params.id);
    allow(who, "compliance_officer", "compliance_analyst");
    const body = objectBody(ctx.json());
    const check = new FieldCheck();
    checkEditable(check, body, true, existing.network);
    if ("lei" in body) check.fail("lei", "The LEI can't be changed.");
    return tx(async (db) => {
      await lockName(db, `counterparties:${who.workspace.slug}`);
      const c = await findCounterparty(db, who, existing.id);
      const legalName = typeof body.legalName === "string" ? body.legalName.trim() : c.legal_name;
      const renamed = legalName !== "" && legalName !== c.legal_name;
      if (renamed && await one(db, "SELECT 1 FROM counterparties WHERE workspace_slug = $1 AND normalised_name = $2 AND id <> $3",
        [who.workspace.slug, normaliseName(legalName), c.id])) {
        throw nameTaken();
      }
      check.throwIfAny();
      const today = businessDate(who.workspace.timeZone, Date.now());
      if (renamed) {
        await db.query("INSERT INTO counterparty_previous_names (counterparty_id, name, from_date, until_date) VALUES ($1, $2, $3, $4)",
          [c.id, c.legal_name, c.name_since, today]);
      }
      const text = (key: string, fallback: string | null) => (typeof body[key] === "string" ? (body[key] as string).trim() : fallback);
      const updated = await one<CounterpartyRow>(db,
        `UPDATE counterparties SET legal_name = $2, normalised_name = $3, name_since = $4, licence_number = $5, due_diligence = $6,
           contact_email = $7, notes = $8, updated_at = now() WHERE id = $1 RETURNING *`,
        [c.id, legalName, normaliseName(legalName), renamed ? today : c.name_since, text("licenceNumber", c.licence_number),
          "dueDiligence" in body ? body.dueDiligence : c.due_diligence, text("contactEmail", c.contact_email) || null,
          typeof body.notes === "string" ? body.notes : c.notes]);
      return { status: 200, json: { counterparty: counterpartyBody(updated!) } };
    });
  });

  router.add("POST", "/api/w/:slug/counterparties/import/preview", async (ctx) => {
    const who = await staff(ctx);
    allow(who, "compliance_officer", "compliance_analyst");
    const planned = await planImport(pool, who, csvBody(ctx));
    const count = (outcome: ImportRow["outcome"]) => planned.filter((r) => r.outcome === outcome).length;
    return {
      status: 200,
      json: { rows: planned.map(publicRow), summary: { matched: count("matched"), new: count("new"), refused: count("refused") } },
    };
  }, 1_000_000);

  router.add("POST", "/api/w/:slug/counterparties/import", async (ctx) => {
    const who = await staff(ctx);
    allow(who, "compliance_officer", "compliance_analyst");
    const text = csvBody(ctx);
    const result = await tx(async (db) => {
      await lockName(db, `counterparties:${who.workspace.slug}`);
      return applyImport(db, who, await planImport(db, who, text));
    });
    return { status: 200, json: result };
  }, 1_000_000);

  router.add("GET", "/api/w/:slug/customers", async (ctx) => {
    const who = await staff(ctx);
    const masked = who.member.role === "support_agent";
    const found = await rows<{ id: string; name: string; identity_number: string; date_of_birth: string; deposit_address: string }>(pool,
      "SELECT * FROM customers WHERE workspace_slug = $1 ORDER BY position", [who.workspace.slug]);
    return {
      status: 200,
      json: {
        customers: found.map((c) => masked
          ? { id: c.id, name: initials(c.name), identityNumber: maskIdentity(c.identity_number), depositAddress: c.deposit_address }
          : { id: c.id, name: c.name, identityNumber: c.identity_number, dateOfBirth: c.date_of_birth, depositAddress: c.deposit_address }),
      },
    };
  });

  router.add("GET", "/api/w/:slug/address-registry", async (ctx) => {
    const who = await staff(ctx);
    const found = await rows<{ address: string; counterparty_id: string; legal_name: string }>(pool,
      `SELECT r.address, r.counterparty_id, c.legal_name FROM address_registry r JOIN counterparties c ON c.id = r.counterparty_id
        WHERE r.workspace_slug = $1 ORDER BY r.address`, [who.workspace.slug]);
    return {
      status: 200,
      json: { addresses: found.map((a) => ({ address: a.address, counterpartyId: a.counterparty_id, counterpartyName: a.legal_name })) },
    };
  });
}
