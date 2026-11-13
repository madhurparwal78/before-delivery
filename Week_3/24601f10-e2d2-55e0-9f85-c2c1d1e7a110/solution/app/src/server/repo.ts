import type { Db } from './db.js';
import { newDraw } from './domain/draw.js';
import { finalPlacements } from './domain/placements.js';
import type { Draw, Dispute, Entrant, Feed, Match, Report, Slot, Tournament } from './domain/types.js';
import type { Bracket, Fill, Format, MatchState, TournamentState, Winner } from '../shared/api.js';
import { dateInZone, ordinal } from './time.js';

interface TournamentRow {
  id: string; name: string; format: Format; time_zone: string; fill: Fill; state: TournamentState; organizer_id: string;
  organizer_username: string; share_code: string; checkin_closes_at: number | null; field_size: number | null;
  swiss_rounds: number | null; seeding_version: number; live_seq: number; seeding_updated_by: string | null; logo_key: string | null;
  logo_sha: string | null; roster_key: string | null; roster_name: string | null; created_at: number; finished_at: number | null;
}

const TOURNAMENT_SELECT = `SELECT t.*, u.username AS organizer_username FROM tournaments t JOIN users u ON u.id = t.organizer_id`;

const toTournament = (r: TournamentRow): Tournament => ({
  id: r.id, name: r.name, format: r.format, timeZone: r.time_zone, fill: r.fill, state: r.state, organizerId: r.organizer_id,
  organizerUsername: r.organizer_username, shareCode: r.share_code, checkinClosesAt: r.checkin_closes_at,
  fieldSize: r.field_size, swissRounds: r.swiss_rounds, seedingVersion: r.seeding_version, liveSeq: r.live_seq,
  seedingUpdatedBy: r.seeding_updated_by, logoKey: r.logo_key, logoSha: r.logo_sha, rosterKey: r.roster_key,
  rosterName: r.roster_name, createdAt: r.created_at, finishedAt: r.finished_at,
});

async function loadTournament(db: Db, id: string, lock = false): Promise<Tournament | null> {
  const { rows } = await db.query<TournamentRow>(`${TOURNAMENT_SELECT} WHERE t.id = $1${lock ? ' FOR UPDATE OF t' : ''}`, [id]);
  return rows[0] ? toTournament(rows[0]) : null;
}

export async function loadTournamentByShare(db: Db, code: string): Promise<Tournament | null> {
  const { rows } = await db.query<TournamentRow>(`${TOURNAMENT_SELECT} WHERE t.share_code = $1`, [code]);
  return rows[0] ? toTournament(rows[0]) : null;
}

interface EntrantRow { id: string; tournament_id: string; name: string; seed: number; user_id: string | null; username: string | null; checked_in: boolean }

const toEntrant = (r: EntrantRow): Entrant => ({
  id: r.id, tournamentId: r.tournament_id, name: r.name, seed: r.seed, userId: r.user_id, username: r.username, checkedIn: r.checked_in,
});

export async function loadEntrants(db: Db, tournamentId: string): Promise<Entrant[]> {
  const { rows } = await db.query<EntrantRow>(
    `SELECT e.*, u.username FROM entrants e LEFT JOIN users u ON u.id = e.user_id WHERE e.tournament_id = $1 ORDER BY e.seed`,
    [tournamentId]);
  return rows.map(toEntrant);
}

export async function loadCoOrganizers(db: Db, tournamentId: string): Promise<Array<{ id: string; username: string }>> {
  const { rows } = await db.query<{ id: string; username: string }>(
    `SELECT u.id, u.username FROM co_organizers c JOIN users u ON u.id = c.user_id WHERE c.tournament_id = $1 ORDER BY u.username`,
    [tournamentId]);
  return rows;
}

interface MatchRow {
  id: string; tournament_id: string; bracket: Bracket; round: number; number: number; label: string;
  upper_kind: Slot['kind']; upper_entrant_id: string | null; lower_kind: Slot['kind']; lower_entrant_id: string | null;
  state: MatchState; winner: Winner | null; upper_games: number | null; lower_games: number | null;
  report: Report | null; dispute: Dispute | null; called_at: number | null; overdue: boolean; version: number;
  updated_by: string; resolved_by: string | null; paired_at: number | null; winner_to: string | null;
  winner_slot: 'upper' | 'lower' | null; loser_to: string | null; loser_slot: 'upper' | 'lower' | null;
}

const slotOf = (kind: Slot['kind'], entrantId: string | null): Slot =>
  kind === 'entrant' ? { kind, entrantId: entrantId as string } : { kind };
const feedOf = (to: string | null, slot: 'upper' | 'lower' | null): Feed | null => (to && slot ? { matchId: to, slot } : null);

const toMatch = (r: MatchRow): Match => ({
  id: r.id, tournamentId: r.tournament_id, bracket: r.bracket, round: r.round, number: r.number, label: r.label,
  upper: slotOf(r.upper_kind, r.upper_entrant_id), lower: slotOf(r.lower_kind, r.lower_entrant_id), state: r.state,
  winner: r.winner, upperGames: r.upper_games, lowerGames: r.lower_games, report: r.report, dispute: r.dispute,
  calledAt: r.called_at, overdue: r.overdue, version: r.version, updatedBy: r.updated_by, resolvedBy: r.resolved_by,
  pairedAt: r.paired_at, winnerTo: feedOf(r.winner_to, r.winner_slot), loserTo: feedOf(r.loser_to, r.loser_slot),
});

async function loadMatches(db: Db, tournamentId: string): Promise<Match[]> {
  const { rows } = await db.query<MatchRow>(
    `SELECT * FROM matches WHERE tournament_id = $1
     ORDER BY CASE bracket WHEN 'winners' THEN 0 WHEN 'losers' THEN 1 WHEN 'final' THEN 2 ELSE 3 END, round, number`,
    [tournamentId]);
  return rows.map(toMatch);
}

export async function loadDraw(db: Db, id: string, actor: string, now: number, lock = false): Promise<Draw | null> {
  const tournament = await loadTournament(db, id, lock);
  if (!tournament) return null;
  const [entrants, matches] = await Promise.all([loadEntrants(db, id), loadMatches(db, id)]);
  return newDraw(tournament, entrants, matches, now, actor);
}

export async function saveTournament(db: Db, t: Tournament): Promise<void> {
  await db.query(
    `UPDATE tournaments SET name = $2, time_zone = $3, fill = $4, state = $5, checkin_closes_at = $6, field_size = $7,
       swiss_rounds = $8, seeding_version = $9, seeding_updated_by = $10, logo_key = $11, logo_sha = $12, roster_key = $13,
       roster_name = $14, finished_at = $15, share_code = $16 WHERE id = $1`,
    [t.id, t.name, t.timeZone, t.fill, t.state, t.checkinClosesAt, t.fieldSize, t.swissRounds, t.seedingVersion,
      t.seedingUpdatedBy, t.logoKey, t.logoSha, t.rosterKey, t.rosterName, t.finishedAt, t.shareCode]);
}

const MATCH_COLUMNS = ['id', 'tournament_id', 'bracket', 'round', 'number', 'label', 'upper_kind', 'upper_entrant_id',
  'lower_kind', 'lower_entrant_id', 'state', 'winner', 'upper_games', 'lower_games', 'report', 'dispute', 'called_at',
  'overdue', 'version', 'updated_by', 'resolved_by', 'paired_at', 'winner_to', 'winner_slot', 'loser_to', 'loser_slot'];

const matchParams = (m: Match): unknown[] => [m.id, m.tournamentId, m.bracket, m.round, m.number, m.label, m.upper.kind,
  m.upper.kind === 'entrant' ? m.upper.entrantId : null, m.lower.kind, m.lower.kind === 'entrant' ? m.lower.entrantId : null,
  m.state, m.winner, m.upperGames, m.lowerGames, m.report ? JSON.stringify(m.report) : null,
  m.dispute ? JSON.stringify(m.dispute) : null, m.calledAt, m.overdue, m.version, m.updatedBy, m.resolvedBy, m.pairedAt,
  m.winnerTo?.matchId ?? null, m.winnerTo?.slot ?? null, m.loserTo?.matchId ?? null, m.loserTo?.slot ?? null];

async function insertMatches(db: Db, matches: Match[]): Promise<void> {
  const chunk = 40;
  for (let at = 0; at < matches.length; at += chunk) {
    const part = matches.slice(at, at + chunk);
    const values = part.map((_, row) => `(${MATCH_COLUMNS.map((__, col) => `$${row * MATCH_COLUMNS.length + col + 1}`).join(',')})`);
    await db.query(`INSERT INTO matches (${MATCH_COLUMNS.join(',')}) VALUES ${values.join(',')}`, part.flatMap(matchParams));
  }
}

async function updateMatch(db: Db, m: Match): Promise<void> {
  const sets = MATCH_COLUMNS.slice(2).map((column, i) => `${column} = $${i + 2}`).join(', ');
  await db.query(`UPDATE matches SET ${sets} WHERE id = $1`, [m.id, ...matchParams(m).slice(2)]);
}

const historyText = (name: string, place: number, size: number, date: string): string =>
  `${name} · ${ordinal(place)} of ${size} · ${date}`;

// Persist everything a domain operation changed: new and changed matches, the tournament row, and, once, the history rows.
export async function saveDraw(db: Db, draw: Draw): Promise<void> {
  const t = draw.tournament;
  await insertMatches(db, draw.matches.filter((m) => draw.created.has(m.id)));
  for (const id of draw.changed.keys()) await updateMatch(db, draw.byId.get(id) as Match);
  await saveTournament(db, t);
  if (!draw.finished) return;
  const places = finalPlacements(draw);
  const date = dateInZone(draw.now, t.timeZone);
  for (const entrant of draw.entrants) {
    const place = places.get(entrant.id);
    if (!entrant.userId || place === undefined) continue;
    const size = draw.entrants.length;
    await db.query(
      `INSERT INTO history_rows (user_id, tournament_id, tournament_name, place, field_size, finished_on, finished_at, text)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
      [entrant.userId, t.id, t.name, place, size, date, draw.now, historyText(t.name, place, size, date)]);
  }
}
