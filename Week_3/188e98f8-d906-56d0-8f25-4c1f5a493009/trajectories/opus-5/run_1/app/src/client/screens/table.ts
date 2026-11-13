/** The public table view. */

import type { Dispute, SessionBody } from '../../shared/model.js';
import { ask } from '../api.js';
import { el } from '../dom.js';
import type { DeskMessages } from '../messages.js';
import { RulingWatcher, signOutButton } from '../parts.js';
import type { TileGrid } from '../tiles.js';
import type { PollState, Screen } from './screen.js';

export function tableScreen(
  tiles: TileGrid,
  messages: DeskMessages,
  session: SessionBody | null,
): Screen {
  const rulings = new RulingWatcher(messages);
  const parts: (Node | string)[] = session === null ? [] : [messages.region];
  const root = el('div', { class: 'screen screen-table' }, [...parts, tiles.region]);

  return {
    root,
    signOut: session === null ? null : signOutButton(),
    land: () => {
      /* the table view takes no landing focus */
    },
    poll: async (state: PollState) => {
      tiles.apply(state.table);
      if (session?.role !== 'captain') return;
      const mine = await ask<{ disputes: Dispute[] }>({ method: 'GET', path: '/api/disputes' });
      if (mine.ok) rulings.note(mine.data.disputes);
    },
  };
}
