/** Builds the screen the address asks for and keeps it in step with the server. */

import { motionCustomProperties } from '../shared/motion.js';
import type { LeagueTable, RoundsBody, SessionBody } from '../shared/model.js';
import { POLL_DELAY_MS } from '../shared/timing.js';
import { ask } from './api.js';
import { el } from './dom.js';
import { DeskMessages, TableNews } from './messages.js';
import { archiveScreen } from './screens/archive.js';
import { captainScreen } from './screens/captain.js';
import { markerScreen } from './screens/marker.js';
import { notFoundScreen } from './screens/notfound.js';
import { quizmasterScreen } from './screens/quizmaster.js';
import type { Screen } from './screens/screen.js';
import { signInScreen } from './screens/signin.js';
import { tableScreen } from './screens/table.js';
import { Shell } from './shell.js';
import { TileGrid } from './tiles.js';

function pick(path: string, session: SessionBody | null, messages: DeskMessages): Screen {
  const tiles = (): TileGrid => new TileGrid(new TableNews());
  if (path === '/sign-in') return signInScreen(messages);
  if (path === '/') return tableScreen(tiles(), messages, session);
  if (session === null) return notFoundScreen(null);
  if (path === '/captain') return captainScreen(tiles(), messages, session);
  if (path === '/marker') return markerScreen(messages);
  if (path === '/quizmaster') return quizmasterScreen(tiles(), messages);
  if (path === '/archive') return archiveScreen(messages);
  return notFoundScreen(messages);
}

async function start(): Promise<void> {
  for (const [name, value] of Object.entries(motionCustomProperties())) {
    document.documentElement.style.setProperty(name, value);
  }

  const held = await ask<SessionBody>({ method: 'GET', path: '/api/session', publicRead: true });
  const session = held.ok ? held.data : null;
  const messages = new DeskMessages();
  const screen = pick(window.location.pathname, session, messages);
  const shell = new Shell(screen.signOut);
  const app = document.getElementById('app');
  if (app === null) return;
  app.append(shell.banner, el('main', { class: 'main' }, [screen.root]));
  screen.land();

  const tick = async (): Promise<void> => {
    const rounds = await ask<RoundsBody>({ method: 'GET', path: '/api/rounds', publicRead: true });
    const table = await ask<LeagueTable>({ method: 'GET', path: '/api/table', publicRead: true });
    if (!rounds.ok || !table.ok) return;
    shell.update(rounds.data.rounds, rounds.data.night);
    await screen.poll({ rounds: rounds.data.rounds, night: rounds.data.night, table: table.data });
  };

  await tick();
  window.setInterval(() => void tick(), POLL_DELAY_MS);
}

void start();
