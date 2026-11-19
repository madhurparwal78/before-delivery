'use strict';

// The published API surface. Under /api only these methods and paths exist.

const errors = require('../lib/errors');
const ready = require('../lib/ready');
const auth = require('../lib/auth');
const authRoutes = require('./auth');
const money = require('./money');
const recipients = require('./recipients');
const payments = require('./payments');
const ledger = require('./ledger');
const inquiries = require('./inquiries');

const PUBLIC = { authenticated: false };

async function health() {
  const healthy = await ready.isHealthy();
  return healthy
    ? { status: 200, body: { status: 'ok' } }
    : { status: 503, body: { status: 'unavailable' } };
}

const ROUTES = [
  { segments: ['health'], methods: { GET: { run: health, authenticated: false, needsDatabase: false } } },
  { segments: ['auth', 'signup'], methods: { POST: { run: authRoutes.signup, ...PUBLIC } } },
  { segments: ['auth', 'login'], methods: { POST: { run: authRoutes.login, ...PUBLIC } } },
  { segments: ['auth', 'logout'], methods: { POST: { run: authRoutes.logout } } },
  { segments: ['me'], methods: { GET: { run: authRoutes.me } } },
  {
    segments: ['accounts'],
    methods: { GET: { run: money.listAccounts }, POST: { run: money.createAccount } },
  },
  { segments: ['accounts', ':account_id'], methods: { GET: { run: money.getAccount } } },
  {
    segments: ['accounts', ':account_id', 'statement.csv'],
    methods: { GET: { run: money.statement } },
  },
  { segments: ['snapshot'], methods: { GET: { run: money.getSnapshot } } },
  { segments: ['transactions'], methods: { GET: { run: money.listTransactions } } },
  { segments: ['search'], methods: { GET: { run: money.search } } },
  { segments: ['stream'], methods: { GET: { run: money.openStream, tokenFromQuery: true } } },
  {
    segments: ['recipients'],
    methods: { GET: { run: recipients.list }, POST: { run: recipients.create } },
  },
  { segments: ['recipients', 'invite'], methods: { POST: { run: recipients.invite } } },
  {
    segments: ['recipients', ':recipient_id'],
    methods: { GET: { run: recipients.get }, DELETE: { run: recipients.remove } },
  },
  {
    segments: ['payments'],
    methods: { GET: { run: payments.list }, POST: { run: payments.create } },
  },
  { segments: ['payments', ':payment_id'], methods: { GET: { run: payments.get } } },
  { segments: ['payments', ':payment_id', 'cancel'], methods: { POST: { run: payments.cancel } } },
  { segments: ['payments', ':payment_id', 'approve'], methods: { POST: { run: payments.approve } } },
  { segments: ['payments', ':payment_id', 'reject'], methods: { POST: { run: payments.reject } } },
  { segments: ['approvals'], methods: { GET: { run: payments.approvals } } },
  { segments: ['fx', 'quotes'], methods: { POST: { run: ledger.createQuote } } },
  { segments: ['invoices'], methods: { GET: { run: ledger.listInvoices } } },
  { segments: ['invoices', ':invoice_id', 'send'], methods: { POST: { run: ledger.sendInvoice } } },
  {
    segments: ['invoices', ':invoice_id', 'mark-paid'],
    methods: { POST: { run: ledger.markInvoicePaid } },
  },
  { segments: ['loans'], methods: { GET: { run: ledger.listLoans } } },
  { segments: ['loans', ':loan_id', 'draw'], methods: { POST: { run: ledger.drawLoan } } },
  { segments: ['transfers'], methods: { POST: { run: ledger.createTransfer } } },
  { segments: ['audit'], methods: { GET: { run: ledger.listAudit } } },
  { segments: ['plans'], methods: { GET: { run: ledger.listPlans, ...PUBLIC } } },
  { segments: ['inquiries'], methods: { POST: { run: inquiries.create, ...PUBLIC } } },
];

// A literal path segment wins over an id segment.
function matchRoute(segments) {
  let best = null;
  let bestScore = -1;
  for (const route of ROUTES) {
    if (route.segments.length !== segments.length) continue;
    let score = 0;
    let params = {};
    let ok = true;
    for (let i = 0; i < segments.length; i += 1) {
      const pattern = route.segments[i];
      if (pattern.startsWith(':')) params[pattern.slice(1)] = segments[i];
      else if (pattern === segments[i]) score += 1;
      else {
        ok = false;
        break;
      }
    }
    if (ok && score > bestScore) {
      best = { route, params };
      bestScore = score;
    }
  }
  return best;
}

function bearerToken(req) {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

async function dispatch(ctx) {
  const matched = matchRoute(ctx.segments);
  if (!matched) throw errors.notFound();

  const allowed = Object.keys(matched.route.methods);
  const definition = matched.route.methods[ctx.method];
  if (!definition) throw errors.methodNotAllowed(allowed.join(', '));

  if (!ctx.bodyIsEmpty && !ctx.contentTypeIsJson) throw errors.unsupportedMediaType();

  if (definition.needsDatabase !== false) await ready.requireDatabase();

  ctx.params = matched.params;
  if (definition.authenticated !== false) {
    const token = definition.tokenFromQuery ? ctx.query.get('token') : bearerToken(ctx.req);
    const session = await auth.resolveSession(token);
    if (!session) throw errors.unauthorized();
    ctx.session = session;
    ctx.companyId = session.companyId;
    ctx.role = session.role;
  }
  return definition.run(ctx);
}

module.exports = { dispatch };
