import type { Person, ShareClass, Tender, TenderMine, TenderState, TenderSubmission } from "../shared/types.js";
import { groupThousands } from "../shared/format.js";
import { allocate } from "./allocation.js";
import { direct, isUniqueViolation, nextId, only, query, transaction, type Queryable, type Tx } from "./db.js";
import { ApiError, conflict, forbidden, notFound, validation } from "./errors.js";
import { createPendingDocument, sealDocument, tenderNdaText } from "./documents.js";
import { formatMoney, formatPrice, parseDecimal, roundHalfUp } from "./decimal.js";
import { writeLedgerEntry } from "./ledger.js";
import { SHARE_CLASSES } from "./registry.js";
import { tenderHasClosed } from "./deadlines.js";
import { addSeconds, iso, now } from "./time.js";

const BUYER_ID = "PER-011";
const BUYER_NAME = "Harbourline Secondary Partners";
const MIN_CLOSE_LEAD_SECONDS = 10;

type TenderRow = { id: string; title: string; price_units: string; share_cap: number; closes_at: Date; state: TenderState };
type SubmissionRow = {
  holder_id: string;
  holder_name: string;
  shares: number;
  submitted_at: Date;
  sequence: number;
  allocation: number | null;
  proceeds_cents: string | null;
};

const SELECT_TENDER = "SELECT id, title, price_units::text AS price_units, share_cap, closes_at, state FROM tenders";

async function tenderRow(db: Queryable, id: string, lock = false): Promise<TenderRow> {
  const [row] = await db.query<TenderRow>(`${SELECT_TENDER} WHERE id = $1${lock ? " FOR UPDATE" : ""}`, [id]);
  if (!row) throw notFound();
  return row;
}

const submissionsOf = (db: Queryable, id: string): Promise<SubmissionRow[]> =>
  db.query<SubmissionRow>(
    `SELECT s.holder_id, p.name AS holder_name, s.shares, s.submitted_at, s.sequence, s.allocation, s.proceeds_cents::text AS proceeds_cents
       FROM tender_submissions s JOIN people p ON p.id = s.holder_id WHERE s.tender_id = $1 ORDER BY s.sequence`,
    [id],
  );

const proceedsOf = (allocation: number, priceUnits: bigint): bigint => roundHalfUp(BigInt(allocation) * priceUnits, 100n);

async function issuedSharesOf(db: Queryable, personId: string): Promise<number> {
  const [row] = await db.query<{ shares: number }>("SELECT coalesce(sum(shares_delta), 0)::bigint AS shares FROM ledger WHERE holder_id = $1", [personId]);
  return row?.shares ?? 0;
}

async function presentMine(db: Queryable, tender: TenderRow, subs: SubmissionRow[], projected: number[], person: Person): Promise<TenderMine> {
  const [nda] = await db.query<{ document_id: string; status: "pending" | "sealed" }>(
    `SELECT n.document_id, d.status FROM tender_ndas n JOIN documents d ON d.id = n.document_id WHERE n.tender_id = $1 AND n.person_id = $2`,
    [tender.id, person.id],
  );
  const [draft] = await db.query<{ shares: string }>("SELECT shares FROM tender_drafts WHERE tender_id = $1 AND person_id = $2", [tender.id, person.id]);
  const index = subs.findIndex((sub) => sub.holder_id === person.id);
  const mine = subs[index];
  const priceUnits = BigInt(tender.price_units);
  const allocation = tender.state === "open" ? null : (mine?.allocation ?? null);
  return {
    nda: { status: nda?.status ?? "none", document_id: nda?.document_id ?? null },
    draft_shares: draft?.shares ?? null,
    submission: mine ? { shares: mine.shares, submitted_at: iso(mine.submitted_at), sequence: mine.sequence } : null,
    projected_allocation: tender.state === "open" && mine ? (projected[index] ?? null) : null,
    allocation,
    proceeds: allocation === null ? null : formatMoney(proceedsOf(allocation, priceUnits)),
  };
}

async function presentTender(db: Queryable, tender: TenderRow, person: Person): Promise<Tender> {
  const subs = await submissionsOf(db, tender.id);
  const total = subs.reduce((sum, sub) => sum + sub.shares, 0);
  const projected = allocate(tender.share_cap, subs.map((sub) => ({ shares: sub.shares, sequence: sub.sequence })));
  const view: Tender = {
    id: tender.id,
    title: tender.title,
    buyer: BUYER_NAME as Tender["buyer"],
    price_per_share: formatPrice(BigInt(tender.price_units)),
    share_cap: tender.share_cap,
    closes_at: iso(tender.closes_at),
    state: tender.state,
    total_tendered: total,
    remaining_cap: Math.max(0, tender.share_cap - total),
    oversubscribed_by: Math.max(0, total - tender.share_cap),
    server_time: iso(now()),
  };
  if (person.role === "investor") view.mine = await presentMine(db, tender, subs, projected, person);
  if (person.role === "founder_admin") {
    view.submissions = subs.map<TenderSubmission>((sub) => ({
      holder_id: sub.holder_id,
      holder_name: sub.holder_name,
      shares: sub.shares,
      submitted_at: iso(sub.submitted_at),
      sequence: sub.sequence,
      allocation: sub.allocation,
      proceeds: sub.proceeds_cents === null ? null : formatMoney(BigInt(sub.proceeds_cents)),
    }));
  }
  return view;
}

/** Every tender state change goes through here: the state moves only from one of the named states. */
async function moveTender(tx: Tx, id: string, from: TenderState[], to: TenderState): Promise<boolean> {
  const rows = await tx.query<{ id: string }>("UPDATE tenders SET state = $3 WHERE id = $1 AND state = ANY($2::text[]) RETURNING id", [id, from, to]);
  return rows.length > 0;
}

function requireTenderRole(person: Person): void {
  if (person.role !== "investor" && person.role !== "founder_admin") throw forbidden();
}

export async function listTenders(person: Person): Promise<Tender[]> {
  requireTenderRole(person);
  await closeDueTenders();
  const rows = await query<TenderRow>(`${SELECT_TENDER} ORDER BY id DESC`);
  return Promise.all(rows.map((row) => presentTender(direct, row, person)));
}

export async function loadTender(person: Person, id: string): Promise<Tender> {
  requireTenderRole(person);
  await closeDueTenders();
  return presentTender(direct, await tenderRow(direct, id), person);
}

export async function openTender(person: Person, body: Record<string, unknown>): Promise<Tender> {
  const fields: Record<string, string> = {};
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (title.length < 1 || title.length > 120) fields.title = "Enter a title.";
  const price = parseDecimal(body.price_per_share, 4);
  if (price === null || price <= 0n) fields.price_per_share = "Enter a price above $0.0000 with up to four decimals.";
  const cap = body.share_cap;
  if (typeof cap !== "number" || !Number.isSafeInteger(cap) || cap < 1) fields.share_cap = "Enter a whole number of shares from 1 upward.";
  const closes = typeof body.closes_at === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(body.closes_at) ? new Date(body.closes_at) : null;
  if (closes === null || Number.isNaN(closes.getTime()) || closes < addSeconds(now(), MIN_CLOSE_LEAD_SECONDS)) {
    fields.closes_at = "Set a close time at least 10 seconds from now.";
  }
  await closeDueTenders();
  const alreadyOpen = conflict("tender_already_open", "Close the open tender before opening another.");
  const open = await query("SELECT 1 FROM tenders WHERE state = 'open'");
  if (open.length > 0) throw alreadyOpen;
  if (Object.keys(fields).length > 0) throw validation(fields);
  let id: string;
  try {
    id = await transaction(async (tx) => {
      const created = await nextId(tx, "tender_number", "TND-", 3);
      await tx.query(
        "INSERT INTO tenders (id, title, price_units, share_cap, closes_at, state, opened_at) VALUES ($1, $2, $3, $4, $5, 'open', $6)",
        [created, title, (price ?? 0n).toString(), cap, closes, now()],
      );
      tx.emit({ to: null, type: "changed", data: { topics: ["tenders"] } });
      return created;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw alreadyOpen;
    throw error;
  }
  return presentTender(direct, await tenderRow(direct, id), person);
}

function requireOpen(tender: TenderRow): void {
  if (tender.state !== "open" || tenderHasClosed(tender.closes_at, now())) throw conflict("tender_closed", "This tender has closed.");
}

function requireInvestor(person: Person): void {
  if (person.role !== "investor") throw forbidden();
}

export async function signNda(person: Person, id: string): Promise<Tender> {
  requireInvestor(person);
  await closeDueTenders();
  const outcome = await transaction(async (tx) => {
    const tender = await tenderRow(tx, id, true);
    const [existing] = await tx.query<{ document_id: string; status: "pending" | "sealed" }>(
      "SELECT n.document_id, d.status FROM tender_ndas n JOIN documents d ON d.id = n.document_id WHERE n.tender_id = $1 AND n.person_id = $2",
      [id, person.id],
    );
    if (existing?.status === "sealed") throw conflict("nda_already_signed", "You have already signed the NDA for this tender.");
    requireOpen(tender);
    let documentId = existing?.document_id;
    if (documentId === undefined) {
      documentId = await createPendingDocument(tx, {
        kind: "tender_nda",
        title: `Tender NDA ${id}`,
        ownerId: person.id,
        vaultKey: `tender-ndas/${id}/${person.id}.txt`,
        text: tenderNdaText({ tenderId: id, sellerName: person.name, signedAt: now() }),
      });
      await tx.query("INSERT INTO tender_ndas (tender_id, person_id, document_id) VALUES ($1, $2, $3)", [id, person.id, documentId]);
    }
    try {
      await sealDocument(tx, documentId);
    } catch (error) {
      if (error instanceof ApiError && error.code === "vault_unavailable") return "pending" as const;
      throw error;
    }
    tx.emit({ to: null, type: "changed", data: { topics: ["tenders"] } });
    return "sealed" as const;
  });
  const view = await presentTender(direct, await tenderRow(direct, id), person);
  if (outcome === "pending") {
    throw new ApiError(503, "vault_unavailable", "The document vault can't be reached. Your NDA is pending and you can't tender yet.", { tender: view });
  }
  return view;
}

export async function saveDraft(person: Person, id: string, body: Record<string, unknown>): Promise<Tender> {
  requireInvestor(person);
  await closeDueTenders();
  await transaction(async (tx) => {
    const tender = await tenderRow(tx, id, true);
    requireOpen(tender);
    const shares = body.shares;
    if (shares !== null && (typeof shares !== "string" || shares.length > 12)) {
      throw validation({ shares: "Enter up to 12 characters." });
    }
    if (shares === null || shares === "") await tx.query("DELETE FROM tender_drafts WHERE tender_id = $1 AND person_id = $2", [id, person.id]);
    else {
      await tx.query(
        `INSERT INTO tender_drafts (tender_id, person_id, shares) VALUES ($1, $2, $3)
         ON CONFLICT (tender_id, person_id) DO UPDATE SET shares = EXCLUDED.shares`,
        [id, person.id, shares],
      );
    }
    tx.emit({ to: person.id, type: "changed", data: { topics: ["tenders"] } });
  });
  return presentTender(direct, await tenderRow(direct, id), person);
}

export async function submitTender(person: Person, id: string, body: Record<string, unknown>): Promise<Tender> {
  requireInvestor(person);
  await closeDueTenders();
  await transaction(async (tx) => {
    const tender = await tenderRow(tx, id, true);
    requireOpen(tender);
    const [nda] = await tx.query<{ status: string }>(
      "SELECT d.status FROM tender_ndas n JOIN documents d ON d.id = n.document_id WHERE n.tender_id = $1 AND n.person_id = $2",
      [id, person.id],
    );
    if (nda?.status !== "sealed") throw conflict("nda_required", "Sign the NDA to tender.");
    const [already] = await tx.query("SELECT 1 FROM tender_submissions WHERE tender_id = $1 AND holder_id = $2", [id, person.id]);
    if (already) throw conflict("already_submitted", "You have already submitted shares to this tender.");
    const issued = await issuedSharesOf(tx, person.id);
    const shares = body.shares;
    if (typeof shares !== "number" || !Number.isSafeInteger(shares) || shares < 1 || shares > issued) {
      throw validation({ shares: `Enter a whole number of shares from 1 to ${groupThousands(issued)}.` });
    }
    const sequence = only(await tx.query<{ sequence: number }>("UPDATE tenders SET submissions_made = submissions_made + 1 WHERE id = $1 RETURNING submissions_made AS sequence", [id])).sequence;
    await tx.query(
      "INSERT INTO tender_submissions (tender_id, holder_id, shares, submitted_at, sequence) VALUES ($1, $2, $3, $4, $5)",
      [id, person.id, shares, now(), sequence],
    );
    await tx.query("DELETE FROM tender_drafts WHERE tender_id = $1 AND person_id = $2", [id, person.id]);
    tx.emit({ to: null, type: "changed", data: { topics: ["tenders"] } });
  });
  return presentTender(direct, await tenderRow(direct, id), person);
}

export async function withdrawTender(person: Person, id: string): Promise<void> {
  requireInvestor(person);
  await closeDueTenders();
  await transaction(async (tx) => {
    const tender = await tenderRow(tx, id, true);
    requireOpen(tender);
    const removed = await tx.query("DELETE FROM tender_submissions WHERE tender_id = $1 AND holder_id = $2 RETURNING 1", [id, person.id]);
    if (removed.length === 0) throw conflict("no_submission", "You have no submission in this tender.");
    tx.emit({ to: null, type: "changed", data: { topics: ["tenders"] } });
  });
}

/* --------------------------------------------------------------- closing */

type Holding = { class: ShareClass; shares: number };

/** Takes `shares` from a seller's classes in share-class order, and gives them to the buyer in the same classes. */
async function transferShares(tx: Tx, sellerId: string, shares: number, tenderId: string): Promise<void> {
  const holdings = await tx.query<Holding>(
    "SELECT class, sum(shares_delta)::bigint AS shares FROM ledger WHERE holder_id = $1 AND class IS NOT NULL GROUP BY class",
    [sellerId],
  );
  let remaining = shares;
  for (const shareClass of SHARE_CLASSES) {
    const held = holdings.find((holding) => holding.class === shareClass)?.shares ?? 0;
    const moved = Math.min(held, remaining);
    if (moved <= 0) continue;
    remaining -= moved;
    await writeLedgerEntry(tx, { holderId: sellerId, kind: "tender_transfer", shareClass, sharesDelta: -moved, optionsDelta: 0, reference: tenderId });
    await writeLedgerEntry(tx, { holderId: BUYER_ID, kind: "tender_transfer", shareClass, sharesDelta: moved, optionsDelta: 0, reference: tenderId });
  }
}

/** At the close time on the server clock the tender closes and is allocated pro rata, once. */
export async function closeDueTenders(): Promise<void> {
  const open = await query<{ id: string; closes_at: Date }>("SELECT id, closes_at FROM tenders WHERE state = 'open'");
  const moment = now();
  for (const { id } of open.filter((tender) => tenderHasClosed(tender.closes_at, moment))) {
    await transaction(async (tx) => {
      const tender = await tenderRow(tx, id, true);
      if (!(await moveTender(tx, id, ["open"], "closed"))) return;
      const subs = await submissionsOf(tx, id);
      const allocations = allocate(tender.share_cap, subs.map((sub) => ({ shares: sub.shares, sequence: sub.sequence })));
      const priceUnits = BigInt(tender.price_units);
      const ordered = subs.map((sub, index) => ({ sub, allocation: allocations[index] ?? 0 }));
      for (const { sub, allocation } of ordered) {
        await tx.query("UPDATE tender_submissions SET allocation = $3, proceeds_cents = $4 WHERE tender_id = $1 AND holder_id = $2", [
          id,
          sub.holder_id,
          allocation,
          proceedsOf(allocation, priceUnits).toString(),
        ]);
        if (allocation > 0) await transferShares(tx, sub.holder_id, allocation, id);
      }
      await moveTender(tx, id, ["closed"], "allocated");
      const investors = await tx.query<{ id: string }>("SELECT id FROM people WHERE role = 'investor' AND access = 'active'");
      for (const investor of investors) tx.emit({ to: investor.id, type: "tender.closed", data: { tender_id: id } });
      for (const { sub, allocation } of ordered) {
        tx.emit({
          to: sub.holder_id,
          type: "tender.allocated",
          data: { tender_id: id, shares: allocation, proceeds: formatMoney(proceedsOf(allocation, priceUnits)) },
        });
      }
      tx.emit({ to: null, type: "changed", data: { topics: ["tenders", "registry"] } });
    });
  }
}

