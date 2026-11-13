import { ApiProblem } from './api.js';
import { clear } from './dom.js';
import { clearBand, showBand } from './shell.js';
import { renderHero } from './screens/hero.js';
import { renderWalls } from './screens/walls.js';
import { renderSurvey } from './screens/survey.js';
import { renderWorkspace } from './screens/workspace.js';
import { renderShelf } from './screens/shelf.js';
import { renderHire } from './screens/hire.js';
import { renderSheet } from './screens/sheet.js';
import { renderTechnician } from './screens/technician.js';
import { sync } from './queue.js';

const screen = document.getElementById('screen') as HTMLElement;
const chrome = document.getElementById('chrome') as HTMLElement;
let leave: (() => void) | null = null;

async function render(): Promise<void> {
  leave?.();
  leave = null;
  clearBand();
  const path = window.location.pathname;
  const survey = /^\/sites\/([^/]+)\/survey$/.exec(path);
  const workspace = /^\/sites\/([^/]+)\/layouts\/([^/]+)$/.exec(path);
  const sheet = /^\/sheets\/([^/]+)$/.exec(path);
  const rig = /^\/rig\/([^/]+)$/.exec(path);
  try {
    if (path === '/') leave = renderHero(screen, chrome);
    else if (path === '/sites') leave = await renderWalls(screen, chrome);
    else if (survey !== null) leave = await renderSurvey(screen, chrome, survey[1] as string);
    else if (workspace !== null) {
      leave = await renderWorkspace(screen, chrome, workspace[1] as string, workspace[2] as string);
    } else if (path === '/kit') leave = await renderShelf(screen, chrome);
    else if (path === '/hire') leave = await renderHire(screen, chrome);
    else if (sheet !== null) leave = await renderSheet(screen, chrome, sheet[1] as string);
    else if (rig !== null) leave = await renderTechnician(screen, chrome, rig[1] as string);
    else {
      clear(screen);
      showBand('Nothing here.');
    }
  } catch (error) {
    if (error instanceof ApiProblem) showBand(error.body.detail);
    else showBand('Something went wrong on our side.');
  }
}

window.addEventListener('popstate', () => void render());
void render();
void sync();
