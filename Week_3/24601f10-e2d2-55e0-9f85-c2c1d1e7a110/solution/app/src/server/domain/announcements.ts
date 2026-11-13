import type { DrawEvent, MatchRef } from './types.js';

function advanceTo(format: string, to: MatchRef): string {
  if (format === 'single_elimination') return `round ${to.round}`;
  if (to.bracket === 'final') return 'the grand final';
  return `${to.bracket === 'losers' ? 'losers' : 'winners'} round ${to.round}`;
}

// The Bracket announcements text of one change: the sentences joined by a full stop and a space.
export function announcementOf(format: string, events: DrawEvent[]): string | null {
  const sentences = events.map((event) => {
    switch (event.kind) {
      case 'advance': return `${event.name} advances to ${advanceTo(format, event.to)}`;
      case 'drop': return `${event.name} drops to losers round ${event.to.round}`;
      case 'reset_needed': return 'Grand final reset needed';
      case 'champion': return `${event.name} wins the tournament`;
    }
  });
  return sentences.length ? sentences.join('. ') : null;
}

export const resetAnnouncement = (count: number): string => (count === 1 ? '1 match reset' : `${count} matches reset`);
