import type { PoolClient } from 'pg';
import { one, pool, query, transaction, type Queryable } from '../db.ts';
import type {
  ApiErrorBody,
  DraftState,
  DraftView,
  Position,
  TransferPreview,
  TransfersResult,
} from '../../shared/types.ts';
import { sellingPriceTenths } from '../../shared/money.ts';
import { checkSquadRules } from '../domain/squadRules.ts';
import { inheritArmbands, toElevenOrder, type Lineup } from '../domain/lineup.ts';
import { chipMakesTransfersFree } from '../domain/chips.ts';
import { freeTransfersLeft, gameweekHitPoints, hitForBatch } from '../domain/hits.ts';
import { CLUB_CODES, CLUB_NAMES, playerMap, type PlayerRecord } from './catalogue.ts';
import {
  bankTenths,
  chipFor,
  lineupOf,
  loadSquad,
  managerGameweek,
  writeLineup,
  type SquadPlayerRecord,
} from './squad.ts';
import { apiError, notFound, rulesBroken, validation } from '../http/errors.ts';

export interface TransferBatch {
  out: string[];
  in: string[];
}

export const parseBatch = (out: unknown, incoming: unknown): TransferBatch => {
  const isIdList = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every((id) => typeof id === 'string');
  if (!isIdList(out) || !isIdList(incoming)) {
    throw validation({ out: 'Send lists of player ids.' });
  }
  return { out, in: incoming };
};

interface PreviewContext {
  squad: SquadPlayerRecord[];
  players: Map<string, PlayerRecord>;
  bank: number;
  pairs: { out: SquadPlayerRecord; in: PlayerRecord }[];
}

const validateBatch = async (
  managerId: string,
  batch: TransferBatch,
  requirePairs: boolean,
): Promise<PreviewContext> => {
  const squad = await loadSquad(pool, managerId);
  if (squad.length === 0) throw notFound('no_squad', 'You have no squad yet.');
  const bank = (await bankTenths(pool, managerId))!;
  const players = await playerMap();

  const fields: Record<string, string> = {};
  const owned = new Map(squad.map((entry) => [entry.player_id, entry]));
  const unknown = [...batch.out, ...batch.in].filter((id) => !players.has(id));
  if (unknown.length > 0) fields.out = `Unknown player ids: ${[...new Set(unknown)].join(', ')}.`;
  const notOwned = batch.out.filter((id) => players.has(id) && !owned.has(id));
  if (notOwned.length > 0) fields.out = `You do not own ${notOwned.join(', ')}.`;
  const alreadyOwned = batch.in.filter((id) => owned.has(id));
  if (alreadyOwned.length > 0) fields.in = `You already own ${alreadyOwned.join(', ')}.`;
  if (batch.in.length > batch.out.length) {
    fields.in = 'Mark a player to sell for each player coming in.';
  }
  if (requirePairs) {
    if (batch.in.length !== batch.out.length) {
      fields.in = 'Mark a player to sell for each player coming in.';
    }
    if (new Set(batch.out).size !== batch.out.length) {
      fields.out = 'Each player may be sold once.';
    }
    if (new Set(batch.in).size !== batch.in.length) {
      fields.in = 'Each player may be brought in once.';
    }
  }
  if (Object.keys(fields).length > 0) throw validation(fields);

  const pairs = batch.in.map((inId, index) => ({
    out: owned.get(batch.out[index]!)!,
    in: players.get(inId)!,
  }));
  return { squad, players, bank, pairs };
};

const buildPreview = async (
  managerId: string,
  gameweek: number,
  batch: TransferBatch,
  context: PreviewContext,
): Promise<TransferPreview> => {
  const { squad, players, bank, pairs } = context;
  const replaced = new Map(pairs.map((pair) => [pair.out.player_id, pair.in.id]));
  const resultingIds = squad.map((entry) => replaced.get(entry.player_id) ?? entry.player_id);

  const sellingOf = (entry: SquadPlayerRecord): number =>
    sellingPriceTenths(entry.purchase_price_tenths, entry.price_tenths);
  const owned = new Map(squad.map((entry) => [entry.player_id, entry]));

  const pairedCredit = pairs.reduce((total, pair) => total + sellingOf(pair.out), 0);
  const pairedDebit = pairs.reduce((total, pair) => total + pair.in.price_tenths, 0);
  const allCredit = batch.out.reduce(
    (total, id) => total + sellingOf(owned.get(id)!),
    0,
  );
  const allDebit = batch.in.reduce((total, id) => total + players.get(id)!.price_tenths, 0);

  const chip = await chipFor(pool, managerId, gameweek);
  const counts = await managerGameweek(pool, managerId, gameweek);
  const outcome = hitForBatch({
    freeTransfersAtStart: counts.free_transfers_at_start,
    transfersCounted: counts.transfers_counted,
    count: pairs.length,
    chipMakesFree: chipMakesTransfersFree(chip),
  });

  const rules = checkSquadRules({
    ids: resultingIds,
    players,
    clubNames: CLUB_NAMES,
    clubOrder: CLUB_CODES,
    overBudget: bank + pairedCredit - pairedDebit < 0,
    positionMismatch: pairs.some((pair) => pair.out.position !== pair.in.position),
  });

  return {
    count: pairs.length,
    free_transfers_used: outcome.freeTransfersUsed,
    hit_points: outcome.hitPoints,
    bank_after_tenths: bank + allCredit - allDebit,
    rules,
  };
};

export const previewTransfers = async (
  managerId: string,
  gameweek: number,
  batch: TransferBatch,
): Promise<TransferPreview> =>
  buildPreview(managerId, gameweek, batch, await validateBatch(managerId, batch, false));

export const confirmTransfers = async (
  managerId: string,
  gameweek: number,
  batch: TransferBatch,
  shownHitPoints: number,
): Promise<TransfersResult> => {
  const context = await validateBatch(managerId, batch, true);
  const preview = await buildPreview(managerId, gameweek, batch, context);
  if (preview.rules.length > 0) throw rulesBroken(preview.rules);
  if (preview.hit_points !== shownHitPoints) {
    throw apiError(409, 'hit_changed', `The hit is now ${preview.hit_points} points.`, {
      hit_points: preview.hit_points,
    });
  }

  const chip = await chipFor(pool, managerId, gameweek);
  const free = chipMakesTransfersFree(chip);
  const previous = lineupOf(context.squad);
  const replaced = new Map(context.pairs.map((pair) => [pair.out.player_id, pair.in.id]));
  const nextStarting = previous.starting.map((id) => replaced.get(id) ?? id);
  const nextBench = previous.bench.map((id) => replaced.get(id) ?? id);
  const positionOf = (playerId: string): Position => context.players.get(playerId)!.position;
  const armbands = inheritArmbands(previous.starting, nextStarting, previous);
  const lineup: Lineup = {
    starting: toElevenOrder(nextStarting, positionOf),
    bench: nextBench,
    captain: armbands.captain,
    vice_captain: armbands.vice_captain,
  };

  const confirmed = await transaction(async (client) => {
    const results: TransfersResult['transfers'] = [];
    let bank = context.bank;
    for (const pair of context.pairs) {
      const sellPrice = sellingPriceTenths(
        pair.out.purchase_price_tenths,
        pair.out.price_tenths,
      );
      const transfer = (
        await query<{ id: string }>(
          client,
          `insert into transfers
             (manager_id, gameweek, out_player, in_player, sell_price_tenths, price_tenths, free_hit)
           values ($1, $2, $3, $4, $5, $6, $7) returning id`,
          [
            managerId,
            gameweek,
            pair.out.player_id,
            pair.in.id,
            sellPrice,
            pair.in.price_tenths,
            chip === 'free_hit',
          ],
        )
      )[0]!;
      await client.query(
        `insert into ledger_entries
           (manager_id, kind, amount_tenths, player_id, transfer_id, gameweek)
         values ($1, 'sale', $2, $3, $4, $5)`,
        [managerId, sellPrice, pair.out.player_id, transfer.id, gameweek],
      );
      await client.query(
        `insert into ledger_entries
           (manager_id, kind, amount_tenths, player_id, transfer_id, gameweek)
         values ($1, 'purchase', $2, $3, $4, $5)`,
        [managerId, -pair.in.price_tenths, pair.in.id, transfer.id, gameweek],
      );
      bank += sellPrice - pair.in.price_tenths;
      results.push({
        id: transfer.id,
        out: pair.out.player_id,
        in: pair.in.id,
        sell_price_tenths: sellPrice,
        price_tenths: pair.in.price_tenths,
      });
    }

    for (const pair of context.pairs) {
      await client.query('delete from squad_players where manager_id = $1 and player_id = $2', [
        managerId,
        pair.out.player_id,
      ]);
    }
    for (const pair of context.pairs) {
      await client.query(
        `insert into squad_players
           (manager_id, player_id, purchase_price_tenths, slot, bench_order)
         values ($1, $2, $3, 'bench', null)`,
        [managerId, pair.in.id, pair.in.price_tenths],
      );
    }
    await writeLineup(client, managerId, lineup);
    await client.query('update squads set bank_tenths = $2 where manager_id = $1', [
      managerId,
      bank,
    ]);
    if (!free) {
      await client.query(
        `update manager_gameweeks set transfers_counted = transfers_counted + $3
          where manager_id = $1 and gameweek = $2`,
        [managerId, gameweek, context.pairs.length],
      );
    }
    return { results, bank };
  });

  const counts = await managerGameweek(pool, managerId, gameweek);
  return {
    transfers: confirmed.results,
    hit_points: preview.hit_points,
    gameweek_hit_points: gameweekHitPoints(
      counts.free_transfers_at_start,
      counts.transfers_counted,
    ),
    bank_tenths: confirmed.bank,
    free_transfers: freeTransfersLeft(
      counts.free_transfers_at_start,
      counts.transfers_counted,
    ),
  };
};

interface DraftRecord {
  gameweek: number;
  state: DraftState;
  out_ids: string[];
  in_ids: string[];
  refusal: ApiErrorBody | null;
}

const readDraft = async (
  on: Queryable,
  managerId: string,
  gameweek: number,
): Promise<DraftRecord> => {
  const record = await one<DraftRecord>(
    on,
    'select gameweek, state, out_ids, in_ids, refusal from drafts where manager_id = $1',
    [managerId],
  );
  if (record === undefined || record.gameweek !== gameweek) {
    return { gameweek, state: 'clean', out_ids: [], in_ids: [], refusal: null };
  }
  return record;
};

const EMPTY_PREVIEW: TransferPreview = {
  count: 0,
  free_transfers_used: 0,
  hit_points: 0,
  bank_after_tenths: 0,
  rules: [],
};

export const draftView = async (managerId: string, gameweek: number): Promise<DraftView> => {
  const record = await readDraft(pool, managerId, gameweek);
  const batch: TransferBatch = { out: record.out_ids, in: record.in_ids };
  const bank = await bankTenths(pool, managerId);
  const preview =
    bank === null
      ? { ...EMPTY_PREVIEW }
      : await previewTransfers(managerId, gameweek, batch);
  return {
    gameweek,
    state: record.state,
    out: record.out_ids,
    in: record.in_ids,
    preview,
    refusal: record.refusal,
  };
};

export const writeDraft = async (
  managerId: string,
  gameweek: number,
  state: DraftState,
  batch: TransferBatch,
  refusal: ApiErrorBody | null,
): Promise<void> => {
  await query(
    pool,
    `insert into drafts (manager_id, gameweek, state, out_ids, in_ids, refusal)
     values ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb)
     on conflict (manager_id) do update
        set gameweek = $2, state = $3, out_ids = $4::jsonb, in_ids = $5::jsonb, refusal = $6::jsonb`,
    [
      managerId,
      gameweek,
      state,
      JSON.stringify(batch.out),
      JSON.stringify(batch.in),
      refusal === null ? null : JSON.stringify(refusal),
    ],
  );
};

export const saveDraft = async (
  managerId: string,
  gameweek: number,
  batch: TransferBatch,
): Promise<DraftView> => {
  await validateBatch(managerId, batch, false);
  const empty = batch.out.length === 0 && batch.in.length === 0;
  await writeDraft(managerId, gameweek, empty ? 'clean' : 'drafting', batch, null);
  return draftView(managerId, gameweek);
};

export const clearDraft = async (managerId: string, gameweek: number): Promise<DraftView> => {
  await writeDraft(managerId, gameweek, 'clean', { out: [], in: [] }, null);
  return draftView(managerId, gameweek);
};

export const discardDraftsAtLock = async (
  client: PoolClient,
  gameweek: number,
): Promise<void> => {
  await client.query(
    `update drafts set state = 'clean', out_ids = '[]'::jsonb, in_ids = '[]'::jsonb, refusal = null
      where gameweek = $1`,
    [gameweek],
  );
};
