import { loadData, readSession, redraw, state } from './app.js';
import { onReducedMotionChange } from './motion.js';
import { startShell } from './shell.js';
import './filters.js';
import './screens/publicSite.js';
import './screens/jobs.js';
import './screens/clients.js';
import './screens/calls.js';
import './screens/job.js';
import './screens/script.js';
import './screens/reel.js';
import './screens/lines.js';
import './screens/cues.js';
import './screens/cuts.js';
import './screens/notes.js';
import './screens/delivery.js';
import './screens/privatePages.js';

async function start(): Promise<void> {
  startShell();
  onReducedMotionChange(() => redraw());
  if (state.screen.name !== 'review' && state.screen.name !== 'signOff' && state.screen.name !== 'fee') {
    await readSession();
  }
  await loadData();
}

void start();
