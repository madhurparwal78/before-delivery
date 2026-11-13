import type { Route } from '../http/server.ts';
import { getMe, postSignIn, postSignOut, postSignUp } from './auth.ts';
import {
  getClubs,
  getCurrentGameweek,
  getGameweeks,
  getPlayers,
} from './catalogue.ts';
import {
  deleteChip,
  deleteDraft,
  getDraft,
  getSquad,
  postChip,
  postSquad,
  postTransferPreview,
  postTransfers,
  putDraft,
  putPicks,
} from './team.ts';
import { getHistory, getLedger, getSnapshot, getTransferHistory } from './history.ts';
import {
  getLeague,
  getLeagues,
  getMemberHistory,
  getMemberSnapshot,
  postJoinLeague,
  postLeague,
  postLeagueCode,
} from './leagues.ts';
import { getNotices, postReadAll } from './notices.ts';
import {
  getEvents,
  postClose,
  postEvent,
  postPriceRun,
  postStart,
  postVoidEvent,
  putFixtures,
} from './operator.ts';

export const routes: Route[] = [
  { method: 'GET', path: '/api/health', auth: 'public', handler: async () => ({ status: 200, body: { status: 'ok' } }) },

  { method: 'POST', path: '/api/auth/signup', auth: 'public', handler: postSignUp },
  { method: 'POST', path: '/api/auth/signin', auth: 'public', handler: postSignIn },
  { method: 'POST', path: '/api/auth/signout', auth: 'public', handler: postSignOut },
  { method: 'GET', path: '/api/me', auth: 'any', handler: getMe },

  { method: 'GET', path: '/api/clubs', auth: 'any', handler: getClubs },
  { method: 'GET', path: '/api/players', auth: 'any', handler: getPlayers },
  { method: 'GET', path: '/api/gameweeks', auth: 'any', handler: getGameweeks },
  { method: 'GET', path: '/api/gameweeks/current', auth: 'any', handler: getCurrentGameweek },

  { method: 'POST', path: '/api/squad', auth: 'manager', handler: postSquad },
  { method: 'GET', path: '/api/squad', auth: 'manager', handler: getSquad },
  { method: 'PUT', path: '/api/picks', auth: 'manager', handler: putPicks },
  { method: 'POST', path: '/api/chips', auth: 'manager', handler: postChip },
  { method: 'DELETE', path: '/api/chips/:gameweek', auth: 'manager', handler: deleteChip },
  {
    method: 'POST',
    path: '/api/transfers/preview',
    auth: 'manager',
    handler: postTransferPreview,
  },
  { method: 'POST', path: '/api/transfers', auth: 'manager', handler: postTransfers },
  { method: 'GET', path: '/api/transfers/draft', auth: 'manager', handler: getDraft },
  { method: 'PUT', path: '/api/transfers/draft', auth: 'manager', handler: putDraft },
  { method: 'DELETE', path: '/api/transfers/draft', auth: 'manager', handler: deleteDraft },

  { method: 'GET', path: '/api/history', auth: 'manager', handler: getHistory },
  { method: 'GET', path: '/api/history/transfers', auth: 'manager', handler: getTransferHistory },
  { method: 'GET', path: '/api/history/ledger', auth: 'manager', handler: getLedger },
  { method: 'GET', path: '/api/history/:gameweek/snapshot', auth: 'manager', handler: getSnapshot },

  { method: 'POST', path: '/api/leagues', auth: 'manager', handler: postLeague },
  { method: 'POST', path: '/api/leagues/join', auth: 'manager', handler: postJoinLeague },
  { method: 'GET', path: '/api/leagues', auth: 'manager', handler: getLeagues },
  { method: 'GET', path: '/api/leagues/:league', auth: 'manager', handler: getLeague },
  { method: 'POST', path: '/api/leagues/:league/code', auth: 'manager', handler: postLeagueCode },
  {
    method: 'GET',
    path: '/api/leagues/:league/members/:member/history',
    auth: 'manager',
    handler: getMemberHistory,
  },
  {
    method: 'GET',
    path: '/api/leagues/:league/members/:member/snapshots/:gameweek',
    auth: 'manager',
    handler: getMemberSnapshot,
  },

  { method: 'GET', path: '/api/notices', auth: 'any', handler: getNotices },
  { method: 'POST', path: '/api/notices/read-all', auth: 'any', handler: postReadAll },

  {
    method: 'PUT',
    path: '/api/operator/gameweeks/:gameweek/fixtures',
    auth: 'operator',
    handler: putFixtures,
  },
  {
    method: 'POST',
    path: '/api/operator/gameweeks/:gameweek/start',
    auth: 'operator',
    handler: postStart,
  },
  {
    method: 'POST',
    path: '/api/operator/gameweeks/:gameweek/close',
    auth: 'operator',
    handler: postClose,
  },
  {
    method: 'GET',
    path: '/api/operator/gameweeks/:gameweek/events',
    auth: 'operator',
    handler: getEvents,
  },
  { method: 'POST', path: '/api/operator/events', auth: 'operator', handler: postEvent },
  {
    method: 'POST',
    path: '/api/operator/events/:event/void',
    auth: 'operator',
    handler: postVoidEvent,
  },
  { method: 'POST', path: '/api/operator/price-runs', auth: 'operator', handler: postPriceRun },
];

export interface RouteMatch {
  route: Route;
  params: Record<string, string>;
}

export const matchRoute = (method: string, pathname: string): RouteMatch | null => {
  const segments = pathname.split('/').filter((segment) => segment !== '');
  for (const route of routes) {
    if (route.method !== method) continue;
    const pattern = route.path.split('/').filter((segment) => segment !== '');
    if (pattern.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (const [index, part] of pattern.entries()) {
      const value = segments[index]!;
      if (part.startsWith(':')) {
        params[part.slice(1)] = decodeURIComponent(value);
      } else if (part !== value) {
        matched = false;
        break;
      }
    }
    if (matched) return { route, params };
  }
  return null;
};
