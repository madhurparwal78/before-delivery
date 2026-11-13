import type pg from "pg";
import { recordAudit } from "./audit.js";
import { type SessionUser, requireRole, requireUser } from "./auth.js";
import { type Db, many, one, pool, tx } from "./db.js";
import { COPY, FieldErrors, refuse } from "./errors.js";
import type { ApiRequest, ApiResult } from "./http.js";
import { queueMail } from "./mail.js";
import { assignJuror, enteringState, panelRows } from "./panel.js";
import { ROUND_COLUMNS, type RoundRow } from "./programs.js";
import { type ProgramDates, guardEntriesClosed, guardRound } from "./rules.js";
import { type CountedScore, type RoundEntry, rankRound } from "./scoring.js";
import { StorageUnavailable, putObject } from "./storage.js";
import { cutoff, deadlineLabel, isDate, isoInZone } from "./time.js";

// Rounds: panels, the round state machine, jury packets and standings (brief: Business rules, Round states).

export interface RoundDetail extends RoundRow, ProgramDates {
  category_name: string;
  shortlist_size: number;
  finalist_count: number;
  program_id: string;
}

export async function roundById(db: Db, id: string, lock = ""): Promise<RoundDetail | null> {
  return one<RoundDetail>(db, `SELECT ${ROUND_COLUMNS}, c.name AS category_name, c.shortlist_size, c.finalist_count,
      c.program_id, p.time_zone, p.early_bird_date, p.deadline_date
    FROM rounds r JOIN categories c ON c.id = r.category_id JOIN programs p ON p.id = c.program_id
    WHERE r.id = $1 ${lock}`, [id]);
}

function roundView(round: RoundDetail) {
  const deadline = round.ballot_deadline;
  return {
    id: round.id,
    categoryId: round.category_id,
    name: round.name,
    kind: round.kind,
    state: round.state,
    ballotDeadline: deadline,
    ballotDeadlineLabel: deadline ? deadlineLabel(deadline, round.time_zone) : null,
    ballotDeadlineAt: deadline ? isoInZone(cutoff(deadline, round.time_zone), round.time_zone) : null,
    openedAt: round.opened_at?.toISOString() ?? null,
    closedAt: round.closed_at?.toISOString() ?? null,
  };
}

/** The round for a director action: 401, then 404, then 403; `lock` holds the round row for the transaction. */
async function directorRound(req: ApiRequest, db: Db, lock = ""): Promise<RoundDetail> {
  const user: SessionUser = await requireUser(req);
  const round = await roundById(db, req.params.id ?? "", lock);
  if (!round) throw refuse("not_found");
  requireRole(user, "director");
  return round;
}

export async function getRound(req: ApiRequest): Promise<ApiResult> {
  const round = await directorRound(req, pool);
  return { status: 200, json: { round: roundView(round), panel: await panelRows(pool, round) } };
}

function cutSize(round: RoundDetail): number {
  return round.kind === "round_1" ? round.shortlist_size : round.finalist_count;
}

/** Counted ballots only: submitted final ballots on current assignments, so recusals and conflicts drop out. */
async function countedScores(db: Db, roundId: string): Promise<CountedScore[]> {
  return many<CountedScore>(db, `SELECT s.juror_id, s.entry_id, s.craft, s.clarity, s.idea, s.story FROM scores s
    JOIN assignments a ON a.round_id = s.round_id AND a.juror_id = s.juror_id AND a.entry_id = s.entry_id
    JOIN ballots b ON b.round_id = s.round_id AND b.juror_id = s.juror_id
    WHERE s.round_id = $1`, [roundId]);
}

interface StandingEntry extends RoundEntry {
  title: string;
}

async function roundEntries(db: Db, roundId: string): Promise<StandingEntry[]> {
  return many<StandingEntry>(db, `SELECT e.id AS entry_id, e.entry_number, e.submitted_at, e.title FROM round_entries re
    JOIN entries e ON e.id = re.entry_id WHERE re.round_id = $1 ORDER BY e.entry_number`, [roundId]);
}

interface StoredResult {
  entry_id: string;
  entry_number: number;
  title: string;
  rank: number;
  score: string | null;
  idea_mean: string | null;
  ballots_counted: number;
  cut: "above" | "below";
  award: string | null;
}

/** Standings: stored once the round has closed, computed from the ballots so far (and never stored) while open. */
export async function standings(db: Db, round: RoundDetail) {
  const base = { cut: cutSize(round), cutLabel: round.kind === "round_1" ? "Shortlist cut" : "Finalist cut" };
  const row = (r: { entryId: string; entryNumber: number; title: string; rank: number; score: string | null;
    ideaMean: number | null; ballotsCounted: number; cut: string; award: string | null }) => ({
    rank: r.rank, entryId: r.entryId, entryNumber: r.entryNumber, title: r.title, categoryName: round.category_name,
    score: r.score, ideaMean: r.ideaMean, ballotsCounted: r.ballotsCounted, cut: r.cut, award: r.award,
  });
  if (round.state === "scheduled") return { provisional: false, ...base, rows: [] };
  if (round.state === "open") {
    const entries = await roundEntries(db, round.id);
    const byId = new Map(entries.map((e) => [e.entry_id, e]));
    const ranked = rankRound(entries, await countedScores(db, round.id), cutSize(round));
    return {
      provisional: true, ...base,
      rows: ranked.map((r) => row({ ...r, entryNumber: byId.get(r.entryId)?.entry_number ?? 0,
        title: byId.get(r.entryId)?.title ?? "", award: null })),
    };
  }
  const stored = await many<StoredResult>(db, `SELECT rr.entry_id, e.entry_number, e.title, rr.rank, rr.score, rr.idea_mean,
      rr.ballots_counted, rr.cut, rr.award
    FROM round_results rr JOIN entries e ON e.id = rr.entry_id WHERE rr.round_id = $1 ORDER BY rr.rank`, [round.id]);
  return {
    provisional: false, ...base,
    rows: stored.map((r) => row({ entryId: r.entry_id, entryNumber: r.entry_number, title: r.title, rank: r.rank, score: r.score,
      ideaMean: r.idea_mean === null ? null : Number(r.idea_mean), ballotsCounted: r.ballots_counted, cut: r.cut, award: r.award })),
  };
}

export async function getStandings(req: ApiRequest): Promise<ApiResult> {
  const round = await directorRound(req, pool);
  return { status: 200, json: await standings(pool, round) };
}

async function invite(db: Db, round: RoundDetail, jurorId: string, deadline: string): Promise<void> {
  const juror = await one<{ email: string; name: string }>(db, "SELECT email, name FROM users WHERE id = $1", [jurorId]);
  const [progress] = await panelRows(db, round, jurorId);
  if (!juror || !progress) return;
  await queueMail(db, "invitation", {
    to: juror.email,
    subject: `Cutline jury invitation: ${round.category_name} — ${round.name}`,
    body: [
      `Hello ${juror.name},`,
      "",
      `You are on the panel for ${round.category_name} — ${round.name}.`,
      `${progress.assigned} entries assigned`,
      `Ballot deadline: ${deadlineLabel(deadline, round.time_zone)}`,
      "",
      "Sign in and open /jury on the desk to score each entry against Craft, Clarity, Idea and Story.",
      "",
      "Cutline Jury Desk",
    ].join("\n"),
  });
}

/** The blind jury packet: entry number, title, case-study text and image ids, nothing about the studio. */
async function packet(db: Db, round: RoundDetail, deadline: string, entryIds: string[]) {
  const entries = await many<{ id: string; entry_number: number; title: string; summary: string; asset_ids: string[] }>(db,
    `SELECT e.id, e.entry_number, e.title, e.summary,
       coalesce(array_agg(a.id ORDER BY a.seq) FILTER (WHERE a.id IS NOT NULL), '{}') AS asset_ids
     FROM entries e LEFT JOIN assets a ON a.entry_id = e.id WHERE e.id = ANY($1)
     GROUP BY e.id ORDER BY e.entry_number`, [entryIds]);
  return {
    roundId: round.id,
    roundName: round.name,
    categoryName: round.category_name,
    ballotDeadlineLabel: deadlineLabel(deadline, round.time_zone),
    entries: entries.map((e) => ({ entryNumber: e.entry_number, title: e.title, summary: e.summary, assetIds: e.asset_ids })),
  };
}

function packetKey(roundId: string): string {
  return `rounds/${roundId}/jury-packet.json`;
}

async function writePacket(db: Db, round: RoundDetail, deadline: string, entryIds: string[]): Promise<void> {
  const body = Buffer.from(JSON.stringify(await packet(db, round, deadline, entryIds)));
  await putObject(packetKey(round.id), body, "application/json");
}

export async function addJuror(req: ApiRequest): Promise<ApiResult> {
  const result = await tx(async (client) => {
    const round = await directorRound(req, client, "FOR UPDATE OF r");
    guardRound(round.state, "add_juror");
    const juror = typeof req.body.jurorId === "string"
      ? await one<{ id: string }>(client, "SELECT id FROM users WHERE id = $1 AND role = 'juror'", [req.body.jurorId]) : null;
    if (!juror) {
      const errors = new FieldErrors();
      errors.add("jurorId", COPY.jurorId);
      errors.throwIfAny();
    }
    const jurorId = (juror as { id: string }).id;
    const added = await client.query("INSERT INTO panel_members (round_id, juror_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [round.id, jurorId]);
    await recordAudit(client, "panel.add", "round", round.id, { jurorId });
    if (added.rowCount && round.state === "open") {
      await assignJuror(client, round.id, jurorId);
      await invite(client, round, jurorId, round.ballot_deadline as string);
      await markPacketPending(client, round.id);
    }
    return { status: added.rowCount ? 201 : 200, panel: await panelRows(client, round) };
  });
  wakePacketWriter();
  return { status: result.status, json: { panel: result.panel } };
}

export async function openRound(req: ApiRequest): Promise<ApiResult> {
  const round = await tx(async (client) => {
    const found = await directorRound(req, client, "FOR UPDATE OF r");
    guardRound(found.state, "open");
    if (found.kind === "round_1") {
      guardEntriesClosed(found, new Date());
      if (await one(client, "SELECT 1 FROM entries WHERE category_id = $1 AND state = 'submitted' LIMIT 1", [found.category_id])) {
        throw refuse("screening_incomplete");
      }
    } else {
      const first = await one<{ state: string }>(client, "SELECT state FROM rounds WHERE category_id = $1 AND kind = 'round_1'",
        [found.category_id]);
      if (first?.state !== "normalised") throw refuse("previous_round_not_confirmed");
    }
    const panel = await many<{ juror_id: string }>(client, "SELECT juror_id FROM panel_members WHERE round_id = $1", [found.id]);
    if (!panel.length) throw refuse("panel_empty");
    const entering = await many<{ id: string }>(client, "SELECT id FROM entries WHERE category_id = $1 AND state = $2",
      [found.category_id, enteringState(found.kind)]);
    if (!entering.length) throw refuse("no_entries");
    const deadline = req.body.ballotDeadline;
    if (!isDate(deadline)) {
      const errors = new FieldErrors();
      errors.add("ballotDeadline", "Give the ballot deadline as a calendar date.");
      errors.throwIfAny();
    }
    const ballotDeadline = deadline as string;
    const entryIds = entering.map((e) => e.id);
    try {
      await writePacket(client, found, ballotDeadline, entryIds);
    } catch (error) {
      throw error instanceof StorageUnavailable ? refuse("storage_unavailable", COPY.storage_unavailable_open) : error;
    }
    await client.query("UPDATE entries SET state = $2 WHERE id = ANY($1)",
      [entryIds, found.kind === "round_1" ? "round_1" : "final_round"]);
    await client.query("INSERT INTO round_entries (round_id, entry_id) SELECT $1, unnest($2::text[])", [found.id, entryIds]);
    await client.query("UPDATE rounds SET state = 'open', ballot_deadline = $2, opened_at = now() WHERE id = $1",
      [found.id, ballotDeadline]);
    const opened = (await roundById(client, found.id)) as RoundDetail;
    for (const member of panel) await assignJuror(client, found.id, member.juror_id);
    await recordAudit(client, "round.open", "round", found.id, { jurors: panel.length, entries: entryIds.length });
    for (const member of panel) await invite(client, opened, member.juror_id, ballotDeadline);
    return opened;
  });
  return { status: 200, json: { round: roundView(round) } };
}

export async function closeRound(req: ApiRequest): Promise<ApiResult> {
  const result = await tx(async (client) => {
    const round = await directorRound(req, client, "FOR UPDATE OF r");
    guardRound(round.state, "close");
    const entries = await roundEntries(client, round.id);
    const ranked = rankRound(entries, await countedScores(client, round.id), cutSize(round));
    for (const r of ranked) {
      await client.query(`INSERT INTO round_results (round_id, entry_id, rank, score, idea_mean, ballots_counted, cut)
        VALUES ($1, $2, $3, $4, $5, $6, $7)`, [round.id, r.entryId, r.rank, r.score, r.ideaMean, r.ballotsCounted, r.cut]);
    }
    await client.query("UPDATE rounds SET state = 'closed', closed_at = now() WHERE id = $1", [round.id]);
    await recordAudit(client, "round.close", "round", round.id, { entries: ranked.length });
    const closed = (await roundById(client, round.id)) as RoundDetail;
    return { round: roundView(closed), standings: await standings(client, closed) };
  });
  return { status: 200, json: result };
}

/** Round 1: above the cut → shortlisted, below → eliminated. Final: rank 1 winner, then finalists, then honourable mentions. */
function outcome(round: RoundDetail, rank: number, cut: string): "shortlisted" | "eliminated" | "winner" | "finalist" | "honourable_mention" {
  if (round.kind === "round_1") return cut === "above" ? "shortlisted" : "eliminated";
  if (rank === 1) return "winner";
  return rank <= round.finalist_count ? "finalist" : "honourable_mention";
}

export async function confirmRound(req: ApiRequest): Promise<ApiResult> {
  const result = await tx(async (client) => {
    const round = await directorRound(req, client, "FOR UPDATE OF r");
    guardRound(round.state, "confirm");
    const results = await many<{ entry_id: string; entry_number: number; rank: number; cut: string }>(client,
      `SELECT rr.entry_id, e.entry_number, rr.rank, rr.cut FROM round_results rr JOIN entries e ON e.id = rr.entry_id
       WHERE rr.round_id = $1 ORDER BY rr.rank`, [round.id]);
    const outcomes = [];
    for (const r of results) {
      const state = outcome(round, r.rank, r.cut);
      const award = round.kind === "final" ? state : null;
      await client.query("UPDATE entries SET state = $2, award = $3 WHERE id = $1", [r.entry_id, state, award]);
      if (award) await client.query("UPDATE round_results SET award = $3 WHERE round_id = $1 AND entry_id = $2", [round.id, r.entry_id, award]);
      outcomes.push({ entryNumber: r.entry_number, state });
    }
    await client.query("UPDATE rounds SET state = 'normalised' WHERE id = $1", [round.id]);
    await recordAudit(client, "round.confirm", "round", round.id, { entries: outcomes.length });
    return { round: roundView((await roundById(client, round.id)) as RoundDetail), outcomes };
  });
  return { status: 200, json: result };
}

export async function markPacketPending(db: Db, roundId: string): Promise<void> {
  await db.query("UPDATE rounds SET packet_pending = true, packet_version = packet_version + 1 WHERE id = $1 AND state = 'open'", [roundId]);
}

let wakeWriter: (() => void) | null = null;

export function wakePacketWriter(): void {
  wakeWriter?.();
}

/** Rewrites a changed open round's packet; storage failures leave it pending for the next pass. */
async function rewritePendingPackets(client: pg.PoolClient): Promise<void> {
  const pending = await many<{ id: string; packet_version: number }>(client,
    "SELECT id, packet_version FROM rounds WHERE packet_pending AND state = 'open'");
  for (const { id, packet_version: version } of pending) {
    const round = (await roundById(client, id)) as RoundDetail;
    const entries = await many<{ entry_id: string }>(client, "SELECT entry_id FROM round_entries WHERE round_id = $1", [id]);
    try {
      await writePacket(client, round, round.ballot_deadline as string, entries.map((e) => e.entry_id));
      await client.query("UPDATE rounds SET packet_pending = false WHERE id = $1 AND packet_version = $2", [id, version]);
    } catch (error) {
      if (!(error instanceof StorageUnavailable)) throw error;
    }
  }
}

/** The packet writer: every 5 seconds, and at once after a change commits. */
export async function runPacketWriter(): Promise<never> {
  for (;;) {
    const client = await pool.connect().catch(() => null);
    if (client) {
      try {
        await rewritePendingPackets(client);
      } catch (error) {
        console.error(`packet writer: ${(error as Error).message}`);
      } finally {
        client.release();
      }
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 5000);
      wakeWriter = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }
}
