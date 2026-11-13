import { defineFallback, definePage, startRouter } from './router.js';
import { mainElement, refreshTopRow, renderShell } from './shell.js';
import {
  applyTheme,
  loadChoice,
  loadServerConfig,
  loadSession,
  loadSettings,
  state,
} from './state.js';
import { TestPage } from './test/page.js';
import { HistoryPage } from './pages/history.js';
import { BoardsPage } from './pages/boards.js';
import { AccountPage } from './pages/account.js';
import { SettingsPage } from './pages/settings.js';
import { RaceLobbyPage, RaceRoomPage } from './pages/race.js';
import { RunPage } from './pages/run.js';
import {
  NotFoundPage,
  ResetConfirmPage,
  ResetRequestPage,
  SignInPage,
  SignUpPage,
  VerifyPage,
} from './pages/auth.js';

definePage('/', () => new TestPage());
definePage('/history', () => new HistoryPage());
definePage('/boards', () => new BoardsPage());
definePage('/account', () => new AccountPage());
definePage('/settings', () => new SettingsPage());
definePage('/race', () => new RaceLobbyPage());
definePage('/race/:code', (params) => new RaceRoomPage(params['code'] as string));
definePage('/runs/:id', (params) => new RunPage(params['id'] as string));
definePage('/signup', () => new SignUpPage());
definePage('/signin', () => new SignInPage());
definePage('/reset', () => new ResetRequestPage());
definePage('/reset/:token', (params) => new ResetConfirmPage(params['token'] as string));
definePage('/verify/:token', (params) => new VerifyPage(params['token'] as string));
defineFallback(() => new NotFoundPage());

async function boot(): Promise<void> {
  window.addEventListener('strikeproof:unauthenticated', () => {
    if (!state.session) return;
    state.session = null;
    refreshTopRow();
  });
  loadChoice();
  await Promise.all([loadServerConfig(), loadSession()]);
  await loadSettings();
  applyTheme();
  renderShell();
  startRouter(mainElement, renderShell);
}

void boot();
