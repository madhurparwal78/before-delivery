import type { Route } from './http.js';

export const routes: Route[] = [
  // Session
  { method: 'POST', pattern: '/api/session', handler: 'session.create', roles: 'public', bodyLimit: 64000, bodyKind: 'json' },
  { method: 'GET', pattern: '/api/session', handler: 'session.get', roles: 'session', bodyLimit: 0, bodyKind: 'none' },
  { method: 'DELETE', pattern: '/api/session', handler: 'session.delete', roles: 'session', bodyLimit: 0, bodyKind: 'none' },
  // Health
  { method: 'GET', pattern: '/api/health', handler: 'health', roles: 'public', bodyLimit: 0, bodyKind: 'none' },
  // Workspace
  { method: 'GET', pattern: '/api/w/:slug', handler: 'workspace.get', roles: 'session', bodyLimit: 0, bodyKind: 'none' },
  // Members
  { method: 'GET', pattern: '/api/w/:slug/members', handler: 'members.list', roles: ['compliance_officer'], bodyLimit: 0, bodyKind: 'none' },
  { method: 'POST', pattern: '/api/w/:slug/members', handler: 'members.create', roles: ['compliance_officer'], bodyLimit: 64000, bodyKind: 'json' },
  { method: 'GET', pattern: '/api/w/:slug/members/:id', handler: 'members.get', roles: ['compliance_officer'], bodyLimit: 0, bodyKind: 'none' },
  { method: 'PATCH', pattern: '/api/w/:slug/members/:id', handler: 'members.update', roles: ['compliance_officer'], bodyLimit: 64000, bodyKind: 'json' },
  { method: 'DELETE', pattern: '/api/w/:slug/members/:id', handler: 'members.remove', roles: ['compliance_officer'], bodyLimit: 0, bodyKind: 'none' },
  // Public directory
  { method: 'GET', pattern: '/api/public/stats', handler: 'public.stats', roles: 'public', bodyLimit: 0, bodyKind: 'none' },
  { method: 'GET', pattern: '/api/public/jurisdictions', handler: 'public.jurisdictions', roles: 'public', bodyLimit: 0, bodyKind: 'none' },
  { method: 'GET', pattern: '/api/public/jurisdictions/:code', handler: 'public.jurisdiction', roles: 'public', bodyLimit: 0, bodyKind: 'none' },
  { method: 'GET', pattern: '/api/public/exchanges', handler: 'public.exchanges', roles: 'public', bodyLimit: 0, bodyKind: 'none' },
  { method: 'GET', pattern: '/api/public/exchanges/:slug', handler: 'public.exchange', roles: 'public', bodyLimit: 0, bodyKind: 'none' },
  { method: 'GET', pattern: '/sitemap.xml', handler: 'public.sitemap', roles: 'public', bodyLimit: 0, bodyKind: 'none' },
  // Listing
  { method: 'GET', pattern: '/api/w/:slug/listing', handler: 'listing.get', roles: 'session', bodyLimit: 0, bodyKind: 'none' },
  { method: 'PUT', pattern: '/api/w/:slug/listing', handler: 'listing.put', roles: ['compliance_officer'], bodyLimit: 64000, bodyKind: 'json' },
  // Rules
  { method: 'GET', pattern: '/api/w/:slug/rules', handler: 'rules.list', roles: 'session', bodyLimit: 0, bodyKind: 'none' },
  { method: 'GET', pattern: '/api/w/:slug/rules/:code', handler: 'rules.get', roles: 'session', bodyLimit: 0, bodyKind: 'none' },
  { method: 'POST', pattern: '/api/w/:slug/rules/changes', handler: 'rules.announce', roles: ['compliance_officer'], bodyLimit: 64000, bodyKind: 'json' },
  { method: 'GET', pattern: '/api/w/:slug/reports/daily', handler: 'rules.daily', roles: ['compliance_officer', 'compliance_analyst'], bodyLimit: 0, bodyKind: 'none' },
  { method: 'GET', pattern: '/api/w/:slug/rates', handler: 'rules.rates', roles: 'session', bodyLimit: 0, bodyKind: 'none' },
  // Counterparties
  { method: 'GET', pattern: '/api/w/:slug/counterparties', handler: 'counterparties.list', roles: 'session', bodyLimit: 0, bodyKind: 'none' },
  { method: 'POST', pattern: '/api/w/:slug/counterparties', handler: 'counterparties.create', roles: ['compliance_officer', 'compliance_analyst'], bodyLimit: 64000, bodyKind: 'json' },
  { method: 'GET', pattern: '/api/w/:slug/counterparties/:id', handler: 'counterparties.get', roles: 'session', bodyLimit: 0, bodyKind: 'none' },
  { method: 'PATCH', pattern: '/api/w/:slug/counterparties/:id', handler: 'counterparties.update', roles: ['compliance_officer', 'compliance_analyst'], bodyLimit: 64000, bodyKind: 'json' },
  { method: 'POST', pattern: '/api/w/:slug/counterparties/import/preview', handler: 'counterparties.preview', roles: ['compliance_officer', 'compliance_analyst'], bodyLimit: 1000000, bodyKind: 'raw' },
  { method: 'POST', pattern: '/api/w/:slug/counterparties/import', handler: 'counterparties.import', roles: ['compliance_officer', 'compliance_analyst'], bodyLimit: 1000000, bodyKind: 'raw' },
  { method: 'GET', pattern: '/api/w/:slug/customers', handler: 'counterparties.customers', roles: 'session', bodyLimit: 0, bodyKind: 'none' },
  { method: 'GET', pattern: '/api/w/:slug/address-registry', handler: 'counterparties.registry', roles: 'session', bodyLimit: 0, bodyKind: 'none' },
  // Cases
  { method: 'GET', pattern: '/api/w/:slug/cases', handler: 'cases.list', roles: 'session', bodyLimit: 0, bodyKind: 'none' },
  { method: 'POST', pattern: '/api/w/:slug/cases', handler: 'cases.create', roles: ['compliance_officer', 'compliance_analyst'], bodyLimit: 64000, bodyKind: 'json' },
  { method: 'GET', pattern: '/api/w/:slug/cases/:id', handler: 'cases.get', roles: 'session', bodyLimit: 0, bodyKind: 'none' },
  { method: 'POST', pattern: '/api/w/:slug/cases/:id/release', handler: 'cases.release', roles: ['operations_lead'], bodyLimit: 64000, bodyKind: 'json' },
  { method: 'POST', pattern: '/api/w/:slug/cases/:id/return', handler: 'cases.return', roles: ['operations_lead'], bodyLimit: 64000, bodyKind: 'json' },
  { method: 'POST', pattern: '/api/w/:slug/cases/:id/release-reason', handler: 'cases.releaseReason', roles: ['compliance_officer'], bodyLimit: 64000, bodyKind: 'json' },
  { method: 'POST', pattern: '/api/w/:slug/cases/:id/ownership', handler: 'cases.ownership', roles: ['compliance_officer', 'compliance_analyst'], bodyLimit: 64000, bodyKind: 'json' },
  { method: 'POST', pattern: '/api/w/:slug/cases/:id/request-page', handler: 'cases.newRequestPage', roles: ['compliance_officer', 'compliance_analyst'], bodyLimit: 64000, bodyKind: 'json' },
  { method: 'DELETE', pattern: '/api/w/:slug/cases/:id/request-page', handler: 'cases.endRequestPage', roles: ['compliance_officer', 'compliance_analyst'], bodyLimit: 0, bodyKind: 'none' },
  { method: 'POST', pattern: '/api/w/:slug/cases/:id/archive', handler: 'cases.archive', roles: ['compliance_officer'], bodyLimit: 64000, bodyKind: 'json' },
  { method: 'POST', pattern: '/api/w/:slug/cases/:id/restore', handler: 'cases.restore', roles: ['compliance_officer'], bodyLimit: 64000, bodyKind: 'json' },
  // Review
  { method: 'GET', pattern: '/api/w/:slug/review', handler: 'review.list', roles: ['compliance_officer', 'compliance_analyst', 'support_agent'], bodyLimit: 0, bodyKind: 'none' },
  { method: 'POST', pattern: '/api/w/:slug/review/:id/claim', handler: 'review.claim', roles: ['compliance_analyst'], bodyLimit: 64000, bodyKind: 'json' },
  { method: 'POST', pattern: '/api/w/:slug/review/:id/decision', handler: 'review.decision', roles: ['compliance_analyst'], bodyLimit: 64000, bodyKind: 'json' },
  // Messages
  { method: 'POST', pattern: '/api/network/:slug/messages', handler: 'messages.post', roles: 'public', bodyLimit: 256000, bodyKind: 'raw' },
  { method: 'GET', pattern: '/api/w/:slug/messages', handler: 'messages.list', roles: ['compliance_officer', 'compliance_analyst', 'operations_lead', 'support_agent'], bodyLimit: 0, bodyKind: 'none' },
  { method: 'GET', pattern: '/api/w/:slug/messages/:id', handler: 'messages.get', roles: ['compliance_officer', 'compliance_analyst', 'operations_lead', 'support_agent'], bodyLimit: 0, bodyKind: 'none' },
  { method: 'GET', pattern: '/api/w/:slug/messages/:id/original', handler: 'messages.original', roles: ['compliance_officer', 'compliance_analyst'], bodyLimit: 0, bodyKind: 'none' },
  // Request pages
  { method: 'GET', pattern: '/api/request-pages/:token', handler: 'requestPages.get', roles: 'public', bodyLimit: 0, bodyKind: 'none' },
  { method: 'POST', pattern: '/api/request-pages/:token/answer', handler: 'requestPages.answer', roles: 'public', bodyLimit: 6000000, bodyKind: 'multipart' },
  // Months
  { method: 'GET', pattern: '/api/w/:slug/months', handler: 'months.list', roles: ['compliance_officer', 'finance_lead'], bodyLimit: 0, bodyKind: 'none' },
  { method: 'GET', pattern: '/api/w/:slug/months/:month', handler: 'months.get', roles: ['compliance_officer', 'finance_lead'], bodyLimit: 0, bodyKind: 'none' },
  { method: 'POST', pattern: '/api/w/:slug/months/:month/close', handler: 'months.close', roles: ['finance_lead'], bodyLimit: 64000, bodyKind: 'json' },
  // Regulator files
  { method: 'GET', pattern: '/api/w/:slug/files', handler: 'files.list', roles: ['compliance_officer', 'compliance_analyst', 'support_agent'], bodyLimit: 0, bodyKind: 'none' },
  { method: 'GET', pattern: '/api/w/:slug/files/regulator', handler: 'files.regulator', roles: ['compliance_officer', 'compliance_analyst', 'support_agent'], bodyLimit: 0, bodyKind: 'none' },
  // Partner access
  { method: 'POST', pattern: '/api/partner/v1/cases', handler: 'partner.createCase', roles: 'partner', bodyLimit: 64000, bodyKind: 'json' },
  { method: 'GET', pattern: '/api/w/:slug/partner-keys', handler: 'partner.keys', roles: ['compliance_officer'], bodyLimit: 0, bodyKind: 'none' },
  { method: 'POST', pattern: '/api/w/:slug/partner-keys', handler: 'partner.createKey', roles: ['compliance_officer'], bodyLimit: 64000, bodyKind: 'json' },
  { method: 'DELETE', pattern: '/api/w/:slug/partner-keys/:id', handler: 'partner.revokeKey', roles: ['compliance_officer'], bodyLimit: 0, bodyKind: 'none' },
];
