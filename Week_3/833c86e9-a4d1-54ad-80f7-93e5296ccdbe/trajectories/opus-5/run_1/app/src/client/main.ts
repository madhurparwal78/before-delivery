import { api } from './api';
import {
  HistoryEntryState,
  mountFrame,
  registerNotFound,
  registerPage,
  render,
  startEvents,
} from './app';
import { Me, Settings, setServerNow, state } from './state';
import { searchPage } from './pages/search';
import { propertyPage } from './pages/property';
import { checkoutPage } from './pages/checkout';
import { bookingPage } from './pages/booking';
import {
  accountPage,
  destinationsPage,
  findPage,
  forPropertiesPage,
  homePage,
  inboxPage,
  moderationPage,
  notFoundPage,
  reviewPage,
  signInPage,
  signUpPage,
} from './pages/simple';
import { calendarPage, importPage, reservationsPage, statementsPage } from './pages/manage';

function readSettings(): void {
  const node = document.getElementById('kip-settings');
  if (!node || !node.textContent) return;
  state.settings = { ...state.settings, ...(JSON.parse(node.textContent) as Settings) };
}

async function boot(): Promise<void> {
  readSettings();
  const time = await api<{ now: string }>('/api/time');
  setServerNow(time.now);
  const me = await api<Me>('/api/me');
  state.me = me;
  state.lang = me.lang;
  state.cur = me.cur;

  mountFrame();

  registerPage(/^\/$/, homePage);
  registerPage(/^\/search$/, searchPage);
  registerPage(/^\/properties\/[^/]+$/, propertyPage);
  registerPage(/^\/checkout\/[^/]+$/, checkoutPage);
  registerPage(/^\/bookings\/[^/]+$/, bookingPage);
  registerPage(/^\/find$/, findPage);
  registerPage(/^\/reviews\/[^/]+$/, reviewPage);
  registerPage(/^\/inbox$/, inboxPage);
  registerPage(/^\/account$/, accountPage);
  registerPage(/^\/signin$/, signInPage);
  registerPage(/^\/signup$/, signUpPage);
  registerPage(/^\/moderation$/, moderationPage);
  registerPage(/^\/destinations$/, destinationsPage);
  registerPage(/^\/for-properties$/, forPropertiesPage);
  registerPage(/^\/manage\/[^/]+\/calendar$/, calendarPage);
  registerPage(/^\/manage\/[^/]+\/reservations$/, reservationsPage);
  registerPage(/^\/manage\/[^/]+\/import$/, importPage);
  registerPage(/^\/manage\/[^/]+\/statements$/, statementsPage);
  registerNotFound(notFoundPage);

  window.addEventListener('popstate', () => {
    const entry = (history.state ?? null) as HistoryEntryState | null;
    void render(entry ?? undefined);
  });

  startEvents();
  await render();
}

void boot();
