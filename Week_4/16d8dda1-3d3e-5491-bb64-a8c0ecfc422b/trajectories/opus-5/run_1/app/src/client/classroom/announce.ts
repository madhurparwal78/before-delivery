import type { LiveEvent, SessionSnapshot } from '../../shared/types.js';
import { percentOf } from '../../shared/rules.js';
import { element } from '../dom.js';

const KEEP = 20;
const REPEAT_GUARD_MS = 2_000;

export interface Announcer {
  region: HTMLElement;
  say: (text: string) => void;
  fromChange: (event: LiveEvent, before: SessionSnapshot | null, after: SessionSnapshot) => void;
}

export function createAnnouncer(): Announcer {
  const region = element('div', { role: 'status', 'aria-label': 'Class announcements', class: 'announcements' });
  let lastText = '';
  let lastAt = 0;

  const say = (text: string): void => {
    const now = Date.now();
    if (text === lastText && now - lastAt < REPEAT_GUARD_MS) return;
    lastText = text;
    lastAt = now;
    region.append(element('p', {}, [text]));
    while (region.children.length > KEEP) region.firstElementChild?.remove();
  };

  /** DP-42: every published announcement, worked out from the change the server reported. */
  const fromChange: Announcer['fromChange'] = (event, before, after) => {
    if (before === null || event === 'snapshot') return;

    if (before.slide.current !== after.slide.current || before.slide.total !== after.slide.total) {
      if (after.slide.total > 0) say(`Slide ${after.slide.current} of ${after.slide.total}.`);
    }

    if (event === 'hand-taken') {
      const took = before.hands[0];
      if (took !== undefined) say(`${took.displayName} has the floor.`);
    } else {
      const known = new Set(before.hands.map((hand) => hand.learnerId));
      for (const hand of after.hands) {
        if (!known.has(hand.learnerId)) say(`${hand.displayName} raised a hand.`);
      }
    }

    if (before.poll !== null && after.poll !== null && before.poll.pollId === after.poll.pollId) {
      if (before.poll.state === 'open' && after.poll.state === 'closed') {
        const counts = after.poll.counts ?? after.poll.options.map(() => 0);
        const total = counts.reduce((sum, count) => sum + count, 0);
        const parts = after.poll.options.map((option, index) => `${option} ${percentOf(counts[index] ?? 0, total)}%`);
        say(`Poll results: ${parts.join(', ')}.`);
      }
    }

    if (event === 'breakouts-started' && after.breakout !== null) {
      const own = after.seats.find((seat) => seat.learnerId === after.you.learnerId);
      if (after.you.learnerId !== null && own?.breakoutTable != null) {
        say(`Breakouts started. You are at table ${own.breakoutTable}.`);
      } else {
        say(`Breakouts started at ${after.breakout.tables.length} tables.`);
      }
    }
    if (event === 'breakout-warning' && after.breakout !== null) {
      say(`Breakouts end in ${after.breakout.remainingSeconds} seconds.`);
    }
    if (event === 'breakouts-ended') {
      say('Breakouts are over. Everyone is back in their seat.');
    }

    if (before.spotlight !== after.spotlight && after.spotlight !== null) {
      const seat = after.seats.find((item) => item.learnerId === after.spotlight);
      if (seat?.displayName != null) say(`${seat.displayName} is in the spotlight.`);
    }

    if (before.locked !== after.locked) {
      say(after.locked ? 'The class is locked.' : 'The class is unlocked.');
    }

    if (event === 'live-resumed') say('Live updates are back.');
  };

  return { region, say, fromChange };
}
