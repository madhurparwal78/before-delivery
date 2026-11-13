import { randomUUID } from 'node:crypto';
import { query } from '../db';
import { validDisplayName } from '../domain/names';
import { errors } from '../errors';
import { readJson, requirePlayer, sendJson, setPlayerCookie, type PlayerRecord } from '../http';
import type { RouteContext } from './context';

export async function createPlayer(
  displayName: string,
): Promise<{ id: string; display_name: string }> {
  const id = randomUUID();
  const result = await query<{ id: string; display_name: string }>(
    'insert into players (id, display_name) values ($1, $2) returning id, display_name',
    [id, displayName],
  );
  return result.rows[0];
}

export async function postPlayers({ req, res }: RouteContext): Promise<void> {
  const body = await readJson(req);
  const name = validDisplayName(body.display_name);
  const player = await createPlayer(name);
  setPlayerCookie(res, player.id);
  sendJson(res, 201, player);
}

export async function getMe({ req, res }: RouteContext): Promise<void> {
  const player = await requirePlayer(req);
  sendJson(res, 200, { id: player.id, display_name: player.display_name });
}

function settingsJson(player: PlayerRecord): Record<string, boolean> {
  return {
    skip_filled: player.skip_filled,
    jump_next_clue: player.jump_next_clue,
    autocheck: player.autocheck,
  };
}

export async function getSettings({ req, res }: RouteContext): Promise<void> {
  const player = await requirePlayer(req);
  sendJson(res, 200, settingsJson(player));
}

export async function putSettings({ req, res }: RouteContext): Promise<void> {
  const player = await requirePlayer(req);
  const body = await readJson(req);
  for (const key of ['skip_filled', 'jump_next_clue', 'autocheck'] as const) {
    if (typeof body[key] !== 'boolean') throw errors.invalid({ [key]: 'Use true or false.' });
  }
  const result = await query<PlayerRecord>(
    `update players set skip_filled = $2, jump_next_clue = $3, autocheck = $4
      where id = $1 returning id, display_name, skip_filled, jump_next_clue, autocheck`,
    [player.id, body.skip_filled, body.jump_next_clue, body.autocheck],
  );
  sendJson(res, 200, settingsJson(result.rows[0]));
}
