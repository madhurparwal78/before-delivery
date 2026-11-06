// The staff workflow: create, save, submit, return, clear, release and withdraw. Each action asks
// the state machine, then the draft rules, and stores its change and audit entry in one transaction.

import { equitySessionAt } from "./calendar.ts";
import { readMarketClock } from "./clock.ts";
import { catchUpCloses } from "./closes.ts";
import { isUniqueViolation, lockLedger, one, text, withTransaction, type Queryable } from "./db.ts";
import { claimedVersion, nextSunday, validateDraft, type DraftContext, type DraftMode, type DraftOutcome, type StoredDraft } from "./draftRules.ts";
import { Refusal } from "./errors.ts";
import { sharesBeforeWeek } from "./ledger.ts";
import { publishRestatement } from "./publication.ts";
import {
  applyChange,
  factsOf,
  findRestatement,
  insertDraft,
  latestPublished,
  listRestatements,
  publishedBefore,
  replaceShareEvents,
  viewOf,
  type Restatement,
} from "./restatements.ts";
import { decide, mayCreate, OPEN_STATES, type Action, type Actor } from "../shared/restatementRules.ts";
import { ROW_KEYS, type ReleaseResponse, type RestatementView } from "../shared/domain.ts";
import { parseCalendarDate, weekEndInstant } from "../shared/newyork.ts";

type Body = Record<string, unknown>;

function draftOf(restatement: Restatement): StoredDraft {
  return {
    rows: restatement.rows,
    shareEvents: restatement.shareEvents.map((event) => ({ kind: event.kind, shares: event.shares, effectiveDate: event.effectiveDate })),
    accession: restatement.accession,
    exhibitPage: restatement.exhibitPage,
    correctionReason: restatement.correctionReason,
  };
}

async function draftContext(q: Queryable, weekEnding: string, isCorrection: boolean, supersededId: string | null, stored: StoredDraft, requireComplete: boolean): Promise<DraftContext> {
  const prior = await publishedBefore(q, weekEnding);
  return { weekEnding, isCorrection, priorRows: prior?.rows ?? null, sharesBeforeWeek: await sharesBeforeWeek(q, supersededId), stored, requireComplete };
}

const EMPTY_DRAFT: StoredDraft = {
  rows: { "beginning-balance": null, "eth-acquired": null, "staking-rewards": null, "ending-balance": null, "cumulative-staking-rewards": null, "diluted-shares": null },
  shareEvents: [],
  accession: null,
  exhibitPage: null,
  correctionReason: null,
};

function refuseWith(outcome: DraftOutcome): void {
  if (Object.keys(outcome.fields).length > 0) throw new Refusal("validation_failed", outcome.fields);
}

/** Loads under the row lock and asks the state machine; every action goes through here. */
async function permit(q: Queryable, id: string, action: Exclude<Action, "create">, actor: Actor, version?: number): Promise<Restatement> {
  const restatement = await findRestatement(q, id, true);
  if (!restatement) throw new Refusal("not_found");
  const { now } = await readMarketClock(q);
  const verdict = decide(action, factsOf(restatement), version === undefined ? { actor, marketNow: now } : { actor, marketNow: now, claimedVersion: version });
  if (!verdict.allowed) throw new Refusal(verdict.code);
  return restatement;
}

export async function createRestatement(actor: Actor, body: Body): Promise<RestatementView> {
  if (!mayCreate(actor)) throw new Refusal("forbidden");
  try {
    return await withTransaction(async (tx) => {
      await lockLedger(tx);
      const { now } = await readMarketClock(tx);
      await catchUpCloses(tx, now);
      const latest = await latestPublished(tx);
      if (!latest) throw new Refusal("week_out_of_sequence");
      const correcting = "supersedes" in body;
      let weekEnding: string;
      let supersededId: string | null = null;
      if (correcting) {
        const target = typeof body["supersedes"] === "string" ? await findRestatement(tx, body["supersedes"], true) : null;
        if (!target || target.state !== "published" || target.id !== latest.id) throw new Refusal("not_latest_week");
        weekEnding = target.weekEnding;
        supersededId = target.id;
      } else {
        weekEnding = nextSunday(latest.weekEnding);
        const asked = body["week_ending"];
        if (typeof asked === "string" && parseCalendarDate(asked) && asked !== weekEnding) throw new Refusal("week_out_of_sequence");
        if (now < weekEndInstant(weekEnding)) throw new Refusal("week_not_ended");
      }
      const open = await one(tx, "SELECT 1 FROM restatements WHERE state = ANY($1::text[]) LIMIT 1", [OPEN_STATES]);
      if (open) throw new Refusal("restatement_open");
      const members: Body = { ...body };
      delete members["supersedes"];
      const mode: DraftMode = correcting ? "correction-create" : "weekly-create";
      const outcome = validateDraft(correcting ? { ...members, supersedes: supersededId } : members, mode, await draftContext(tx, weekEnding, correcting, supersededId, EMPTY_DRAFT, false));
      refuseWith(outcome);
      const created = await insertDraft(tx, {
        weekEnding,
        supersedes: supersededId,
        correctionReason: outcome.changes.correctionReason ?? null,
        rows: outcome.changes.rows ?? EMPTY_DRAFT.rows,
        shareEvents: outcome.changes.shareEvents ?? [],
        accession: outcome.changes.accession ?? null,
        exhibitPage: outcome.changes.exhibitPage ?? null,
        preparedBy: actor.id,
        at: now,
      });
      return viewOf(tx, created);
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new Refusal("restatement_open");
    throw error;
  }
}

export async function saveRestatement(actor: Actor, id: string, body: Body): Promise<RestatementView> {
  return withTransaction(async (tx) => {
    const sent = claimedVersion(body["version"]);
    const current = await permit(tx, id, "edit", actor, sent ?? undefined);
    const context = await draftContext(tx, current.weekEnding, current.supersedes !== null, current.supersedes, draftOf(current), false);
    const outcome = validateDraft(body, "save", context);
    if (sent === null) outcome.fields["version"] = "Send the version you last read, a positive whole number.";
    refuseWith(outcome);
    const { changes } = outcome;
    const set: Record<string, unknown> = {};
    if (changes.rows) set["rows"] = changes.rows;
    if (changes.accession !== undefined) {
      set["accession"] = changes.accession;
      if (changes.accession !== current.accession) Object.assign(set, { exhibit_status: null, exhibit_sha256: null, exhibit_bytes: null, exhibit_key: null });
    }
    if (changes.exhibitPage !== undefined) set["exhibit_page"] = changes.exhibitPage;
    if (changes.correctionReason !== undefined) set["correction_reason"] = changes.correctionReason;
    const { now } = await readMarketClock(tx);
    if (changes.shareEvents) await replaceShareEvents(tx, current.id, changes.shareEvents);
    const saved = await applyChange(tx, current, { action: "edit", actorId: actor.id, at: now, toState: current.state, set });
    return viewOf(tx, saved);
  });
}

export async function submitRestatement(actor: Actor, id: string): Promise<RestatementView> {
  return withTransaction(async (tx) => {
    const current = await permit(tx, id, "submit", actor);
    if (current.exhibit?.status !== "verified") throw new Refusal("exhibit_not_verified");
    const context = await draftContext(tx, current.weekEnding, current.supersedes !== null, current.supersedes, draftOf(current), true);
    refuseWith(validateDraft({}, "save", context));
    const { now } = await readMarketClock(tx);
    return viewOf(tx, await applyChange(tx, current, { action: "submit", actorId: actor.id, at: now, toState: "in_review" }));
  });
}

export async function returnRestatement(actor: Actor, id: string, body: Body): Promise<RestatementView> {
  return withTransaction(async (tx) => {
    const current = await permit(tx, id, "return", actor);
    const note = body["note"];
    if (typeof note !== "string" || note.length < 10 || note.length > 1000) throw new Refusal("validation_failed", { note: "Enter a note of 10 to 1,000 characters." });
    const { now } = await readMarketClock(tx);
    return viewOf(tx, await applyChange(tx, current, { action: "return", actorId: actor.id, at: now, toState: "returned", note, set: { return_note: note } }));
  });
}

function checkedAllRows(value: unknown): boolean {
  return Array.isArray(value) && value.length === ROW_KEYS.length && ROW_KEYS.every((key) => value.filter((entry) => entry === key).length === 1);
}

export async function clearRestatement(actor: Actor, id: string, body: Body): Promise<RestatementView> {
  return withTransaction(async (tx) => {
    const sent = claimedVersion(body["version"]);
    const current = await permit(tx, id, "clear", actor, sent ?? undefined);
    const fields: Record<string, string> = {};
    if (!checkedAllRows(body["checked"])) fields["checked"] = "Confirm each of the six exhibit rows once.";
    if (sent === null) fields["version"] = "Send the version you last read, a positive whole number.";
    if (Object.keys(fields).length > 0) throw new Refusal("validation_failed", fields);
    const { now } = await readMarketClock(tx);
    return viewOf(tx, await applyChange(tx, current, { action: "clear", actorId: actor.id, at: now, toState: "cleared", set: { cleared_by: actor.id } }));
  });
}

interface ReplayedRelease {
  status: number;
  body: string;
}

async function storedRelease(q: Queryable, actor: Actor, key: string, restatementId: string): Promise<ReplayedRelease | null> {
  const row = await one(q, "SELECT restatement_id, status, body FROM release_replays WHERE user_id = $1 AND idempotency_key = $2", [actor.id, key]);
  if (!row) return null;
  if (text(row, "restatement_id") !== restatementId) throw new Refusal("idempotency_conflict");
  const status = row["status"];
  if (typeof status !== "number") throw new TypeError("stored release has no status");
  return { status, body: text(row, "body") };
}

async function sessionCloseStillPending(q: Queryable, now: number): Promise<number | null> {
  const session = equitySessionAt(now);
  if (session.status !== "open" || session.closesAt === null) return null;
  const processed = await one(q, "SELECT 1 FROM processed_closes WHERE date = $1", [session.date]);
  return processed ? null : session.closesAt;
}

/** A release inside a session queues to its close; any other release publishes at once. */
export async function releaseRestatement(actor: Actor, id: string, body: Body, idempotencyKey: string | undefined): Promise<ReplayedRelease> {
  return withTransaction(async (tx) => {
    await lockLedger(tx);
    if (idempotencyKey !== undefined) {
      const replay = await storedRelease(tx, actor, idempotencyKey, id);
      if (replay) return replay;
    }
    const current = await permit(tx, id, "release", actor);
    if (body["confirm"] !== true) throw new Refusal("validation_failed", { confirm: "Confirm the release." });
    const { now } = await readMarketClock(tx);
    await catchUpCloses(tx, now);
    const closeAt = await sessionCloseStillPending(tx, now);
    let response: ReleaseResponse;
    let status: number;
    if (closeAt !== null) {
      const queued = await applyChange(tx, current, { action: "release_queued", actorId: actor.id, at: now, toState: "queued", set: { release_at: closeAt, released_by: actor.id } });
      response = { outcome: "queued", restatement: await viewOf(tx, queued) };
      status = 202;
    } else {
      const published = await publishRestatement(tx, current, { at: now, actorId: actor.id });
      response = { outcome: "published", restatement: await viewOf(tx, published) };
      status = 200;
    }
    const serialised = JSON.stringify(response);
    if (idempotencyKey !== undefined) {
      await tx.query("INSERT INTO release_replays (user_id, idempotency_key, restatement_id, status, body) VALUES ($1, $2, $3, $4, $5)", [actor.id, idempotencyKey, id, status, serialised]);
    }
    return { status, body: serialised };
  });
}

export async function withdrawRestatement(actor: Actor, id: string, body: Body): Promise<RestatementView> {
  return withTransaction(async (tx) => {
    await lockLedger(tx);
    const { now } = await readMarketClock(tx);
    await catchUpCloses(tx, now);
    const sent = claimedVersion(body["version"]);
    const current = await permit(tx, id, "withdraw", actor, sent ?? undefined);
    const note = body["note"];
    const fields: Record<string, string> = {};
    if (typeof note !== "string" || note.length < 10 || note.length > 500) fields["note"] = "Enter a note of 10 to 500 characters.";
    if (sent === null) fields["version"] = "Send the version you last read, a positive whole number.";
    if (Object.keys(fields).length > 0 || typeof note !== "string") throw new Refusal("validation_failed", fields);
    return viewOf(tx, await applyChange(tx, current, { action: "withdraw", actorId: actor.id, at: now, toState: "cleared", note, set: { release_at: null, released_by: null } }));
  });
}

export async function listRestatementViews(): Promise<RestatementView[]> {
  return withTransaction(async (tx) => {
    const views: RestatementView[] = [];
    for (const restatement of await listRestatements(tx)) views.push(await viewOf(tx, restatement));
    return views;
  });
}
