import { COPY } from '../shared/copy';
import type { ApiTournament } from '../shared/types';
import { api, ApiError } from './api';
import {
  bandNodes,
  connectLive,
  disconnectLive,
  navigate,
  noteServerTime,
  onLive,
  pageAlert,
  readRoute,
  refresh,
  setRenderer,
  state,
} from './app';
import { tickCountdowns } from './card';
import { anyDialogOpen } from './dialog';
import { h } from './dom';
import { bracketScreen, patchCards, toggleWholeBracket } from './screens/bracket';
import {
  createScreen,
  disputesScreen,
  historyScreen,
  landingScreen,
  meScreen,
  notFoundScreen,
  shareScreen,
  signInScreen,
  signUpScreen,
  tournamentsScreen,
} from './screens/pages';
import { setupScreen } from './screens/setup';
import { playResetOnCards } from './trace';

const root = document.getElementById('app') as HTMLElement;
const screen = h('main', { id: 'screen' });
const topBar = h('header', { class: 'top-bar' });
root.append(topBar, ...bandNodes(), screen);

let loadedKey = '';
let resizeTimer = 0;
let tournamentsCache: ApiTournament[] = [];

const isOrganizer = (tournament: ApiTournament): boolean =>
  tournament.my_role === 'organizer' || tournament.my_role === 'co_organizer';

const renderTopBar = (): void => {
  const right = h('span', { class: 'top-right' });
  if (state.user !== null) {
    const out = h('button', { type: 'button' }, 'Sign out');
    out.addEventListener('click', () => {
      void api.signOut().then(() => {
        state.user = null;
        disconnectLive();
        navigate('/');
      });
    });
    right.append(h('a', { href: `/u/${state.user.username}`, class: 'link' }, state.user.username), out);
  }
  const onLanding = state.route.parts.length === 0;
  topBar.replaceChildren(onLanding ? h('span', {}) : h('a', { href: '/', class: 'brand' }, 'Cupfold'), right);
};

const loadTournament = async (id: string, shareCode: string | null): Promise<void> => {
  state.shareCode = shareCode;
  if (shareCode !== null) {
    const payload = await api.share(shareCode);
    state.tournament = payload.tournament;
    state.publicEntrants = payload.entrants;
    state.matches = payload.matches;
    state.standings = payload.standings;
    state.entrants = [];
    state.myEntrantId = null;
    noteServerTime(payload.tournament.server_time);
    connectLive(payload.tournament.id, shareCode);
    return;
  }
  const { tournament } = await api.tournament(id);
  state.tournament = tournament;
  noteServerTime(tournament.server_time);
  const [{ entrants }, { matches }] = await Promise.all([api.entrants(id), api.matches(id)]);
  state.entrants = entrants;
  state.matches = matches;
  state.standings =
    tournament.format === 'round_robin' || tournament.format === 'swiss' ? await api.standings(id) : null;
  try {
    const mine = await api.myEntrant(id);
    state.myEntrantId = mine.entrant.id;
    state.nextMatch = mine.next_match;
  } catch {
    state.myEntrantId = null;
    state.nextMatch = null;
  }
  connectLive(id, null);
};

/** The next match is the server's answer, re-read whenever a match changes. */
const refreshNextMatch = (): void => {
  const tournament = state.tournament;
  if (tournament === null || state.route.parts[2] !== 'me') return;
  void api
    .myEntrant(tournament.id)
    .then((mine) => {
      state.nextMatch = mine.next_match;
      refresh();
    })
    .catch(() => undefined);
};

const needSignIn = (path: string): boolean => {
  if (state.user !== null) return false;
  navigate(`/signin?next=${encodeURIComponent(path)}`, true);
  return true;
};

const show = (node: HTMLElement): void => {
  screen.replaceChildren(node);
};

const renderTournamentRoute = (id: string, page: string, shareCode: string | null): void => {
  const key = `${shareCode ?? id}:${page === 'share' ? 'share' : 'tournament'}`;
  if (loadedKey !== key) {
    loadedKey = key;
    void loadTournament(id, shareCode)
      .then(refresh)
      .catch((error: unknown) => {
        loadedKey = '';
        state.tournament = null;
        const message: string =
          error instanceof ApiError && error.body.error === 'not_found' ? error.message : COPY.pageNotFound;
        show(notFoundScreen(message));
      });
    return;
  }
  const loaded = state.tournament;
  if (loaded === null) return;

  if (shareCode !== null) {
    show(shareScreen(loaded));
    return;
  }
  switch (page) {
    case 'setup':
      show(isOrganizer(loaded) ? setupScreen(loaded) : notFoundScreen());
      return;
    case 'bracket':
      show(bracketScreen(loaded, false));
      return;
    case 'disputes':
      show(isOrganizer(loaded) ? disputesScreen(loaded) : notFoundScreen());
      return;
    case 'me':
      show(meScreen(loaded));
      return;
    default: {
      const started = loaded.state === 'running' || loaded.state === 'finished';
      navigate(`/t/${loaded.id}/${isOrganizer(loaded) && !started ? 'setup' : 'bracket'}`, true);
      return;
    }
  }
};

const render = (): void => {
  renderTopBar();
  const { parts, path } = state.route;

  if (parts.length === 0) {
    disconnectLive();
    loadedKey = '';
    show(landingScreen());
    return;
  }
  if (parts[0] === 'signup' && parts.length === 1) {
    show(signUpScreen());
    return;
  }
  if (parts[0] === 'signin' && parts.length === 1) {
    show(signInScreen());
    return;
  }
  if (parts[0] === 's' && parts.length === 2) {
    renderTournamentRoute('', 'share', parts[1] as string);
    return;
  }
  if (parts[0] === 'u' && parts.length === 2) {
    if (needSignIn(path)) return;
    show(historyScreen(parts[1] as string));
    return;
  }
  if (parts[0] === 't' && parts.length <= 3) {
    if (needSignIn(path)) return;
    if (parts.length === 1) {
      if (loadedKey !== 'list') {
        loadedKey = 'list';
        void api.tournaments().then(({ tournaments }) => {
          tournamentsCache = tournaments;
          refresh();
        });
      }
      show(tournamentsScreen(tournamentsCache));
      return;
    }
    if (parts[1] === 'new') {
      show(createScreen());
      return;
    }
    renderTournamentRoute(parts[1] as string, (parts[2] as string) ?? '', null);
    return;
  }
  show(notFoundScreen());
};

setRenderer(render);

document.addEventListener('click', (event) => {
  const link = (event.target as HTMLElement).closest('a');
  if (link === null) return;
  const href = link.getAttribute('href');
  if (href === null || href.startsWith('http') || link.getAttribute('target') === '_blank') return;
  event.preventDefault();
  navigate(href);
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'z' && event.key !== 'Z') return;
  if (anyDialogOpen()) return;
  const target = event.target as HTMLElement;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
  if (document.querySelector('[data-bracket-area]') === null) return;
  event.preventDefault();
  toggleWholeBracket();
});

onLive((message) => {
  if (message.type === 'match.updated' || message.type === 'matches.reset') refreshNextMatch();
  if (message.type === 'matches.reset') {
    void playResetOnCards((message.data.matches ?? []).map((match) => match.id));
  }
  if (message.type === 'match.updated' && message.data.match !== undefined) {
    patchCards([message.data.match]);
  }
});

window.addEventListener('resize', () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(refresh, 150);
});

window.setInterval(tickCountdowns, 500);

const boot = async (): Promise<void> => {
  readRoute();
  try {
    state.config = await api.config();
    noteServerTime(state.config.server_time);
  } catch {
    pageAlert(COPY.liveDown);
  }
  try {
    const { user } = await api.me();
    state.user = user;
  } catch {
    state.user = null;
  }
  render();
};

void boot();
