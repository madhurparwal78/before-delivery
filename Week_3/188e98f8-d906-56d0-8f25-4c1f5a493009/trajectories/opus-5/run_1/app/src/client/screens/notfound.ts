/** The not-found screen. */

import { COPY } from '../copy.js';
import { el } from '../dom.js';
import type { DeskMessages } from '../messages.js';
import type { PollState, Screen } from './screen.js';

export function notFoundScreen(messages: DeskMessages | null): Screen {
  const root = el('div', { class: 'screen screen-not-found' }, [
    ...(messages === null ? [] : [messages.region]),
    el('section', { class: 'card not-found-card' }, [
      el('h1', {}, [COPY.notFound]),
      el('a', { class: 'link', href: '/' }, ['League table']),
    ]),
  ]);
  return {
    root,
    signOut: null,
    land: () => {
      /* the not-found screen takes no landing focus */
    },
    poll: async (_state: PollState) => {
      /* nothing on this screen comes from the server */
    },
  };
}
