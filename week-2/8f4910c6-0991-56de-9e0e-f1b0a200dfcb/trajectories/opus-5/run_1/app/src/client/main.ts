import { el } from './lib/dom.js';
import { shellFor } from './lib/chrome.js';
import { pageHeading, registerScreens, setNotFound, setShell, startRouter, type Screen } from './lib/router.js';
import { loadMember } from './lib/session.js';
import { boardIndexScreen, boardListingScreen, profileScreen, trayScreen } from './screens/boards.js';
import { castRequestScreen } from './screens/castRequest.js';
import { packageScreen } from './screens/packageLink.js';
import { applyScreen } from './screens/apply.js';
import { consentScreen } from './screens/consent.js';
import { forgotPasswordScreen, invitationScreen, resetPasswordScreen, signInScreen } from './screens/account.js';
import { boardScreen } from './screens/board.js';
import {
  bookingScreen,
  bookingsScreen,
  licencesScreen,
  myCalendarScreen,
  overviewScreen,
  statementScreen,
  statementsIndexScreen,
} from './screens/money.js';
import {
  applicationScreen,
  applicationsScreen,
  membersScreen,
  officesScreen,
  packagesScreen,
  rateCardsScreen,
  rosterScreen,
} from './screens/agency.js';
import { profileEditorScreen } from './screens/profile.js';

const homeScreen: Screen = {
  pattern: '/',
  async render() {
    return {
      node: el('main', { class: 'page page-boards' }, [
        pageHeading('Vesper & Rowe Talent'),
        el('p', { class: 'lede', text: 'Fashion and commercial talent in Toronto and Vancouver.' }),
        el('a', { class: 'link', href: '/boards', text: 'Browse the boards' }),
      ]),
      chrome: 'public',
    };
  },
};

const notFoundScreen: Screen = {
  pattern: '/not-found',
  async render() {
    return {
      node: el('main', { class: 'page page-gone' }, [
        pageHeading('Page not found'),
        el('p', { class: 'lede', text: 'That address is not part of Rungboard.' }),
        el('a', { class: 'link', href: '/boards', text: 'Back to boards' }),
      ]),
      chrome: 'public',
    };
  },
};

registerScreens([
  homeScreen,
  boardIndexScreen,
  boardListingScreen,
  profileScreen,
  trayScreen,
  castRequestScreen,
  packageScreen,
  applyScreen,
  consentScreen,
  signInScreen,
  forgotPasswordScreen,
  resetPasswordScreen,
  invitationScreen,
  overviewScreen,
  boardScreen,
  bookingsScreen,
  bookingScreen,
  licencesScreen,
  statementsIndexScreen,
  statementScreen,
  packagesScreen,
  applicationsScreen,
  applicationScreen,
  profileEditorScreen,
  rosterScreen,
  membersScreen,
  rateCardsScreen,
  officesScreen,
  myCalendarScreen,
]);
setNotFound(notFoundScreen);
setShell(shellFor);

async function boot(): Promise<void> {
  if (window.location.pathname.startsWith('/workspace')) await loadMember();
  startRouter();
}

void boot();
