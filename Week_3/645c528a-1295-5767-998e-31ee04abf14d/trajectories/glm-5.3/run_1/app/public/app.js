// Long Rail Headstring application router.

import { el, navigate, qs, copy } from './ui.js';
import {
  state, loadMe, setChips, openLive, closeLive, applyTheme, applyMotionPreference, offlineMode,
} from './app-state.js';
import { homeScreen, tutorialScreen } from './screens-home.js';
import { tierPickerScreen, tableScreen } from './screens-play.js';
import { practiceSetupScreen, practiceTableScreen } from './screens-practice.js';
import { shopScreen, tournamentsScreen, bracketScreen, clubsScreen, clubScreen, leaderboardsScreen } from './screens-social.js';
import { profileScreen, settingsScreen, verifyScreen, inviteScreen, addFriendScreen } from './screens-account.js';
import { openFriendsPanel } from './screens-account.js';

const TUTORIAL_DONE_KEY = 'headstring-tutorial-done';

let teardown = null;

async function route() {
  if (teardown) {
    teardown();
    teardown = null;
  }
  closeLive();
  const path = location.pathname;

  // A signed-in player who opens `/` goes to `/home`.
  if (path === '/' || path === '') {
    const signedUp = localStorage.getItem(TUTORIAL_DONE_KEY) === '1';
    if (signedUp || state.me) {
      try {
        await loadMe();
        navigate('/home');
        return;
      } catch {
        // Guests and outages see the tutorial table.
      }
    }
    if (state.me) {
      navigate('/home');
      return;
    }
    teardown = tutorialScreen();
    return;
  }

  try {
    await loadMe();
  } catch {
    state.me = null;
  }

  if (path === '/home') {
    teardown = await homeScreen();
    return;
  }
  if (path === '/play') {
    await tierPickerScreen(new URLSearchParams(location.search).get('mode') === 'special' ? 'special' : qs('mode') ?? undefined);
    return;
  }
  if (path === '/play/special') {
    await tierPickerScreen('special');
    return;
  }
  if (path.startsWith('/table/')) {
    teardown = await tableScreen(path.slice('/table/'.length));
    return;
  }
  if (path === '/practice') {
    practiceSetupScreen();
    return;
  }
  if (path === '/practice/table') {
    practiceTableScreen();
    return;
  }
  if (path === '/shop') {
    await shopScreen();
    return;
  }
  if (path === '/tournaments') {
    await tournamentsScreen();
    return;
  }
  if (path.startsWith('/tournaments/')) {
    await bracketScreen(path.slice('/tournaments/'.length));
    return;
  }
  if (path === '/clubs') {
    await clubsScreen();
    return;
  }
  if (path.startsWith('/clubs/')) {
    await clubScreen(path.slice('/clubs/'.length));
    return;
  }
  if (path === '/leaderboards') {
    await leaderboardsScreen();
    return;
  }
  if (path === '/profile') {
    await profileScreen();
    return;
  }
  if (path === '/settings') {
    await settingsScreen();
    return;
  }
  if (path === '/verify') {
    await verifyScreen();
    return;
  }
  if (path.startsWith('/invite/')) {
    await inviteScreen(path.slice('/invite/'.length));
    return;
  }
  if (path.startsWith('/friends/add/')) {
    await addFriendScreen(path.slice('/friends/add/'.length));
    return;
  }

  // Not found.
  document.getElementById('app').replaceChildren(el('h1', { text: copy.notFoundHeading }));
}

window.addEventListener('popstate', () => {
  void route();
});

document.addEventListener('click', (event) => {
  const anchor = event.target.closest('a[href]');
  if (!anchor) return;
  const href = anchor.getAttribute('href');
  if (!href || href.startsWith('http') || href.startsWith('#')) return;
  if (anchor.target === '_blank') return;
  event.preventDefault();
  navigate(href);
});

window.addEventListener('open-signup', () => {
  void (async () => {
    const { signUpDialog } = await import('./dialogs.js');
    await signUpDialog({});
  })();
});

window.addEventListener('open-friends', () => {
  void openFriendsPanel();
});

window.addEventListener('online', () => void route());
window.addEventListener('offline', () => void route());

applyTheme();
applyMotionPreference();
void route();
