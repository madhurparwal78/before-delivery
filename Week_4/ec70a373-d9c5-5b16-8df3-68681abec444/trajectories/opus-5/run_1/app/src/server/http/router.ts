import type { RouteDef } from './context';
import { getHealth } from '../routes/health';
import { deleteSession, getMe, getSites, postSession } from '../routes/session';
import { getAvailability } from '../routes/availability';
import {
  getBooking,
  getBookings,
  getSiteBookings,
  postBooking,
  postCancel,
  postCheckIn,
  postCheckOut,
  postConfirm,
  postNoShow,
  postSeries,
} from '../routes/bookings';
import { getLedger, getPacks, postPackPurchase } from '../routes/packs';
import {
  getDocument,
  getDocumentFile,
  getDocuments,
  postDocument,
  postReject,
  postVerify,
} from '../routes/documents';
import {
  getInspectorLinks,
  getVisits,
  postDepart,
  postInspectorLink,
  postReissueLink,
  postRevokeLink,
  postVisit,
} from '../routes/trucks';
import { getInspect, getInspectPdf } from '../routes/inspect';
import {
  getAudit,
  getMembers,
  getRates,
  getReport,
  getReportCsv,
  postRate,
} from '../routes/finance';

export const ROUTES: RouteDef[] = [
  { pattern: '/api/health', methods: [{ method: 'GET', roles: 'public', handler: getHealth }] },
  {
    pattern: '/api/session',
    methods: [
      { method: 'POST', roles: 'public', handler: postSession },
      { method: 'DELETE', roles: 'public', handler: deleteSession },
    ],
  },
  {
    pattern: '/api/me',
    methods: [
      { method: 'GET', roles: ['member', 'kitchen_manager', 'finance_lead'], handler: getMe },
    ],
  },
  {
    pattern: '/api/me/ledger',
    methods: [{ method: 'GET', roles: ['member'], handler: getLedger }],
  },
  {
    pattern: '/api/sites',
    methods: [
      { method: 'GET', roles: ['member', 'kitchen_manager', 'finance_lead'], handler: getSites },
    ],
  },
  {
    pattern: '/api/sites/{site_id}/availability',
    methods: [
      { method: 'GET', roles: ['member', 'kitchen_manager'], handler: getAvailability },
    ],
  },
  {
    pattern: '/api/sites/{site_id}/bookings',
    methods: [
      { method: 'GET', roles: ['kitchen_manager', 'finance_lead'], handler: getSiteBookings },
    ],
  },
  {
    pattern: '/api/sites/{site_id}/rates',
    methods: [
      { method: 'GET', roles: ['finance_lead'], handler: getRates },
      { method: 'POST', roles: ['finance_lead'], handler: postRate },
    ],
  },
  {
    pattern: '/api/bookings',
    methods: [
      { method: 'POST', roles: ['member'], handler: postBooking },
      { method: 'GET', roles: ['member'], handler: getBookings },
    ],
  },
  {
    pattern: '/api/bookings/{id}',
    methods: [
      { method: 'GET', roles: ['member', 'kitchen_manager'], handler: getBooking },
    ],
  },
  {
    pattern: '/api/bookings/{id}/confirm',
    methods: [{ method: 'POST', roles: ['member'], handler: postConfirm }],
  },
  {
    pattern: '/api/bookings/{id}/cancel',
    methods: [
      { method: 'POST', roles: ['member', 'kitchen_manager'], handler: postCancel },
    ],
  },
  {
    pattern: '/api/bookings/{id}/check-in',
    methods: [{ method: 'POST', roles: ['kitchen_manager'], handler: postCheckIn }],
  },
  {
    pattern: '/api/bookings/{id}/no-show',
    methods: [{ method: 'POST', roles: ['kitchen_manager'], handler: postNoShow }],
  },
  {
    pattern: '/api/bookings/{id}/check-out',
    methods: [{ method: 'POST', roles: ['kitchen_manager'], handler: postCheckOut }],
  },
  {
    pattern: '/api/recurring-series',
    methods: [{ method: 'POST', roles: ['member'], handler: postSeries }],
  },
  {
    pattern: '/api/packs',
    methods: [{ method: 'GET', roles: ['member', 'finance_lead'], handler: getPacks }],
  },
  {
    pattern: '/api/pack-purchases',
    methods: [{ method: 'POST', roles: ['member'], handler: postPackPurchase }],
  },
  {
    pattern: '/api/documents',
    methods: [
      { method: 'POST', roles: ['member'], handler: postDocument },
      { method: 'GET', roles: ['member', 'kitchen_manager'], handler: getDocuments },
    ],
  },
  {
    pattern: '/api/documents/{id}',
    methods: [
      { method: 'GET', roles: ['member', 'kitchen_manager'], handler: getDocument },
    ],
  },
  {
    pattern: '/api/documents/{id}/file',
    methods: [
      { method: 'GET', roles: ['member', 'kitchen_manager'], handler: getDocumentFile },
    ],
  },
  {
    pattern: '/api/documents/{id}/verify',
    methods: [{ method: 'POST', roles: ['kitchen_manager'], handler: postVerify }],
  },
  {
    pattern: '/api/documents/{id}/reject',
    methods: [{ method: 'POST', roles: ['kitchen_manager'], handler: postReject }],
  },
  {
    pattern: '/api/members',
    methods: [
      { method: 'GET', roles: ['kitchen_manager', 'finance_lead'], handler: getMembers },
    ],
  },
  {
    pattern: '/api/trucks/{truck_id}/visits',
    methods: [
      { method: 'GET', roles: ['member', 'kitchen_manager'], handler: getVisits },
      { method: 'POST', roles: ['kitchen_manager'], handler: postVisit },
    ],
  },
  {
    pattern: '/api/visits/{id}/depart',
    methods: [{ method: 'POST', roles: ['kitchen_manager'], handler: postDepart }],
  },
  {
    pattern: '/api/trucks/{truck_id}/inspector-links',
    methods: [
      { method: 'GET', roles: ['kitchen_manager'], handler: getInspectorLinks },
      { method: 'POST', roles: ['kitchen_manager'], handler: postInspectorLink },
    ],
  },
  {
    pattern: '/api/inspector-links/{id}/revoke',
    methods: [{ method: 'POST', roles: ['kitchen_manager'], handler: postRevokeLink }],
  },
  {
    pattern: '/api/inspector-links/{id}/reissue',
    methods: [{ method: 'POST', roles: ['kitchen_manager'], handler: postReissueLink }],
  },
  {
    pattern: '/api/inspect/{token}',
    methods: [{ method: 'GET', roles: 'public', handler: getInspect }],
  },
  {
    pattern: '/api/inspect/{token}/log.pdf',
    methods: [{ method: 'GET', roles: 'public', handler: getInspectPdf }],
  },
  {
    pattern: '/api/reports/utilisation',
    methods: [{ method: 'GET', roles: ['finance_lead'], handler: getReport }],
  },
  {
    pattern: '/api/reports/utilisation.csv',
    methods: [{ method: 'GET', roles: ['finance_lead'], handler: getReportCsv }],
  },
  {
    pattern: '/api/audit',
    methods: [
      { method: 'GET', roles: ['kitchen_manager', 'finance_lead'], handler: getAudit },
    ],
  },
];

export interface RouteMatch {
  route: RouteDef;
  params: Record<string, string>;
}

const COMPILED = ROUTES.map((route) => ({
  route,
  segments: route.pattern.split('/').filter((segment) => segment.length > 0),
}));

export function matchRoute(path: string): RouteMatch | null {
  const parts = path.split('/').filter((segment) => segment.length > 0);
  for (const candidate of COMPILED) {
    if (candidate.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (let index = 0; index < candidate.segments.length; index += 1) {
      const segment = candidate.segments[index] as string;
      const value = parts[index] as string;
      if (segment.startsWith('{') && segment.endsWith('}')) {
        params[segment.slice(1, -1)] = decodeURIComponent(value);
      } else if (segment !== value) {
        matched = false;
        break;
      }
    }
    if (matched) return { route: candidate.route, params };
  }
  return null;
}

export function allowHeader(route: RouteDef): string {
  return route.methods.map((method) => method.method).join(', ');
}
