import { copy } from '../../shared/copy.js';
import { defaultShortName } from '../../shared/rules.js';
import type { PlayerListItem, TeamListItem } from '../../shared/wire.js';
import { TEAM_VISIBLE } from '../db/access.js';
import { canSeePlayer, canSeeTeam, matchIdByCode } from '../db/lookup.js';
import { MATCH_SELECT, bundleOf, logoUrl } from '../db/matches.js';
import type { MatchRow } from '../db/matches.js';
import { direct, query, transaction } from '../db/pool.js';
import { teamDetail } from '../db/views.js';
import { careerOf } from '../laws/career.js';
import { ApiError, notFound, validation } from '../http/errors.js';
import type { FilePart } from '../http/body.js';
import { asObject, failOn, text } from '../http/input.js';
import { authedUser, reply, route } from '../http/router.js';
import { MULTIPART_OVERHEAD_BYTES, config } from '../config.js';
import { StorageUnavailable, getObject, putObject } from '../services/s3.js';

interface PlayerInput { name: string; shortName: string }

/** Players from a request: names required, short names defaulting to the last word and unique within the team. */
const playersOf = (input: unknown, taken: string[], fieldPrefix: (index: number) => string): { players: PlayerInput[]; fields: Record<string, string> } => {
  const fields: Record<string, string> = {};
  const seen = new Set(taken.map((short) => short.toLowerCase()));
  const players: PlayerInput[] = [];
  for (const [index, raw] of (Array.isArray(input) ? input : []).entries()) {
    const player = asObject(raw);
    const name = text(player['name']);
    const given = text(player['short_name']);
    if (name === '') fields[`${fieldPrefix(index)}name`] = copy.name;
    const shortName = given === '' ? defaultShortName(name) : given;
    if (name !== '' && seen.has(shortName.toLowerCase())) fields[`${fieldPrefix(index)}short_name`] = copy.shortNameClash;
    seen.add(shortName.toLowerCase());
    players.push({ name, shortName });
  }
  return { players, fields };
};

route('GET', '/api/teams', {}, async (ctx) => {
  const user = authedUser(ctx);
  const rows = await query<{ id: string; name: string; logo_key: string | null; logo_uploads: number }>(
    `SELECT t.id, t.name, t.logo_key, t.logo_uploads FROM teams t WHERE ${TEAM_VISIBLE} ORDER BY t.created_at DESC`, [user.id]);
  const teams: TeamListItem[] = rows.map((team) => ({ id: team.id, name: team.name, logo_url: logoUrl(team.id, team.logo_key, team.logo_uploads) }));
  return reply(200, { teams });
});

route('POST', '/api/teams', {}, async (ctx) => {
  const user = authedUser(ctx);
  const input = asObject(ctx.body);
  const name = text(input['name']);
  const { players, fields } = playersOf(input['players'], [], (index) => `players[${index}].`);
  if (name === '') fields['name'] = copy.name;
  failOn(fields);
  const id = await transaction(async (db) => {
    const created = await db.query<{ id: string }>('INSERT INTO teams (organiser_id, name) VALUES ($1, $2) RETURNING id', [user.id, name]);
    const teamId = created[0].id;
    for (const [position, player] of players.entries()) {
      await db.query('INSERT INTO players (team_id, name, short_name, position) VALUES ($1, $2, $3, $4)', [teamId, player.name, player.shortName, position]);
    }
    return teamId;
  });
  const detail = await teamDetail(user.id, id);
  return reply(201, detail);
});

route('GET', '/api/teams/:id', {}, async (ctx) => {
  const detail = await teamDetail(authedUser(ctx).id, ctx.params['id'] ?? '');
  if (!detail) throw notFound();
  return reply(200, detail);
});

const ownTeam = async (userId: string, teamId: string): Promise<void> => {
  if ((await query('SELECT 1 FROM teams WHERE id = $1 AND organiser_id = $2', [teamId, userId])).length === 0) throw notFound();
};

route('POST', '/api/teams/:id/players', {}, async (ctx) => {
  const user = authedUser(ctx);
  const teamId = ctx.params['id'] ?? '';
  await ownTeam(user.id, teamId);
  const existing = await query<{ short_name: string }>('SELECT short_name FROM players WHERE team_id = $1', [teamId]);
  const { players, fields } = playersOf([ctx.body], existing.map((player) => player.short_name), () => '');
  failOn(fields);
  const player = players[0];
  const rows = await query<{ id: string }>(
    `INSERT INTO players (team_id, name, short_name, position)
     VALUES ($1, $2, $3, (SELECT coalesce(max(position) + 1, 0) FROM players WHERE team_id = $1)) RETURNING id`,
    [teamId, player.name, player.shortName]);
  return reply(201, { id: rows[0]?.id, name: player.name, short_name: player.shortName });
});

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff]);

const imageKind = (data: Buffer): { extension: 'png' | 'jpg'; type: string } | null => {
  if (data.subarray(0, PNG.length).equals(PNG)) return { extension: 'png', type: 'image/png' };
  if (data.subarray(0, JPEG.length).equals(JPEG)) return { extension: 'jpg', type: 'image/jpeg' };
  return null;
};

route('POST', '/api/teams/:id/logo', { body: 'multipart', limit: config.logoMaxBytes + MULTIPART_OVERHEAD_BYTES }, async (ctx) => {
  const user = authedUser(ctx);
  const teamId = ctx.params['id'] ?? '';
  await ownTeam(user.id, teamId);
  const part = (Array.isArray(ctx.body) ? (ctx.body as FilePart[]) : []).find((candidate) => candidate.field === 'logo');
  const kind = part ? imageKind(part.data) : null;
  if (!part || !kind) throw validation({ logo: copy.logoWrongType });
  if (part.data.length > config.logoMaxBytes) throw validation({ logo: copy.logoTooLarge(config.logoMaxBytes) });
  try {
    const uploads = await transaction(async (db) => {
      const rows = await db.query<{ logo_uploads: number }>('SELECT logo_uploads FROM teams WHERE id = $1 FOR UPDATE', [teamId]);
      const next = rows[0].logo_uploads + 1;
      const key = `logos/${teamId}/${next}.${kind.extension}`;
      await putObject(key, new Uint8Array(part.data), kind.type);
      await db.query('UPDATE teams SET logo_key = $2, logo_type = $3, logo_uploads = $4 WHERE id = $1', [teamId, key, kind.type, next]);
      return next;
    });
    return reply(201, { logo_url: `/api/teams/${teamId}/logo?v=${uploads}` });
  } catch (error) {
    if (error instanceof StorageUnavailable) throw new ApiError(503, 'STORAGE_UNAVAILABLE', copy.storageOutage);
    throw error;
  }
});

const logoOf = async (teamId: string): Promise<Awaited<ReturnType<typeof getObject>> & { cache: string }> => {
  const rows = await query<{ logo_key: string | null; logo_type: string | null }>('SELECT logo_key, logo_type FROM teams WHERE id = $1', [teamId]);
  const key = rows[0]?.logo_key;
  if (!key) throw notFound();
  try {
    return { ...(await getObject(key)), cache: 'public, max-age=86400' };
  } catch (error) {
    if (error instanceof StorageUnavailable) throw new ApiError(503, 'STORAGE_UNAVAILABLE', copy.storageOutage);
    throw error;
  }
};

route('GET', '/api/teams/:id/logo', {}, async (ctx) => {
  const teamId = ctx.params['id'] ?? '';
  if (!(await canSeeTeam(authedUser(ctx).id, teamId))) throw notFound();
  const logo = await logoOf(teamId);
  return { status: 200, raw: { body: logo.body, type: logo.contentType }, headers: { 'Cache-Control': logo.cache } };
});

route('GET', '/api/live/:code/teams/:teamId/logo', { auth: false }, async (ctx) => {
  const matchId = await matchIdByCode(ctx.params['code'] ?? '');
  const teamId = ctx.params['teamId'] ?? '';
  if (matchId === null) throw notFound();
  const playing = await query('SELECT 1 FROM matches WHERE id = $1 AND (home_team_id = $2 OR away_team_id = $2)', [matchId, teamId]);
  if (playing.length === 0) throw notFound();
  const logo = await logoOf(teamId);
  return { status: 200, raw: { body: logo.body, type: logo.contentType }, headers: { 'Cache-Control': logo.cache } };
});

route('GET', '/api/players', {}, async (ctx) => {
  const rows = await query<{ id: string; name: string; short_name: string; team_id: string; team_name: string }>(
    `SELECT p.id, p.name, p.short_name, t.id AS team_id, t.name AS team_name FROM players p JOIN teams t ON t.id = p.team_id
     WHERE ${TEAM_VISIBLE} ORDER BY t.name, p.position`, [authedUser(ctx).id]);
  const players: PlayerListItem[] = rows.map((row) => ({
    id: row.id, name: row.name, short_name: row.short_name, team: { id: row.team_id, name: row.team_name },
  }));
  return reply(200, { players });
});

route('GET', '/api/players/:id', {}, async (ctx) => {
  const playerId = ctx.params['id'] ?? '';
  if (!(await canSeePlayer(authedUser(ctx).id, playerId))) throw notFound();
  const rows = await query<{ id: string; name: string; short_name: string; team_id: string; team_name: string }>(
    'SELECT p.id, p.name, p.short_name, t.id AS team_id, t.name AS team_name FROM players p JOIN teams t ON t.id = p.team_id WHERE p.id = $1',
    [playerId]);
  const player = rows[0];
  if (!player) throw notFound();
  const matchRows = await query<MatchRow>(
    `${MATCH_SELECT} WHERE m.summary IS NULL AND EXISTS (SELECT 1 FROM match_xi x WHERE x.match_id = m.id AND x.player_id = $1)`, [playerId]);
  const bundles = await Promise.all(matchRows.map((row) => bundleOf(direct, row)));
  const team = { id: player.team_id, name: player.team_name, xi: [] };
  return reply(200, careerOf({ id: player.id, name: player.name, shortName: player.short_name }, team, bundles.map((bundle) => bundle.view)));
});
