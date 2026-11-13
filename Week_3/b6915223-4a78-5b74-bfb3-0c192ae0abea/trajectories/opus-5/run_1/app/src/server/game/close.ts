import type { PoolClient } from 'pg';
import { pool, query, transaction, withAdvisoryLock } from '../db.ts';
import type { ChipCode, Position } from '../../shared/types.ts';
import { noticeMessage } from '../../shared/copy.ts';
import { applyAutoSubs } from '../domain/autosubs.ts';
import { gameweekHitPoints } from '../domain/hits.ts';
import { rawPoints, teamMultiplier, type ScoredEvent } from '../domain/scoring.ts';
import { standingsOrder } from '../domain/standings.ts';
import { TOTAL_GAMEWEEKS } from '../domain/seed.ts';
import { broadcast } from '../services/realtime.ts';
import { currentGameweekView } from './gameweeks.ts';
import { playerMap } from './catalogue.ts';
import { writeLineup } from './squad.ts';
import { queueNotice } from './notices.ts';
import { conflict } from '../http/errors.ts';

interface LockedTeamRow {
  manager_id: string;
  starting: string[];
  bench: string[];
  captain: string;
  vice_captain: string;
  chip: ChipCode | null;
}

interface FreeHitState {
  bank_tenths: number;
  players: {
    player_id: string;
    purchase_price_tenths: number;
  }[];
  starting: string[];
  bench: string[];
  captain: string;
  vice_captain: string;
}

export const captureFreeHitState = async (
  client: PoolClient,
  managerId: string,
  gameweek: number,
): Promise<void> => {
  const players = await query<{ player_id: string; purchase_price_tenths: number }>(
    client,
    'select player_id, purchase_price_tenths from squad_players where manager_id = $1',
    [managerId],
  );
  const lineup = await query<{ player_id: string; slot: string; captain: boolean; vice_captain: boolean }>(
    client,
    `select player_id, slot, captain, vice_captain from squad_players
      where manager_id = $1 order by (slot = 'bench'), starting_index nulls last, bench_order nulls last`,
    [managerId],
  );
  const bank = await query<{ bank_tenths: number }>(
    client,
    'select bank_tenths from squads where manager_id = $1',
    [managerId],
  );
  const state: FreeHitState = {
    bank_tenths: bank[0]!.bank_tenths,
    players,
    starting: lineup.filter((entry) => entry.slot === 'starting').map((entry) => entry.player_id),
    bench: lineup.filter((entry) => entry.slot === 'bench').map((entry) => entry.player_id),
    captain: lineup.find((entry) => entry.captain)!.player_id,
    vice_captain: lineup.find((entry) => entry.vice_captain)!.player_id,
  };
  await client.query(
    `insert into free_hit_states (manager_id, gameweek, state) values ($1, $2, $3::jsonb)
     on conflict (manager_id, gameweek) do nothing`,
    [managerId, gameweek, JSON.stringify(state)],
  );
};

const revertFreeHit = async (
  client: PoolClient,
  managerId: string,
  gameweek: number,
): Promise<void> => {
  const stored = await query<{ state: FreeHitState }>(
    client,
    'select state from free_hit_states where manager_id = $1 and gameweek = $2',
    [managerId, gameweek],
  );
  const state = stored[0]?.state;
  if (state === undefined) return;

  const entries = await query<{ id: string; amount_tenths: number; player_id: string | null }>(
    client,
    `select l.id, l.amount_tenths, l.player_id
       from ledger_entries l join transfers t on t.id = l.transfer_id
      where l.manager_id = $1 and t.gameweek = $2 and t.free_hit = true
      order by l.seq`,
    [managerId, gameweek],
  );
  for (const entry of entries) {
    await client.query(
      `insert into ledger_entries
         (manager_id, kind, amount_tenths, player_id, reverses, gameweek)
       values ($1, 'reversal', $2, $3, $4, $5)`,
      [managerId, -entry.amount_tenths, entry.player_id, entry.id, gameweek],
    );
  }

  await client.query('delete from squad_players where manager_id = $1', [managerId]);
  for (const player of state.players) {
    await client.query(
      `insert into squad_players
         (manager_id, player_id, purchase_price_tenths, slot, bench_order)
       values ($1, $2, $3, 'bench', null)`,
      [managerId, player.player_id, player.purchase_price_tenths],
    );
  }
  await writeLineup(client, managerId, {
    starting: state.starting,
    bench: state.bench,
    captain: state.captain,
    vice_captain: state.vice_captain,
  });
  await client.query('update squads set bank_tenths = $2 where manager_id = $1', [
    managerId,
    state.bank_tenths,
  ]);
};

export const closeGameweek = async (
  number: number,
): Promise<{ number: number; status: 'closed'; next_gameweek: number | null }> => {
  const result = await withAdvisoryLock(`close-gameweek-${number}`, () =>
    transaction(async (client) => {
      const marked = await query<{ number: number }>(
        client,
        `update gameweeks set status = 'closed', closed_at = now()
          where number = $1 and status = 'live' returning number`,
        [number],
      );
      if (marked.length === 0) {
        throw conflict('gameweek_not_live', `Gameweek ${number} is not live.`);
      }

      const players = await playerMap();
      const events = await query<ScoredEvent & { player_id: string }>(
        client,
        `select player_id, fixture_id, type, value, voided from match_events where gameweek = $1`,
        [number],
      );
      const byPlayer = new Map<string, ScoredEvent[]>();
      for (const event of events) {
        const list = byPlayer.get(event.player_id) ?? [];
        list.push(event);
        byPlayer.set(event.player_id, list);
      }
      const rawFor = (playerId: string): number => {
        const position = players.get(playerId)?.position;
        const list = byPlayer.get(playerId);
        return position === undefined || list === undefined ? 0 : rawPoints(list, position);
      };
      const played = (playerId: string): boolean =>
        (byPlayer.get(playerId) ?? []).some(
          (event) => !event.voided && event.type === 'minutes' && (event.value ?? 0) >= 1,
        );
      const positionOf = (playerId: string): Position => players.get(playerId)!.position;

      const teams = await query<LockedTeamRow>(
        client,
        `select manager_id, starting, bench, captain, vice_captain, chip
           from locked_teams where gameweek = $1 order by manager_id`,
        [number],
      );

      for (const team of teams) {
        const outcome = applyAutoSubs({
          starting: team.starting,
          bench: team.bench,
          captain: team.captain,
          vice_captain: team.vice_captain,
          chip: team.chip,
          positionOf,
          played,
        });

        const scoring =
          team.chip === 'bench_boost' ? [...team.starting, ...team.bench] : outcome.starting;
        let points = scoring.reduce((total, playerId) => total + rawFor(playerId), 0);
        if (outcome.captain !== null && scoring.includes(outcome.captain)) {
          const multiplier = teamMultiplier({
            slot: 'starting',
            captain: true,
            chip: team.chip,
          });
          points += rawFor(outcome.captain) * (multiplier - 1);
        }

        const counts = await query<{
          free_transfers_at_start: number;
          transfers_counted: number;
        }>(
          client,
          `select free_transfers_at_start, transfers_counted from manager_gameweeks
            where manager_id = $1 and gameweek = $2`,
          [team.manager_id, number],
        );
        const hit = gameweekHitPoints(
          counts[0]?.free_transfers_at_start ?? 0,
          counts[0]?.transfers_counted ?? 0,
        );
        const net = points - hit;
        const previous = await query<{ running_total: number }>(
          client,
          `select running_total from gameweek_scores
            where manager_id = $1 and gameweek < $2 order by gameweek desc limit 1`,
          [team.manager_id, number],
        );
        const transfersMade = await query<{ count: string }>(
          client,
          'select count(*)::text as count from transfers where manager_id = $1 and gameweek = $2',
          [team.manager_id, number],
        );

        await client.query(
          `insert into gameweek_scores
             (manager_id, gameweek, points, hit_points, net_points, running_total,
              chip, captain, vice_captain, transfers_made)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           on conflict (manager_id, gameweek) do nothing`,
          [
            team.manager_id,
            number,
            points,
            hit,
            net,
            (previous[0]?.running_total ?? 0) + net,
            team.chip,
            team.captain,
            team.vice_captain,
            Number(transfersMade[0]!.count),
          ],
        );

        for (const sub of outcome.subs) {
          await queueNotice(client, {
            managerId: team.manager_id,
            kind: 'auto_sub',
            gameweek: number,
            message: noticeMessage.autoSub(
              players.get(sub.in)!.name,
              players.get(sub.out)!.name,
              number,
            ),
            dedupeKey: `auto_sub:${number}:${team.manager_id}:${sub.in}`,
          });
        }
        if (outcome.captainFellBack) {
          await queueNotice(client, {
            managerId: team.manager_id,
            kind: 'auto_sub',
            gameweek: number,
            message: noticeMessage.captainFallback(
              players.get(team.vice_captain)!.name,
              number,
            ),
            dedupeKey: `captain_fallback:${number}:${team.manager_id}`,
          });
        }

        if (team.chip === 'free_hit') {
          await revertFreeHit(client, team.manager_id, number);
        }
      }

      const standings = await query<{
        league_id: string;
        manager_id: string;
        team_name: string;
        season_total: string;
      }>(
        client,
        `select lm.league_id, lm.manager_id, m.team_name,
                coalesce(sum(gs.net_points), 0)::text as season_total
           from league_members lm
           join managers m on m.id = lm.manager_id
           left join gameweek_scores gs on gs.manager_id = lm.manager_id
          group by lm.league_id, lm.manager_id, m.team_name`,
      );
      const byLeague = new Map<string, typeof standings>();
      for (const entry of standings) {
        const list = byLeague.get(entry.league_id) ?? [];
        list.push(entry);
        byLeague.set(entry.league_id, list);
      }
      for (const [leagueId, members] of byLeague) {
        const ordered = standingsOrder(
          members.map((member) => ({
            manager_id: member.manager_id,
            team_name: member.team_name,
            season_total: Number(member.season_total),
          })),
        );
        for (const [index, member] of ordered.entries()) {
          await client.query(
            `insert into league_ranks (league_id, manager_id, gameweek, rank)
             values ($1, $2, $3, $4)
             on conflict (league_id, manager_id, gameweek) do update set rank = $4`,
            [leagueId, member.manager_id, number, index + 1],
          );
        }
      }

      const next = number < TOTAL_GAMEWEEKS ? number + 1 : null;
      if (next !== null) {
        await client.query(
          `update gameweeks set status = 'open' where number = $1 and status = 'upcoming'`,
          [next],
        );
      }
      return { number, status: 'closed' as const, next_gameweek: next };
    }),
  );

  broadcast({ type: 'gameweek', gameweek: await currentGameweekView() });
  broadcast({ type: 'squad' });
  broadcast({ type: 'standings' });
  return result;
};

export const startGameweek = async (
  number: number,
): Promise<{ number: number; status: 'live' }> => {
  const started = await query<{ number: number }>(
    pool,
    `update gameweeks set status = 'live' where number = $1 and status = 'locked' returning number`,
    [number],
  );
  if (started.length === 0) {
    throw conflict('gameweek_not_locked', `Gameweek ${number} is not locked.`);
  }
  broadcast({ type: 'gameweek', gameweek: await currentGameweekView() });
  return { number, status: 'live' };
};
