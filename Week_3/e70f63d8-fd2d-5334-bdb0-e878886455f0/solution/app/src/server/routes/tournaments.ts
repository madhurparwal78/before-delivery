import { copy } from '../../shared/copy.js';
import type { TournamentDetail } from '../../shared/wire.js';
import { TOURNAMENT_VISIBLE } from '../db/access.js';
import { canSeeTournament } from '../db/lookup.js';
import { query, transaction } from '../db/pool.js';
import { tournamentTables } from '../db/views.js';
import { notFound } from '../http/errors.js';
import { asObject, failOn, flag, text, wholeNumber } from '../http/input.js';
import { isUuid } from '../http/router.js';
import { authedUser, reply, route } from '../http/router.js';

const MIN_OVERS = 1;
const MAX_OVERS = 50;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 11;

/** Field errors for the settings every match and tournament shares. */
export const settingsErrors = (overs: number, players: number): Record<string, string> => {
  const fields: Record<string, string> = {};
  if (!(overs >= MIN_OVERS && overs <= MAX_OVERS)) fields['overs'] = copy.overs;
  if (!(players >= MIN_PLAYERS && players <= MAX_PLAYERS)) fields['players_per_side'] = copy.playersPerSide;
  return fields;
};

const tournamentDetail = async (id: string): Promise<TournamentDetail | null> => {
  const rows = await query<{ id: string; name: string; overs: number; players_per_side: number; super_over: boolean }>(
    'SELECT id, name, overs, players_per_side, super_over FROM tournaments WHERE id = $1', [id]);
  const row = rows[0];
  if (!row) return null;
  return { ...row, groups: await tournamentTables(id) };
};

route('GET', '/api/tournaments', {}, async (ctx) => {
  const rows = await query<{ id: string; name: string }>(
    `SELECT tr.id, tr.name FROM tournaments tr WHERE ${TOURNAMENT_VISIBLE} ORDER BY tr.created_at DESC`, [authedUser(ctx).id]);
  return reply(200, { tournaments: rows });
});

route('POST', '/api/tournaments', {}, async (ctx) => {
  const user = authedUser(ctx);
  const input = asObject(ctx.body);
  const name = text(input['name']);
  const overs = wholeNumber(input['overs']) ?? Number.NaN;
  const players = wholeNumber(input['players_per_side']) ?? Number.NaN;
  const fields = settingsErrors(overs, players);
  if (name === '') fields['name'] = copy.name;
  const groups = (Array.isArray(input['groups']) ? input['groups'] : []).map((raw) => {
    const group = asObject(raw);
    return { name: text(group['name']), teams: Array.isArray(group['teams']) ? group['teams'].filter((team): team is string => typeof team === 'string') : [] };
  });
  const everyTeam = groups.flatMap((group) => group.teams);
  const owned = everyTeam.length === 0 ? [] : await query<{ id: string }>(
    'SELECT id FROM teams WHERE organiser_id = $1 AND id = ANY($2::uuid[])', [user.id, [...new Set(everyTeam.filter(isUuid))]]);
  const ownedIds = new Set(owned.map((team) => team.id));
  const seen = new Set<string>();
  for (const [index, group] of groups.entries()) {
    if (group.name === '') fields[`groups[${index}].name`] = copy.name;
    if (group.teams.some((team) => !ownedIds.has(team) || seen.has(team))) fields[`groups[${index}].teams`] = copy.fieldErrors;
    for (const team of group.teams) seen.add(team);
  }
  failOn(fields);
  const id = await transaction(async (db) => {
    const created = await db.query<{ id: string }>(
      'INSERT INTO tournaments (organiser_id, name, overs, players_per_side, super_over) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [user.id, name, overs, players, flag(input['super_over']) ?? false]);
    const tournamentId = created[0].id;
    for (const [position, group] of groups.entries()) {
      const row = await db.query<{ id: string }>(
        'INSERT INTO tournament_groups (tournament_id, name, position) VALUES ($1, $2, $3) RETURNING id', [tournamentId, group.name, position]);
      for (const team of group.teams) {
        await db.query('INSERT INTO group_teams (group_id, tournament_id, team_id) VALUES ($1, $2, $3)', [row[0].id, tournamentId, team]);
      }
    }
    return tournamentId;
  });
  return reply(201, await tournamentDetail(id));
});

route('GET', '/api/tournaments/:id', {}, async (ctx) => {
  const id = ctx.params['id'] ?? '';
  if (!(await canSeeTournament(authedUser(ctx).id, id))) throw notFound();
  return reply(200, await tournamentDetail(id));
});
