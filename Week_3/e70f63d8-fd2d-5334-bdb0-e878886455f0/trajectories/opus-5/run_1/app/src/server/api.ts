import { MSG } from '../shared/messages.js';
import { config } from './config.js';
import { now } from './clock.js';
import { query, one } from './db.js';
import { HttpError, notFound, signInRequired, validation } from './errors.js';
import {
  type Ctx,
  parseMultipart,
  sendBytes,
  sendJson,
  sendNoContent,
  sessionCookie,
  clearedCookie,
} from './http.js';
import { publishLinkOff, publishMatchState, scorerContext, viewerContext } from './live.js';
import { buildScorecard, buildState, computeMatch } from './match.js';
import { requirePen } from './pen.js';
import {
  changeDelivery,
  checkExpectedSeq,
  recordDelivery,
  retireBatter,
  startInnings,
  startOver,
  undoLast,
} from './scoring.js';
import { buildCareer, buildTournamentView, teamHistory } from './stats.js';
import {
  type MatchRow,
  type UserRow,
  createSession,
  createUser,
  deleteSession,
  groupTeams,
  isScorer,
  loadMatchInput,
  matchByCode,
  matchById,
  matchScorers,
  newId,
  randomToken,
  teamById,
  teamPlayers,
  tournamentById,
  tournamentGroups,
  userByEmail,
  userBySession,
  verifyPassword,
  viewerCode,
  visibleMatches,
  visiblePlayer,
  visiblePlayers,
  visibleTeam,
  visibleTeams,
  visibleTournament,
  visibleTournaments,
} from './store.js';
import { getObject, putObject, storageReachable } from './storage.js';
import { mailReachable, sendInvitation } from './mail.js';
import { liveReachable } from './valkey.js';
import { postgresUp } from './db.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function currentUser(ctx: Ctx): Promise<UserRow | null> {
  return userBySession(ctx.cookies.oc_session ?? null);
}

async function requireUser(ctx: Ctx): Promise<UserRow> {
  const user = await currentUser(ctx);
  if (!user) throw signInRequired();
  return user;
}

function body(ctx: Ctx): Record<string, unknown> {
  return (ctx.parsed ?? {}) as Record<string, unknown>;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function shortNameOf(name: string, provided: unknown): string {
  const given = text(provided);
  if (given) return given;
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1] ?? '';
}

async function matchForScorer(matchId: string, user: UserRow): Promise<MatchRow> {
  const match = await matchById(matchId);
  if (!match || !(await isScorer(match.id, user.id))) throw notFound();
  return match;
}

async function matchForOrganiser(matchId: string, user: UserRow): Promise<MatchRow> {
  const match = await matchById(matchId);
  if (!match || match.organiser_id !== user.id) throw notFound();
  return match;
}

async function teamView(teamId: string, userId: string): Promise<Record<string, unknown>> {
  const team = await visibleTeam(userId, teamId);
  if (!team) throw notFound();
  const players = await teamPlayers(team.id);
  return {
    id: team.id,
    name: team.name,
    logo_url: team.logo_key ? `/api/teams/${team.id}/logo` : null,
    players: players.map((player) => ({
      id: player.id,
      name: player.name,
      short_name: player.short_name,
    })),
    matches: await teamHistory(team.id),
  };
}

async function matchView(match: MatchRow): Promise<Record<string, unknown>> {
  const input = await loadMatchInput(match);
  const computed = computeMatch(input);
  const ctx = scorerContext(input);
  const scorers = await matchScorers(match.id);
  const tournament = match.tournament_id ? await tournamentById(match.tournament_id) : null;
  return {
    id: match.id,
    title: `${input.home.name} v ${input.away.name}`,
    status: computed.status,
    home: { id: input.home.id, name: input.home.name, logo_url: ctx.logoUrl(input.home.id) },
    away: { id: input.away.id, name: input.away.name, logo_url: ctx.logoUrl(input.away.id) },
    overs: match.overs,
    players_per_side: match.players_per_side,
    super_over: match.super_over,
    tournament: tournament ? { id: tournament.id, name: tournament.name } : null,
    viewer_link: match.viewer_link,
    viewer_code: match.viewer_link ? match.viewer_code : null,
    scorers: scorers.map((scorer) => ({ display_name: scorer.display_name })),
  };
}

async function tournamentView(tournamentId: string, userId: string): Promise<unknown> {
  const tournament = await visibleTournament(userId, tournamentId);
  if (!tournament) throw notFound();
  return buildTournamentView(tournament);
}

async function requireScoringMatch(ctx: Ctx, matchId: string): Promise<{ match: MatchRow; user: UserRow }> {
  const user = await requireUser(ctx);
  const match = await matchForScorer(matchId, user);
  await requirePen(match.id, ctx.req.headers['x-pen'] as string | undefined);
  return { match, user };
}

export async function handleApi(ctx: Ctx, segments: string[]): Promise<boolean> {
  const [first, ...rest] = segments;
  if (first !== 'api') return false;
  const path = rest;
  const method = ctx.method;

  if (path[0] === 'health' && path.length === 1) {
    sendJson(ctx.res, 200, { status: 'ok' });
    return true;
  }

  if (path[0] === 'config' && path.length === 1) {
    sendJson(ctx.res, 200, {
      live_delay_ms: config.liveDelayMs,
      tick_ms: config.tickMs,
      tick_stagger_ms: config.tickStaggerMs,
    });
    return true;
  }

  if (path[0] === 'services' && path.length === 1) {
    const [postgres, valkey, minio, mailpit] = await Promise.all([
      postgresUp(),
      liveReachable(),
      storageReachable(),
      mailReachable(),
    ]);
    sendJson(ctx.res, 200, {
      postgres: postgres ? 'up' : 'down',
      valkey: valkey ? 'up' : 'down',
      minio: minio ? 'up' : 'down',
      mailpit: mailpit ? 'up' : 'down',
    });
    return true;
  }

  if (path[0] === 'auth') {
    if (path[1] === 'signup' && method === 'POST') {
      const data = body(ctx);
      const email = text(data.email).toLowerCase();
      const password = typeof data.password === 'string' ? data.password : '';
      const displayName = text(data.display_name);
      const fields: Record<string, string> = {};
      if (!EMAIL_PATTERN.test(email)) fields.email = MSG.emailField;
      if (password.length < 10) fields.password = MSG.passwordField;
      if (!displayName) fields.display_name = MSG.nameField;
      if (!fields.email && (await userByEmail(email))) fields.email = MSG.emailTaken;
      if (Object.keys(fields).length > 0) throw validation(fields);
      const user = await createUser({ email, password, displayName });
      const token = await createSession(user.id);
      ctx.res.setHeader('set-cookie', sessionCookie(token));
      sendJson(ctx.res, 201, {
        user: { id: user.id, email: user.email, display_name: user.display_name },
      });
      return true;
    }
    if (path[1] === 'signin' && method === 'POST') {
      const data = body(ctx);
      const email = text(data.email).toLowerCase();
      const password = typeof data.password === 'string' ? data.password : '';
      const found = await userByEmail(email);
      const stored =
        found?.password_hash ??
        'ac3c4f4e2f4e4a4b4c4d4e4f50515253:0000000000000000000000000000000000000000000000000000000000000000';
      const valid = await verifyPassword(password, stored);
      if (!found || !valid) {
        throw new HttpError(401, 'SIGN_IN_FAILED', MSG.signInFailed);
      }
      const token = await createSession(found.id);
      ctx.res.setHeader('set-cookie', sessionCookie(token));
      sendJson(ctx.res, 200, {
        user: { id: found.id, email: found.email, display_name: found.display_name },
      });
      return true;
    }
    if (path[1] === 'signout' && method === 'POST') {
      const token = ctx.cookies.oc_session;
      if (token) await deleteSession(token);
      ctx.res.setHeader('set-cookie', clearedCookie());
      sendNoContent(ctx.res);
      return true;
    }
  }

  if (path[0] === 'me' && path.length === 1 && method === 'GET') {
    const user = await requireUser(ctx);
    sendJson(ctx.res, 200, {
      user: { id: user.id, email: user.email, display_name: user.display_name },
    });
    return true;
  }

  if (path[0] === 'teams') {
    if (path.length === 1 && method === 'GET') {
      const user = await requireUser(ctx);
      const teams = await visibleTeams(user.id);
      sendJson(ctx.res, 200, {
        teams: teams.map((team) => ({
          id: team.id,
          name: team.name,
          logo_url: team.logo_key ? `/api/teams/${team.id}/logo` : null,
        })),
      });
      return true;
    }
    if (path.length === 1 && method === 'POST') {
      const user = await requireUser(ctx);
      const data = body(ctx);
      const name = text(data.name);
      const rawPlayers = Array.isArray(data.players) ? (data.players as Record<string, unknown>[]) : [];
      const fields: Record<string, string> = {};
      if (!name) fields.name = MSG.nameField;
      const players = rawPlayers.map((player) => ({
        name: text(player.name),
        short_name: shortNameOf(text(player.name), player.short_name),
      }));
      players.forEach((player, index) => {
        if (!player.name) fields[`players[${index}].name`] = MSG.nameField;
        if (!player.short_name) fields[`players[${index}].short_name`] = MSG.nameField;
      });
      players.forEach((player, index) => {
        if (players.some((other, otherIndex) => otherIndex < index && other.short_name === player.short_name)) {
          fields[`players[${index}].short_name`] = MSG.shortNameClash;
        }
      });
      if (Object.keys(fields).length > 0) throw validation(fields);
      const teamId = newId();
      await query('insert into teams (id, organiser_id, name) values ($1, $2, $3)', [
        teamId,
        user.id,
        name,
      ]);
      for (const [index, player] of players.entries()) {
        await query(
          'insert into players (id, team_id, name, short_name, position) values ($1, $2, $3, $4, $5)',
          [newId(), teamId, player.name, player.short_name, index + 1],
        );
      }
      sendJson(ctx.res, 201, await teamView(teamId, user.id));
      return true;
    }
    if (path.length === 2 && method === 'GET') {
      const user = await requireUser(ctx);
      sendJson(ctx.res, 200, await teamView(path[1], user.id));
      return true;
    }
    if (path.length === 3 && path[2] === 'players' && method === 'POST') {
      const user = await requireUser(ctx);
      const team = await teamById(path[1]);
      if (!team || team.organiser_id !== user.id) throw notFound();
      const data = body(ctx);
      const name = text(data.name);
      const shortName = shortNameOf(name, data.short_name);
      const fields: Record<string, string> = {};
      if (!name) fields.name = MSG.nameField;
      const players = await teamPlayers(team.id);
      if (players.some((player) => player.short_name === shortName)) {
        fields.short_name = MSG.shortNameClash;
      }
      if (Object.keys(fields).length > 0) throw validation(fields);
      const id = newId();
      await query(
        'insert into players (id, team_id, name, short_name, position) values ($1, $2, $3, $4, $5)',
        [id, team.id, name, shortName, players.length + 1],
      );
      sendJson(ctx.res, 201, { id, name, short_name: shortName });
      return true;
    }
    if (path.length === 3 && path[2] === 'logo' && method === 'POST') {
      const user = await requireUser(ctx);
      const team = await teamById(path[1]);
      if (!team || team.organiser_id !== user.id) throw notFound();
      const contentType = ctx.req.headers['content-type'] ?? '';
      if (!contentType.includes('multipart/form-data')) {
        throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', MSG.serverError);
      }
      const files = parseMultipart(ctx.rawBody ?? Buffer.alloc(0), contentType);
      const file = files.find((candidate) => candidate.name === 'logo');
      if (!file) throw validation({ logo: MSG.logoWrongType });
      const png = file.bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      const jpeg =
        file.bytes.length > 3 &&
        file.bytes[0] === 0xff &&
        file.bytes[1] === 0xd8 &&
        file.bytes[2] === 0xff;
      if (!png && !jpeg) throw validation({ logo: MSG.logoWrongType });
      if (file.bytes.length > config.logoMaxBytes) {
        throw validation({ logo: MSG.logoTooLarge(config.logoMaxBytes) });
      }
      const uploads = team.logo_uploads + 1;
      const key = `logos/${team.id}/${uploads}.${png ? 'png' : 'jpg'}`;
      const type = png ? 'image/png' : 'image/jpeg';
      try {
        await putObject(key, file.bytes, type);
      } catch {
        throw new HttpError(503, 'STORAGE_UNAVAILABLE', MSG.storageOutage);
      }
      await query(
        'update teams set logo_key = $2, logo_type = $3, logo_uploads = $4 where id = $1',
        [team.id, key, type, uploads],
      );
      sendJson(ctx.res, 201, { logo_url: `/api/teams/${team.id}/logo` });
      return true;
    }
    if (path.length === 3 && path[2] === 'logo' && method === 'GET') {
      const user = await requireUser(ctx);
      const team = await visibleTeam(user.id, path[1]);
      if (!team || !team.logo_key) throw notFound();
      const object = await getObject(team.logo_key);
      if (!object) throw notFound();
      sendBytes(ctx.res, 200, object.body, team.logo_type ?? object.contentType);
      return true;
    }
  }

  if (path[0] === 'players') {
    if (path.length === 1 && method === 'GET') {
      const user = await requireUser(ctx);
      const players = await visiblePlayers(user.id);
      sendJson(ctx.res, 200, {
        players: players.map((player) => ({
          id: player.id,
          name: player.name,
          short_name: player.short_name,
          team: { id: player.team_id, name: player.team_name },
        })),
      });
      return true;
    }
    if (path.length === 2 && method === 'GET') {
      const user = await requireUser(ctx);
      const player = await visiblePlayer(user.id, path[1]);
      if (!player) throw notFound();
      sendJson(ctx.res, 200, await buildCareer(player));
      return true;
    }
  }

  if (path[0] === 'tournaments') {
    if (path.length === 1 && method === 'GET') {
      const user = await requireUser(ctx);
      const tournaments = await visibleTournaments(user.id);
      sendJson(ctx.res, 200, {
        tournaments: tournaments.map((tournament) => ({ id: tournament.id, name: tournament.name })),
      });
      return true;
    }
    if (path.length === 1 && method === 'POST') {
      const user = await requireUser(ctx);
      const data = body(ctx);
      const name = text(data.name);
      const overs = Number(data.overs);
      const playersPerSide = Number(data.players_per_side);
      const superOver = data.super_over === true;
      const groups = Array.isArray(data.groups) ? (data.groups as Record<string, unknown>[]) : [];
      const fields: Record<string, string> = {};
      if (!name) fields.name = MSG.nameField;
      if (!Number.isInteger(overs) || overs < 1 || overs > 50) fields.overs = MSG.oversField;
      if (!Number.isInteger(playersPerSide) || playersPerSide < 2 || playersPerSide > 11) {
        fields.players_per_side = MSG.playersPerSideField;
      }
      const seen = new Set<string>();
      for (const [index, group] of groups.entries()) {
        if (!text(group.name)) fields[`groups[${index}].name`] = MSG.nameField;
        const teamIds = Array.isArray(group.teams) ? (group.teams as string[]) : [];
        for (const teamId of teamIds) {
          const team = await teamById(teamId);
          if (!team || team.organiser_id !== user.id || seen.has(teamId)) {
            fields[`groups[${index}].teams`] = MSG.nameField;
          }
          seen.add(teamId);
        }
      }
      if (Object.keys(fields).length > 0) throw validation(fields);
      const tournamentId = newId();
      await query(
        'insert into tournaments (id, organiser_id, name, overs, players_per_side, super_over) values ($1, $2, $3, $4, $5, $6)',
        [tournamentId, user.id, name, overs, playersPerSide, superOver],
      );
      for (const [index, group] of groups.entries()) {
        const groupId = newId();
        await query('insert into groups (id, tournament_id, name, position) values ($1, $2, $3, $4)', [
          groupId,
          tournamentId,
          text(group.name),
          index + 1,
        ]);
        const teamIds = Array.isArray(group.teams) ? (group.teams as string[]) : [];
        for (const [teamIndex, teamId] of teamIds.entries()) {
          await query('insert into group_teams (group_id, team_id, position) values ($1, $2, $3)', [
            groupId,
            teamId,
            teamIndex + 1,
          ]);
        }
      }
      sendJson(ctx.res, 201, await tournamentView(tournamentId, user.id));
      return true;
    }
    if (path.length === 2 && method === 'GET') {
      const user = await requireUser(ctx);
      sendJson(ctx.res, 200, await tournamentView(path[1], user.id));
      return true;
    }
  }

  if (path[0] === 'matches') {
    if (path.length === 1 && method === 'GET') {
      const user = await requireUser(ctx);
      const rows = await visibleMatches(user.id);
      const matches = [];
      for (const row of rows) {
        const input = await loadMatchInput(row);
        const computed = computeMatch(input);
        matches.push({
          id: row.id,
          title: `${input.home.name} v ${input.away.name}`,
          status: computed.status,
          played_on: input.played_on,
          result: computed.result,
        });
      }
      sendJson(ctx.res, 200, { matches });
      return true;
    }
    if (path.length === 1 && method === 'POST') {
      const user = await requireUser(ctx);
      const data = body(ctx);
      const fields: Record<string, string> = {};
      const home = await visibleTeam(user.id, text(data.home));
      const away = await visibleTeam(user.id, text(data.away));
      if (!home || !away || home.id === away.id) throw notFound();
      const tournamentId = text(data.tournament);
      const tournament = tournamentId ? await visibleTournament(user.id, tournamentId) : null;
      if (tournamentId && !tournament) throw notFound();
      let overs = Number(data.overs);
      let playersPerSide = Number(data.players_per_side);
      let superOver = data.super_over === true;
      if (tournament) {
        overs = tournament.overs;
        playersPerSide = tournament.players_per_side;
        superOver = tournament.super_over;
        const groups = await tournamentGroups(tournament.id);
        let together = false;
        for (const group of groups) {
          const teams = await groupTeams(group.id);
          const ids = teams.map((team) => team.id);
          if (ids.includes(home.id) && ids.includes(away.id)) together = true;
        }
        if (!together) fields.tournament = MSG.tournamentGroupField;
      }
      if (!Number.isInteger(overs) || overs < 1 || overs > 50) fields.overs = MSG.oversField;
      if (!Number.isInteger(playersPerSide) || playersPerSide < 2 || playersPerSide > 11) {
        fields.players_per_side = MSG.playersPerSideField;
      }
      const battingFirst = text(data.batting_first);
      if (battingFirst !== home.id && battingFirst !== away.id) {
        fields.batting_first = MSG.fieldErrors;
      }
      const xiInput = (data.xi ?? {}) as Record<string, unknown>;
      const chosen = new Map<string, string[]>();
      for (const team of [home, away]) {
        const ids = Array.isArray(xiInput[team.id]) ? (xiInput[team.id] as string[]) : [];
        const players = await teamPlayers(team.id);
        const valid = ids.filter((id) => players.some((player) => player.id === id));
        if (valid.length !== playersPerSide || valid.length !== ids.length) {
          fields.xi = MSG.xiField(playersPerSide);
        }
        chosen.set(
          team.id,
          players.filter((player) => valid.includes(player.id)).map((player) => player.id),
        );
      }
      if (Object.keys(fields).length > 0) throw validation(fields);
      const matchId = newId();
      await query(
        `insert into matches (id, organiser_id, home_team_id, away_team_id, overs, players_per_side,
           super_over, batting_first, tournament_id, viewer_code, viewer_link)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)`,
        [
          matchId,
          user.id,
          home.id,
          away.id,
          overs,
          playersPerSide,
          superOver,
          battingFirst,
          tournament ? tournament.id : null,
          viewerCode(),
        ],
      );
      for (const [teamId, ids] of chosen) {
        for (const [index, playerId] of ids.entries()) {
          await query(
            'insert into match_xi (match_id, team_id, player_id, position) values ($1, $2, $3, $4)',
            [matchId, teamId, playerId, index + 1],
          );
        }
      }
      const created = await matchById(matchId);
      sendJson(ctx.res, 201, await matchView(created!));
      return true;
    }

    const matchId = path[1];
    if (path.length === 2 && method === 'GET') {
      const user = await requireUser(ctx);
      const match = await matchForScorer(matchId, user);
      sendJson(ctx.res, 200, await matchView(match));
      return true;
    }
    if (path.length === 3 && path[2] === 'viewer-link' && method === 'PATCH') {
      const user = await requireUser(ctx);
      const match = await matchForOrganiser(matchId, user);
      const on = body(ctx).on === true;
      if (on) {
        const code = match.viewer_link ? match.viewer_code : viewerCode();
        await query('update matches set viewer_link = true, viewer_code = $2 where id = $1', [
          match.id,
          code,
        ]);
        sendJson(ctx.res, 200, { viewer_link: true, viewer_code: code });
      } else {
        await query('update matches set viewer_link = false where id = $1', [match.id]);
        await publishLinkOff(match.id);
        sendJson(ctx.res, 200, { viewer_link: false, viewer_code: null });
      }
      return true;
    }
    if (path.length === 3 && path[2] === 'invitations' && method === 'POST') {
      const user = await requireUser(ctx);
      const match = await matchForOrganiser(matchId, user);
      const email = text(body(ctx).email);
      if (!EMAIL_PATTERN.test(email)) throw validation({ email: MSG.emailField });
      const counted = await one<{ count: string }>(
        `select count(*)::text as count from invitations
          where organiser_id = $1 and sent_at > $2`,
        [user.id, new Date(now().getTime() - 3600_000).toISOString()],
      );
      if (Number(counted?.count ?? '0') >= config.inviteRatePerHour) {
        throw new HttpError(429, 'RATE_LIMITED', MSG.invitationRateLimit);
      }
      const input = await loadMatchInput(match);
      const token = randomToken(24);
      try {
        await sendInvitation({
          to: email,
          home: input.home.name,
          away: input.away.name,
          token,
        });
      } catch {
        throw new HttpError(503, 'MAIL_UNAVAILABLE', MSG.mailOutage);
      }
      await query(
        'insert into invitations (id, match_id, organiser_id, email, token, sent_at) values ($1, $2, $3, $4, $5, $6)',
        [newId(), match.id, user.id, email, token, now().toISOString()],
      );
      sendJson(ctx.res, 202, { message: MSG.invitationSent(email) });
      return true;
    }
    if (path.length === 3 && path[2] === 'state' && method === 'GET') {
      const user = await requireUser(ctx);
      const match = await matchForScorer(matchId, user);
      const input = await loadMatchInput(match);
      const computed = computeMatch(input);
      sendJson(ctx.res, 200, {
        ...buildState(computed, scorerContext(input)),
        viewer_link: input.viewer_link,
        viewer_code: input.viewer_link ? input.viewer_code : null,
      });
      return true;
    }
    if (path.length === 3 && path[2] === 'scorecard' && method === 'GET') {
      const user = await requireUser(ctx);
      const match = await matchForScorer(matchId, user);
      const input = await loadMatchInput(match);
      const computed = computeMatch(input);
      sendJson(ctx.res, 200, buildScorecard(computed, scorerContext(input)));
      return true;
    }

    if (path.length === 3 && path[2] === 'innings' && method === 'POST') {
      const { match } = await requireScoringMatch(ctx, matchId);
      const input = await loadMatchInput(match);
      const event = await startInnings(input, body(ctx));
      await answerState(ctx, match, 201, event);
      return true;
    }
    if (path.length === 3 && path[2] === 'overs' && method === 'POST') {
      const { match } = await requireScoringMatch(ctx, matchId);
      const input = await loadMatchInput(match);
      const event = await startOver(input, body(ctx));
      await answerState(ctx, match, 201, event);
      return true;
    }
    if (path.length === 3 && path[2] === 'deliveries' && method === 'POST') {
      const { match } = await requireScoringMatch(ctx, matchId);
      const input = await loadMatchInput(match);
      checkExpectedSeq(input, body(ctx).expected_seq);
      const event = await recordDelivery(input, body(ctx));
      await answerState(ctx, match, 201, event);
      return true;
    }
    if (path.length === 3 && path[2] === 'retirements' && method === 'POST') {
      const { match } = await requireScoringMatch(ctx, matchId);
      const input = await loadMatchInput(match);
      const event = await retireBatter(input, body(ctx));
      await answerState(ctx, match, 201, event);
      return true;
    }
    if (path.length === 4 && path[2] === 'deliveries' && path[3] === 'last' && method === 'DELETE') {
      const { match } = await requireScoringMatch(ctx, matchId);
      const input = await loadMatchInput(match);
      const event = await undoLast(input);
      await answerState(ctx, match, 200, event);
      return true;
    }
    if (path.length === 4 && path[2] === 'deliveries' && method === 'PUT') {
      const { match } = await requireScoringMatch(ctx, matchId);
      const input = await loadMatchInput(match);
      const seq = Number(path[3]);
      if (!Number.isInteger(seq)) throw notFound();
      const event = await changeDelivery(input, seq, body(ctx));
      await answerState(ctx, match, 200, event);
      return true;
    }
  }

  if (path[0] === 'invitations') {
    const token = path[1] ?? '';
    const invitation = await one<{
      id: string;
      match_id: string;
      sent_at: string;
      accepted_at: string | null;
    }>('select id, match_id, sent_at, accepted_at from invitations where token = $1', [token]);
    if (!invitation) throw notFound();
    const match = await matchById(invitation.match_id);
    if (!match) throw notFound();
    const input = await loadMatchInput(match);
    const expired =
      now().getTime() - new Date(invitation.sent_at).getTime() >= config.inviteTtlHours * 3600_000;
    if (path.length === 2 && method === 'GET') {
      sendJson(ctx.res, 200, {
        match: { id: match.id, title: `${input.home.name} v ${input.away.name}` },
        status: invitation.accepted_at ? 'used' : expired ? 'expired' : 'open',
      });
      return true;
    }
    if (path.length === 3 && path[2] === 'accept' && method === 'POST') {
      const user = await requireUser(ctx);
      if (invitation.accepted_at) {
        throw new HttpError(409, 'INVITATION_USED', MSG.invitationUsed);
      }
      if (expired) {
        throw new HttpError(409, 'INVITATION_EXPIRED', MSG.invitationExpired);
      }
      await query('update invitations set accepted_at = $2, accepted_by = $3 where id = $1', [
        invitation.id,
        now().toISOString(),
        user.id,
      ]);
      await query(
        'insert into match_scorers (match_id, user_id) values ($1, $2) on conflict do nothing',
        [match.id, user.id],
      );
      sendJson(ctx.res, 200, { match_id: match.id });
      return true;
    }
  }

  if (path[0] === 'live') {
    const code = path[1] ?? '';
    if (method !== 'GET') throw notFound();
    const match = await matchByCode(code);
    if (!match || !match.viewer_link) throw notFound();
    const input = await loadMatchInput(match);
    const computed = computeMatch(input);
    if (path.length === 3 && path[2] === 'state') {
      sendJson(ctx.res, 200, buildState(computed, viewerContext(input)));
      return true;
    }
    if (path.length === 3 && path[2] === 'scorecard') {
      sendJson(ctx.res, 200, buildScorecard(computed, viewerContext(input)));
      return true;
    }
    if (path.length === 5 && path[2] === 'teams' && path[4] === 'logo') {
      const team = await teamById(path[3]);
      if (!team || !team.logo_key || (team.id !== match.home_team_id && team.id !== match.away_team_id)) {
        throw notFound();
      }
      const object = await getObject(team.logo_key);
      if (!object) throw notFound();
      sendBytes(ctx.res, 200, object.body, team.logo_type ?? object.contentType);
      return true;
    }
    throw notFound();
  }

  throw notFound();
}

async function answerState(
  ctx: Ctx,
  match: MatchRow,
  status: number,
  event: { kind: string; seq: number },
): Promise<void> {
  const fresh = await matchById(match.id);
  const input = await loadMatchInput(fresh!);
  const computed = computeMatch(input);
  sendJson(ctx.res, status, {
    ...buildState(computed, scorerContext(input)),
    viewer_link: input.viewer_link,
    viewer_code: input.viewer_link ? input.viewer_code : null,
  });
  await publishMatchState(match.id, {
    kind: event.kind as 'delivery',
    seq: event.seq,
  });
}
