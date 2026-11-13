import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { config } from './config.js';
import { one, query } from './db.js';
import type { BallEvent, PlayerRef } from './engine.js';
import type { InningsRecord, MatchInput, MatchSummary } from './match.js';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

export interface UserRow {
  id: string;
  email: string;
  display_name: string;
}

export interface TeamRow {
  id: string;
  organiser_id: string;
  name: string;
  logo_key: string | null;
  logo_type: string | null;
  logo_uploads: number;
}

export interface PlayerRow {
  id: string;
  team_id: string;
  name: string;
  short_name: string;
  position: number;
}

export interface MatchRow {
  id: string;
  organiser_id: string;
  home_team_id: string;
  away_team_id: string;
  overs: number;
  players_per_side: number;
  super_over: boolean;
  batting_first: string;
  tournament_id: string | null;
  viewer_code: string;
  viewer_link: boolean;
  played_on: string | null;
  summary: MatchSummary | null;
  created_at: string;
}

export function newId(): string {
  return randomUUID();
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}

export function viewerCode(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const raw = randomBytes(32);
  let code = '';
  for (const byte of raw) code += alphabet[byte % alphabet.length];
  return code.slice(0, 24);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 32);
  return `${salt}:${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(':');
  const derived = await scrypt(password, salt ?? '', 32);
  const expected = Buffer.from(hash ?? '', 'hex');
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

export async function createSession(userId: string): Promise<string> {
  const token = randomToken(32);
  await query('insert into sessions (id, user_id) values ($1, $2)', [token, userId]);
  return token;
}

export async function deleteSession(token: string): Promise<void> {
  await query('delete from sessions where id = $1', [token]);
}

export async function userBySession(token: string | null): Promise<UserRow | null> {
  if (!token) return null;
  return one<UserRow>(
    `select u.id, u.email, u.display_name from sessions s
       join users u on u.id = s.user_id
      where s.id = $1`,
    [token],
  );
}

export async function userByEmail(email: string): Promise<(UserRow & { password_hash: string }) | null> {
  return one<UserRow & { password_hash: string }>(
    'select id, email, display_name, password_hash from users where email = $1',
    [email.trim().toLowerCase()],
  );
}

export async function createUser(args: {
  email: string;
  password: string;
  displayName: string;
}): Promise<UserRow> {
  const id = newId();
  const passwordHash = await hashPassword(args.password);
  await query(
    'insert into users (id, email, password_hash, display_name) values ($1, $2, $3, $4)',
    [id, args.email.trim().toLowerCase(), passwordHash, args.displayName.trim()],
  );
  return { id, email: args.email.trim().toLowerCase(), display_name: args.displayName.trim() };
}

const VISIBLE_TEAM = `(
  teams.organiser_id = $1 or exists (
    select 1 from matches m
      join match_scorers ms on ms.match_id = m.id and ms.user_id = $1
     where m.home_team_id = teams.id or m.away_team_id = teams.id
  )
)`;

export async function visibleTeams(userId: string): Promise<TeamRow[]> {
  return query<TeamRow>(
    `select teams.* from teams where ${VISIBLE_TEAM} order by teams.created_at, teams.name`,
    [userId],
  );
}

export async function visibleTeam(userId: string, teamId: string): Promise<TeamRow | null> {
  return one<TeamRow>(`select teams.* from teams where teams.id = $2 and ${VISIBLE_TEAM}`, [
    userId,
    teamId,
  ]);
}

export async function teamById(teamId: string): Promise<TeamRow | null> {
  return one<TeamRow>('select * from teams where id = $1', [teamId]);
}

export async function teamPlayers(teamId: string): Promise<PlayerRow[]> {
  return query<PlayerRow>('select * from players where team_id = $1 order by position', [teamId]);
}

export async function visiblePlayer(
  userId: string,
  playerId: string,
): Promise<(PlayerRow & { team_name: string }) | null> {
  return one<PlayerRow & { team_name: string }>(
    `select players.*, teams.name as team_name from players
       join teams on teams.id = players.team_id
      where players.id = $2 and ${VISIBLE_TEAM}`,
    [userId, playerId],
  );
}

export async function visiblePlayers(userId: string): Promise<(PlayerRow & { team_name: string })[]> {
  return query<PlayerRow & { team_name: string }>(
    `select players.*, teams.name as team_name from players
       join teams on teams.id = players.team_id
      where ${VISIBLE_TEAM}
      order by teams.name, players.position`,
    [userId],
  );
}

const VISIBLE_TOURNAMENT = `(
  tournaments.organiser_id = $1 or exists (
    select 1 from matches m
      join match_scorers ms on ms.match_id = m.id and ms.user_id = $1
     where m.tournament_id = tournaments.id
  )
)`;

export interface TournamentRow {
  id: string;
  organiser_id: string;
  name: string;
  overs: number;
  players_per_side: number;
  super_over: boolean;
}

export async function visibleTournaments(userId: string): Promise<TournamentRow[]> {
  return query<TournamentRow>(
    `select tournaments.* from tournaments where ${VISIBLE_TOURNAMENT} order by tournaments.created_at`,
    [userId],
  );
}

export async function visibleTournament(
  userId: string,
  tournamentId: string,
): Promise<TournamentRow | null> {
  return one<TournamentRow>(
    `select tournaments.* from tournaments where tournaments.id = $2 and ${VISIBLE_TOURNAMENT}`,
    [userId, tournamentId],
  );
}

export interface GroupRow {
  id: string;
  tournament_id: string;
  name: string;
  position: number;
}

export async function tournamentGroups(tournamentId: string): Promise<GroupRow[]> {
  return query<GroupRow>('select * from groups where tournament_id = $1 order by position', [
    tournamentId,
  ]);
}

export async function groupTeams(groupId: string): Promise<TeamRow[]> {
  return query<TeamRow>(
    `select teams.* from group_teams
       join teams on teams.id = group_teams.team_id
      where group_teams.group_id = $1
      order by group_teams.position`,
    [groupId],
  );
}

export async function tournamentMatches(tournamentId: string): Promise<MatchRow[]> {
  return query<MatchRow>(
    'select * from matches where tournament_id = $1 order by created_at',
    [tournamentId],
  );
}

export async function matchById(matchId: string): Promise<MatchRow | null> {
  return one<MatchRow>('select * from matches where id = $1', [matchId]);
}

export async function matchByCode(code: string): Promise<MatchRow | null> {
  return one<MatchRow>('select * from matches where viewer_code = $1', [code]);
}

export async function matchScorers(matchId: string): Promise<UserRow[]> {
  return query<UserRow>(
    `select u.id, u.email, u.display_name from match_scorers ms
       join users u on u.id = ms.user_id
      where ms.match_id = $1
      order by u.display_name`,
    [matchId],
  );
}

export async function isScorer(matchId: string, userId: string): Promise<boolean> {
  const row = await one<{ exists: boolean }>(
    `select exists (
       select 1 from matches m where m.id = $1 and m.organiser_id = $2
       union all
       select 1 from match_scorers ms where ms.match_id = $1 and ms.user_id = $2
     ) as exists`,
    [matchId, userId],
  );
  return row?.exists === true;
}

export async function visibleMatches(userId: string): Promise<MatchRow[]> {
  return query<MatchRow>(
    `select m.* from matches m
      where m.organiser_id = $1
         or exists (select 1 from match_scorers ms where ms.match_id = m.id and ms.user_id = $1)
      order by m.created_at desc`,
    [userId],
  );
}

export async function teamMatches(teamId: string): Promise<MatchRow[]> {
  return query<MatchRow>(
    `select * from matches
      where home_team_id = $1 or away_team_id = $1
      order by created_at desc`,
    [teamId],
  );
}

export async function playerMatches(playerId: string): Promise<MatchRow[]> {
  return query<MatchRow>(
    `select m.* from matches m
       join match_xi x on x.match_id = m.id and x.player_id = $1
      order by m.created_at`,
    [playerId],
  );
}

export async function loadMatchInput(matchRow: MatchRow): Promise<MatchInput> {
  const [home, away] = await Promise.all([
    teamById(matchRow.home_team_id),
    teamById(matchRow.away_team_id),
  ]);
  const xiRows = await query<PlayerRow & { team_id: string; xi_position: number }>(
    `select p.id, p.team_id, p.name, p.short_name, x.position as xi_position
       from match_xi x join players p on p.id = x.player_id
      where x.match_id = $1
      order by x.team_id, x.position`,
    [matchRow.id],
  );
  const xi = new Map<string, PlayerRef[]>();
  xi.set(matchRow.home_team_id, []);
  xi.set(matchRow.away_team_id, []);
  const rowsByTeam = new Map<string, (PlayerRow & { xi_position: number })[]>();
  for (const row of xiRows) {
    const list = rowsByTeam.get(row.team_id) ?? [];
    list.push(row);
    rowsByTeam.set(row.team_id, list);
  }
  for (const [teamId, rows] of rowsByTeam) {
    rows.sort((a, b) => a.xi_position - b.xi_position);
    xi.set(
      teamId,
      rows.map((row) => ({ id: row.id, name: row.name, short_name: row.short_name })),
    );
  }

  const inningsRows = await query<{
    id: string;
    key: string;
    striker: string;
    non_striker: string;
    idx: number;
  }>('select id, key, striker, non_striker, idx from innings where match_id = $1 order by idx', [
    matchRow.id,
  ]);
  const innings: InningsRecord[] = [];
  for (const row of inningsRows) {
    const events = await query<{ type: string; data: BallEvent }>(
      'select type, data from ball_events where innings_id = $1 order by ord',
      [row.id],
    );
    innings.push({
      id: row.id,
      key: row.key,
      striker: row.striker,
      non_striker: row.non_striker,
      events: events.map((event) => event.data),
    });
  }

  const hasLogo = new Set<string>();
  if (home?.logo_key) hasLogo.add(home.id);
  if (away?.logo_key) hasLogo.add(away.id);

  return {
    id: matchRow.id,
    overs: matchRow.overs,
    players_per_side: matchRow.players_per_side,
    super_over: matchRow.super_over,
    super_over_max: config.superOverMax,
    home: { id: matchRow.home_team_id, name: home?.name ?? '' },
    away: { id: matchRow.away_team_id, name: away?.name ?? '' },
    batting_first: matchRow.batting_first,
    played_on: matchRow.played_on ? isoDate(matchRow.played_on) : null,
    xi,
    innings,
    viewer_link: matchRow.viewer_link,
    viewer_code: matchRow.viewer_code,
    has_logo: hasLogo,
    tournament_id: matchRow.tournament_id,
    summary: matchRow.summary,
  };
}

export function isoDate(value: string | Date): string {
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return String(value).slice(0, 10);
}

export async function appendEvents(inningsId: string, events: BallEvent[]): Promise<void> {
  const row = await one<{ next: number }>(
    'select coalesce(max(ord), 0) + 1 as next from ball_events where innings_id = $1',
    [inningsId],
  );
  let ord = row?.next ?? 1;
  for (const event of events) {
    await query('insert into ball_events (innings_id, ord, type, data) values ($1, $2, $3, $4)', [
      inningsId,
      ord,
      event.t,
      JSON.stringify(event),
    ]);
    ord += 1;
  }
}

export async function createInningsRecord(args: {
  matchId: string;
  key: string;
  striker: string;
  nonStriker: string;
  bowler: string;
}): Promise<string> {
  const row = await one<{ next: number }>(
    'select coalesce(max(idx), 0) + 1 as next from innings where match_id = $1',
    [args.matchId],
  );
  const id = newId();
  await query(
    'insert into innings (id, match_id, idx, key, striker, non_striker) values ($1, $2, $3, $4, $5, $6)',
    [id, args.matchId, row?.next ?? 1, args.key, args.striker, args.nonStriker],
  );
  await appendEvents(id, [{ t: 'over', bowler: args.bowler }]);
  return id;
}

export async function deleteInnings(inningsId: string): Promise<void> {
  await query('delete from innings where id = $1', [inningsId]);
}

export interface EventRow {
  id: string;
  ord: number;
  type: string;
  data: BallEvent;
}

export async function inningsEvents(inningsId: string): Promise<EventRow[]> {
  return query<EventRow>(
    'select id, ord, type, data from ball_events where innings_id = $1 order by ord',
    [inningsId],
  );
}

export async function deleteEvent(eventId: string): Promise<void> {
  await query('delete from ball_events where id = $1', [eventId]);
}

export async function updateEvent(eventId: string, event: BallEvent): Promise<void> {
  await query('update ball_events set data = $2 where id = $1', [eventId, JSON.stringify(event)]);
}

export async function setPlayedOn(matchId: string, date: string): Promise<void> {
  await query('update matches set played_on = $2 where id = $1 and played_on is null', [
    matchId,
    date,
  ]);
}

export async function tournamentById(tournamentId: string): Promise<TournamentRow | null> {
  return one<TournamentRow>('select * from tournaments where id = $1', [tournamentId]);
}
