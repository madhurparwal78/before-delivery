import { db, type Transaction } from "../../db.js";
import { formatPrice } from "../../domain/money.js";
import { nextTenderId } from "../../ids.js";
import { writeWithEvents } from "../../live/events.js";
import { TENDER_AUDIENCE } from "../../flows/audiences.js";
import { buildTender, TENDER_COLUMNS, type TenderRow } from "../../model/tenders.js";
import { loadRegisterTotals } from "../../model/register.js";
import { recordPendingDocument, sealDocument, tenderNdaText } from "../../services/documents.js";
import { VaultUnavailableError } from "../../services/vault.js";
import { conflict, notFound, unavailable, validation } from "../errors.js";
import { field, isPresent, readCount, readInstant, readPrice, readText } from "../fields.js";
import { json, requirePerson, requireRole, type Handler } from "../context.js";
import { route, type Route } from "../router.js";

const BUYER = "Harbourline Secondary Partners";

async function tenderRow(tx: Transaction, id: string, forUpdate = false): Promise<TenderRow> {
  const row = await tx.queryOne<TenderRow>(
    `select ${TENDER_COLUMNS} from tenders where id = $1${forUpdate ? " for update" : ""}`,
    [id],
  );
  if (row === null) throw notFound();
  return row;
}

function requireOpen(row: TenderRow, now: Date): void {
  if (row.state !== "open" || now.getTime() >= row.closes_at.getTime()) {
    throw conflict("tender_closed", "This tender has closed.");
  }
}

async function issuedSharesOf(tx: Transaction, personId: string): Promise<number> {
  const totals = await loadRegisterTotals(tx);
  return totals.holders.get(personId)?.issuedShares ?? 0;
}

const listTenders: Handler = async (context) => {
  const person = requireRole(context, "investor", "founder_admin");
  const rows = await db.query<TenderRow>(`select ${TENDER_COLUMNS} from tenders order by created_at desc`);
  const tenders = [];
  for (const row of rows) tenders.push(await buildTender(db, row, person, context.now));
  return json({ tenders });
};

const readTender: Handler = async (context) => {
  const person = requirePerson(context);
  if (person.role !== "investor" && person.role !== "founder_admin") throw notFound();
  const row = await tenderRow(db, context.params["id"] ?? "");
  return json(await buildTender(db, row, person, context.now));
};

const openTender: Handler = async (context) => {
  const person = requireRole(context, "founder_admin");
  return writeWithEvents(async (tx, emit) => {
    const open = await tx.queryOne<{ id: string }>("select id from tenders where state = 'open'");
    if (open !== null) throw conflict("tender_already_open", "Close the open tender before opening another.");
    const fields: Record<string, string> = {};
    const title = readText(field(context.body, "title"));
    if (title === null || title.trim() === "" || title.length > 120) fields["title"] = "Enter a title of 1 to 120 characters.";
    const price = readPrice(field(context.body, "price_per_share"));
    if (price === null) fields["price_per_share"] = "Enter a price above $0.0000 with up to four decimals.";
    const cap = readCount(field(context.body, "share_cap"));
    if (cap === null) fields["share_cap"] = "Enter a whole number of shares from 1 upward.";
    const closesAt = readInstant(field(context.body, "closes_at"));
    if (closesAt === null || closesAt.getTime() < context.now.getTime() + 10000) {
      fields["closes_at"] = "Set a close time at least 10 seconds from now.";
    }
    if (Object.keys(fields).length > 0 || title === null || price === null || cap === null || closesAt === null) {
      throw validation(fields);
    }
    const id = await nextTenderId(tx);
    const rows = await tx.query<TenderRow>(
      `insert into tenders (id, title, buyer, price_per_share, share_cap, closes_at, state)
       values ($1, $2, $3, $4, $5, $6, 'open') returning ${TENDER_COLUMNS}`,
      [id, title, BUYER, formatPrice(price), cap, closesAt],
    );
    const created = rows[0];
    if (created === undefined) throw new Error("the tender was not written");
    await emit(
      "tender_changed",
      { tender_id: id, reason: "opened", closes_at: closesAt.toISOString() },
      TENDER_AUDIENCE,
    );
    return json(await buildTender(tx, created, person, context.now), 201);
  });
};

const signNda: Handler = async (context) => {
  const person = requireRole(context, "investor");
  const id = context.params["id"] ?? "";
  const prepared = await writeWithEvents(async (tx) => {
    const row = await tenderRow(tx, id);
    const existing = await tx.queryOne<{ status: string; document_id: string | null }>(
      "select status, document_id from tender_ndas where tender_id = $1 and person_id = $2",
      [id, person.id],
    );
    if (existing !== null && existing.status === "sealed") {
      throw conflict("nda_already_signed", "You have already signed this tender's NDA.");
    }
    requireOpen(row, context.now);
    const document = await recordPendingDocument(tx, existing?.document_id ?? null, {
      kind: "tender_nda",
      title: `Tender NDA ${row.id}`,
      ownerId: person.id,
      vaultKey: `tender-ndas/${row.id}/${person.id}.txt`,
      tenderId: row.id,
      body: tenderNdaText(row.id, person.name, context.now.toISOString()),
    });
    await tx.query(
      `insert into tender_ndas (tender_id, person_id, status, document_id) values ($1, $2, 'pending', $3)
       on conflict (tender_id, person_id) do update set status = 'pending', document_id = excluded.document_id`,
      [id, person.id, document.id],
    );
    return { row, document };
  });

  try {
    return await writeWithEvents(async (tx, emit) => {
      await sealDocument(tx, prepared.document);
      await tx.query("update tender_ndas set status = 'sealed' where tender_id = $1 and person_id = $2", [
        id,
        person.id,
      ]);
      await emit("tender_changed", { tender_id: id, reason: "nda" }, { persons: [person.id], roles: ["founder_admin"] });
      return json(await buildTender(tx, prepared.row, person, context.now));
    });
  } catch (error) {
    if (!(error instanceof VaultUnavailableError)) throw error;
    throw unavailable(
      "vault_unavailable",
      "The document vault can't be reached. Your NDA is pending and you can't tender yet.",
      { tender: await buildTender(db, prepared.row, person, context.now) },
    );
  }
};

const saveDraft: Handler = async (context) => {
  const person = requireRole(context, "investor");
  const id = context.params["id"] ?? "";
  return writeWithEvents(async (tx) => {
    const row = await tenderRow(tx, id);
    requireOpen(row, context.now);
    const value = field(context.body, "shares");
    const shares = isPresent(value) ? readText(value) : null;
    if (isPresent(value) && (shares === null || shares.length > 12)) {
      throw validation({ shares: "Enter a whole number of shares from 1 upward." });
    }
    await tx.query(
      `insert into tender_drafts (tender_id, person_id, shares) values ($1, $2, $3)
       on conflict (tender_id, person_id) do update set shares = excluded.shares`,
      [id, person.id, shares],
    );
    return json(await buildTender(tx, row, person, context.now));
  });
};

const submit: Handler = async (context) => {
  const person = requireRole(context, "investor");
  const id = context.params["id"] ?? "";
  return writeWithEvents(async (tx, emit) => {
    const row = await tenderRow(tx, id, true);
    requireOpen(row, context.now);
    const nda = await tx.queryOne<{ status: string }>(
      "select status from tender_ndas where tender_id = $1 and person_id = $2",
      [id, person.id],
    );
    if (nda === null || nda.status !== "sealed") {
      throw conflict("nda_required", "Sign the tender NDA before you tender shares.");
    }
    const existing = await tx.queryOne<{ shares: number }>(
      "select shares from tender_submissions where tender_id = $1 and person_id = $2",
      [id, person.id],
    );
    if (existing !== null) throw conflict("already_submitted", "You have already tendered into this offer.");
    const issued = await issuedSharesOf(tx, person.id);
    const shares = readCount(field(context.body, "shares"));
    if (shares === null || shares > issued) {
      throw validation({ shares: `Enter a whole number of shares from 1 to ${issued}.` });
    }
    const sequenceRow = await tx.queryOne<{ next: number }>(
      "select coalesce(max(sequence), 0) + 1 as next from tender_submissions where tender_id = $1",
      [id],
    );
    await tx.query(
      `insert into tender_submissions (tender_id, person_id, shares, submitted_at, sequence)
       values ($1, $2, $3, $4, $5)`,
      [id, person.id, shares, context.now, sequenceRow === null ? 1 : sequenceRow.next],
    );
    await emit("tender_changed", { tender_id: id, reason: "submitted" }, TENDER_AUDIENCE);
    return json(await buildTender(tx, row, person, context.now), 201);
  });
};

const withdraw: Handler = async (context) => {
  const person = requireRole(context, "investor");
  const id = context.params["id"] ?? "";
  return writeWithEvents(async (tx, emit) => {
    const row = await tenderRow(tx, id, true);
    requireOpen(row, context.now);
    const existing = await tx.queryOne<{ shares: number }>(
      "select shares from tender_submissions where tender_id = $1 and person_id = $2",
      [id, person.id],
    );
    if (existing === null) throw conflict("no_submission", "You have not tendered into this offer.");
    await tx.query("delete from tender_submissions where tender_id = $1 and person_id = $2", [id, person.id]);
    await emit("tender_changed", { tender_id: id, reason: "withdrawn" }, TENDER_AUDIENCE);
    return { status: 204 };
  });
};

export const tenderRoutes: Route[] = [
  route("GET", "/api/tenders", listTenders),
  route("POST", "/api/tenders", openTender),
  route("GET", "/api/tenders/:id", readTender),
  route("POST", "/api/tenders/:id/nda", signNda),
  route("PUT", "/api/tenders/:id/draft", saveDraft),
  route("POST", "/api/tenders/:id/submissions", submit),
  route("DELETE", "/api/tenders/:id/submissions/mine", withdraw),
];

