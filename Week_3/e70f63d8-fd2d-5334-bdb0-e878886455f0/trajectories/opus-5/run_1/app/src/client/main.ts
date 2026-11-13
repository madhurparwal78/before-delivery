import { api, find } from './dom.js';
import {
  startFollow,
  startInvitation,
  startMatch,
  startNewMatch,
  startNewTeam,
  startNewTournament,
  startSignIn,
  startSignUp,
  startTeam,
} from './forms.js';
import { startScoring } from './scoring.js';
import { startTournament } from './tournament.js';
import { startViewer } from './viewer.js';

function startChrome(): void {
  const menu = find<HTMLButtonElement>('#menu-button');
  const nav = find('#main-nav');
  if (menu && nav) {
    menu.addEventListener('click', () => {
      const open = menu.getAttribute('aria-expanded') === 'true';
      menu.setAttribute('aria-expanded', String(!open));
      nav.classList.toggle('open', !open);
    });
  }
  const signout = find<HTMLButtonElement>('#signout-button');
  if (signout) {
    signout.addEventListener('click', () => {
      void (async () => {
        await api('/api/auth/signout', { method: 'POST' });
        location.assign('/');
      })();
    });
  }
}

const PAGES: Record<string, () => void> = {
  signup: startSignUp,
  signin: startSignIn,
  follow: startFollow,
  'new-team': startNewTeam,
  team: startTeam,
  'new-tournament': startNewTournament,
  'new-match': startNewMatch,
  match: startMatch,
  scoring: startScoring,
  viewer: startViewer,
  tournament: startTournament,
  invitation: startInvitation,
};

startChrome();
const page = document.body.dataset.page ?? '';
PAGES[page]?.();
