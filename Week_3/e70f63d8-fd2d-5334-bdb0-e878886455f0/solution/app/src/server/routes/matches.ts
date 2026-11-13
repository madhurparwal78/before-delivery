import { copy } from '../../shared/copy.js';
import { isMatchOrganiser } from '../db/lookup.js';
import type { Bundle } from '../db/matches.js';
import { query, transaction } from '../db/pool.js';
import { matchDetail, matchListItem, scorerState, visibleBundle, visibleMatches } from '../db/views.js';
import { HOUR_MS, now } from '../clock.js';
import { config } from '../config.js';
import { publishLinkOff } from '../live/hub.js';
import { newViewerCode } from '../viewerCode.js';
import { buildScorecard } from '../laws/present.js';
import { ApiError, notFound, validation } from '../http/errors.js';
import { EMAIL, asObject, failOn, flag, text, wholeNumber } from '../http/input.js';
import { authedUser, isUuid, reply, route } from '../http/router.js';
import { hashToken, newToken } from '../http/session.js';
import { MailUnavailable, sendMail } from '../services/smtp.js';
import { settingsErrors } from './tournaments.js';

const ownedBundle = async (userId: string, matchId: string): Promise<Bundle> => {
  if (!(await isMatchOrganiser(userId, matchId))) throw notFound();
  return visibleBundle(userId, matchId);
};

/** The XI picked for a team: exactly `players` distinct players of that team, in batting order. */
const validXi = async (team: string, picked: unknown, players: number): Promise<string[] | null> => {
  if (!Array.isArray(picked) || picked.length !== players) return null;
  const ids = picked.filter((id): id is string => typeof id === 'string' && isUuid(id));
  if (ids.length !== players || new Set(ids).size !== players) return null;
  const rows = await query<{ n: string }>('SELECT count(*)::text AS n FROM players WHERE team_id = $1 AND id = ANY($2::uuid[])', [team, ids]);
  return Number(rows[0]?.n) === players ? ids : null;
};

route('GET', '/api/matches', {}, async (ctx) => {
  const user = authedUser(ctx);
  const bundles = await visibleMatches(user.id);
  return reply(200, { matches: bundles.map((bundle) => matchListItem(bundle, user.id)) });
});

type TournamentRow = { id: string; overs: number; players_per_side: number; super_over: boolean };

route('POST', '/api/matches', {}, async (ctx) => {
  const user = authedUser(ctx);
  const input = asObject(ctx.body);
  const fields: Record<string, string> = {};
  const homeId = text(input['home']);
  const awayId = text(input['away']);
  const teamIds = [homeId, awayId].filter(isUuid);
  const teams = teamIds.length === 0 ? [] : await query<{ id: string }>(
    'SELECT id FROM teams WHERE organiser_id = $1 AND id = ANY($2::uuid[])', [user.id, teamIds]);
  const owned = new Set(teams.map((team) => team.id));
  if (!owned.has(homeId)) fields['home'] = copy.chooseSide;
  if (!owned.has(awayId) || awayId === homeId) fields['away'] = copy.chooseSide;
  const battingFirst = text(input['batting_first']);
  if (battingFirst !== homeId && battingFirst !== awayId) fields['batting_first'] = copy.chooseSide;

  let settings = { overs: wholeNumber(input['overs']) ?? Number.NaN, players: wholeNumber(input['players_per_side']) ?? Number.NaN, superOver: flag(input['super_over']) ?? false };
  const tournamentId = typeof input['tournament'] === 'string' ? input['tournament'] : null;
  if (tournamentId !== null) {
    const rows = isUuid(tournamentId) ? await query<TournamentRow>(
      'SELECT id, overs, players_per_side, super_over FROM tournaments WHERE id = $1 AND organiser_id = $2', [tournamentId, user.id]) : [];
    const tournament = rows[0];
    if (!tournament) fields['tournament'] = copy.fieldErrors;
    else {
      settings = { overs: tournament.overs, players: tournament.players_per_side, superOver: tournament.super_over };
      const together = await query(
        `SELECT 1 FROM group_teams a JOIN group_teams b ON b.group_id = a.group_id
         WHERE a.tournament_id = $1 AND a.team_id = $2 AND b.team_id = $3`, [tournament.id, homeId, awayId]);
      if (together.length === 0 && owned.has(homeId) && owned.has(awayId)) fields['tournament'] = copy.teamsNotInOneGroup;
    }
  } else {
    Object.assign(fields, settingsErrors(settings.overs, settings.players));
  }

  const xiInput = asObject(input['xi']);
  const xi = new Map<string, string[]>();
  if (Number.isInteger(settings.players)) {
    for (const team of [homeId, awayId].filter((candidate) => owned.has(candidate))) {
      const ids = await validXi(team, xiInput[team], settings.players);
      if (ids) xi.set(team, ids);
      else fields['xi'] = copy.xi(settings.players);
    }
  }
  failOn(fields);
  const { overs, players: perSide, superOver } = settings;
  const id = await transaction(async (db) => {
    const created = await db.query<{ id: string }>(
      `INSERT INTO matches (organiser_id, home_team_id, away_team_id, batting_first_team_id, tournament_id, overs, players_per_side, super_over, viewer_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [user.id, homeId, awayId, battingFirst, tournamentId, overs, perSide, superOver, newViewerCode()]);
    const matchId = created[0].id;
    for (const [team, ids] of xi) {
      for (const [position, player] of ids.entries()) {
        await db.query('INSERT INTO match_xi (match_id, team_id, player_id, position) VALUES ($1, $2, $3, $4)', [matchId, team, player, position]);
      }
    }
    return matchId;
  });
  return reply(201, await matchDetail(await visibleBundle(user.id, id)));
});

route('GET', '/api/matches/:id', {}, async (ctx) =>
  reply(200, await matchDetail(await visibleBundle(authedUser(ctx).id, ctx.params['id'] ?? ''))));

route('GET', '/api/matches/:id/state', {}, async (ctx) =>
  reply(200, scorerState(await visibleBundle(authedUser(ctx).id, ctx.params['id'] ?? ''))));

route('GET', '/api/matches/:id/scorecard', {}, async (ctx) => {
  const bundle = await visibleBundle(authedUser(ctx).id, ctx.params['id'] ?? '');
  return reply(200, buildScorecard(bundle.view, bundle.ctx));
});

route('PATCH', '/api/matches/:id/viewer-link', {}, async (ctx) => {
  const { row } = await ownedBundle(authedUser(ctx).id, ctx.params['id'] ?? '');
  const on = flag(asObject(ctx.body)['on']);
  if (on === null) throw validation({ on: copy.fieldErrors });
  // Each change is one guarded update: turning on issues a new code only when the link was off, and only the call that turned it off tells the viewers.
  if (on) {
    const turned = await query<{ viewer_code: string }>(
      'UPDATE matches SET viewer_link = true, viewer_code = $2 WHERE id = $1 AND NOT viewer_link RETURNING viewer_code', [row.id, newViewerCode()]);
    const current = turned[0] ?? (await query<{ viewer_code: string }>('SELECT viewer_code FROM matches WHERE id = $1', [row.id]))[0];
    return reply(200, { viewer_link: true, viewer_code: current.viewer_code });
  }
  const turned = await query('UPDATE matches SET viewer_link = false WHERE id = $1 AND viewer_link RETURNING id', [row.id]);
  if (turned.length > 0) await publishLinkOff(row.id);
  return reply(200, { viewer_link: false, viewer_code: null });
});

route('POST', '/api/matches/:id/invitations', {}, async (ctx) => {
  const user = authedUser(ctx);
  const bundle = await ownedBundle(user.id, ctx.params['id'] ?? '');
  const email = text(asObject(ctx.body)['email']);
  if (!EMAIL.test(email)) failOn({ email: copy.email });
  const token = newToken();
  await transaction(async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`invitations:${user.id}`]);
    const sentAt = now();
    const recent = await db.query<{ sent: string }>(
      'SELECT count(*)::text AS sent FROM invitations WHERE organiser_id = $1 AND sent_at > $2', [user.id, new Date(sentAt.getTime() - HOUR_MS)]);
    if (Number(recent[0]?.sent ?? 0) >= config.inviteRatePerHour) throw new ApiError(429, 'RATE_LIMITED', copy.rateLimited);
    try {
      await sendMail({
        to: email, subject: `Score ${bundle.row.home_name} v ${bundle.row.away_name} on Overcall`,
        text: `You are invited to score ${bundle.row.home_name} v ${bundle.row.away_name} on Overcall.\n\n`
          + `Open this link to accept: ${config.appBaseUrl}/invitations/${token}\n\n${copy.invitationMailLine(config.inviteTtlHours)}\n`,
      });
    } catch (error) {
      if (error instanceof MailUnavailable) throw new ApiError(503, 'MAIL_UNAVAILABLE', copy.mailOutage);
      throw error;
    }
    await db.query(
      'INSERT INTO invitations (match_id, organiser_id, email, token_hash, sent_at) VALUES ($1, $2, $3, $4, $5)',
      [bundle.row.id, user.id, email, hashToken(token), sentAt]);
  });
  return reply(202, { message: copy.invitationSent(email) });
});

