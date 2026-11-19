import type { Tx } from "./db.js";
import { db, write } from "./db.js";
import { record } from "./audit.js";
import { now } from "./clock.js";
import { newId } from "./crypto.js";
import { emitToDesk } from "./events.js";
import { Fields, checkBody, conflict, forbidden, notFound } from "./http.js";
import { isDesk, type PersonRow, type VaultRow } from "./model.js";
import { businessDaysAfter, firstBusinessDayOnOrAfter, officeDate, officeMidnight, quarterOf } from "./office-time.js";
import { actorOf } from "./people.js";
import { quarterLabel, reviewSubject, announceReviews, type ReviewRow } from "./review-lines.js";
import { dropScopes } from "./scopes.js";
import { syncAccess } from "./access-sync.js";
import { loadPerson } from "./people.js";

const OVERDUE_BUSINESS_DAY = 11;

interface LineRow {
  id: string;
  review_id: string;
  person_id: string;
  vault_id: string;
  decision: "undecided" | "kept" | "removed";
  decided_by: string | null;
  decided_via: "review" | "scope_change" | null;
}

function requireDesk(viewer: PersonRow): void {
  if (!isDesk(viewer.role)) throw forbidden();
}

function summary(review: ReviewRow, names: Map<string, string>): Record<string, unknown> {
  return {
    id: review.id,
    quarter: quarterLabel(review),
    opened_on: review.opened_on,
    overdue_from: review.overdue_from,
    status: review.status,
    signed_off_by: review.signed_off_by ? (names.get(review.signed_off_by) ?? null) : null,
  };
}

async function personNames(reader: { query: Tx["query"] }): Promise<Map<string, string>> {
  return new Map((await reader.query<{ id: string; full_name: string }>("SELECT id, full_name FROM people")).map((row) => [row.id, row.full_name]));
}

export async function listReviews(viewer: PersonRow): Promise<Record<string, unknown>[]> {
  requireDesk(viewer);
  const names = await personNames(db);
  return (await db.query<ReviewRow>("SELECT * FROM reviews ORDER BY ord DESC")).map((review) => summary(review, names));
}

async function lineViews(reader: Tx | typeof db, lines: LineRow[], names: Map<string, string>): Promise<Record<string, unknown>[]> {
  const [vaults, vendors] = await Promise.all([
    reader.query<VaultRow>("SELECT * FROM vaults"),
    reader.query<{ vault_id: string; name: string; formerly: string | null }>(
      `SELECT c.vault_id, v.name, v.formerly FROM credentials c JOIN vendors v ON v.id = c.vendor_id ORDER BY c.ord`,
    ),
  ]);
  return lines.map((line) => {
    const vault = vaults.find((candidate) => candidate.id === line.vault_id);
    const seen = new Set<string>();
    const vendorList: Array<{ name: string; formerly: string | null }> = [];
    for (const vendor of vendors.filter((candidate) => candidate.vault_id === line.vault_id)) {
      if (!seen.has(vendor.name)) {
        seen.add(vendor.name);
        vendorList.push({ name: vendor.name, formerly: vendor.formerly });
      }
    }
    return {
      id: line.id,
      person_id: line.person_id,
      person_name: names.get(line.person_id) ?? "",
      vault_id: line.vault_id,
      vault_name: vault?.name ?? "",
      vault_formerly: vault?.formerly ?? null,
      vendors: vendorList,
      decision: line.decision,
      decided_by: line.decided_by ? (names.get(line.decided_by) ?? null) : null,
      decided_via: line.decided_via,
    };
  });
}

/** Lines in people order (seed order, then join order), and within each person in drawer order. */
async function orderedLines(reader: Tx | typeof db, reviewId: string): Promise<LineRow[]> {
  return reader.query<LineRow>(
    `SELECT l.* FROM review_lines l JOIN people p ON p.id = l.person_id JOIN vaults v ON v.id = l.vault_id
     WHERE l.review_id = $1 ORDER BY p.ord, v.ord, l.id`,
    [reviewId],
  );
}

async function detail(reader: Tx | typeof db, review: ReviewRow): Promise<Record<string, unknown>> {
  const names = await personNames(reader);
  const lines = await orderedLines(reader, review.id);
  return {
    ...summary(review, names),
    decided: lines.filter((line) => line.decision !== "undecided").length,
    total: lines.length,
    lines: await lineViews(reader, lines, names),
  };
}

export async function showReview(viewer: PersonRow, id: string): Promise<Record<string, unknown>> {
  requireDesk(viewer);
  const review = await db.one<ReviewRow>("SELECT * FROM reviews WHERE id = $1", [id]);
  if (!review) throw notFound();
  return detail(db, review);
}

export async function decideLine(actor: PersonRow, reviewId: string, lineId: string, body: unknown): Promise<Record<string, unknown>> {
  const decided = await write(async (tx) => {
    const review = await tx.one<ReviewRow>("SELECT * FROM reviews WHERE id = $1", [reviewId]);
    const line = review ? await tx.one<LineRow>("SELECT * FROM review_lines WHERE id = $1 AND review_id = $2", [lineId, reviewId]) : null;
    if (!review || !line) throw notFound();
    if (actor.role !== "office_manager") throw forbidden();
    if (review.status === "signed_off") throw conflict("review_signed_off", "That review is signed off.");
    if (line.decision !== "undecided") throw conflict("line_decided", "This line is already decided.");
    const fields = new Fields();
    const v = checkBody(body, { decision: { kind: "string" } }, fields);
    if (v.decision !== "keep" && v.decision !== "remove") fields.add("decision", "Choose keep or remove.");
    fields.throwIfAny();
    const at = now();
    const person = await loadPerson(tx, line.person_id);
    const vault = await tx.one<VaultRow>("SELECT * FROM vaults WHERE id = $1", [line.vault_id]);
    if (!person || !vault) throw notFound();
    const decision: LineRow["decision"] = v.decision === "keep" ? "kept" : "removed";
    await tx.query("UPDATE review_lines SET decision = $2, decided_by = $3, decided_via = 'review' WHERE id = $1", [line.id, decision, actor.id]);
    await record(
      tx,
      actorOf(actor),
      "review_decision",
      { kind: "person", id: person.id, name: person.full_name },
      { decided_via: "review", decision, vault: vault.name, review: quarterLabel(review) },
      at,
    );
    if (decision === "removed") {
      await dropScopes(tx, person, [vault.id], actorOf(actor), at);
      tx.after(() => syncAccess(person.id, "change"));
    }
    announceReviews(tx, [review.id]);
    return { ...line, decision, decided_by: actor.id, decided_via: "review" as const };
  });
  const [view] = await lineViews(db, [decided], await personNames(db));
  return view ?? {};
}

export async function signOff(actor: PersonRow, reviewId: string): Promise<Record<string, unknown>> {
  return write(async (tx) => {
    const review = await tx.one<ReviewRow>("SELECT * FROM reviews WHERE id = $1", [reviewId]);
    if (!review) throw notFound();
    if (actor.role !== "managing_partner") throw forbidden();
    if (review.status === "signed_off") throw conflict("review_signed_off", "That review is signed off.");
    const open = await tx.one<{ count: number }>("SELECT count(*)::int AS count FROM review_lines WHERE review_id = $1 AND decision = 'undecided'", [reviewId]);
    if ((open?.count ?? 0) > 0) throw conflict("lines_undecided", "Decide every line before signing off.");
    await tx.query("UPDATE reviews SET status = 'signed_off', signed_off_by = $2 WHERE id = $1", [reviewId, actor.id]);
    await record(tx, actorOf(actor), "review_sign_off", reviewSubject(review), { review_id: review.id });
    announceReviews(tx, [review.id]);
    const fresh = await tx.one<ReviewRow>("SELECT * FROM reviews WHERE id = $1", [reviewId]);
    return detail(tx, fresh ?? review);
  });
}

// ---- timed: a review opens on the quarter's first office business day and turns overdue ----

export function openingDay(date: string): { year: number; quarter: number; opened_on: string; overdue_from: string } {
  const { year, quarter, start } = quarterOf(date);
  const opened = firstBusinessDayOnOrAfter(start);
  return { year, quarter, opened_on: opened, overdue_from: businessDaysAfter(opened, OVERDUE_BUSINESS_DAY - 1) };
}

/** Opens the review of the quarter containing `date` if it is not filed yet. `audited` is false for the seeded one. */
export async function openReviewFor(tx: Tx, date: string, audited: boolean): Promise<ReviewRow | null> {
  const day = openingDay(date);
  if (date < day.opened_on) return null;
  if (await tx.one("SELECT 1 FROM reviews WHERE quarter_year = $1 AND quarter = $2", [day.year, day.quarter])) return null;
  const id = newId();
  const openedAt = officeMidnight(day.opened_on);
  await tx.query(
    "INSERT INTO reviews (id, quarter_year, quarter, opened_on, overdue_from, status, opened_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [id, day.year, day.quarter, day.opened_on, day.overdue_from, date >= day.overdue_from ? "overdue" : "open", openedAt],
  );
  const pairs = await tx.query<{ person_id: string; vault_id: string }>(
    `SELECT pv.person_id, pv.vault_id FROM person_vaults pv JOIN people p ON p.id = pv.person_id JOIN vaults v ON v.id = pv.vault_id
     WHERE p.left_at IS NULL AND p.role IN ('staff_accountant','outside_bookkeeper') ORDER BY p.ord, v.ord`,
  );
  for (const pair of pairs) {
    await tx.query("INSERT INTO review_lines (id, review_id, person_id, vault_id, decision) VALUES ($1,$2,$3,$4,'undecided')", [
      newId(),
      id,
      pair.person_id,
      pair.vault_id,
    ]);
  }
  const review = await tx.one<ReviewRow>("SELECT * FROM reviews WHERE id = $1", [id]);
  if (!review) throw new Error("review was not stored");
  if (audited) {
    await record(tx, "system", "review_open", reviewSubject(review), { review_id: id }, openedAt);
    tx.after(() => emitToDesk("review-opened", { review_id: id }));
  }
  return review;
}

export async function markOverdue(tx: Tx, at: Date): Promise<void> {
  const today = officeDate(at);
  const late = await tx.query<ReviewRow>("SELECT * FROM reviews WHERE status = 'open' AND overdue_from <= $1 ORDER BY ord", [today]);
  for (const review of late) {
    await tx.query("UPDATE reviews SET status = 'overdue' WHERE id = $1", [review.id]);
    await record(tx, "system", "review_overdue", reviewSubject(review), { review_id: review.id }, officeMidnight(review.overdue_from));
    announceReviews(tx, [review.id]);
  }
}
