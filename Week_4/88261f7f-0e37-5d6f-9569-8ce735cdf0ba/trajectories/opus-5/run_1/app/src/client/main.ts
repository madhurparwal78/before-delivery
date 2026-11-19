import { pageNotFoundText } from '../shared/notices';
import { call } from './api';
import {
  homeFor,
  loadBoard,
  loadDesk,
  loadGuests,
  loadRates,
  loadReport,
  loadRoute,
  mayOpen,
  render,
  setRenderer,
  state,
} from './app';
import { showCloseEndState, sweepIsRunning } from './closeSweep';
import { currentLayout, el, replaceChildren } from './dom';
import { applyPushedMessage, regionNames } from './regions';
import { boardScreen } from './screens/board';
import { checkinScreen } from './screens/checkin';
import { deskGridNode, deskScreen, restoreDeskFocus } from './screens/desk';
import { guestsScreen } from './screens/guests';
import { ratesScreen } from './screens/rates';
import { reportsScreen } from './screens/reports';
import { signInScreen } from './screens/signin';
import { refreshStayPanel } from './stayPanel';
import { User } from './types';

interface Change {
  type: 'stay' | 'room' | 'close' | 'checkin' | 'merge' | 'report';
  notice: string | null;
  stayId?: string;
  roomId?: string;
  businessDate?: string;
}

function appRoot(): HTMLElement {
  const node = document.getElementById('app');
  if (node) return node;
  const created = el('div', { id: 'app' });
  document.body.append(created);
  return created;
}

function screenFor(): HTMLElement {
  if (!state.user) return signInScreen();
  if (!mayOpen(state.user.role, state.route)) {
    return el('main', { class: 'notfound' }, [el('p', { text: pageNotFoundText })]);
  }
  switch (state.route) {
    case '/desk':
      return deskScreen();
    case '/board':
      return boardScreen();
    case '/guests':
      return guestsScreen();
    case '/rates':
      return ratesScreen();
    default:
      return reportsScreen();
  }
}

function renderScreen(): void {
  const grid = deskGridNode();
  const hadGridFocus = grid !== null && grid.contains(document.activeElement);
  replaceChildren(appRoot(), [screenFor()]);
  document.documentElement.setAttribute('data-layout', state.layout);
  restoreDeskFocus(hadGridFocus);
}

async function refreshForChange(): Promise<void> {
  if (state.route === '/desk') await loadDesk();
  if (state.route === '/board') {
    await loadBoard();
    if (state.user && state.user.role !== 'housekeeper') await loadDesk();
  }
  if (state.route === '/guests') await loadGuests();
  if (state.route === '/rates') await loadRates();
  if (state.route === '/reports') await loadReport();
  await refreshStayPanel();
  render();
}

async function onChange(change: Change): Promise<void> {
  if (change.notice !== null) {
    if (change.type === 'close') {
      applyPushedMessage(regionNames.closeStatus, change.notice);
    } else if (state.route === '/board') {
      applyPushedMessage(regionNames.boardStatus, change.notice);
    } else {
      applyPushedMessage(regionNames.deskNotices, change.notice);
    }
  }
  if (change.type === 'close' && change.businessDate !== undefined) {
    if (sweepIsRunning()) return;
    await showCloseEndState(change.businessDate);
    return;
  }
  await refreshForChange();
}

function startLive(): void {
  const source = new EventSource('/api/live');
  source.addEventListener('change', (event) => {
    void onChange(JSON.parse((event as MessageEvent<string>).data) as Change);
  });
}

function watchLayout(): void {
  window.addEventListener('resize', () => {
    const next = currentLayout();
    if (next === state.layout) return;
    state.layout = next;
    render();
  });
}

async function boot(): Promise<void> {
  setRenderer(renderScreen);
  const path = window.location.pathname;
  if (path.startsWith('/checkin/')) {
    const token = path.slice('/checkin/'.length);
    replaceChildren(appRoot(), [await checkinScreen(token)]);
    return;
  }
  const session = await call<{ user: User }>('/api/session');
  state.user = session.data ? session.data.user : null;
  state.route = path;
  if (!state.user) {
    renderScreen();
    return;
  }
  if (path === '/') {
    window.location.assign(homeFor(state.user.role));
    return;
  }
  watchLayout();
  window.addEventListener('popstate', () => {
    state.route = window.location.pathname;
    void loadRoute();
  });
  startLive();
  await loadRoute();
}

void boot();
