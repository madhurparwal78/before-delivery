/**
 * Client entry: dispatches to the screen the server's shell names. The bundle
 * the page loads is this module, with no third-party script.
 */
import { runHoarding, runSignIn } from './main.js';
import { runStockist, runNoticePage } from './screens.js';
import { runEditor } from './editor.js';

const app = document.getElementById('app') as HTMLElement;
const route = app.dataset.route ?? '/';

if (route === '/') void runHoarding();
else if (route === '/sign-in') void runSignIn();
else if (route === '/stockist') void runStockist();
else if (route === '/editor') void runEditor();
else if (route === '/notices') void runNoticePage(app.dataset.number ?? '');
