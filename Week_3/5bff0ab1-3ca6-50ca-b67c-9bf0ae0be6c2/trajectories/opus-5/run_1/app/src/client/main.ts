import type { ChapterId, FinishId, HubId, ModelId } from '../shared/catalogue.js';
import { STATUS } from '../shared/strings.js';
import type { LiveReading, User } from '../shared/types.js';
import {
  announce,
  clearSessionFlag,
  identityChanged,
  sessionEnded,
  sessionWasEnded,
  setUser,
  startIdentityWatch,
  startLive,
} from './core.js';
import { startGarage } from './garage.js';
import { startHubConsole } from './hubconsole.js';
import { startLockWatch } from './lockwatch.js';
import { startShowroom } from './showroom.js';
import { openSignIn } from './signin.js';
import { startTestRide } from './testride.js';

interface Bootstrap {
  route: 'long' | 'test-ride' | 'garage' | 'hub' | 'not-found' | 'wrong-role';
  user: User | null;
  reading: LiveReading;
  selection: { hub: HubId; model: ModelId; finish: FinishId };
  chapter: ChapterId;
  part: string | null;
  progress: number;
}

function bootstrap(): Bootstrap | null {
  const node = document.getElementById('bootstrap');
  if (!node?.textContent) return null;
  return JSON.parse(node.textContent) as Bootstrap;
}

function start(): void {
  const data = bootstrap();
  if (!data) return;
  setUser(data.user, false);
  startLive(data.selection, data.reading);
  startIdentityWatch();
  startLockWatch();

  sessionEnded.on(() => {
    if (sessionWasEnded()) {
      announce(STATUS.sessionEnded, 'session');
      clearSessionFlag();
    }
    openSignIn();
  });

  identityChanged.on(() => {
    const links = document.querySelector<HTMLElement>('[data-links]');
    if (!links) return;
    const host = links.querySelector('.host-link');
    const me = (window as unknown as { __user?: User }).__user;
    void me;
    if (host) host.remove();
  });

  if (data.route === 'long') startShowroom(data);
  else if (data.route === 'test-ride') startTestRide();
  else if (data.route === 'garage') startGarage();
  else if (data.route === 'hub') startHubConsole();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
