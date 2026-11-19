import { el, svg } from './dom.js';
import { loadConfig, loadMe, loadServerTime } from './session.js';
import { render, route, setNotFound, startShell } from './shell.js';
import { dashboardPage } from './pages/dashboard.js';
import { homePage } from './pages/home.js';
import { inboxPage } from './pages/inbox.js';
import { projectPage } from './pages/project.js';
import { sheetPage } from './pages/sheet.js';
import { signinPage } from './pages/signin.js';
import { sourcePage } from './pages/source.js';
import { uploadPage } from './pages/upload.js';
import { workbookPage } from './pages/workbook.js';
import { workbooksPage } from './pages/workbooks.js';

function notFoundPage(host: HTMLElement): void {
  document.body.dataset.field = 'ground';
  const sticker = svg('svg', { class: 'sticker sticker-bl', width: 160, height: 120, viewBox: '0 0 160 120', 'aria-hidden': 'true' });
  sticker.append(
    svg('rect', { x: 20, y: 30, width: 120, height: 60, rx: 30, fill: 'rgb(234, 160, 205)', stroke: 'rgb(26,10,20)', 'stroke-width': 3 }),
  );
  host.append(
    el('div', { class: 'page empty-page' }, [
      el('h1', { class: 'empty-headline', text: 'Not found.' }),
      sticker as unknown as HTMLElement,
    ]),
  );
}

route('/', homePage);
route('/signin', signinPage);
route('/workbooks', workbooksPage);
route('/projects/:id', projectPage);
route('/sources/new', uploadPage);
route('/sources/:id', sourcePage);
route('/workbooks/:id', workbookPage);
route('/workbooks/:id/sheets/:sheetId', sheetPage);
route('/dashboards/:id', dashboardPage);
route('/inbox', inboxPage);
setNotFound(notFoundPage);

void (async () => {
  await Promise.all([loadConfig(), loadMe(), loadServerTime()]);
  startShell();
  await render();
})();
