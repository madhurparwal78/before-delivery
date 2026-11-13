import { withTransaction, type Tx, one, all, query } from "./db.js";
import { errors } from "./errors.js";
import { isoNow } from "./auth.js";
import type {
  Entrant,
  Match,
  Tournament,
  TournamentFormat,
  TournamentState,
  TrophyFill,
  BracketName,
  MatchState,
  SlotValue,
} from "../shared/types.js";
import { buildSingleElimination, buildDoubleElimination, type EntrantRow, type MatchRow } from "./brackets.js";
export type { EntrantRow, MatchRow } from "./brackets.js";
import { broadcast, recordMessage } from "./live.js";
import { buildRoundRobin, pairSwissRound } from "./formats.js";

export interface TournamentRow {
  id: string;
  name: string;
  format: TournamentFormat;
  state: TournamentState;
  fill: TrophyFill;
  time_zone: string;
  organizer_id: string;
  checkin_closes_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  share_code: string;
  logo_url: string | null;
  seeding_version: number;
  swiss_rounds: number | null;
  field_size: number | null;
  roster_file_name: string | null;
}

export async function getTournamentRow(id: string): Promise<TournamentRow | null> {
  return one<TournamentRow>(`SELECT * FROM tournaments WHERE id = $1`, [id]);
}

export async function getEntrantRows(tournamentId: string, tx?: Tx): Promise<EntrantRow[]> {
  const sql = `SELECT id, tournament_id, name, seed, username, checked_in FROM entrants WHERE tournament_id = $1 ORDER BY seed`;
  return tx ? tx.all<EntrantRow>(sql, [tournamentId]) : all<EntrantRow>(sql, [tournamentId]);
}

export async function getMatchRows(tournamentId: string, tx?: Tx): Promise<MatchRow[]> {
  const sql = `SELECT * FROM matches WHERE tournament_id = $1`;
  const order = `
    ORDER BY CASE bracket WHEN 'winners' THEN 0 WHEN 'losers' THEN 1 WHEN 'final' THEN 2 ELSE 3 END,
             round, number`;
  return tx ? tx.all<MatchRow>(sql + order, [tournamentId]) : all<MatchRow>(sql + order, [tournamentId]);
}

export function toEntrant(row: EntrantRow, includeUsername: boolean): Entrant {
  return {
    id: row.id,
    name: row.name,
    seed: row.seed,
    username: includeUsername ? row.username : null,
    checked_in: row.checked_in,
  };
}

export function toMatch(row: MatchRow, nameOf: (id: string | null) => string, isOrganizer: boolean): Match {
  const upper: SlotValue = row.upper_entrant_id ? { entrant_id: row.upper_entrant_id, name: nameOf(row.upper_entrant_id) } : row.upper_is_bye ? { bye: true } : null;
  const lower: SlotValue = row.lower_entrant_id ? { entrant_id: row.lower_entrant_id, name: nameOf(row.lower_entrant_id) } : row.lower_is_bye ? { bye: true } : null;
  const m: Match = {
    id: row.id,
    tournament_id: row.tournament_id,
    label: row.label,
    bracket: row.bracket,
    round: row.round,
    number: row.number,
    upper,
    lower,
    state: row.state,
    upper_games: row.upper_games,
    lower_games: row.lower_games,
    winner: (row.winner as Match["winner"]) ?? null,
    report: row.report ?? null,
    dispute: row.dispute ?? null,
    called_at: row.called_at ?? null,
    version: row.version,
  };
  if (isOrganizer) {
    m.overdue = row.overdue;
    m.updated_by = row.updated_by ?? undefined;
  }
  return m;
}

export function makeNameLookup(entrants: EntrantRow[]): (id: string | null) => string {
  const map = new Map(entrants.map((e) => [e.id, e.name]));
  return (id) => (id ? (map.get(id) ?? "") : "");
}

export async function myRole(
  t: TournamentRow,
  userId: string | null
): Promise<"organizer" | "co_organizer" | "player" | "viewer"> {
  if (!userId) return "viewer";
  if (t.organizer_id === userId) return "organizer";
  const co = await one<{ user_id: string }>(
    `SELECT user_id FROM co_organizers WHERE tournament_id = $1 AND user_id = $2`,
    [t.id, userId]
  );
  if (co) return "co_organizer";
  const linked = await one<{ id: string }>(
    `SELECT id FROM entrants WHERE tournament_id = $1 AND user_id = $2`,
    [t.id, userId]
  );
  if (linked) return "player";
  return "viewer";
}

export async function requireOrganizer(t: TournamentRow, userId: string): Promise<"organizer" | "co_organizer"> {
  const role = await myRole(t, userId);
  if (role === "organizer" || role === "co_organizer") return role;
  throw errors.forbiddenTournament();
}

export async function isOrganizer(t: TournamentRow, userId: string | null): Promise<boolean> {
  const role = await myRole(t, userId);
  return role === "organizer" || role === "co_organizer";
}

export async function coOrganizerUsernames(tournamentId: string): Promise<string[]> {
  const rows = await all<{ username: string }>(
    `SELECT u.username FROM co_organizers c JOIN users u ON u.id = c.user_id WHERE c.tournament_id = $1 ORDER BY u.username`,
    [tournamentId]
  );
  return rows.map((r) => r.username);
}

export async function toTournament(
  t: TournamentRow,
  userId: string | null,
  includePrivate: boolean
): Promise<Tournament> {
  const role = await myRole(t, userId);
  const entrants = await getEntrantRows(t.id);
  const checked = entrants.filter((e) => e.checked_in).length;
  const coUsers = includePrivate && (role === "organizer" || role === "co_organizer") ? await coOrganizerUsernames(t.id) : null;
  const organizer = (await one<{ username: string }>(`SELECT username FROM users WHERE id = $1`, [t.organizer_id]))?.username ?? "";
  const currentRound = await currentRoundOf(t.id, t.format);
  return {
    id: t.id,
    name: t.name,
    format: t.format,
    state: t.state,
    fill: t.fill,
    time_zone: t.time_zone,
    organizer,
    checkin_closes_at: t.checkin_closes_at,
    server_time: isoNow(),
    field_size: t.field_size ?? entrants.length,
    entrant_count: entrants.length,
    checked_in_count: checked,
    current_round: currentRound,
    swiss_rounds: t.format === "swiss" ? t.swiss_rounds : null,
    logo_url: t.logo_url,
    seeding_version: t.seeding_version,
    my_role: role,
    share_url:
      includePrivate && (role === "organizer" || role === "co_organizer")
        ? `${config.publicUrl}/s/${t.share_code}`
        : null,
    co_organizers: coUsers,
  };
}

// avoid circular import: config imported lazily
import { config } from "./config.js";

export async function currentRoundOf(tournamentId: string, format: TournamentFormat): Promise<{ bracket: BracketName; round: number }> {
  const matches = await getMatchRows(tournamentId);
  return computeCurrentRound(matches, format);
}

export function computeCurrentRound(
  matches: MatchRow[],
  format: TournamentFormat
): { bracket: BracketName; round: number } {
  if (format === "double_elimination") {
    const regionOrder: BracketName[] = ["winners", "losers", "final"];
    const regionRounds: { bracket: BracketName; round: number }[] = [];
    for (const region of regionOrder) {
      const rm = matches.filter((m) => m.bracket === region);
      if (rm.length === 0) continue;
      regionRounds.push({ bracket: region, round: regionCurrentRound(rm) });
    }
    for (const rr of regionRounds) {
      if (roundHasOpenMatch(matches.filter((m) => m.bracket === rr.bracket), rr.round)) {
        return rr;
      }
    }
    return regionRounds[regionRounds.length - 1] ?? { bracket: "final", round: 1 };
  }
  const rounds = [...new Set(matches.map((m) => m.round))].sort((a, b) => a - b);
  for (const r of rounds) {
    if (roundHasOpenMatch(matches.filter((m) => m.round === r), r)) {
      return { bracket: "main", round: r };
    }
  }
  return { bracket: "main", round: rounds[rounds.length - 1] ?? 1 };
}

function regionCurrentRound(matches: MatchRow[]): number {
  const rounds = [...new Set(matches.map((m) => m.round))].sort((a, b) => a - b);
  for (const r of rounds) {
    if (roundHasOpenMatch(matches.filter((m) => m.round === r), r)) return r;
  }
  return rounds[rounds.length - 1] ?? 1;
}

function roundHasOpenMatch(matches: MatchRow[], round: number): boolean {
  return matches.some((m) => m.round === round && isOpenMatch(m));
}

export function isOpenMatch(m: MatchRow): boolean {
  if (m.state === "pending" || m.state === "called" || m.state === "reported" || m.state === "disputed") {
    return m.upper_entrant_id !== null && m.lower_entrant_id !== null;
  }
  return false;
}

export async function requireNotStarted(t: TournamentRow): Promise<void> {
  if (t.state === "running" || t.state === "finished") {
    throw errors.ws("The tournament has already started.");
  }
}

export async function openCheckin(t: TournamentRow, closesAt: string | null): Promise<TournamentRow> {
  const now = isoNow();
  switch (t.state) {
    case "checkin_open":
      throw errors.ws("Check-in is already open.");
    case "checkin_closed":
      throw errors.ws("Check-in has already closed. Go back to draft to open it again.");
    case "running":
    case "finished":
      throw errors.ws("The tournament has already started.");
  }
  let closes: string | null = closesAt;
  if (closes) {
    if (new Date(closes).getTime() <= new Date(now).getTime()) {
      throw errors.validation({ closes_at: "Choose a time after now." });
    }
  } else {
    closes = new Date(new Date(now).getTime() + config.checkinDefaultMs).toISOString();
  }
  const row = await one<TournamentRow>(
    `UPDATE tournaments SET state = 'checkin_open', checkin_closes_at = $2 WHERE id = $1 RETURNING *`,
    [t.id, closes]
  );
  return row!;
}

export async function closeCheckin(t: TournamentRow): Promise<TournamentRow> {
  if (t.state !== "checkin_open") {
    throw errors.ws("Check-in is not open.");
  }
  const row = await one<TournamentRow>(`UPDATE tournaments SET state = 'checkin_closed' WHERE id = $1 RETURNING *`, [t.id]);
  return row!;
}

export async function backToDraft(t: TournamentRow): Promise<TournamentRow> {
  if (t.state === "draft") throw errors.ws("The tournament is already a draft.");
  if (t.state === "running" || t.state === "finished") throw errors.ws("The tournament has already started.");
  const row = await one<TournamentRow>(
    `UPDATE tournaments SET state = 'draft', checkin_closes_at = NULL WHERE id = $1 RETURNING *`,
    [t.id]
  );
  await query(`UPDATE entrants SET checked_in = false WHERE tournament_id = $1`, [t.id]);
  return row!;
}

export async function startTournament(
  t: TournamentRow
): Promise<{ tournament: TournamentRow; removed: string[]; entrants: EntrantRow[]; matches: MatchRow[] }> {
  const entrantsAll = await getEntrantRows(t.id);
  let removed: string[] = [];
  let entrants = entrantsAll;
  const now = isoNow();
  if (t.state === "draft") {
    if (entrants.length < 2) throw errors.ws("At least 2 entrants are needed to start.");
  } else if (t.state === "checkin_closed") {
    const remaining = entrants.filter((e) => e.checked_in);
    if (remaining.length < 2) throw errors.ws("At least 2 checked-in entrants are needed to start.");
    removed = entrants.filter((e) => !e.checked_in).map((e) => e.name);
    entrants = remaining;
  } else if (t.state === "checkin_open") {
    throw errors.ws("Close check-in before starting.");
  } else {
    throw errors.ws("The tournament has already started.");
  }
  // renumber remaining entrants keeping relative order
  await withTransaction(async (tx) => {
    if (removed.length > 0) {
      await tx.query(`DELETE FROM entrants WHERE tournament_id = $1 AND checked_in = false`, [t.id]);
    }
    let i = 0;
    for (const e of entrants) {
      i += 1;
      if (e.seed !== i) {
        await tx.query(`UPDATE entrants SET seed = $2 WHERE id = $1`, [e.id, i]);
        e.seed = i;
      }
    }
    await buildBracket(tx, t, entrants, now);
    await tx.query(`UPDATE tournaments SET state = 'running', started_at = $2, field_size = $3 WHERE id = $1`, [
      t.id,
      now,
      entrants.length,
    ]);
  });
  const fresh = (await getTournamentRow(t.id))!;
  const freshEntrants = await getEntrantRows(t.id);
  const matches = await getMatchRows(t.id);
  await recordMessage(t.id, "tournament.updated", { tournament: await toTournament(fresh, null, false) });
  await recordMessage(t.id, "entrants.updated", { entrants: freshEntrants.map((e) => toEntrant(e, true)) });
  if (removed.length > 0) {
    await recordMessage(t.id, "announcement", { text: "The tournament has started" });
  } else {
    await recordMessage(t.id, "announcement", { text: "The tournament has started" });
  }
  broadcastTournament(t.id);
  return { tournament: fresh, removed, entrants: freshEntrants, matches };
}

export async function buildBracket(tx: Tx, t: TournamentRow, entrants: EntrantRow[], nowIso: string): Promise<void> {
  if (t.format === "single_elimination") {
    await buildSingleElimination(tx, t.id, entrants, nowIso);
  } else if (t.format === "double_elimination") {
    await buildDoubleElimination(tx, t.id, entrants, nowIso);
  } else if (t.format === "round_robin") {
    await buildRoundRobin(tx, t.id, entrants, nowIso);
  } else {
    await pairFirstSwissRound(tx, t, entrants, nowIso);
  }
}

async function pairFirstSwissRound(tx: Tx, t: TournamentRow, entrants: EntrantRow[], nowIso: string): Promise<void> {
  const rounds = Math.ceil(Math.log2(entrants.length)) || 1;
  await tx.query(`UPDATE tournaments SET swiss_rounds = $2 WHERE id = $1`, [t.id, rounds]);
  await pairSwissRound(tx, t, entrants, 1, nowIso);
}

export async function matchByLabel(tournamentId: string, label: string): Promise<MatchRow | null> {
  return one<MatchRow>(`SELECT * FROM matches WHERE tournament_id = $1 AND label = $2`, [tournamentId, label]);
}

export async function entrantByName(tournamentId: string, name: string): Promise<EntrantRow | null> {
  return one<EntrantRow>(`SELECT * FROM entrants WHERE tournament_id = $1 AND lower(name) = lower($2)`, [
    tournamentId,
    name,
  ]);
}

export function stateWord(s: MatchState): string {
  return {
    pending: "Pending",
    called: "Called",
    reported: "Awaiting confirmation",
    confirmed: "Confirmed",
    disputed: "Disputed",
    resolved: "Resolved",
    bye: "Bye",
    not_needed: "Not needed",
    waiting: "Waiting",
  }[s];
}

export async function broadcastTournament(tournamentId: string): Promise<void> {
  const t = await getTournamentRow(tournamentId);
  if (!t) return;
  await broadcast(tournamentId, {
    type: "tournament.updated",
    data: { tournament: await toTournament(t, null, false) },
  });
}
