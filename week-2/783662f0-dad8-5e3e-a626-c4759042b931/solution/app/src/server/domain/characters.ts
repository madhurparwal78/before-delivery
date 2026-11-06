import type { PoolClient } from 'pg';
import { one } from '../db/pool.js';
import { fail } from '../errors.js';
import { etagOf } from '../http/conditional.js';
import type { Appearance, ItemKind } from '../../shared/domain.js';
import type { CharacterObject } from '../../shared/types.js';
import { walletOf } from './ledger.js';

interface CharacterRow {
  id: string;
  server_id: string;
  user_id: string;
  world_id: string;
  name: string;
  appearance: Appearance;
  loadout: ItemKind[];
  x: number;
  y: number;
  revision: string;
  created_at: Date;
}

/** A character of another server answers the same 404 as an unknown id. */
export async function requireCharacterOnServer(
  serverId: string,
  id: string,
): Promise<CharacterRow> {
  const row = await one<CharacterRow>(
    'SELECT * FROM characters WHERE id = $1 AND server_id = $2',
    [id, serverId],
  );
  if (row === null) throw fail('not_found');
  return row;
}

/** A character_id in a body must name one of the session user's characters. */
export async function requireOwnCharacter(
  serverId: string,
  id: string,
  userId: string,
): Promise<CharacterRow> {
  const row = await requireCharacterOnServer(serverId, id);
  if (row.user_id !== userId) throw fail('not_your_character');
  return row;
}

export const characterEtag = (character: CharacterRow): string =>
  etagOf('character', character.id, character.revision);


export async function characterObject(
  character: CharacterRow,
  client?: PoolClient,
): Promise<CharacterObject> {
  const owner = await (client === undefined
    ? one<{ handle: string }>('SELECT handle FROM users WHERE id = $1', [character.user_id])
    : client
        .query<{ handle: string }>('SELECT handle FROM users WHERE id = $1', [character.user_id])
        .then((result) => result.rows[0] ?? null));
  const world = await (client === undefined
    ? one<{ slug: string }>('SELECT slug FROM worlds WHERE id = $1', [character.world_id])
    : client
        .query<{ slug: string }>('SELECT slug FROM worlds WHERE id = $1', [character.world_id])
        .then((result) => result.rows[0] ?? null));
  const wallet = await walletOf(character.id, client);
  return {
    id: character.id,
    name: character.name,
    owner: owner?.handle ?? '',
    world: world?.slug ?? '',
    x: character.x,
    y: character.y,
    appearance: character.appearance,
    loadout: character.loadout,
    balance: wallet.balance,
    available: wallet.available,
  };
}

