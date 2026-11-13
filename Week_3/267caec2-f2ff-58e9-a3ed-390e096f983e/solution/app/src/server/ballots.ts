import { type SessionUser, requireRole, requireUser } from "./auth.js";
import { type Db, lockKey, many, one, pool, tx } from "./db.js";
import { COPY, FieldErrors, refuse } from "./errors.js";
import type { ApiRequest, ApiResult } from "./http.js";
import { panelRows } from "./panel.js";
import { type RoundDetail, markPacketPending, roundById, wakePacketWriter } from "./rounds.js";
import { cutoff, deadlineLabel, isoInZone } from "./time.js";
import { text, wholeNumber } from "./validate.js";

// The juror's side: blind ballots, scores, recusal and declared conflicts (brief: API, Juror).

const CRITERIA = ["craft", "clarity", "idea", "story"] as const;

/**
 * The round as the juror may see it: 404 for an unknown round and, for jurors, for a round they are not on or one
 * still scheduled; then 403 for any other role. `lock` is FOR UPDATE / FOR SHARE on the round row.
 */
async function jurorRound(req: ApiRequest, db: Db, lock = ""): Promise<{ user: SessionUser; round: RoundDetail }> {
  const user = await requireUser(req);
  const round = await roundById(db, req.params.id ?? "", lock);
  if (!round) throw refuse("not_found");
  if (user.role === "juror") {
    const member = await one(db, "SELECT 1 FROM panel_members WHERE round_id = $1 AND juror_id = $2", [round.id, user.id]);
    if (!member || round.state === "scheduled") throw refuse("not_found");
  }
  requireRole(user, "juror");
  return { user, round };
}

async function guardAssigned(db: Db, roundId: string, jurorId: string, entryId: string): Promise<void> {
  const assigned = await one(db, "SELECT 1 FROM assignments WHERE round_id = $1 AND juror_id = $2 AND entry_id = $3",
    [roundId, jurorId, entryId]);
  if (!assigned) throw refuse("not_found");
}

function guardOpen(round: RoundDetail): void {
  if (round.state !== "open") throw refuse("round_closed");
}

async function progress(db: Db, round: RoundDetail, jurorId: string) {
  const [row] = await panelRows(db, round, jurorId);
  return { assigned: row?.assigned ?? 0, scored: row?.scored ?? 0, remaining: row?.remaining ?? 0, submitted: row?.ballotSubmitted ?? false };
}

export async function jurorRounds(req: ApiRequest): Promise<ApiResult> {
  const user = await requireUser(req);
  requireRole(user, "juror");
  const ids = await many<{ id: string }>(pool, `SELECT r.id FROM rounds r JOIN panel_members pm ON pm.round_id = r.id
    JOIN categories c ON c.id = r.category_id WHERE pm.juror_id = $1 AND r.state = 'open' ORDER BY r.ballot_deadline, c.name`, [user.id]);
  const rounds = [];
  for (const { id } of ids) {
    const round = (await roundById(pool, id)) as RoundDetail;
    const counts = await progress(pool, round, user.id);
    rounds.push({
      id: round.id, name: round.name, categoryName: round.category_name,
      ballotDeadlineLabel: deadlineLabel(round.ballot_deadline as string, round.time_zone),
      assigned: counts.assigned, remaining: counts.remaining, ballotSubmitted: counts.submitted,
    });
  }
  return { status: 200, json: { rounds } };
}

export async function getBallot(req: ApiRequest): Promise<ApiResult> {
  const { user, round } = await jurorRound(req, pool);
  const entries = await many<{ id: string; entry_number: number; title: string; summary: string;
    craft: number | null; clarity: number | null; idea: number | null; story: number | null }>(pool,
    `SELECT e.id, e.entry_number, e.title, e.summary, s.craft, s.clarity, s.idea, s.story
     FROM assignments a JOIN entries e ON e.id = a.entry_id
     LEFT JOIN scores s ON s.round_id = a.round_id AND s.juror_id = a.juror_id AND s.entry_id = a.entry_id
     WHERE a.round_id = $1 AND a.juror_id = $2 ORDER BY e.entry_number`, [round.id, user.id]);
  const images = await many<{ entry_id: string; id: string; width: number; height: number }>(pool,
    "SELECT entry_id, id, width, height FROM assets WHERE entry_id = ANY($1) ORDER BY seq", [entries.map((e) => e.id)]);
  const counts = await progress(pool, round, user.id);
  const deadline = round.ballot_deadline as string;
  return {
    status: 200,
    json: {
      round: {
        id: round.id, name: round.name, categoryName: round.category_name,
        ballotDeadlineLabel: deadlineLabel(deadline, round.time_zone),
        ballotDeadlineAt: isoInZone(cutoff(deadline, round.time_zone), round.time_zone), state: round.state,
      },
      entries: entries.map((e) => ({
        entryId: e.id,
        entryNumber: e.entry_number,
        title: e.title,
        summary: e.summary,
        images: images.filter((i) => i.entry_id === e.id).map((i) => ({ url: `/api/assets/${i.id}`, width: i.width, height: i.height })),
        scores: e.craft === null ? null : { craft: e.craft, clarity: e.clarity, idea: e.idea, story: e.story },
      })),
      assigned: counts.assigned,
      scored: counts.scored,
      remaining: counts.remaining,
      submitted: counts.submitted,
    },
  };
}

export async function saveScores(req: ApiRequest): Promise<ApiResult> {
  const result = await tx(async (client) => {
    const { user, round } = await jurorRound(req, client, "FOR SHARE OF r");
    await guardAssigned(client, round.id, user.id, req.params.entryId ?? "");
    guardOpen(round);
    if (await one(client, "SELECT 1 FROM ballots WHERE round_id = $1 AND juror_id = $2", [round.id, user.id])) {
      throw refuse("ballot_submitted");
    }
    const errors = new FieldErrors();
    for (const name of CRITERIA) errors.check(wholeNumber(req.body[name], 1, 10), name, COPY.scores);
    errors.throwIfAny();
    const values = CRITERIA.map((name) => req.body[name] as number);
    await client.query(`INSERT INTO scores (round_id, juror_id, entry_id, craft, clarity, idea, story) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (round_id, juror_id, entry_id) DO UPDATE SET craft = $4, clarity = $5, idea = $6, story = $7, saved_at = now()`,
      [round.id, user.id, req.params.entryId, ...values]);
    const [craft, clarity, idea, story] = values;
    return { scores: { craft, clarity, idea, story }, remaining: (await progress(client, round, user.id)).remaining };
  });
  return { status: 200, json: result };
}

/** Submit and close are settled in one order by the round row lock: a 200 ballot is always in the stored result. */
export async function submitBallot(req: ApiRequest): Promise<ApiResult> {
  const result = await tx(async (client) => {
    const { user, round } = await jurorRound(req, client, "FOR SHARE OF r");
    guardOpen(round);
    const counts = await progress(client, round, user.id);
    if (counts.submitted) throw refuse("ballot_submitted");
    if (counts.remaining > 0) throw refuse("ballot_incomplete", COPY.ballot_incomplete(counts.remaining));
    const ballot = await one<{ submitted_at: Date }>(client,
      "INSERT INTO ballots (round_id, juror_id) VALUES ($1, $2) RETURNING submitted_at", [round.id, user.id]);
    return { submitted: true, counted: counts.scored, submittedAt: ballot?.submitted_at.toISOString() };
  });
  return { status: 200, json: result };
}

export async function recuse(req: ApiRequest): Promise<ApiResult> {
  const result = await tx(async (client) => {
    const { user, round } = await jurorRound(req, client, "FOR SHARE OF r");
    const entryId = req.params.entryId ?? "";
    await guardAssigned(client, round.id, user.id, entryId);
    guardOpen(round);
    const note = req.body.note === undefined ? "" : text(req.body.note, 0, 300);
    if (note === null) {
      const errors = new FieldErrors();
      errors.add("note", "Keep the note to 300 characters or fewer.");
      errors.throwIfAny();
    }
    await client.query("DELETE FROM assignments WHERE round_id = $1 AND juror_id = $2 AND entry_id = $3", [round.id, user.id, entryId]);
    await client.query("INSERT INTO recusals (round_id, juror_id, entry_id, note) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
      [round.id, user.id, entryId, note]);
    await markPacketPending(client, round.id);
    return { remaining: (await progress(client, round, user.id)).remaining };
  });
  wakePacketWriter();
  return { status: 200, json: result };
}

function conflictView(row: { studio_id: string; studio_name: string; note: string; declared_at: Date }) {
  return { studioId: row.studio_id, studioName: row.studio_name, note: row.note, declaredAt: row.declared_at.toISOString() };
}

const CONFLICT_SELECT = `SELECT k.studio_id, s.name AS studio_name, k.note, k.declared_at
  FROM conflicts k JOIN studios s ON s.id = k.studio_id`;

/** A declared conflict removes the juror's stored assignments to that studio's entries in every open round at once. */
export async function declareConflict(req: ApiRequest): Promise<ApiResult> {
  const user = await requireUser(req);
  requireRole(user, "juror");
  const result = await tx(async (client) => {
    await lockKey(client, `juror:${user.id}`);
    const studio = typeof req.body.studioId === "string"
      ? await one<{ id: string }>(client, "SELECT id FROM studios WHERE id = $1", [req.body.studioId]) : null;
    const errors = new FieldErrors();
    if (!studio) errors.add("studioId", "Choose a studio.");
    const note = req.body.note === undefined || req.body.note === null ? "" : text(req.body.note, 0, 300);
    if (note === null) errors.add("note", "Keep the note to 300 characters or fewer.");
    errors.throwIfAny();
    const studioId = (studio as { id: string }).id;
    const inserted = await client.query("INSERT INTO conflicts (juror_id, studio_id, note) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
      [user.id, studioId, note]);
    let removed = 0;
    if (inserted.rowCount) {
      const gone = await many<{ round_id: string }>(client,
        `DELETE FROM assignments a USING rounds r, entries e
         WHERE a.round_id = r.id AND e.id = a.entry_id AND r.state = 'open' AND a.juror_id = $1 AND e.studio_id = $2
         RETURNING a.round_id`, [user.id, studioId]);
      removed = gone.length;
      for (const roundId of new Set(gone.map((g) => g.round_id))) await markPacketPending(client, roundId);
    }
    const conflict = await one<{ studio_id: string; studio_name: string; note: string; declared_at: Date }>(client,
      `${CONFLICT_SELECT} WHERE k.juror_id = $1 AND k.studio_id = $2`, [user.id, studioId]);
    return { status: inserted.rowCount ? 201 : 200, conflict: conflictView(conflict as NonNullable<typeof conflict>), removed };
  });
  wakePacketWriter();
  return { status: result.status, json: { conflict: result.conflict, removedAssignments: result.removed } };
}

export async function listConflicts(req: ApiRequest): Promise<ApiResult> {
  const user = await requireUser(req);
  requireRole(user, "juror");
  const rows = await many<{ studio_id: string; studio_name: string; note: string; declared_at: Date }>(pool,
    `${CONFLICT_SELECT} WHERE k.juror_id = $1 ORDER BY k.declared_at DESC`, [user.id]);
  return { status: 200, json: { conflicts: rows.map(conflictView) } };
}
