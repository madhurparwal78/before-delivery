import { randomInt } from 'node:crypto';
import { one, pool, query, transaction } from '../db.ts';
import type { LeagueCreated, LeagueSummary, LeagueView, StandingRow } from '../../shared/types.ts';
import { standingsOrder } from '../domain/standings.ts';
import { currentGameweek } from './gameweeks.ts';
import { historyView } from './history.ts';
import { conflict, forbidden, notFound, validation } from '../http/errors.ts';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const identifier = (value: string): string => {
  if (!UUID_PATTERN.test(value)) throw notFound();
  return value;
};

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const JOIN_CODE_LENGTH = 6;

const freshCode = (): string =>
  Array.from({ length: JOIN_CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]!)
    .join('');

const uniqueCode = async (): Promise<string> => {
  for (;;) {
    const code = freshCode();
    const taken = await query(pool, 'select 1 from leagues where code = $1', [code]);
    if (taken.length === 0) return code;
  }
};

const trimmedName = (value: unknown, field: string, min: number, max: number): string => {
  const name = typeof value === 'string' ? value.trim() : '';
  if (name.length < min || name.length > max) {
    throw validation({ [field]: `Use ${min} to ${max} characters.` });
  }
  return name;
};

export const createLeague = async (
  managerId: string,
  name: unknown,
): Promise<LeagueCreated> => {
  const leagueName = trimmedName(name, 'name', 3, 40);
  const code = await uniqueCode();
  return transaction(async (client) => {
    const league = (
      await query<{ id: string }>(
        client,
        'insert into leagues (name, code, admin_manager_id) values ($1, $2, $3) returning id',
        [leagueName, code, managerId],
      )
    )[0]!;
    await client.query(
      'insert into league_members (league_id, manager_id) values ($1, $2)',
      [league.id, managerId],
    );
    return {
      id: league.id,
      name: leagueName,
      code,
      admin_manager_id: managerId,
      is_admin: true,
    };
  });
};

export const joinLeague = async (
  managerId: string,
  code: unknown,
): Promise<LeagueCreated> => {
  const text = typeof code === 'string' ? code.trim().toUpperCase() : '';
  const league = await one<{ id: string; name: string; admin_manager_id: string }>(
    pool,
    'select id, name, admin_manager_id from leagues where code = $1',
    [text],
  );
  if (league === undefined) throw notFound('league_not_found', 'No league uses that code.');
  const joined = await query<{ manager_id: string }>(
    pool,
    `insert into league_members (league_id, manager_id) values ($1, $2)
     on conflict (league_id, manager_id) do nothing returning manager_id`,
    [league.id, managerId],
  );
  if (joined.length === 0) {
    throw conflict('already_member', 'You are already in this league.');
  }
  return {
    id: league.id,
    name: league.name,
    code: null,
    admin_manager_id: league.admin_manager_id,
    is_admin: league.admin_manager_id === managerId,
  };
};

interface MemberRow {
  manager_id: string;
  team_name: string;
}

const lastClosedGameweek = async (): Promise<number | null> => {
  const closed = await one<{ number: number }>(
    pool,
    `select number from gameweeks where status = 'closed' order by number desc limit 1`,
  );
  return closed?.number ?? null;
};

const buildStandings = async (leagueId: string): Promise<StandingRow[]> => {
  const members = await query<MemberRow>(
    pool,
    `select lm.manager_id, m.team_name from league_members lm
       join managers m on m.id = lm.manager_id where lm.league_id = $1`,
    [leagueId],
  );
  const closed = await lastClosedGameweek();
  const ranks =
    closed === null
      ? []
      : await query<{ manager_id: string; rank: number }>(
          pool,
          'select manager_id, rank from league_ranks where league_id = $1 and gameweek = $2',
          [leagueId, closed],
        );

  const gameweek = await currentGameweek();
  const withTotals = [];
  for (const member of members) {
    const history = await historyView(member.manager_id);
    const liveRow = history.rows.find(
      (row) => row.gameweek === gameweek.number && row.running_total === null,
    );
    const lastClosed = [...history.rows].reverse().find((row) => row.running_total !== null);
    withTotals.push({
      manager_id: member.manager_id,
      team_name: member.team_name,
      season_total: history.season_total,
      gameweek_points: liveRow?.net_points ?? lastClosed?.net_points ?? 0,
    });
  }

  return standingsOrder(withTotals).map((member, index) => ({
    rank: index + 1,
    last_rank: ranks.find((entry) => entry.manager_id === member.manager_id)?.rank ?? null,
    manager_id: member.manager_id,
    team_name: member.team_name,
    gameweek_points: member.gameweek_points,
    season_total: member.season_total,
  }));
};

export const leagueSummaries = async (managerId: string): Promise<LeagueSummary[]> => {
  const leagues = await query<{ id: string; name: string; admin_manager_id: string }>(
    pool,
    `select l.id, l.name, l.admin_manager_id from league_members lm
       join leagues l on l.id = lm.league_id
      where lm.manager_id = $1 order by lm.joined_at, l.id`,
    [managerId],
  );
  const summaries: LeagueSummary[] = [];
  for (const league of leagues) {
    const standings = await buildStandings(league.id);
    summaries.push({
      id: league.id,
      name: league.name,
      is_admin: league.admin_manager_id === managerId,
      rank: standings.find((row) => row.manager_id === managerId)?.rank ?? null,
      members: standings.length,
    });
  }
  return summaries;
};

const memberOf = async (leagueId: string, managerId: string): Promise<boolean> =>
  (
    await query(pool, 'select 1 from league_members where league_id = $1 and manager_id = $2', [
      leagueId,
      managerId,
    ])
  ).length > 0;

export const leagueView = async (
  managerId: string,
  id: string,
): Promise<LeagueView> => {
  const leagueId = identifier(id);
  const league = await one<{ id: string; name: string; code: string; admin_manager_id: string }>(
    pool,
    'select id, name, code, admin_manager_id from leagues where id = $1',
    [leagueId],
  );
  if (league === undefined || !(await memberOf(leagueId, managerId))) throw notFound();
  const gameweek = await currentGameweek();
  return {
    id: league.id,
    name: league.name,
    code: league.admin_manager_id === managerId ? league.code : null,
    gameweek: gameweek.number,
    standings: await buildStandings(leagueId),
  };
};

export const replaceJoinCode = async (
  managerId: string,
  id: string,
): Promise<{ code: string }> => {
  const leagueId = identifier(id);
  const league = await one<{ admin_manager_id: string }>(
    pool,
    'select admin_manager_id from leagues where id = $1',
    [leagueId],
  );
  if (league === undefined || !(await memberOf(leagueId, managerId))) throw notFound();
  if (league.admin_manager_id !== managerId) throw forbidden();
  const code = await uniqueCode();
  await query(pool, 'update leagues set code = $2 where id = $1', [leagueId, code]);
  return { code };
};

export const assertSharedLeague = async (
  callerId: string,
  id: string,
  member: string,
): Promise<void> => {
  const leagueId = identifier(id);
  const memberId = identifier(member);
  if (!(await memberOf(leagueId, callerId)) || !(await memberOf(leagueId, memberId))) {
    throw notFound();
  }
};
