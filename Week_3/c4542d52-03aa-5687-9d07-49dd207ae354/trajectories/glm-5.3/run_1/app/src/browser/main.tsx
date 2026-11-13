import { h } from './dom.js';
import { boot } from './app.js';
import { ensureStatusRegion } from './status.js';

// Register the pages.
import './portal.js';
import './grant.js';
import './orders.js';
import './captable.js';
import './tenders.js';
import './board.js';
import './admin.js';
import './scenario.js';

ensureStatusRegion();

const root = document.getElementById('root')!;
boot(root);

// The removed-access page is a full-page band.
if (location.pathname === '/removed') {
  document.getElementById('root')!.replaceChildren(
    h('section', { class: 'band black full-bleed', role: 'alert' },
      h('h1', null, 'Your access to the Tidecraft register has ended.'),
      h('p', null, h('a', { href: '/' }, 'Sign in')),
    ),
  );
}
