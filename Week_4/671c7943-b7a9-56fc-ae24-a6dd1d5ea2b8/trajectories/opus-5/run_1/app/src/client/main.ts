import { query, view } from './dom.js';
import { initChrome } from './chrome.js';
import { initFocusGuard } from './focus.js';
import { raiseTitleLines } from './motion.js';
import { initRouter, initView } from './router.js';

initFocusGuard();
initChrome();
initRouter();
initView(true);
if (query('[data-case]', view())) raiseTitleLines(view());
