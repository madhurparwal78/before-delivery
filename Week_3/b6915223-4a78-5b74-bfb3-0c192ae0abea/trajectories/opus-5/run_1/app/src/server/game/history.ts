import { one, pool, query } from '../db.ts';
import type {
  ChipCode,
  GameweekStatus,
  HistoryRow,
  HistoryView,
  LedgerEntry,
  LedgerView,
  TransferHistoryRow,
} from '../../shared/types.ts';
import { sellingPriceTenths } from '../../shared/money.ts';
import { StorageUnavailable, getSnapshot, snapshotKey } from '../services/storage.ts';
import { TOTAL_GAMEWEEKS } from '../domain/seed.ts';
import { effectiveStatus, listGameweeks } from './gameweeks.ts';
import { squadView } from './squad.ts';
import { apiError, conflict, notFound } from '../http/errors.ts';
import { STORAGE_OUTAGE, RECEIPT_PENDING_DOWNLOAD } from '../../shared/copy.ts';

interface LockedRow {
  gameweek: number;
  captain: string;
  vice_captain: string;
  chip: ChipCode | null;
  receipt: 'stored' | 'pending';
}

interface ScoreRow {
  gameweek: number;
  points: number;
  hit_points: number;
  net_points: number;
  running_total: number;
  chip: ChipCode | null;
  captain: string;
  vice_captain: string;
  transfers_made: number;
}

export const historyView = async (managerId: string): Promise<HistoryView> => {
  const manager = (await one<{ team_name: string }>(
    pool,
    'select team_name from managers where id = $1',
    [managerId],
  ))!;
  const locked = await query<LockedRow>(
    pool,
    `select gameweek, captain, vice_captain, chip, receipt from locked_teams
      where manager_id = $1 order by gameweek`,
    [managerId],
  );
  const scores = await query<ScoreRow>(
    pool,
    `select gameweek, points, hit_points, net_points, running_total, chip,
            captain, vice_captain, transfers_made
       from gameweek_scores where manager_id = $1 order by gameweek`,
    [managerId],
  );
  const transferCounts = await query<{ gameweek: number; count: string }>(
    pool,
    `select gameweek, count(*)::text as count from transfers
      where manager_id = $1 group by gameweek`,
    [managerId],
  );
  const gameweeks = await listGameweeks();
  const now = new Date();
  const statusOf = (number: number): GameweekStatus =>
    effectiveStatus(gameweeks[number - 1]!, now);

  const live = gameweeks.find((gameweek) => {
    const status = effectiveStatus(gameweek, now);
    return status === 'locked' || status === 'live';
  });
  const liveView =
    live !== undefined && locked.some((entry) => entry.gameweek === live.number)
      ? await squadView(managerId)
      : null;

  const rows: HistoryRow[] = locked.map((entry) => {
    const score = scores.find((candidate) => candidate.gameweek === entry.gameweek);
    const transfersMade = Number(
      transferCounts.find((count) => count.gameweek === entry.gameweek)?.count ?? '0',
    );
    if (score !== undefined) {
      return {
        gameweek: entry.gameweek,
        status: statusOf(entry.gameweek),
        points: score.points,
        hit_points: score.hit_points,
        net_points: score.net_points,
        running_total: score.running_total,
        chip: score.chip,
        captain: score.captain,
        vice_captain: score.vice_captain,
        transfers_made: score.transfers_made,
        receipt: entry.receipt,
      };
    }
    const points = liveView === null ? 0 : liveView.gameweek_total + liveView.hit_points;
    const hit = liveView === null ? 0 : liveView.hit_points;
    return {
      gameweek: entry.gameweek,
      status: statusOf(entry.gameweek),
      points,
      hit_points: hit,
      net_points: points - hit,
      running_total: null,
      chip: entry.chip,
      captain: entry.captain,
      vice_captain: entry.vice_captain,
      transfers_made: transfersMade,
      receipt: entry.receipt,
    };
  });

  const closedTotal = scores.reduce((total, score) => total + score.net_points, 0);
  const liveNet = rows
    .filter((row) => row.running_total === null)
    .reduce((total, row) => total + row.net_points, 0);

  return {
    manager_id: managerId,
    team_name: manager.team_name,
    season_total: closedTotal + liveNet,
    rows,
  };
};

export const transferHistory = async (managerId: string): Promise<TransferHistoryRow[]> => {
  const rows = await query<{
    id: string;
    gameweek: number;
    made_at: Date;
    out_player: string;
    out_name: string;
    sell_price_tenths: number;
    in_player: string;
    in_name: string;
    price_tenths: number;
    free_hit: boolean;
  }>(
    pool,
    `select t.id, t.gameweek, t.made_at, t.out_player, po.name as out_name,
            t.sell_price_tenths, t.in_player, pi.name as in_name, t.price_tenths, t.free_hit
       from transfers t
       join players po on po.id = t.out_player
       join players pi on pi.id = t.in_player
      where t.manager_id = $1 order by t.seq`,
    [managerId],
  );
  return rows.map((row) => ({
    id: row.id,
    gameweek: row.gameweek,
    made_at: row.made_at.toISOString(),
    out: {
      player_id: row.out_player,
      name: row.out_name,
      sell_price_tenths: row.sell_price_tenths,
    },
    in: { player_id: row.in_player, name: row.in_name, price_tenths: row.price_tenths },
    free_hit: row.free_hit,
  }));
};

export const ledgerView = async (managerId: string): Promise<LedgerView> => {
  const entries = await query<Omit<LedgerEntry, 'created_at'> & { created_at: Date }>(
    pool,
    `select id, kind, amount_tenths, player_id, transfer_id, reverses, gameweek, created_at
       from ledger_entries where manager_id = $1 order by seq`,
    [managerId],
  );
  const squad = await query<{ purchase_price_tenths: number; price_tenths: number }>(
    pool,
    `select sp.purchase_price_tenths, p.price_tenths
       from squad_players sp join players p on p.id = sp.player_id
      where sp.manager_id = $1`,
    [managerId],
  );
  const bank = await one<{ bank_tenths: number }>(
    pool,
    'select bank_tenths from squads where manager_id = $1',
    [managerId],
  );
  return {
    bank_tenths: bank?.bank_tenths ?? 0,
    squad_selling_value_tenths: squad.reduce(
      (total, player) =>
        total + sellingPriceTenths(player.purchase_price_tenths, player.price_tenths),
      0,
    ),
    entries: entries.map((entry) => ({
      ...entry,
      created_at: entry.created_at.toISOString(),
    })),
  };
};

export const downloadSnapshot = async (
  managerId: string,
  gameweek: number,
): Promise<{ bytes: Buffer; filename: string }> => {
  if (!Number.isInteger(gameweek) || gameweek < 1 || gameweek > TOTAL_GAMEWEEKS) {
    throw notFound();
  }
  const locked = await one<{ receipt: string }>(
    pool,
    'select receipt from locked_teams where manager_id = $1 and gameweek = $2',
    [managerId, gameweek],
  );
  if (locked === undefined) throw notFound();
  if (locked.receipt !== 'stored') {
    throw conflict('receipt_pending', RECEIPT_PENDING_DOWNLOAD);
  }
  try {
    const bytes = await getSnapshot(snapshotKey(gameweek, managerId));
    if (bytes === null) throw apiError(503, 'storage_unavailable', STORAGE_OUTAGE);
    return {
      bytes,
      filename: `elevens-gw${String(gameweek).padStart(2, '0')}-${managerId}.json`,
    };
  } catch (error) {
    if (error instanceof StorageUnavailable) {
      throw apiError(503, 'storage_unavailable', STORAGE_OUTAGE);
    }
    throw error;
  }
};
