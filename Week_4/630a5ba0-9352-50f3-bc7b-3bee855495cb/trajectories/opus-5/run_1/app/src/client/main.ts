import { registerScreen, render, startShellRefresh } from './app.js';
import { renderDaybook, startDaybookLoops } from './daybook/board.js';
import './screens/entry.js';
import './screens/settings.js';
import './screens/workspace.js';
import './screens/ops.js';

registerScreen('/', async (root) => {
  await renderDaybook(root);
  startDaybookLoops();
});

window.addEventListener('popstate', () => void render());

void render();
startShellRefresh();
