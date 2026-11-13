import { pool, query, transaction } from '../db.ts';
import type { ChipCode, SquadView } from '../../shared/types.ts';
import { CHIP_NAMES, chipRefusalCopy } from '../../shared/copy.ts';
import { CANCELLABLE_CHIPS, chipRefusalCode } from '../domain/chips.ts';
import { bankTenths, playedChips, squadView, transfersMadeIn } from './squad.ts';
import { captureFreeHitState } from './close.ts';
import { conflict, notFound, validation } from '../http/errors.ts';

export const CHIP_CODES: ChipCode[] = [
  'wildcard',
  'free_hit',
  'bench_boost',
  'triple_captain',
];

export const parseChip = (value: unknown): ChipCode => {
  const chip = CHIP_CODES.find((candidate) => candidate === value);
  if (chip === undefined) throw validation({ chip: 'Choose a chip.' });
  return chip;
};

export const playChip = async (
  managerId: string,
  gameweek: number,
  chip: ChipCode,
): Promise<SquadView> => {
  if ((await bankTenths(pool, managerId)) === null) {
    throw notFound('no_squad', 'You have no squad yet.');
  }
  const code = chipRefusalCode({
    gameweek,
    chip,
    played: await playedChips(pool, managerId),
    transfersMadeThisGameweek: await transfersMadeIn(pool, managerId, gameweek),
  });
  if (code !== null) throw conflict(code, chipRefusalCopy(code, chip));

  await transaction(async (client) => {
    await client.query(
      'insert into chips_played (manager_id, gameweek, chip) values ($1, $2, $3)',
      [managerId, gameweek, chip],
    );
    if (chip === 'free_hit') await captureFreeHitState(client, managerId, gameweek);
  });
  return squadView(managerId);
};

export const cancelChip = async (
  managerId: string,
  gameweek: number,
): Promise<SquadView> => {
  const played = await query<{ chip: ChipCode }>(
    pool,
    'select chip from chips_played where manager_id = $1 and gameweek = $2',
    [managerId, gameweek],
  );
  const chip = played[0]?.chip;
  if (chip === undefined) throw notFound('not_found', 'No chip is played for that gameweek.');
  if (!CANCELLABLE_CHIPS.includes(chip)) {
    throw conflict('chip_locked_in', `${CHIP_NAMES[chip]} cannot be cancelled once played.`);
  }
  await query(pool, 'delete from chips_played where manager_id = $1 and gameweek = $2', [
    managerId,
    gameweek,
  ]);
  return squadView(managerId);
};
