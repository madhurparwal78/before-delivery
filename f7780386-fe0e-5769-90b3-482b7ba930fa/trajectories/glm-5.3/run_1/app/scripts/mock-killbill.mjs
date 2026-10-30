// A local stand-in for Kill Bill used only to verify Passboard's billing
// integration end to end: account creation, external charges, invoice
// payments, credits and invoice reads, on both context prefixes.

import { createServer } from 'node:http';

const PORT = 8090;
const accounts = new Map(); // externalKey -> { accountId, name, email }
const invoices = new Map(); // accountId -> [{ invoiceId, amount, balance, items }]
const counters = { account: 0, invoice: 0, credit: 0 };

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let path = url.pathname;
  for (const prefix of ['/killbill', '']) {
    if (path === prefix) continue;
    if (prefix && path.startsWith(prefix)) path = path.slice(prefix.length);
    if (path.startsWith('/v1/')) break;
  }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const data = body ? JSON.parse(body) : {};
    if (req.method === 'GET' && path === '/v1/healthcheck') {
      json(res, 200, {});
      return;
    }
    if (req.method === 'GET' && path.startsWith('/v1/accounts') && url.searchParams.has('externalKey')) {
      const account = accounts.get(url.searchParams.get('externalKey'));
      if (!account) {
        json(res, 404, { error: 'not_found' });
        return;
      }
      json(res, 200, account);
      return;
    }
    if (req.method === 'POST' && path === '/v1/accounts') {
      const accountId = `acc-${++counters.account}`;
      const account = {
        accountId,
        externalKey: data.externalKey,
        name: data.name,
        email: data.email,
      };
      accounts.set(data.externalKey, account);
      invoices.set(accountId, []);
      json(res, 201, account);
      return;
    }
    const chargeMatch = /^\/v1\/accounts\/([^/]+)\/charges$/.exec(path);
    if (req.method === 'POST' && chargeMatch) {
      const accountId = chargeMatch[1];
      const item = Array.isArray(data) ? data[0] : data;
      const invoiceId = `inv-${++counters.invoice}`;
      const invoice = {
        invoiceId,
        invoiceDate: new Date().toISOString().slice(0, 10),
        amount: item.amount,
        balance: item.amount,
        items: [{ invoiceItemId: invoiceId, description: item.description, amount: item.amount }],
      };
      invoices.get(accountId)?.push(invoice);
      json(res, 201, invoice);
      return;
    }
    const paymentMatch = /^\/v1\/invoices\/([^/]+)\/payments$/.exec(path);
    if (req.method === 'POST' && paymentMatch) {
      for (const list of invoices.values()) {
        const invoice = list.find((i) => i.invoiceId === paymentMatch[1]);
        if (invoice) invoice.balance = 0;
      }
      json(res, 201, { paymentId: `pay-${Date.now()}`, transactions: [{ transactionId: 't1', status: 'SUCCESS' }] });
      return;
    }
    if (req.method === 'POST' && path === '/v1/credits') {
      counters.credit += 1;
      const item = Array.isArray(data) ? data[0] : data;
      for (const [accountId, list] of invoices) {
        void accountId;
        void list;
      }
      json(res, 201, { creditId: `cred-${counters.credit}`, amount: item.amount });
      return;
    }
    const invoiceListMatch = /^\/v1\/accounts\/([^/]+)\/invoices$/.exec(path);
    if (req.method === 'GET' && invoiceListMatch) {
      json(res, 200, invoices.get(invoiceListMatch[1]) ?? []);
      return;
    }
    json(res, 404, { error: 'not_found' });
  });
});

server.listen(PORT, '127.0.0.1', () => console.log(`mock killbill on ${PORT}`));
