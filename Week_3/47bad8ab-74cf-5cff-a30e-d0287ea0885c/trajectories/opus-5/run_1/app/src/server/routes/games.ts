import { errors } from '../errors';
import { applyWrite, withGameLock } from '../games/engine';
import { loadOps } from '../games/records';
import {
  createGame,
  gameAccess,
  joinByCode,
  linkInfo,
  replaceLink,
  setTeam,
  startRace,
  turnLinkOff,
} from '../games/service';
import { gameJson, scores } from '../games/state';
import { readJson, requirePlayer, sendJson } from '../http';
import {
  broadcastRace,
  broadcastTeam,
  closeRevokedConnections,
  countsAgainstRate,
  deliverOutcome,
  updateSeatTeams,
} from '../live';
import { visiblePuzzle } from '../puzzles';
import type { RouteContext } from './context';

export async function postGames({ req, res }: RouteContext): Promise<void> {
  const player = await requirePlayer(req);
  const body = await readJson(req);
  if (typeof body.puzzle_id !== 'string') {
    throw errors.invalid({ puzzle_id: 'Choose a puzzle.' });
  }
  const mode = body.mode ?? 'shared';
  if (mode !== 'shared' && mode !== 'race') {
    throw errors.invalid({ mode: 'Use shared or race.' });
  }
  const puzzle = await visiblePuzzle(body.puzzle_id, player.id);
  const state = await createGame(puzzle, player.id, mode);
  sendJson(res, 201, gameJson(state, player.id));
}

export async function getGame({ req, res, params }: RouteContext): Promise<void> {
  const player = await requirePlayer(req);
  const state = await gameAccess(params[0], player.id);
  sendJson(res, 200, gameJson(state, player.id));
}

export async function getGameOps({ req, res, params }: RouteContext): Promise<void> {
  const player = await requirePlayer(req);
  const state = await gameAccess(params[0], player.id);
  sendJson(res, 200, { ops: await loadOps(state.game.id) });
}

export async function postGameOps({ req, res, params }: RouteContext): Promise<void> {
  const body = await readJson(req);
  const player = await requirePlayer(req);
  if (countsAgainstRate(player.id)) throw errors.rateLimited();
  const state = await gameAccess(params[0], player.id);
  const outcome = await withGameLock(state.game.id, () =>
    applyWrite(state.game.id, player.id, body),
  );
  await deliverOutcome(state.game.id, outcome, null);
  sendJson(res, 200, outcome.message);
}

export async function postLinkOff({ req, res, params }: RouteContext): Promise<void> {
  const player = await requirePlayer(req);
  await readJson(req);
  const state = await gameAccess(params[0], player.id);
  const next = await turnLinkOff(state, player.id);
  closeRevokedConnections(state.game.id, 'off');
  sendJson(res, 200, gameJson(next, player.id));
}

export async function postLinkReplace({ req, res, params }: RouteContext): Promise<void> {
  const player = await requirePlayer(req);
  await readJson(req);
  const state = await gameAccess(params[0], player.id);
  const next = await replaceLink(state, player.id);
  closeRevokedConnections(state.game.id, 'replaced');
  sendJson(res, 200, gameJson(next, player.id));
}

export async function postTeam({ req, res, params }: RouteContext): Promise<void> {
  const player = await requirePlayer(req);
  const body = await readJson(req);
  const state = await gameAccess(params[0], player.id);
  const next = await setTeam(state, player.id, body.team);
  updateSeatTeams(next);
  broadcastTeam(next.game.id, player.id, body.team as 1 | 2 | null);
  sendJson(res, 200, gameJson(next, player.id));
}

export async function postRaceStart({ req, res, params }: RouteContext): Promise<void> {
  const player = await requirePlayer(req);
  await readJson(req);
  const state = await gameAccess(params[0], player.id);
  const next = await startRace(state, player.id);
  broadcastRace(next.game.id, 'racing', scores(next));
  sendJson(res, 200, gameJson(next, player.id));
}

export async function getLink({ req, res, params }: RouteContext): Promise<void> {
  await requirePlayer(req);
  sendJson(res, 200, await linkInfo(params[0]));
}

export async function postLinkJoin({ req, res, params }: RouteContext): Promise<void> {
  const player = await requirePlayer(req);
  await readJson(req);
  const state = await joinByCode(params[0], player.id);
  sendJson(res, 200, gameJson(state, player.id));
}
