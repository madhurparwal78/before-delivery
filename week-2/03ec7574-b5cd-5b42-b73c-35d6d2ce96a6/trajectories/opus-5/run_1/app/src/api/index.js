import { createContactRequest, login, logout, me } from './auth.js';
import {
  createAggregation, createPolicy, deletePolicy, evaluatePolicyRoute, getPolicyRoute,
  listAggregationsRoute, listPoliciesRoute, listPolicyRevisions, patchPolicy
} from './policies.js';
import {
  approvalsInbox, approveIntent, cancelIntent, exportIntents, getIntentRoute, listIntents, rejectIntent
} from './intents.js';
import { createBatch, createTransfer } from './transfers.js';
import {
  createApiKey, createMember, createQuorum, listApiKeysRoute, listAuditEvents, listMembersRoute,
  listQuorumsRoute, listWebhookEvents, patchMember, patchQuorum, readWebhookSecret, removeMember,
  revokeApiKey, rotateWebhookSecret, verifyAuditChain
} from './governance.js';
import {
  createDeposit, createWallet, freezeWallet, getWalletRoute, listWalletsRoute, patchWallet, unfreezeWallet
} from './wallets.js';

const open = { auth: 'none', org: false };
const anyCredential = { auth: 'required', role: 'readers' };

export const API_ROUTES = [
  { method: 'GET', path: '/api/v1/health', ...open, handler: async () => ({ status: 200, data: { status: 'ok' } }) },
  { method: 'POST', path: '/api/v1/auth/login', ...open, handler: login },
  { method: 'POST', path: '/api/v1/contact', ...open, handler: createContactRequest },
  { method: 'POST', path: '/api/v1/auth/logout', auth: 'required', role: 'members', handler: logout },
  { method: 'GET', path: '/api/v1/me', ...anyCredential, handler: me },

  { method: 'GET', path: '/api/v1/wallets', ...anyCredential, handler: listWalletsRoute },
  { method: 'POST', path: '/api/v1/wallets', auth: 'required', role: 'owner', handler: createWallet },
  { method: 'GET', path: '/api/v1/wallets/:id', ...anyCredential, handler: getWalletRoute },
  { method: 'PATCH', path: '/api/v1/wallets/:id', auth: 'required', role: 'owner', handler: patchWallet },
  { method: 'POST', path: '/api/v1/wallets/:id/freeze', auth: 'required', role: 'owner', handler: freezeWallet },
  { method: 'POST', path: '/api/v1/wallets/:id/unfreeze', auth: 'required', role: 'owner', handler: unfreezeWallet },
  { method: 'POST', path: '/api/v1/wallets/:id/transfers', auth: 'required', role: 'sender', idempotent: true, handler: createTransfer },
  { method: 'POST', path: '/api/v1/wallets/:id/batches', auth: 'required', role: 'sender', idempotent: true, handler: createBatch },
  { method: 'POST', path: '/api/v1/wallets/:id/deposits', auth: 'required', role: 'sender', idempotent: true, handler: createDeposit },

  { method: 'GET', path: '/api/v1/intents', ...anyCredential, handler: listIntents },
  { method: 'GET', path: '/api/v1/intents/export', ...anyCredential, handler: exportIntents },
  { method: 'GET', path: '/api/v1/intents/:id', ...anyCredential, handler: getIntentRoute },
  { method: 'POST', path: '/api/v1/intents/:id/approve', ...anyCredential, handler: approveIntent },
  { method: 'POST', path: '/api/v1/intents/:id/reject', ...anyCredential, handler: rejectIntent },
  { method: 'POST', path: '/api/v1/intents/:id/cancel', auth: 'required', role: 'canceller', handler: cancelIntent },
  { method: 'GET', path: '/api/v1/approvals/inbox', auth: 'required', role: 'members', handler: approvalsInbox },

  { method: 'GET', path: '/api/v1/policies', ...anyCredential, handler: listPoliciesRoute },
  { method: 'POST', path: '/api/v1/policies', auth: 'required', role: 'owner', handler: createPolicy },
  { method: 'GET', path: '/api/v1/policies/:id', ...anyCredential, handler: getPolicyRoute },
  { method: 'GET', path: '/api/v1/policies/:id/revisions', ...anyCredential, handler: listPolicyRevisions },
  { method: 'PATCH', path: '/api/v1/policies/:id', auth: 'required', role: 'owner', handler: patchPolicy },
  { method: 'DELETE', path: '/api/v1/policies/:id', auth: 'required', role: 'owner', handler: deletePolicy },
  { method: 'POST', path: '/api/v1/policies/:id/evaluate', ...anyCredential, handler: evaluatePolicyRoute },

  { method: 'GET', path: '/api/v1/aggregations', ...anyCredential, handler: listAggregationsRoute },
  { method: 'POST', path: '/api/v1/aggregations', auth: 'required', role: 'owner', handler: createAggregation },
  { method: 'GET', path: '/api/v1/quorums', ...anyCredential, handler: listQuorumsRoute },
  { method: 'POST', path: '/api/v1/quorums', auth: 'required', role: 'owner', handler: createQuorum },
  { method: 'PATCH', path: '/api/v1/quorums/:id', auth: 'required', role: 'owner', handler: patchQuorum },

  { method: 'GET', path: '/api/v1/members', ...anyCredential, handler: listMembersRoute },
  { method: 'POST', path: '/api/v1/members', auth: 'required', role: 'owner', handler: createMember },
  { method: 'PATCH', path: '/api/v1/members/:id', auth: 'required', role: 'owner', handler: patchMember },
  { method: 'DELETE', path: '/api/v1/members/:id', auth: 'required', role: 'owner', handler: removeMember },

  { method: 'GET', path: '/api/v1/api-keys', auth: 'required', role: 'auditReader', handler: listApiKeysRoute },
  { method: 'POST', path: '/api/v1/api-keys', auth: 'required', role: 'owner', handler: createApiKey },
  { method: 'DELETE', path: '/api/v1/api-keys/:id', auth: 'required', role: 'owner', handler: revokeApiKey },

  { method: 'GET', path: '/api/v1/audit', auth: 'required', role: 'auditReader', handler: listAuditEvents },
  { method: 'GET', path: '/api/v1/audit/verify', auth: 'required', role: 'auditReader', handler: verifyAuditChain },

  { method: 'GET', path: '/api/v1/webhooks/secret', auth: 'required', role: 'owner', handler: readWebhookSecret },
  { method: 'POST', path: '/api/v1/webhooks/secret/rotate', auth: 'required', role: 'owner', handler: rotateWebhookSecret },
  { method: 'GET', path: '/api/v1/webhooks/events', auth: 'required', role: 'auditReader', handler: listWebhookEvents }
];

export function matchApiRoute(method, pathname) {
  const segments = pathname.split('/').filter(Boolean);
  let pathExists = false;
  for (const route of API_ROUTES) {
    const routeSegments = route.path.split('/').filter(Boolean);
    if (routeSegments.length !== segments.length) continue;
    const params = {};
    let matched = true;
    for (let i = 0; i < routeSegments.length; i += 1) {
      const part = routeSegments[i];
      if (part.startsWith(':')) params[part.slice(1)] = decodeURIComponent(segments[i]);
      else if (part !== segments[i]) {
        matched = false;
        break;
      }
    }
    if (!matched) continue;
    pathExists = true;
    if (route.method === method) return { route, params };
  }
  return { route: null, params: {}, pathExists };
}
