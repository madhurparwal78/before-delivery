import { COPY } from '../shared/copy';
import type {
  ApiEntrant,
  ApiMatch,
  ApiTournament,
  ConfigResponse,
  LiveMessage,
  PublicEntrant,
  Standings,
} from '../shared/types';
import { api } from './api';
import { h } from './dom';

export interface Route {
  path: string;
  parts: string[];
  query: URLSearchParams;
}

export interface AppState {
  user: { username: string } | null;
  config: ConfigResponse | null;
  route: Route;
  tournament: ApiTournament | null;
  entrants: ApiEntrant[];
  publicEntrants: PublicEntrant[];
  matches: ApiMatch[];
  standings: Standings | null;
  shareCode: string | null;
  announcement: string;
  liveDown: boolean;
  myEntrantId: string | null;
  nextMatch: ApiMatch | null;
}

export const state: AppState = {
  user: null,
  config: null,
  route: { path: '/', parts: [], query: new URLSearchParams() },
  tournament: null,
  entrants: [],
  publicEntrants: [],
  matches: [],
  standings: null,
  shareCode: null,
  announcement: '',
  liveDown: false,
  myEntrantId: null,
  nextMatch: null,
};

const serverBase = { serverTime: Date.now(), pageTime: 0 };

export const noteServerTime = (iso: string): void => {
  serverBase.serverTime = Date.parse(iso);
  serverBase.pageTime = performance.now();
};

/** Server time as the page knows it: the last published server time plus time passed on the page. */
export const serverNow = (): number => serverBase.serverTime + (performance.now() - serverBase.pageTime);

// --- status regions ---------------------------------------------------------

const regions = {
  notice: h('div', { role: 'status', 'aria-label': 'Page notice', class: 'band band-notice' }),
  alert: h('div', { role: 'alert', class: 'band band-alert' }),
};

let noticeTimer = 0;

export const pageNotice = (text: string): void => {
  regions.notice.textContent = text;
  regions.notice.classList.toggle('shown', text !== '');
  window.clearTimeout(noticeTimer);
  if (text !== '') {
    noticeTimer = window.setTimeout(() => {
      regions.notice.textContent = '';
      regions.notice.classList.remove('shown');
    }, state.config?.toast_ms ?? 4000);
  }
};

export const pageAlert = (text: string): void => {
  regions.alert.textContent = text;
  regions.alert.classList.toggle('shown', text !== '');
};

export const bandNodes = (): HTMLElement[] => [regions.notice, regions.alert];

// --- routing ----------------------------------------------------------------

const parseRoute = (): Route => {
  const url = new URL(window.location.href);
  return {
    path: url.pathname,
    parts: url.pathname.split('/').filter((part) => part !== ''),
    query: url.searchParams,
  };
};

let renderer: (() => void) | null = null;

export const setRenderer = (render: () => void): void => {
  renderer = render;
};

export const refresh = (): void => {
  if (renderer !== null) renderer();
};

export const navigate = (path: string, replace = false): void => {
  if (replace) window.history.replaceState({}, '', path);
  else window.history.pushState({}, '', path);
  state.route = parseRoute();
  pageAlert('');
  refresh();
};

export const readRoute = (): void => {
  state.route = parseRoute();
};

window.addEventListener('popstate', () => {
  state.route = parseRoute();
  refresh();
});

// --- live channel -----------------------------------------------------------

let socket: WebSocket | null = null;
let liveKey = '';
let lastSeq = 0;
let reconnectTimer = 0;

export type LiveHandler = (message: LiveMessage) => void;
const liveHandlers = new Set<LiveHandler>();

export const onLive = (handler: LiveHandler): (() => void) => {
  liveHandlers.add(handler);
  return () => liveHandlers.delete(handler);
};

const applyLive = (message: LiveMessage): void => {
  lastSeq = Math.max(lastSeq, message.seq);
  noteServerTime(message.at);
  const data = message.data;
  switch (message.type) {
    case 'match.updated':
      if (data.match !== undefined) mergeMatch(data.match);
      break;
    case 'matches.reset':
      for (const match of data.matches ?? []) mergeMatch(match);
      break;
    case 'standings.updated':
      if (state.standings !== null && data.rows !== undefined) {
        state.standings = { columns: state.standings.columns, rows: data.rows };
      }
      break;
    case 'checkin.updated':
      if (state.tournament !== null && data.checked_in_count !== undefined) {
        state.tournament = { ...state.tournament, checked_in_count: data.checked_in_count };
      }
      if (data.entrant !== undefined) {
        const entrant = data.entrant;
        state.entrants = state.entrants.map((row) =>
          row.name === entrant.name ? { ...row, checked_in: entrant.checked_in } : row,
        );
      }
      break;
    case 'entrants.updated':
      if (data.entrants !== undefined) {
        if (state.shareCode !== null) state.publicEntrants = data.entrants as PublicEntrant[];
        else state.entrants = data.entrants as ApiEntrant[];
      }
      break;
    case 'tournament.updated':
      if (data.tournament !== undefined) {
        const before = state.tournament;
        state.tournament = data.tournament;
        if (before === null || before.state !== data.tournament.state) void reloadMatches();
      }
      break;
    case 'announcement':
      state.announcement = data.text ?? '';
      break;
    default:
      break;
  }
  for (const handler of [...liveHandlers]) handler(message);
};

export const mergeMatch = (match: ApiMatch): void => {
  const index = state.matches.findIndex((row) => row.id === match.id);
  if (index === -1) state.matches = [...state.matches, match];
  else state.matches = state.matches.map((row) => (row.id === match.id ? match : row));
};

export const reloadMatches = async (): Promise<void> => {
  const tournament = state.tournament;
  if (tournament === null) return;
  if (state.shareCode !== null) {
    const payload = await api.share(state.shareCode);
    state.matches = payload.matches;
    state.standings = payload.standings;
    state.publicEntrants = payload.entrants;
    state.tournament = payload.tournament;
  } else {
    const { matches } = await api.matches(tournament.id);
    state.matches = matches;
    if (tournament.format === 'round_robin' || tournament.format === 'swiss') {
      state.standings = await api.standings(tournament.id);
    }
    const { entrants } = await api.entrants(tournament.id);
    state.entrants = entrants;
  }
  refresh();
};

export const connectLive = (tournamentId: string, shareCode: string | null): void => {
  const key = `${tournamentId}:${shareCode ?? ''}`;
  if (liveKey === key && socket !== null && socket.readyState <= WebSocket.OPEN) return;
  liveKey = key;
  lastSeq = 0;
  openSocket();
};

export const disconnectLive = (): void => {
  liveKey = '';
  window.clearTimeout(reconnectTimer);
  if (socket !== null) {
    socket.onclose = null;
    socket.close();
    socket = null;
  }
};

const openSocket = (): void => {
  if (liveKey === '') return;
  const [tournamentId, shareCode] = liveKey.split(':');
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const query = new URLSearchParams();
  if (shareCode !== undefined && shareCode !== '') query.set('share', shareCode);
  if (lastSeq > 0) query.set('after', String(lastSeq));
  const suffix = query.toString() === '' ? '' : `?${query.toString()}`;
  const next = new WebSocket(`${protocol}//${window.location.host}/api/tournaments/${tournamentId}/live${suffix}`);
  socket = next;
  next.onopen = () => {
    if (state.liveDown) {
      state.liveDown = false;
      pageAlert('');
      void reloadMatches();
    }
  };
  next.onmessage = (event) => {
    applyLive(JSON.parse(String(event.data)) as LiveMessage);
    refresh();
  };
  next.onclose = () => {
    if (liveKey === '') return;
    state.liveDown = true;
    pageAlert(COPY.liveDown);
    refresh();
    window.clearTimeout(reconnectTimer);
    reconnectTimer = window.setTimeout(openSocket, 1000);
  };
};
