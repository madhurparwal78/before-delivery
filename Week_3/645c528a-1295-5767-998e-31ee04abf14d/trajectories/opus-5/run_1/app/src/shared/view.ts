import { GAME_OVER, RESULT_LINES, VOID_LINE } from './copy.js';
import type { Announcement, MatchState, ResultCase, Seat } from './types.js';

export interface Viewer {
  seat: Seat | null;
  names: Record<Seat, string>;
}

export function resultLine(viewerSeat: Seat | null, winnerSeat: Seat | null, resultCase: ResultCase, names: Record<Seat, string>): string {
  if (resultCase === 'void' || winnerSeat === null) return VOID_LINE;
  const lines = RESULT_LINES[resultCase];
  const loserSeat: Seat = winnerSeat === 1 ? 2 : 1;
  if (viewerSeat === winnerSeat) return lines.winner(names[loserSeat]);
  if (viewerSeat === loserSeat) return lines.loser(names[winnerSeat]);
  return lines.winner(names[loserSeat]);
}

export function resolveAnnouncement(announcement: Announcement, viewer: Viewer): string {
  switch (announcement.type) {
    case 'plain':
      return announcement.text;
    case 'turn':
      if (viewer.seat !== null && announcement.seat === viewer.seat) {
        return announcement.ballInHand ? 'Ball in hand' : 'Your turn';
      }
      return `${viewer.names[announcement.seat]}'s turn`;
    case 'game-over':
      return GAME_OVER;
    case 'result':
      return resultLine(viewer.seat, announcement.winnerSeat, announcement.resultCase, viewer.names);
  }
}

export function turnText(state: MatchState, viewer: Viewer): string {
  if (state.over) return GAME_OVER;
  if (viewer.seat !== null && state.activeSeat === viewer.seat) {
    return state.ballInHand ? 'Ball in hand' : 'Your turn';
  }
  return `${viewer.names[state.activeSeat]}'s turn`;
}

export function groupLabel(group: 'solids' | 'stripes' | null): string {
  if (group === 'solids') return 'Solids';
  if (group === 'stripes') return 'Stripes';
  return 'Open';
}

export function ballsLeftText(count: number): string {
  return count === 1 ? '1 ball left' : `${count} balls left`;
}
