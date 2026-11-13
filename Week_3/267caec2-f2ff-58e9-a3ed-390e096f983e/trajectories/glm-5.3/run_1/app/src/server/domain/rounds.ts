import { errors } from "../http/errors.js";
import type { Queryable } from "../db.js";
import { newId, rows, row } from "../db.js";
import type { ProgramRow, CategoryRow, RoundRow } from "./programs.js";
import { isValidDate, deadlineBoundary, deadlineLabel, instantWithZone, windowOpen } from "./time.js";
import { isoUtc } from "../http/util.js";
import { computeRoundScores, rankRows, formatScore, type RankRow, type BallotScoreRow } from "./scoring.js";
import { enqueueEmail, invitationEmail } from "./mail.js";
import type { EntryState } from "./entries.js";
import type { Storage } from "../providers/storage.js";

export type RoundKind = "round_1" | "final";

export interface PanelRow {
  jurorId: string;
  name: string;
  assigned: number;
  scored: number;
  remaining: number;
  ballotSubmitted: boolean;
}

export interface StandingRow {
  rank: number;
  entryId: string;
  entryNumber: number;
  title: string;
  categoryName: string;
  score: string | null;
  ideaMean: number | null;
  ballotsCounted: number;
  cut: "above" | "below";
  award: string | null;
}

export interface Standings {
  provisional: boolean;
  cut: number;
  cutLabel: string;
  rows: StandingRow[];
}

/** Ballot score rows counted in a round, leaving out recused and conflicted assignments. */
async function countedBallotRows(client: Queryable, roundId: string, submittedOnly: boolean): Promise<Map<string, BallotScoreRow[]>> {
  const filter = submittedOnly ? "AND b.juror_id IS NOT NULL" : "";
  const scoreRows = await rows<{ juror_id: string; entry_id: string; craft: number; clarity: number; idea: number; story: number }>(client, `
    SELECT s.juror_id, s.entry_id, s.craft, s.clarity, s.idea, s.story
    FROM scores s
    JOIN assignments a ON a.round_id = s.round_id AND a.juror_id = s.juror_id AND a.entry_id = s.entry_id
    LEFT JOIN ballots b ON b.round_id = s.round_id AND b.juror_id = s.juror_id
    WHERE s.round_id = $1 ${filter}
  `, [roundId]);
  const byJuror = new Map<string, BallotScoreRow[]>();
  for (const s of scoreRows) {
    byJuror.set(s.juror_id, [
      ...(byJuror.get(s.juror_id) ?? []),
      { entryId: s.entry_id, scores: { craft: s.craft, clarity: s.clarity, idea: s.idea, story: s.story } },
    ]);
  }
  return byJuror;
}

/**
 * The single standings computation: applied to submitted ballots while a round
 * is open (provisional, nothing stored), and once at close (stored).
 */
export async function computeStandings(client: Queryable, round: RoundRow, category: CategoryRow, provisional: boolean): Promise<Standings> {
  const ballots = await countedBallotRows(client, round.id, provisional);
  const scored = computeRoundScores(ballots);
  const entryRows = await rows<{
    id: string; entry_number: number; title: string; submitted_at: Date | null; award: string | null; category_name: string;
  }>(client, `
    SELECT e.id, e.entry_number, e.title, e.submitted_at, e.award, c.name AS category_name
    FROM entries e JOIN categories c ON c.id = e.category_id
    WHERE e.category_id = $1 AND e.state = ANY($2)
  `, [round.category_id, inRoundStates(round.kind)]);
  const rankInput: RankRow[] = entryRows.map((e) => ({
    entryId: e.id,
    entryNumber: e.entry_number,
    title: e.title,
    categoryName: e.category_name,
    score: scored.get(e.id)?.score ?? null,
    ideaMean: scored.get(e.id)?.ideaMean ?? null,
    submittedAt: e.submitted_at,
  }));
  const cut = round.kind === "round_1" ? category.shortlist_size : category.finalist_count;
  const ranked = rankRows(rankInput, cut);
  const ballotsCounted = new Map<string, number>();
  for (const jurorRows of ballots.values()) {
    for (const scoreRow of jurorRows) {
      ballotsCounted.set(scoreRow.entryId, (ballotsCounted.get(scoreRow.entryId) ?? 0) + 1);
    }
  }
  return {
    provisional,
    cut,
    cutLabel: round.kind === "round_1" ? "Shortlist cut" : "Finalist cut",
    rows: ranked.map((r) => ({
      rank: r.rank,
      entryId: r.entryId,
      entryNumber: r.entryNumber,
      title: r.title,
      categoryName: r.categoryName,
      score: r.score === null ? null : formatScore(r.score),
      ideaMean: r.ideaMean,
      ballotsCounted: ballotsCounted.get(r.entryId) ?? 0,
      cut: r.cut,
      award: null,
    })),
  };
}

export function inRoundStates(kind: RoundKind): EntryState[] {
  return kind === "round_1" ? ["round_1"] : ["final_round"];
}

/** Stored standings for a closed round, or provisional standings while open. */
export async function standingsForRound(client: Queryable, round: RoundRow, category: CategoryRow): Promise<Standings> {
  if (round.state === "scheduled") {
    return { provisional: false, cut: round.kind === "round_1" ? category.shortlist_size : category.finalist_count, cutLabel: round.kind === "round_1" ? "Shortlist cut" : "Finalist cut", rows: [] };
  }
  if (round.state === "open") {
    return computeStandings(client, round, category, true);
  }
  const stored = await row<{ rows: unknown }>(client, "SELECT rows FROM round_results WHERE round_id = $1", [round.id]);
  return (stored?.rows as Standings) ?? { provisional: false, cut: 0, cutLabel: "", rows: [] };
}

export interface JuryPacketEntry {
  entryNumber: number;
  title: string;
  summary: string;
  assetIds: string[];
}

/** The blind jury packet: numbers, titles, text and images only. */
export async function buildJuryPacket(
  client: Queryable,
  round: RoundRow,
  states: EntryState[] = inRoundStates(round.kind),
  ballotDeadlineOverride?: string,
): Promise<{ roundId: string; roundName: string; categoryName: string; ballotDeadlineLabel: string | null; entries: JuryPacketEntry[] }> {
  const category = await row<CategoryRow>(client, "SELECT * FROM categories WHERE id = $1", [round.category_id]);
  const program = await row<ProgramRow>(client, "SELECT p.* FROM programs p JOIN categories c ON c.program_id = p.id WHERE c.id = $1", [round.category_id]);
  const entryRows = await rows<{ id: string; entry_number: number; title: string; summary: string }>(client, `
    SELECT e.id, e.entry_number, e.title, e.summary
    FROM entries e WHERE e.category_id = $1 AND e.state = ANY($2) ORDER BY e.entry_number ASC
  `, [round.category_id, states]);
  const entries: JuryPacketEntry[] = [];
  for (const entryRow of entryRows) {
    const assets = await rows<{ id: string }>(client, "SELECT id FROM assets WHERE entry_id = $1 ORDER BY sort ASC, created_at ASC", [entryRow.id]);
    entries.push({ entryNumber: entryRow.entry_number, title: entryRow.title, summary: entryRow.summary, assetIds: assets.map((a) => a.id) });
  }
  return {
    roundId: round.id,
    roundName: round.name,
    categoryName: category?.name ?? "",
    ballotDeadlineLabel: (ballotDeadlineOverride ?? round.ballot_deadline) && program
      ? deadlineLabel(ballotDeadlineOverride ?? round.ballot_deadline!, program.time_zone)
      : null,
    entries,
  };
}

export function juryPacketKey(roundId: string): string {
  return `rounds/${roundId}/jury-packet.json`;
}

/**
 * Opening a round: the guards in the brief's order, then the all-or-nothing
 * effects. The packet write happens first; a failure answers 503 and changes
 * nothing.
 */
export async function openRound(
  client: Queryable,
  round: RoundRow,
  program: ProgramRow,
  ballotDeadline: string,
  directorId: string,
  storage: Storage,
): Promise<number> {
  if (round.state !== "scheduled") {
    throw errors.invalidTransition(round.state, "round.open");
  }
  if (!isValidDate(ballotDeadline)) {
    throw errors.validation({ ballotDeadline: "Dates use the YYYY-MM-DD format." });
  }
  if (round.kind === "round_1") {
    if (windowOpen(program.deadline_date, program.time_zone, new Date())) {
      throw errors.deadlineNotPassed(deadlineLabel(program.deadline_date, program.time_zone));
    }
    const unscreened = await row<{ count: string }>(
      client,
      "SELECT count(*) AS count FROM entries WHERE category_id = ANY (SELECT id FROM categories WHERE program_id = $1) AND state = 'submitted'",
      [program.id],
    );
    if (Number(unscreened?.count ?? 0) > 0) {
      throw errors.screeningIncomplete();
    }
  } else {
    const prior = await row<RoundRow>(
      client,
      "SELECT * FROM rounds WHERE category_id = $1 AND kind = 'round_1'",
      [round.category_id],
    );
    if (prior?.state !== "normalised" && prior?.state !== "published") {
      throw errors.previousRoundNotConfirmed();
    }
  }
  const panel = await rows<{ juror_id: string; email: string; name: string }>(
    client,
    "SELECT p.juror_id, u.email, u.name FROM panel p JOIN users u ON u.id = p.juror_id WHERE p.round_id = $1",
    [round.id],
  );
  if (panel.length === 0) {
    throw errors.panelEmpty();
  }
  let wouldEnter = 0;
  for (const juror of panel) {
    const excluded = await excludedStudios(client, juror.juror_id);
    const eligible = await eligibleEntriesForRound(client, round, excluded);
    wouldEnter = Math.max(wouldEnter, eligible.length);
  }
  if (wouldEnter === 0) {
    throw errors.noEntries();
  }

  // Effect 1: store the jury packet first. Nothing changes if this fails. The
  // packet covers the entries that will enter the round, with the ballot
  // deadline label the round will carry.
  const packet = await buildJuryPacket(client, round, eligibleEntryStates(round.kind), ballotDeadline);
  await storage.put(juryPacketKey(round.id), Buffer.from(JSON.stringify(packet), "utf8"), "application/json");

  // Effect 2: one database step does the rest.
  const assignmentValues: { jurorId: string; entryId: string }[] = [];
  for (const juror of panel) {
    const excluded = await excludedStudios(client, juror.juror_id);
    const eligible = await eligibleEntriesForRound(client, round, excluded);
    for (const entry of eligible) {
      assignmentValues.push({ jurorId: juror.juror_id, entryId: entry.id });
    }
  }
  const q = client as { query(text: string, params: unknown[]): Promise<unknown> };
  await q.query(
    "UPDATE entries SET state = $2 WHERE category_id = $1 AND state = ANY($3)",
    [round.category_id, round.kind === "round_1" ? "round_1" : "final_round", eligibleEntryStates(round.kind)],
  );
  for (const value of assignmentValues) {
    await q.query(
      "INSERT INTO assignments (id, round_id, juror_id, entry_id) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
      [newId("asg"), round.id, value.jurorId, value.entryId],
    );
  }
  await q.query(
    "UPDATE rounds SET state = 'open', ballot_deadline = $2, opened_at = now() WHERE id = $1",
    [round.id, ballotDeadline],
  );
  await audit(client, directorId, "round.open", "round", round.id, round.name);
  for (const juror of panel) {
    const count = assignmentValues.filter((a) => a.jurorId === juror.juror_id).length;
    const email = invitationEmail({
      categoryName: packet.categoryName,
      roundName: round.name,
      ballotDeadlineLabel: deadlineLabel(ballotDeadline, program.time_zone),
      assigned: count,
    });
    await enqueueEmail(client, "invitation", juror.email, email.subject, email.body);
  }
  return panel.length;
}

export async function audit(client: Queryable, directorId: string, action: string, targetType: string, targetId: string, detail: string): Promise<void> {
  const q = client as { query(text: string, params: unknown[]): Promise<unknown> };
  await q.query(
    "INSERT INTO audit_events (id, director_id, action, target_type, target_id, detail) VALUES ($1, $2, $3, $4, $5, $6)",
    [newId("aud"), directorId, action, targetType, targetId, detail],
  );
}

export const AUDIT_ACTIONS = {
  programCreate: "program.create",
  programUpdate: "program.update",
  categoryCreate: "category.create",
  jurorCreate: "juror.create",
  entryPass: "entry.pass",
  entryDisqualify: "entry.disqualify",
  entryReinstate: "entry.reinstate",
  panelAdd: "panel.add",
  roundOpen: "round.open",
  roundClose: "round.close",
  roundConfirm: "round.confirm",
  categoryPublish: "category.publish",
} as const;

/** Entries that would enter the round if it opened now. */
const ENTRY_STATES: Record<RoundKind, EntryState[]> = {
  round_1: ["screened"],
  final: ["shortlisted"],
};

export function eligibleEntryStates(kind: RoundKind): EntryState[] {
  return ENTRY_STATES[kind];
}

/** A juror's excluded studios: home studio plus declared conflicts. */
export async function excludedStudios(client: Queryable, jurorId: string): Promise<string[]> {
  const studios = await rows<{ studio_id: string | null }>(client, `
    SELECT u.studio_id FROM users u WHERE u.id = $1 AND u.studio_id IS NOT NULL
    UNION ALL
    SELECT c.studio_id FROM conflicts c WHERE c.juror_id = $1
  `, [jurorId]);
  return [...new Set(studios.map((r) => r.studio_id).filter((x): x is string => Boolean(x)))];
}

/**
 * The single place computing a panel row. Scheduled rounds compute assignment
 * counts on every read; open rounds count stored assignments.
 */
export async function panelForRound(client: Queryable, round: RoundRow): Promise<PanelRow[]> {
  const jurors = await rows<{ id: string; name: string }>(client, `
    SELECT u.id, u.name FROM panel p JOIN users u ON u.id = p.juror_id
    WHERE p.round_id = $1 ORDER BY u.name ASC
  `, [round.id]);
  const result: PanelRow[] = [];
  for (const juror of jurors) {
    if (round.state === "scheduled") {
      const excluded = await excludedStudios(client, juror.id);
      const eligible = await eligibleEntriesForRound(client, round, excluded);
      result.push({ jurorId: juror.id, name: juror.name, assigned: eligible.length, scored: 0, remaining: eligible.length, ballotSubmitted: false });
    } else {
      const counts = await row<{ assigned: string; scored: string; ballot: Date | null }>(client, `
        SELECT
          (SELECT count(*) FROM assignments a WHERE a.round_id = $1 AND a.juror_id = $2) AS assigned,
          (SELECT count(*) FROM assignments a JOIN scores s ON s.round_id = a.round_id AND s.juror_id = a.juror_id AND s.entry_id = a.entry_id
             WHERE a.round_id = $1 AND a.juror_id = $2) AS scored,
          (SELECT b.submitted_at FROM ballots b WHERE b.round_id = $1 AND b.juror_id = $2) AS ballot
      `, [round.id, juror.id]);
      const assigned = Number(counts?.assigned ?? 0);
      const scored = Number(counts?.scored ?? 0);
      const submitted = Boolean(counts?.ballot);
      result.push({
        jurorId: juror.id,
        name: juror.name,
        assigned,
        scored,
        remaining: submitted ? 0 : Math.max(assigned - scored, 0),
        ballotSubmitted: submitted,
      });
    }
  }
  return result;
}

async function eligibleEntriesForRound(client: Queryable, round: RoundRow, excludedStudios: string[]): Promise<{ id: string }[]> {
  const states = eligibleEntryStates(round.kind);
  const params: unknown[] = [round.category_id, states];
  let exclude = "";
  if (excludedStudios.length > 0) {
    params.push(excludedStudios);
    exclude = ` AND e.studio_id <> ALL($3)`;
  }
  return rows<{ id: string }>(
    client,
    `SELECT e.id FROM entries e WHERE e.category_id = $1 AND e.state = ANY($2)${exclude} ORDER BY e.entry_number ASC`,
    params,
  );
}

export function projectRound(round: RoundRow, program: ProgramRow): Record<string, unknown> {
  const boundary = round.ballot_deadline ? deadlineBoundary(round.ballot_deadline, program.time_zone) : null;
  return {
    id: round.id,
    categoryId: round.category_id,
    name: round.name,
    kind: round.kind,
    state: round.state,
    ballotDeadline: round.ballot_deadline,
    ballotDeadlineLabel: round.ballot_deadline ? deadlineLabel(round.ballot_deadline, program.time_zone) : null,
    ballotDeadlineAt: boundary ? instantWithZone(boundary, program.time_zone) : null,
    openedAt: round.opened_at ? isoUtc(round.opened_at) : null,
    closedAt: round.closed_at ? isoUtc(round.closed_at) : null,
  };
}
