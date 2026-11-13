import { copy } from '../../shared/copy';
import { api, ApiFailure } from '../api';
import { sentenceTile } from '../main';
import { openRaceOverDialog, openSolvedDialog } from '../room/dialogs';
import { Room } from '../room/session';
import { buildRoom } from '../room/view';
import { app, layoutMode } from '../state';

let session: { gameId: string; room: Room } | null = null;

export function leaveRoom(): void {
  session?.room.close();
  session = null;
}

export async function mountRoom(container: HTMLElement, gameId: string): Promise<void> {
  if (session && session.gameId !== gameId) leaveRoom();
  let room = session?.room ?? null;
  if (!room) {
    try {
      const game = await api.game(gameId);
      const puzzle = await api.puzzle(game.puzzle_id);
      room = new Room(game, puzzle, app.player?.id ?? '');
      session = { gameId, room };
      room.connect();
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.status === 410) {
        container.append(sentenceTile(failure.body.message, 'ink band'));
        return;
      }
      container.append(sentenceTile(copy.unknownGame));
      return;
    }
  }

  const view = buildRoom(room, container, layoutMode());
  room.onGameChanged = view.patchRace;
  room.onSolved = (elapsed, revealed, stats) => openSolvedDialog(room as Room, elapsed, revealed, stats);
  room.onRaceOver = () => openRaceOverDialog(room as Room);
  room.paintAllSquares();
  room.paintSelection();
  room.paintPlayers();
  room.paintTimer();
  room.startTicking();
  if (room.deadLink !== null) room.showBand(room.deadLink);
  room.elements?.grid.focus();
  room.announceClue();
}
