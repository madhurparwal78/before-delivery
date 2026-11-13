import type { PoolClient } from 'pg';
import { one, pool, query, transaction, type Queryable } from '../db.ts';
import type {
  ChipCode,
  Position,
  SquadView,
  SquadViewPlayer,
} from '../../shared/types.ts';
import { BUDGET_TENTHS, sellingPriceTenths } from '../../shared/money.ts';
import { checkSquadRules } from '../domain/squadRules.ts';
import {
  checkLineupRules,
  defaultLineup,
  inheritArmbands,
  resolveArmbandChange,
  toElevenOrder,
  type Lineup,
} from '../domain/lineup.ts';
import { chipStates, type PlayedChip } from '../domain/chips.ts';
import { freeTransfersLeft, gameweekHitPoints } from '../domain/hits.ts';
import { teamMultiplier } from '../domain/scoring.ts';
import { CLUB_CODES, CLUB_NAMES, playerMap, rawPointsByPlayer } from './catalogue.ts';
import { currentGameweek, effectiveStatus } from './gameweeks.ts';
import { conflict, notFound, rulesBroken, validation } from '../http/errors.ts';

export interface SquadPlayerRecord {
  player_id: string;
  purchase_price_tenths: number;
  slot: 'starting' | 'bench';
  starting_index: number | null;
  bench_order: number | null;
  captain: boolean;
  vice_captain: boolean;
  name: string;
  club: string;
  position: Position;
  price_tenths: number;
}

const SQUAD_SELECT = `
  select sp.player_id, sp.purchase_price_tenths, sp.slot, sp.starting_index, sp.bench_order,
         sp.captain, sp.vice_captain, p.name, p.club, p.position, p.price_tenths
    from squad_players sp join players p on p.id = sp.player_id
   where sp.manager_id = $1
   order by (sp.slot = 'bench'), sp.starting_index nulls last, sp.bench_order nulls last`;

export const loadSquad = (on: Queryable, managerId: string): Promise<SquadPlayerRecord[]> =>
  query<SquadPlayerRecord>(on, SQUAD_SELECT, [managerId]);

export const bankTenths = async (on: Queryable, managerId: string): Promise<number | null> => {
  const squad = await one<{ bank_tenths: number }>(
    on,
    'select bank_tenths from squads where manager_id = $1',
    [managerId],
  );
  return squad === undefined ? null : squad.bank_tenths;
};

export const playedChips = (on: Queryable, managerId: string): Promise<PlayedChip[]> =>
  query<PlayedChip>(
    on,
    'select gameweek, chip from chips_played where manager_id = $1 order by gameweek',
    [managerId],
  );

export interface ManagerGameweek {
  free_transfers_at_start: number;
  transfers_counted: number;
}

export const managerGameweek = async (
  on: Queryable,
  managerId: string,
  gameweek: number,
): Promise<ManagerGameweek> => {
  const record = await one<ManagerGameweek>(
    on,
    `select free_transfers_at_start, transfers_counted
       from manager_gameweeks where manager_id = $1 and gameweek = $2`,
    [managerId, gameweek],
  );
  return record ?? { free_transfers_at_start: 0, transfers_counted: 0 };
};

/** Free transfers follow the latest gameweek reached, so a deadline's addition shows at once. */
export const latestManagerGameweek = async (
  on: Queryable,
  managerId: string,
): Promise<ManagerGameweek> =>
  (await one<ManagerGameweek>(
    on,
    `select free_transfers_at_start, transfers_counted
       from manager_gameweeks where manager_id = $1 order by gameweek desc limit 1`,
    [managerId],
  )) ?? { free_transfers_at_start: 0, transfers_counted: 0 };

export const transfersMadeIn = async (
  on: Queryable,
  managerId: string,
  gameweek: number,
): Promise<number> => {
  const record = await one<{ count: string }>(
    on,
    'select count(*)::text as count from transfers where manager_id = $1 and gameweek = $2',
    [managerId, gameweek],
  );
  return Number(record?.count ?? '0');
};

export const lineupOf = (rows: SquadPlayerRecord[]): Lineup => ({
  starting: rows.filter((entry) => entry.slot === 'starting').map((entry) => entry.player_id),
  bench: rows.filter((entry) => entry.slot === 'bench').map((entry) => entry.player_id),
  captain: rows.find((entry) => entry.captain)!.player_id,
  vice_captain: rows.find((entry) => entry.vice_captain)!.player_id,
});

export const squadView = async (managerId: string): Promise<SquadView> => {
  const gameweek = await currentGameweek();
  const status = effectiveStatus(gameweek, new Date());
  const bank = await bankTenths(pool, managerId);
  if (bank === null) throw notFound('no_squad', 'You have no squad yet.');

  const rows = await loadSquad(pool, managerId);
  const played = await playedChips(pool, managerId);
  const chip = played.find((entry) => entry.gameweek === gameweek.number)?.chip ?? null;
  const counts = await managerGameweek(pool, managerId, gameweek.number);
  const latest = await latestManagerGameweek(pool, managerId);
  const hit = gameweekHitPoints(counts.free_transfers_at_start, counts.transfers_counted);
  const raw = await rawPointsByPlayer([gameweek.number], await playerMap());

  const players: SquadViewPlayer[] = rows.map((entry) => {
    const rawPoints = raw.get(entry.player_id) ?? 0;
    return {
      id: entry.player_id,
      name: entry.name,
      club: entry.club,
      position: entry.position,
      purchase_price_tenths: entry.purchase_price_tenths,
      price_tenths: entry.price_tenths,
      selling_price_tenths: sellingPriceTenths(
        entry.purchase_price_tenths,
        entry.price_tenths,
      ),
      slot: entry.slot,
      bench_order: entry.bench_order,
      captain: entry.captain,
      vice_captain: entry.vice_captain,
      raw_points: rawPoints,
      team_points:
        rawPoints * teamMultiplier({ slot: entry.slot, captain: entry.captain, chip }),
    };
  });

  const teamPoints = players.reduce((total, player) => total + player.team_points, 0);
  return {
    gameweek: gameweek.number,
    gameweek_status: status,
    editable: status === 'open',
    players,
    bank_tenths: bank,
    squad_value_tenths: players.reduce(
      (total, player) => total + player.selling_price_tenths,
      0,
    ),
    free_transfers: freeTransfersLeft(latest.free_transfers_at_start, latest.transfers_counted),
    transfers_made: await transfersMadeIn(pool, managerId, gameweek.number),
    hit_points: hit,
    chip,
    chips: chipStates(gameweek.number, played),
    gameweek_total: teamPoints - hit,
  };
};

export const writeLineup = async (
  client: PoolClient,
  managerId: string,
  lineup: Lineup,
): Promise<void> => {
  await client.query(
    `update squad_players
        set slot = 'bench', starting_index = null, bench_order = null,
            captain = false, vice_captain = false
      where manager_id = $1`,
    [managerId],
  );
  for (const [index, playerId] of lineup.starting.entries()) {
    await client.query(
      `update squad_players
          set slot = 'starting', starting_index = $3, bench_order = null,
              captain = $4, vice_captain = $5
        where manager_id = $1 and player_id = $2`,
      [
        managerId,
        playerId,
        index,
        playerId === lineup.captain,
        playerId === lineup.vice_captain,
      ],
    );
  }
  for (const [index, playerId] of lineup.bench.entries()) {
    await client.query(
      `update squad_players
          set slot = 'bench', starting_index = null, bench_order = $3
        where manager_id = $1 and player_id = $2`,
      [managerId, playerId, index + 1],
    );
  }
};

export const createSquad = async (
  managerId: string,
  requested: unknown,
): Promise<SquadView> => {
  if (!Array.isArray(requested) || requested.some((id) => typeof id !== 'string')) {
    throw validation({ players: 'Send a list of player ids.' });
  }
  const ids = requested as string[];
  const gameweek = await currentGameweek();

  if ((await bankTenths(pool, managerId)) !== null) {
    throw conflict('squad_exists', 'You already have a squad.');
  }

  const players = await playerMap();
  const unknown = ids.filter((id) => !players.has(id));
  if (unknown.length > 0) {
    throw validation({ players: `Unknown player ids: ${[...new Set(unknown)].join(', ')}.` });
  }

  const cost = ids.reduce((total, id) => total + players.get(id)!.price_tenths, 0);
  const broken = checkSquadRules({
    ids,
    players,
    clubNames: CLUB_NAMES,
    clubOrder: CLUB_CODES,
    overBudget: cost > BUDGET_TENTHS,
    positionMismatch: false,
  });
  if (broken.length > 0) throw rulesBroken(broken);

  const squad = ids.map((id) => players.get(id)!);
  const lineup = defaultLineup(squad);

  await transaction(async (client) => {
    await client.query('insert into squads (manager_id, bank_tenths) values ($1, $2)', [
      managerId,
      BUDGET_TENTHS - cost,
    ]);
    await client.query(
      `insert into manager_gameweeks (manager_id, gameweek, free_transfers_at_start)
       values ($1, $2, 1)
       on conflict (manager_id, gameweek) do nothing`,
      [managerId, gameweek.number],
    );
    for (const player of squad) {
      await client.query(
        `insert into squad_players
           (manager_id, player_id, purchase_price_tenths, slot, bench_order)
         values ($1, $2, $3, 'bench', null)`,
        [managerId, player.id, player.price_tenths],
      );
    }
    await client.query(
      `insert into ledger_entries (manager_id, kind, amount_tenths, gameweek)
       values ($1, 'opening_budget', $2, $3)`,
      [managerId, BUDGET_TENTHS, gameweek.number],
    );
    for (const player of squad) {
      await client.query(
        `insert into ledger_entries (manager_id, kind, amount_tenths, player_id, gameweek)
         values ($1, 'purchase', $2, $3, $4)`,
        [managerId, -player.price_tenths, player.id, gameweek.number],
      );
    }
    await writeLineup(client, managerId, lineup);
  });

  return squadView(managerId);
};

export interface PicksBody {
  starting: string[];
  bench: string[];
  captain: string;
  vice_captain: string;
}

export const savePicks = async (managerId: string, body: PicksBody): Promise<SquadView> => {
  const rows = await loadSquad(pool, managerId);
  if (rows.length === 0) throw notFound('no_squad', 'You have no squad yet.');

  const squadIds = new Set(rows.map((entry) => entry.player_id));
  const submitted = [...body.starting, ...body.bench];
  const unique = new Set(submitted);
  if (
    body.starting.length !== 11 ||
    body.bench.length !== 4 ||
    unique.size !== squadIds.size ||
    [...unique].some((id) => !squadIds.has(id))
  ) {
    throw validation({ starting: 'Send your eleven and bench as exactly your 15 squad players.' });
  }

  const positionOf = (playerId: string): Position =>
    rows.find((entry) => entry.player_id === playerId)!.position;
  const previous = lineupOf(rows);
  const chosen = resolveArmbandChange(previous, {
    captain: body.captain,
    vice_captain: body.vice_captain,
  });
  const armbands = inheritArmbands(previous.starting, body.starting, chosen);
  const lineup: Lineup = {
    starting: toElevenOrder(body.starting, positionOf),
    bench: body.bench,
    captain: armbands.captain,
    vice_captain: armbands.vice_captain,
  };

  const broken = checkLineupRules(lineup, positionOf);
  if (broken.length > 0) throw rulesBroken(broken);

  await transaction((client) => writeLineup(client, managerId, lineup));
  return squadView(managerId);
};

export const chipFor = async (
  on: Queryable,
  managerId: string,
  gameweek: number,
): Promise<ChipCode | null> => {
  const record = await one<{ chip: ChipCode }>(
    on,
    'select chip from chips_played where manager_id = $1 and gameweek = $2',
    [managerId, gameweek],
  );
  return record?.chip ?? null;
};
