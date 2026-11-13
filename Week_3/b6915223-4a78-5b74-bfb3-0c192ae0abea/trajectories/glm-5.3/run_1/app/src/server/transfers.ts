import * as pg from 'pg';
import { ApiError, rulesBrokenError, validationError } from './errors';
import {
  checkSquadRules,
  pairsOf,
  hitPointsFor,
  freeTransfersUsedFor,
  sellingPriceTenths,
  type SquadPlayerState,
} from './rules';
import type { TransferPreview } from '../shared/views';
import { fetchActiveChip } from './store';

export interface PreviewInput {
  managerId: string;
  gameweek: number;
  out: string[];
  into: string[];
}

export interface PreviewContext {
  bankTenths: number;
  freeTransfers: number;
  squad: SquadPlayerState[];
  activeChip: string | null;
  knownIds: Set<string>;
  allowShortIn: boolean;
}

export async function loadPreviewContext(
  client: pg.PoolClient,
  managerId: string,
  gameweek: number,
  allowShortIn: boolean,
): Promise<PreviewContext> {
  const meta = await client.query<{ bank_tenths: number; free_transfers: number }>(
    'SELECT bank_tenths, free_transfers FROM squad_meta WHERE manager_id = $1',
    [managerId],
  );
  if (meta.rows.length === 0) throw new ApiError(404, 'no_squad', 'Create your squad first.');
  const squadRows = await client.query<{ player_id: string; purchase_price_tenths: number; club: string; position: string; price_tenths: number }>(
    `SELECT sp.player_id, sp.purchase_price_tenths, p.club, p.position, p.price_tenths
       FROM squad_players sp JOIN players p ON p.id = sp.player_id
      WHERE sp.manager_id = $1`,
    [managerId],
  );
  const known = await client.query<{ id: string }>('SELECT id FROM players');
  const chip = await fetchActiveChip(client, managerId, gameweek);
  const squad: SquadPlayerState[] = squadRows.rows.map((row) => ({
    id: row.player_id,
    club: row.club,
    position: row.position as SquadPlayerState['position'],
    purchase_price_tenths: row.purchase_price_tenths,
    price_tenths: row.price_tenths,
  }));
  return {
    bankTenths: meta.rows[0].bank_tenths,
    freeTransfers: meta.rows[0].free_transfers,
    squad,
    activeChip: chip,
    knownIds: new Set(known.rows.map((row) => row.id)),
    allowShortIn,
  };
}

export function validateIds(
  input: { out: string[]; into: string[] },
  context: PreviewContext,
  requireEqualLength: boolean,
): { ownedSet: Set<string>; catalogue: Map<string, SquadPlayerState> } {
  const ownedSet = new Set(context.squad.map((player) => player.id));
  const catalogue = new Map(context.squad.map((player) => [player.id, player]));
  const fields: Record<string, string> = {};
  for (const id of input.out) {
    if (!context.knownIds.has(id)) fields.out = 'Unknown player id.';
    else if (!ownedSet.has(id)) fields.out = 'That player is not in your squad.';
  }
  for (const id of input.into) {
    if (!context.knownIds.has(id)) fields.in = 'Unknown player id.';
    else if (ownedSet.has(id) && !input.out.includes(id)) fields.in = 'That player is already in your squad.';
  }
  if (requireEqualLength && input.out.length !== input.into.length) {
    fields.in = 'Send the same number of players out and in.';
  }
  const outDuplicates = new Set(input.out.filter((id, index) => input.out.indexOf(id) !== index));
  const inDuplicates = new Set(input.into.filter((id, index) => input.into.indexOf(id) !== index));
  if (outDuplicates.size > 0) fields.out = 'A player appears more than once.';
  if (inDuplicates.size > 0) fields.in = 'A player appears more than once.';
  if (Object.keys(fields).length > 0) throw validationError(fields);
  return { ownedSet, catalogue };
}

export function buildPreview(
  input: { out: string[]; into: string[] },
  context: PreviewContext,
  catalogue: Map<string, { id: string; position: SquadPlayerState['position']; club: string; price_tenths: number }>,
): { preview: TransferPreview; pairs: { out: string; in: string }[] } {
  const pairs = pairsOf(input.out, input.into);
  const count = pairs.length;
  const chipFree = context.activeChip === 'wildcard' || context.activeChip === 'free_hit';
  const freeUsed = chipFree ? 0 : Math.min(count, context.freeTransfers);
  const hit = hitPointsFor(count, chipFree ? 0 : context.freeTransfers, context.activeChip as 'wildcard' | 'free_hit' | null);

  const remaining = context.squad.filter((player) => !input.out.includes(player.id));
  const incoming = pairs.map((pair) => {
    const info = catalogue.get(pair.in);
    return {
      id: pair.in,
      club: info?.club ?? '',
      position: (info?.position ?? 'GK') as SquadPlayerState['position'],
      purchase_price_tenths: info?.price_tenths ?? 0,
      price_tenths: info?.price_tenths ?? 0,
    };
  });
  const resulting = [...remaining, ...incoming];

  const moneyAvailable = context.bankTenths + input.out.reduce((sum, id) => {
    const owned = context.squad.find((player) => player.id === id);
    return sum + (owned !== undefined ? sellingPriceTenths(owned.purchase_price_tenths, owned.price_tenths) : 0);
  }, 0);

  const rules = checkSquadRules({
    players: resulting,
    moneyAvailableTenths: moneyAvailable,
    costTenths: incoming.reduce((sum, player) => sum + player.price_tenths, 0),
    positionMatchPairs: pairs.map((pair) => ({
      out: context.squad.find((player) => player.id === pair.out)?.position ?? 'GK',
      in: incoming.find((player) => player.id === pair.in)?.position ?? 'GK',
    })),
  });

  const bankAfter =
    context.bankTenths +
    pairs.reduce((sum, pair) => {
      const outOwned = context.squad.find((player) => player.id === pair.out);
      const sell = outOwned !== undefined ? sellingPriceTenths(outOwned.purchase_price_tenths, outOwned.price_tenths) : 0;
      const buy = catalogue.get(pair.in)?.price_tenths ?? 0;
      return sum + sell - buy;
    }, 0);

  return {
    preview: {
      count,
      free_transfers_used: freeUsed,
      hit_points: hit,
      bank_after_tenths: bankAfter,
      rules: rules.map((rule) => ({ code: rule.code, message: rule.message })),
    },
    pairs,
  };
}

export function previewForMarkedOnly(out: string[], context: PreviewContext): TransferPreview {
  const preview = buildPreview({ out, into: [] }, context, new Map());
  return preview.preview;
}
