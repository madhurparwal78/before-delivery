/** Browser entry point: one page per address. */

import { startRouter, type PageDefinition } from './router';
import { createLandingPage } from './pages/landing';
import { createFinderPage } from './pages/finder';
import { createHoldPage } from './pages/holdPage';
import { createSharedPage } from './pages/sharedPage';
import { createConsolePage } from './pages/consolePage';

const pages: PageDefinition[] = [
  { kind: 'landing', match: (pathname) => pathname === '/', create: () => createLandingPage() },
  { kind: 'finder', match: (pathname) => pathname === '/finder', create: (url) => createFinderPage(url) },
  { kind: 'hold', match: (pathname) => pathname.startsWith('/holds/'), create: (url) => createHoldPage(url) },
  { kind: 'shared', match: (pathname) => pathname.startsWith('/shared/'), create: (url) => createSharedPage(url) },
  { kind: 'console', match: (pathname) => pathname === '/console', create: () => createConsolePage() },
];

const root = document.getElementById('app');
if (root) startRouter(pages, root);
