import type { Grant, GrantState, Person, VestingType } from "../shared/types.js";
import { displayDate, groupThousands } from "../shared/format.js";
import { formatPrice, parseDecimal } from "./decimal.js";
import { POOL_LOCK, direct, nextId, query, transaction, type Queryable, type Tx } from "./db.js";
import { ApiError, conflict, forbidden, notFound, validation, vaultUnavailable } from "./errors.js";
import { grantAgreementText, createPendingDocument, sealDocument } from "./documents.js";
import { writeLedgerEntry } from "./ledger.js";
import { loadRegisterTotals, loadValuations, presentPool, type RegisterTotals } from "./registry.js";
import { addMonths, isCalendarDate, iso, now, pacificDate } from "./time.js";
import { offerExpiry, offerHasLapsed, offerWarningAt, windowHasEnded } from "./deadlines.js";
import { MARKS } from "../shared/vesting.js";
import { buildSchedule, cumulativeAt, latestMark, nextTranche, vestedOn, type VestingBasis } from "./vesting.js";

export type GrantRow = {
  id: string;
  holder_id: string | null;
  holder_name: string | null;
  options: number | null;
  strike_units: string | null;
  vesting_type: VestingType | null;
  vesting_start: string | null;
  state: GrantState;
  draft_version: number;
  offered_at: Date | null;
  offer_expires_at: Date | null;
  offer_warning_sent: boolean;
  accepted_at: Date | null;
  agreement_paper: boolean;
  agreement_document_id: string | null;
  agreement_status: "pending" | "sealed" | null;
  exercised: number;
  cancelled: number;
  forfeited: number;
  window_settled: boolean;
  announced_mark: number | null;
  termination_date: string | null;
  window_ends_at: Date | null;
  approvals: number;
  declines: number;
  in_open_orders: number;
};

export const SELECT_GRANTS = `SELECT g.id, g.holder_id, p.name AS holder_name, g.options, g.strike_units::text AS strike_units,
    g.vesting_type, g.vesting_start, g.state, g.draft_version, g.offered_at, g.offer_expires_at,
    g.offer_warning_sent, g.accepted_at, g.agreement_paper, g.agreement_document_id, d.status AS agreement_status,
    g.exercised, g.cancelled, g.forfeited, g.window_settled, g.announced_mark, p.termination_date, p.window_ends_at,
    (SELECT count(*) FROM votes v WHERE v.grant_id = g.id AND v.vote = 'approve')::int AS approvals,
    (SELECT count(*) FROM votes v WHERE v.grant_id = g.id AND v.vote = 'decline')::int AS declines,
    (SELECT coalesce(sum(o.options), 0) FROM orders o WHERE o.grant_id = g.id AND o.state IN ('pending', 'held'))::bigint AS in_open_orders
  FROM grants g LEFT JOIN people p ON p.id = g.holder_id LEFT JOIN documents d ON d.id = g.agreement_document_id`;

const instant = (value: Date | null): string | null => (value ? iso(value) : null);

/** The vesting facts of an accepted grant on the server date; the one place a grant's vested count is derived. */
export function vestingBasis(row: GrantRow, serverDate: string): VestingBasis | null {
  if (row.options === null || row.vesting_type === null || row.vesting_start === null) return null;
  return {
    options: row.options,
    vestingType: row.vesting_type,
    vestingStart: row.vesting_start,
    serverDate,
    terminationDate: row.state === "accepted" ? row.termination_date : null,
  };
}

type Terms = { holderId: string; holderName: string; options: number; strikeUnits: bigint; vestingType: VestingType; vestingStart: string };

/** The terms of a grant that has passed the board; submit validation guarantees every one is set. */
export function committedTerms(row: GrantRow): Terms {
  if (row.holder_id === null || row.holder_name === null || row.options === null || row.strike_units === null || row.vesting_type === null || row.vesting_start === null) {
    throw new Error(`grant ${row.id} reached the board without its terms`);
  }
  return { holderId: row.holder_id, holderName: row.holder_name, options: row.options, strikeUnits: BigInt(row.strike_units), vestingType: row.vesting_type, vestingStart: row.vesting_start };
}

export const exercisableOf = (row: GrantRow, vested: number): number =>
  row.state === "accepted" ? Math.max(0, vested - row.exercised - row.cancelled - row.in_open_orders) : 0;

export function presentGrant(row: GrantRow, totals: RegisterTotals): Grant {
  const moment = now();
  const serverDate = pacificDate(moment);
  const accepted = row.state === "accepted";
  const basis = vestingBasis(row, serverDate);
  const vested = accepted && basis ? vestedOn(basis) : 0;
  const windowEnded = windowHasEnded(row.window_ends_at, moment);
  const strikeUnits = row.strike_units === null ? null : BigInt(row.strike_units);
  const schedule =
    basis && strikeUnits !== null
      ? buildSchedule({
          ...basis,
          strikeUnits,
          accepted,
          cancelledAtWindowEnd: accepted && windowEnded && row.cancelled > 0,
          exercised: accepted ? row.exercised : 0,
          cancelled: accepted ? row.cancelled : 0,
          holderIssued: totals.holders.get(row.holder_id ?? "")?.issued ?? 0,
          fullyDilutedTotal: totals.fullyDiluted,
        })
      : [];
  return {
    id: row.id,
    holder_id: row.holder_id,
    holder_name: row.holder_name,
    options: row.options,
    strike: strikeUnits === null ? null : formatPrice(strikeUnits),
    vesting_type: row.vesting_type,
    vesting_start: row.vesting_start,
    state: row.state,
    draft_version: row.draft_version,
    votes: { approve: row.approvals, decline: row.declines },
    offered_at: instant(row.offered_at),
    offer_expires_at: instant(row.offer_expires_at),
    offer_warning_at: row.offer_expires_at ? iso(offerWarningAt(row.offer_expires_at)) : null,
    accepted_at: instant(row.accepted_at),
    agreement: {
      status: row.agreement_status ?? (row.agreement_paper ? "paper" : "none"),
      document_id: row.agreement_document_id,
    },
    vested,
    exercised: accepted ? row.exercised : 0,
    cancelled: accepted ? row.cancelled : 0,
    forfeited: accepted ? row.forfeited : 0,
    in_open_orders: accepted ? row.in_open_orders : 0,
    exercisable: exercisableOf(row, vested),
    next_tranche:
      accepted && basis && basis.terminationDate === null ? nextTranche(basis.options, basis.vestingType, basis.vestingStart, serverDate) : null,
    exercise_window_ends_at: accepted ? instant(row.window_ends_at) : null,
    schedule,
    server_date: serverDate,
    server_time: iso(moment),
  };
}

export function canSeeGrant(person: Person, row: GrantRow): boolean {
  return person.role === "founder_admin" || (row.holder_id === person.id && (person.role === "option_holder" || person.role === "leaver"));
}

export async function grantRow(db: Queryable, id: string, lock = false): Promise<GrantRow> {
  // The lock is its own statement so the read that follows sees everything committed while waiting for it.
  if (lock) await db.query("SELECT 1 FROM grants WHERE id = $1 FOR UPDATE", [id]);
  const rows = await db.query<GrantRow>(`${SELECT_GRANTS} WHERE g.id = $1`, [id]);
  if (!rows[0]) throw notFound();
  return rows[0];
}

export async function visibleGrantRow(person: Person, id: string): Promise<GrantRow> {
  await settleGrant(id);
  const row = await grantRow(direct, id);
  if (!canSeeGrant(person, row)) throw notFound();
  return row;
}

export const requireHolder = (person: Person, row: GrantRow): void => {
  if (row.holder_id !== person.id) throw forbidden();
};

export async function presentGrantById(id: string): Promise<Grant> {
  const [row, totals] = await Promise.all([grantRow(direct, id), loadRegisterTotals(direct)]);
  return presentGrant(row, totals);
}

export async function listGrants(person: Person): Promise<Grant[]> {
  if (person.role !== "founder_admin" && person.role !== "option_holder" && person.role !== "leaver") throw forbidden();
  await settleAll();
  const [rows, totals] = await Promise.all([
    person.role === "founder_admin"
      ? query<GrantRow>(`${SELECT_GRANTS} ORDER BY g.id`)
      : query<GrantRow>(`${SELECT_GRANTS} WHERE g.holder_id = $1 ORDER BY g.id`, [person.id]),
    loadRegisterTotals(direct),
  ]);
  return rows.map((row) => presentGrant(row, totals));
}

/** Every grant state change goes through here: the state moves only from one of the named states. */
export async function moveGrant(
  tx: Tx,
  id: string,
  from: GrantState[],
  to: GrantState,
  set: Record<string, unknown> = {},
): Promise<boolean> {
  const columns = Object.keys(set);
  const assignments = columns.map((column, index) => `, ${column} = $${index + 4}`).join("");
  const rows = await tx.query<{ id: string }>(
    `UPDATE grants SET state = $3${assignments} WHERE id = $1 AND state = ANY($2::text[]) RETURNING id`,
    [id, from, to, ...columns.map((column) => set[column])],
  );
  if (rows.length > 0) tx.emit({ to: null, type: "changed", data: { topics: ["grants", "board", "registry"] } });
  return rows.length > 0;
}

/* ------------------------------------------------------------------ drafts */

type Draft = {
  holder_id?: string | null;
  options?: number | null;
  strike_units?: bigint | null;
  vesting_type?: VestingType | null;
  vesting_start?: string | null;
};

const strikeMessage = "Enter a price above $0.0000 with up to four decimals.";
const optionsMessage = (available: number) => `Enter a whole number of options from 1 to ${groupThousands(Math.max(available, 1))}.`;

/** Checks the shape of the fields sent with a draft; the board-ready rules are checked on submit. */
async function parseDraft(tx: Queryable, body: Record<string, unknown>, available: number): Promise<Draft> {
  const draft: Draft = {};
  const fields: Record<string, string> = {};
  if ("holder_id" in body && body.holder_id !== null) {
    if (typeof body.holder_id !== "string") fields.holder_id = "Choose an option holder.";
    else {
      const [holder] = await tx.query<{ role: string }>("SELECT role FROM people WHERE id = $1", [body.holder_id]);
      if (!holder) throw notFound();
      if (holder.role !== "option_holder") fields.holder_id = "Choose an option holder.";
    }
  }
  if ("holder_id" in body && !fields.holder_id) draft.holder_id = body.holder_id as string | null;
  if ("options" in body) {
    if (body.options === null) draft.options = null;
    else if (typeof body.options === "number" && Number.isSafeInteger(body.options) && body.options >= 1) draft.options = body.options;
    else fields.options = optionsMessage(available);
  }
  if ("strike" in body) {
    const units = body.strike === null ? null : parseDecimal(body.strike, 4);
    if (body.strike === null) draft.strike_units = null;
    else if (units !== null && units > 0n) draft.strike_units = units;
    else fields.strike = strikeMessage;
  }
  if ("vesting_type" in body) {
    if (body.vesting_type === null || body.vesting_type === "standard" || body.vesting_type === "monthly") draft.vesting_type = body.vesting_type;
    else fields.vesting_type = "Choose a vesting type.";
  }
  if ("vesting_start" in body) {
    if (body.vesting_start === null) draft.vesting_start = null;
    else if (typeof body.vesting_start === "string" && isCalendarDate(body.vesting_start)) draft.vesting_start = body.vesting_start;
    else fields.vesting_start = "Enter the vesting start as YYYY-MM-DD.";
  }
  if (Object.keys(fields).length > 0) throw validation(fields);
  return draft;
}

async function requireCurrentValuation(db: Queryable): Promise<{ fmvUnits: bigint }> {
  const { current } = await loadValuations(db);
  if (!current || current.status !== "current") {
    const lapsed = current ? `The current valuation lapsed on ${displayDate(current.expires_on)}.` : "There is no valuation on record.";
    throw conflict("valuation_lapsed", `${lapsed} Record a new valuation before issuing grants.`);
  }
  return { fmvUnits: parseDecimal(current.fmv_per_share, 4) ?? 0n };
}

function draftColumns(draft: Draft): { assignments: string; values: unknown[] } {
  const entries = Object.entries(draft);
  return {
    assignments: entries.map(([column], index) => `${column} = $${index + 2}`).join(", "),
    values: entries.map(([, value]) => (typeof value === "bigint" ? value.toString() : value)),
  };
}

export async function createDraft(body: Record<string, unknown>): Promise<Grant> {
  await requireCurrentValuation(direct);
  const totals = await loadRegisterTotals(direct);
  const draft = await parseDraft(direct, body, presentPool(totals).available);
  const id = await transaction(async (tx) => {
    const created = await nextId(tx, "grant_number", "TC-OPT-", 4);
    await tx.query("INSERT INTO grants (id) VALUES ($1)", [created]);
    const { assignments, values } = draftColumns(draft);
    if (assignments) await tx.query(`UPDATE grants SET ${assignments} WHERE id = $1`, [created, ...values]);
    tx.emit({ to: null, type: "changed", data: { topics: ["grants"] } });
    return created;
  });
  return presentGrantById(id);
}

export async function patchDraft(id: string, body: Record<string, unknown>): Promise<Grant> {
  const totals = await loadRegisterTotals(direct);
  const saved = await transaction(async (tx) => {
    const row = await grantRow(tx, id, true);
    if (row.state !== "draft") throw conflict("grant_not_draft", "Only a draft grant can be edited.");
    const version = body.draft_version;
    if (typeof version === "number" && Number.isSafeInteger(version) && version >= 1 && version !== row.draft_version) {
      throw new ApiError(409, "draft_outdated", "This draft changed in another tab. The latest version is shown.", {
        grant: presentGrant(row, totals),
      });
    }
    if ("draft_version" in body && !(typeof version === "number" && Number.isSafeInteger(version) && version >= 1)) {
      throw validation({ draft_version: "The draft version must be a positive whole number." });
    }
    const draft = await parseDraft(tx, body, presentPool(totals).available);
    const { assignments, values } = draftColumns(draft);
    await tx.query(`UPDATE grants SET ${assignments ? `${assignments}, ` : ""}draft_version = draft_version + 1 WHERE id = $1`, [id, ...values]);
    tx.emit({ to: null, type: "changed", data: { topics: ["grants"] } });
    return id;
  });
  return presentGrantById(saved);
}

export async function deleteDraft(id: string): Promise<void> {
  await transaction(async (tx) => {
    const row = await grantRow(tx, id, true);
    if (row.state !== "draft") throw conflict("grant_not_draft", "Only a draft grant can be deleted.");
    await tx.query("DELETE FROM grants WHERE id = $1", [id]);
    tx.emit({ to: null, type: "changed", data: { topics: ["grants"] } });
  });
}

/* ------------------------------------------------------------ transitions */

export async function submitGrant(id: string): Promise<Grant> {
  await transaction(async (tx) => {
    const row = await grantRow(tx, id, true);
    if (row.state !== "draft") throw conflict("grant_not_draft", "Only a draft grant can be submitted to the board.");
    const { fmvUnits } = await requireCurrentValuation(tx);
    await tx.query("SELECT pg_advisory_xact_lock($1)", [POOL_LOCK]);
    const available = presentPool(await loadRegisterTotals(tx)).available;
    if (row.options !== null && row.options >= 1 && row.options > available) {
      throw conflict("pool_exhausted", "The option pool doesn't have that many options available.");
    }
    const fields: Record<string, string> = {};
    if (row.holder_id === null) fields.holder_id = "Choose an option holder.";
    if (row.options === null || row.options < 1) fields.options = optionsMessage(available);
    if (row.strike_units === null || BigInt(row.strike_units) < fmvUnits) {
      fields.strike = `Strike must be at least the current fair market value of $${formatPrice(fmvUnits)}.`;
    }
    if (row.vesting_type === null) fields.vesting_type = "Choose a vesting type.";
    const today = pacificDate(now());
    if (row.vesting_start === null || row.vesting_start < "2015-01-01" || row.vesting_start > addMonths(today, 12)) {
      fields.vesting_start = "Enter the vesting start as YYYY-MM-DD.";
    }
    if (Object.keys(fields).length > 0) throw validation(fields);
    await moveGrant(tx, id, ["draft"], "board_queue");
  });
  return presentGrantById(id);
}

export async function offerGrant(id: string): Promise<Grant> {
  await transaction(async (tx) => {
    const row = await grantRow(tx, id, true);
    if (row.state !== "approved") throw conflict("grant_not_approved", "Only an approved grant can be offered.");
    const { fmvUnits } = await requireCurrentValuation(tx);
    if (row.strike_units === null || BigInt(row.strike_units) < fmvUnits) {
      throw conflict("strike_below_fmv", "The strike is below the current fair market value.");
    }
    const offeredAt = now();
    await moveGrant(tx, id, ["approved"], "offered", {
      offered_at: offeredAt,
      offer_expires_at: offerExpiry(offeredAt),
      offer_warning_sent: false,
    });
    tx.emit({ to: row.holder_id, type: "offer.arrived", data: { grant_id: id, options: row.options } });
  });
  return presentGrantById(id);
}

export async function acceptGrant(id: string): Promise<{ outcome: "accepted" | "vault_down" | "expired" }> {
  return transaction(async (tx) => {
    const row = await grantRow(tx, id, true);
    const answered = await refuseUnlessOffered(tx, row);
    if (answered) return { outcome: "expired" as const };
    const terms = committedTerms(row);
    let documentId = row.agreement_document_id;
    if (documentId === null) {
      documentId = await createPendingDocument(tx, {
        kind: "grant_agreement",
        title: `Grant agreement ${id}`,
        ownerId: terms.holderId,
        vaultKey: `grant-agreements/${id}.txt`,
        text: grantAgreementText({
          id,
          holderName: terms.holderName,
          options: terms.options,
          strike: formatPrice(terms.strikeUnits),
          vestingType: terms.vestingType,
          vestingStart: terms.vestingStart,
          signedAt: now(),
        }),
      });
      await tx.query("UPDATE grants SET agreement_document_id = $2 WHERE id = $1", [id, documentId]);
    }
    try {
      await sealDocument(tx, documentId);
    } catch (error) {
      if (error instanceof ApiError && error.code === "vault_unavailable") return { outcome: "vault_down" as const };
      throw error;
    }
    const acceptedAt = now();
    await moveGrant(tx, id, ["offered"], "accepted", { accepted_at: acceptedAt, announced_mark: latestMark(terms.vestingStart, pacificDate(acceptedAt)) });
    await writeLedgerEntry(tx, {
      holderId: terms.holderId,
      kind: "grant_accepted",
      shareClass: null,
      sharesDelta: 0,
      optionsDelta: terms.options,
      reference: id,
    });
    return { outcome: "accepted" as const };
  });
}

export async function declineGrant(id: string): Promise<{ outcome: "declined" | "expired" }> {
  return transaction(async (tx) => {
    const row = await grantRow(tx, id, true);
    const answered = await refuseUnlessOffered(tx, row);
    if (answered) return { outcome: "expired" as const };
    await tx.query("DELETE FROM votes WHERE grant_id = $1", [id]);
    await moveGrant(tx, id, ["offered"], "board_queue", { offered_at: null, offer_expires_at: null, offer_warning_sent: false });
    return { outcome: "declined" as const };
  });
}

/** True when the offer has expired (now or earlier); throws when the grant is not waiting for an answer at all. */
async function refuseUnlessOffered(tx: Tx, row: GrantRow): Promise<boolean> {
  if (row.state === "expired") return true;
  if (row.state !== "offered") throw conflict("grant_not_offered", "This grant is not waiting for an answer.");
  if (!offerHasLapsed(row.offer_expires_at, now())) return false;
  await expireOffer(tx, row);
  return true;
}

export function respondToOutcome(outcome: "accepted" | "vault_down" | "expired" | "declined"): void {
  if (outcome === "expired") throw conflict("offer_expired", "This offer has expired.");
  if (outcome === "vault_down") throw vaultUnavailable();
}

/* --------------------------------------------------------------- settling */

async function expireOffer(tx: Tx, row: GrantRow): Promise<void> {
  if (await moveGrant(tx, row.id, ["offered"], "expired")) {
    tx.emit({ to: row.holder_id, type: "offer.expired", data: { grant_id: row.id } });
  }
}

/** Offers whose window has ended on the server clock become Expired. */
export async function expireDueOffers(tx: Tx, id: string | null): Promise<void> {
  const offered = await tx.query<{ id: string; offer_expires_at: Date }>(
    `SELECT id, offer_expires_at FROM grants WHERE state = 'offered' AND ($1::text IS NULL OR id = $1) FOR UPDATE SKIP LOCKED`,
    [id],
  );
  const moment = now();
  for (const grant of offered) {
    if (offerHasLapsed(grant.offer_expires_at, moment)) await expireOffer(tx, await grantRow(tx, grant.id));
  }
}

/** Offers that reached their warning time on the server clock send the warning once. */
export async function warnDueOffers(tx: Tx): Promise<void> {
  const waiting = await tx.query<{ id: string; holder_id: string; offer_expires_at: Date }>(
    "SELECT id, holder_id, offer_expires_at FROM grants WHERE state = 'offered' AND NOT offer_warning_sent",
  );
  const moment = now();
  for (const grant of waiting.filter((candidate) => offerWarningAt(candidate.offer_expires_at) <= moment)) {
    const marked = await tx.query("UPDATE grants SET offer_warning_sent = true WHERE id = $1 AND NOT offer_warning_sent RETURNING id", [grant.id]);
    if (marked.length > 0) {
      tx.emit({ to: grant.holder_id, type: "offer.warning", data: { grant_id: grant.id, expires_at: iso(grant.offer_expires_at) } });
    }
  }
}

/** Where a leaver's window has ended, every unexercised option not held in an open order is cancelled. */
export async function settleEndedWindows(tx: Tx, id: string | null): Promise<void> {
  const moment = now();
  const leavers = await tx.query<{ id: string; window_ends_at: Date }>(
    `SELECT g.id, p.window_ends_at FROM grants g JOIN people p ON p.id = g.holder_id
      WHERE g.state = 'accepted' AND NOT g.window_settled AND p.window_ends_at IS NOT NULL AND ($1::text IS NULL OR g.id = $1)
      FOR UPDATE OF g SKIP LOCKED`,
    [id],
  );
  for (const { id: dueId } of leavers.filter((leaver) => windowHasEnded(leaver.window_ends_at, moment))) {
    const row = await grantRow(tx, dueId);
    const basis = vestingBasis(row, pacificDate(moment));
    const toCancel = exercisableOf(row, basis ? vestedOn(basis) : 0);
    await tx.query("UPDATE grants SET cancelled = cancelled + $2, window_settled = true WHERE id = $1", [row.id, toCancel]);
    if (toCancel > 0) {
      await writeLedgerEntry(tx, { holderId: row.holder_id, kind: "options_cancelled", shareClass: null, sharesDelta: 0, optionsDelta: -toCancel, reference: row.id });
      tx.emit({ to: row.holder_id, type: "window.ended", data: { grant_id: row.id, cancelled: toCancel } });
    }
    tx.emit({ to: null, type: "changed", data: { topics: ["grants", "orders", "registry"] } });
  }
}

/** Each tranche that vests on the server date is announced to its holder once. */
export async function announceVestedTranches(tx: Tx): Promise<void> {
  const today = pacificDate(now());
  const open = await tx.query<{ id: string; holder_id: string; options: number; vesting_type: VestingType; vesting_start: string; announced_mark: number | null }>(
    `SELECT g.id, g.holder_id, g.options, g.vesting_type, g.vesting_start, g.announced_mark
       FROM grants g JOIN people p ON p.id = g.holder_id
      WHERE g.state = 'accepted' AND p.role = 'option_holder' AND (g.announced_mark IS NULL OR g.announced_mark < $1)`,
    [MARKS],
  );
  for (const grant of open) {
    const mark = latestMark(grant.vesting_start, today);
    if (mark === null || mark === grant.announced_mark) continue;
    const marked = await tx.query(
      "UPDATE grants SET announced_mark = $2 WHERE id = $1 AND announced_mark IS NOT DISTINCT FROM $3 RETURNING id",
      [grant.id, mark, grant.announced_mark],
    );
    if (marked.length === 0) continue;
    if (grant.announced_mark !== null) {
      const vestedToday = cumulativeAt(grant.options, grant.vesting_type, mark) - cumulativeAt(grant.options, grant.vesting_type, grant.announced_mark);
      if (vestedToday > 0) tx.emit({ to: grant.holder_id, type: "tranche.vested", data: { grant_id: grant.id, vested: vestedToday } });
    }
    tx.emit({ to: null, type: "changed", data: { topics: ["grants", "registry"] } });
  }
}

/** Settles whatever the server clock has made due for one grant, so a read after the instant already shows it. */
export async function settleGrant(id: string): Promise<void> {
  const [row] = await query<{ state: GrantState; offer_expires_at: Date | null; window_ends_at: Date | null; window_settled: boolean }>(
    `SELECT g.state, g.offer_expires_at, p.window_ends_at, g.window_settled
       FROM grants g LEFT JOIN people p ON p.id = g.holder_id WHERE g.id = $1`,
    [id],
  );
  const moment = now();
  const due =
    row !== undefined &&
    ((row.state === "offered" && offerHasLapsed(row.offer_expires_at, moment)) ||
      (row.state === "accepted" && !row.window_settled && windowHasEnded(row.window_ends_at, moment)));
  if (!due) return;
  await transaction(async (tx) => {
    await expireDueOffers(tx, id);
    await settleEndedWindows(tx, id);
  });
}

async function settleAll(): Promise<void> {
  await transaction(async (tx) => {
    await expireDueOffers(tx, null);
    await settleEndedWindows(tx, null);
  });
}
