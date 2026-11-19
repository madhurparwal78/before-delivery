import { MEDIUM, all, one, pageData, play } from './dom.js';
import { startDialogs } from './dialogs.js';
import { startPublicSite } from './publicSite.js';
import { startQuoteForm } from './quoteForm.js';
import { startRefresh } from './refresh.js';
import { startDeskActions, startSignInForms } from './deskActions.js';
import { startBidPage, startCustomerPage, startRunSheet } from './privatePages.js';

type Data = { screen?: string; step?: string };

function startDeskMoves(): void {
  document.addEventListener('click', (event) => {
    const link = (event.target as HTMLElement | null)?.closest<HTMLAnchorElement>('a[href^="/"]');
    if (!link || link.target === '_blank' || link.getAttribute('href')?.startsWith('/api/')) return;
    const main = document.getElementById('main');
    if (!main) return;
    play(main, [{ opacity: 1 }, { opacity: 0.2 }], MEDIUM);
  });
  const heading = one<HTMLElement>('h1[tabindex="-1"]');
  if (heading && document.body.classList.contains('desk')) heading.focus({ preventScroll: true });
}

function start(): void {
  startDialogs();
  const data = pageData<Data>();
  const body = document.body;
  if (body.classList.contains('public')) startPublicSite();
  if (body.classList.contains('quote')) startQuoteForm();
  if (body.classList.contains('sign-in')) startSignInForms();
  if (body.classList.contains('desk') && !body.classList.contains('sign-in')) {
    startDeskActions();
    startDeskMoves();
    startRefresh();
  }
  if (data.screen === 'customer-page') {
    startCustomerPage();
    startRefresh();
  }
  if (data.screen === 'bid-page') {
    startBidPage();
    startRefresh();
  }
  if (data.screen === 'run-sheet') {
    startRunSheet();
    startRefresh();
  }
  for (const section of all<HTMLElement>('.rise')) {
    if (window.scrollY === 0) continue;
    section.classList.add('risen');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
