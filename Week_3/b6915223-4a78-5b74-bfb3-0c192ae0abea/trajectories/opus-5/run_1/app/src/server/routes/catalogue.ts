import type { Handler } from '../http/server.ts';
import type { PlayerRow, Position, SortOrder } from '../../shared/types.ts';
import { parseMillions } from '../../shared/money.ts';
import { POSITION_ORDER } from '../domain/squadRules.ts';
import {
  CLUB_CODES,
  allClubs,
  allPlayers,
  playerMap,
  rawPointsByPlayer,
  sortPlayerRows,
} from '../game/catalogue.ts';
import { currentGameweekView, effectiveStatus, listGameweeks } from '../game/gameweeks.ts';
import { validation } from '../http/errors.ts';

const SORT_ORDERS: SortOrder[] = ['price_desc', 'price_asc', 'points_desc', 'name_asc'];

export const getClubs: Handler = async () => ({
  status: 200,
  body: { clubs: await allClubs() },
});

export const getPlayers: Handler = async (context) => {
  const search = context.url.searchParams;
  const fields: Record<string, string> = {};

  const positionText = search.get('position');
  const position = POSITION_ORDER.find((candidate) => candidate === positionText) ?? null;
  if (positionText !== null && position === null) fields.position = 'Unknown position.';

  const clubText = search.get('club');
  if (clubText !== null && !CLUB_CODES.includes(clubText)) fields.club = 'Unknown club.';

  const maxPriceText = search.get('max_price');
  const maxPrice = maxPriceText === null ? null : parseMillions(maxPriceText);
  if (maxPriceText !== null && maxPrice === null) {
    fields.max_price = 'Give millions with one decimal.';
  }

  const sortText = search.get('sort');
  const sort = SORT_ORDERS.find((candidate) => candidate === sortText) ?? null;
  if (sortText !== null && sort === null) fields.sort = 'Unknown sort order.';

  if (Object.keys(fields).length > 0) throw validation(fields);

  const players = await playerMap();
  const gameweeks = await listGameweeks();
  const current = await currentGameweekView();
  const now = new Date();
  const scoring = gameweeks
    .map((gameweek) => ({ number: gameweek.number, status: effectiveStatus(gameweek, now) }))
    .filter((gameweek) => gameweek.status === 'closed' || gameweek.status === 'live')
    .map((gameweek) => gameweek.number);
  const totals = await rawPointsByPlayer(scoring, players);
  const gameweekTotals = await rawPointsByPlayer([current.number], players);

  const rows: PlayerRow[] = (await allPlayers())
    .filter((player) => position === null || player.position === (position as Position))
    .filter((player) => clubText === null || player.club === clubText)
    .filter((player) => maxPrice === null || player.price_tenths <= maxPrice)
    .map((player) => ({
      id: player.id,
      name: player.name,
      club: player.club,
      position: player.position,
      price_tenths: player.price_tenths,
      total_points: totals.get(player.id) ?? 0,
      gameweek_points: gameweekTotals.get(player.id) ?? 0,
    }));

  return { status: 200, body: { players: sortPlayerRows(rows, sort ?? 'price_desc') } };
};

export const getGameweeks: Handler = async () => {
  const gameweeks = await listGameweeks();
  const now = new Date();
  return {
    status: 200,
    body: {
      gameweeks: gameweeks.map((gameweek) => ({
        number: gameweek.number,
        status: effectiveStatus(gameweek, now),
        deadline: gameweek.deadline === null ? null : gameweek.deadline.toISOString(),
      })),
    },
  };
};

export const getCurrentGameweek: Handler = async () => ({
  status: 200,
  body: await currentGameweekView(),
});
