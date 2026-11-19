// Serve: static assets, the API, service probes, the reminder sweep and the background membership check.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { loadConfig, type Config } from './config';
import { Db } from './db';
import { migrate } from './migrate';
import { KillBillClient, KillBillDown, TIER_PLANS } from './killbill';
import { Storage } from './storage';
import { Mailer } from './mail';
import { ApiServer } from './apiServer';
import { sendError } from './http';
import { getCalendar } from './domain';
import { addDays, dueBy, today } from './calendar';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const SCREEN_PATHS = new Set(['/', '/index.html']);

function main(): void {
  const config = loadConfig();
  const db = new Db(config.databaseUrl);
  const killbill = new KillBillClient(config.killbill);
  const storage = new Storage(config.s3);
  const mailer = new Mailer(config.smtp, db);
  const status = { storage: 'up' as 'up' | 'down', billing: 'up' as 'up' | 'down' };
  const api = new ApiServer(db, config, killbill, storage, mailer, status);

  const assetsDir = join(process.cwd(), 'dist', 'assets');
  const server = createServer((req, res) => {
    void handleRequest(req, res);
  });

  server.listen(config.port, '0.0.0.0', () => {
    console.log(`pegworth desk listening on 0.0.0.0:${config.port}`);
  });

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const pathname = decodeURIComponent(url.pathname);
      if (pathname.startsWith('/api/') || pathname === '/api') {
        await api.handle(req, res, pathname);
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found.');
        return;
      }
      serveAsset(res, pathname);
    } catch (err) {
      sendError(res, err);
    }
  }

  function serveAsset(res: ServerResponse, pathnameRaw: string): void {
    let pathname = pathnameRaw.split('?')[0]!;
    if (pathname === '') pathname = '/';
    if (pathname === '/') pathname = '/index.html';
    // No dot-paths, no traversal, only files inside the built assets.
    if (pathname.split('/').some((segment) => segment.startsWith('.'))) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found.');
      return;
    }
    const target = normalize(join(assetsDir, pathname));
    if (!target.startsWith(normalize(assetsDir) + '/') || !existsSync(target) || !statSync(target).isFile()) {
      // Unknown screen paths serve the app shell; everything else 404s.
      if (SCREEN_PATHS.has(pathname) || isScreenPath(pathname)) {
        serveFile(res, join(assetsDir, 'index.html'));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found.');
      return;
    }
    serveFile(res, target);
  }

  function isScreenPath(pathname: string): boolean {
    if (SCREEN_PATHS.has(pathname)) return true;
    const screens = ['/signin', '/join', '/account', '/desk', '/office', '/loans', '/fees'];
    return screens.some((screen) => pathname === screen || pathname.startsWith(screen + '/'));
  }

  function serveFile(res: ServerResponse, target: string): void {
    try {
      const body = readFileSync(target);
      const type = MIME[extname(target)] ?? 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Length': String(body.length) });
      res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found.');
    }
  }

  // Postgres unreachable at boot: keep serving, health answers 503 until connected.
  void db
    .waitUntilConnected(2000, (message) => console.log(message))
    .then(async () => {
      await migrate(db);
      console.log('schema and seed applied');
      return start(config, db, killbill, storage, mailer, status);
    })
    .catch((err) => console.log(`startup failed: ${err instanceof Error ? err.message : String(err)}`));
}

async function start(
  config: Config,
  db: Db,
  killbill: KillBillClient,
  storage: Storage,
  mailer: Mailer,
  status: { storage: 'up' | 'down'; billing: 'up' | 'down' },
): Promise<void> {
  mailer.start();

  // Service probes: every 10 s while up, every second while marked down.
  let storageUp = true;
  let billingUp = true;
  const probe = async () => {
    try {
      await storage.ping();
      storageUp = true;
    } catch {
      storageUp = false;
    }
    try {
      await killbill.ping();
      billingUp = true;
    } catch {
      billingUp = false;
    }
    status.storage = storageUp ? 'up' : 'down';
    status.billing = billingUp ? 'up' : 'down';
    setTimeout(probe, storageUp && billingUp ? 10000 : 1000).unref?.();
  };
  void probe();

  // Catalog upload on serve; seeded members' Kill Bill accounts, subscriptions and payments.
  for (let attempt = 0; ; attempt++) {
    try {
      await killbill.ensureCatalog();
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
  await seedKillBillMembers(db, killbill);

  // Background membership activation check.
  const membershipTimer = setInterval(() => {
    void checkPendingMemberships(db, killbill, status).catch(() => {});
  }, 10000);
  membershipTimer.unref?.();

  // Reminder sweep: due-tomorrow emails, deduplicated across processes.
  const reminderTimer = setInterval(() => {
    void reminderSweep(db, mailer).catch(() => {});
  }, config.reminderSweepSeconds * 1000);
  reminderTimer.unref?.();
  void reminderSweep(db, mailer).catch(() => {});

  // Mail retries.
  setInterval(() => {
    void mailer.sweep().catch(() => {});
  }, 30000).unref?.();
}

async function seedKillBillMembers(db: Db, killbill: KillBillClient): Promise<void> {
  const members = await db.query<{ id: number; name: string; email: string; tier: string }>(
    `SELECT u.id, u.name, u.email, m.tier FROM users u JOIN memberships m ON m.user_id = u.id WHERE u.role = 'member'`,
  );
  for (const member of members) {
    try {
      const accountId = await ensureAccount(killbill, member.email, member.name);
      const plan = TIER_PLANS[member.tier];
      if (plan !== undefined) {
        const subId = await ensureSub(killbill, accountId, plan);
        await payFirstInvoice(killbill, accountId);
        await db.exec(
          `UPDATE memberships SET killbill_account_id = $2, killbill_subscription_id = $3 WHERE user_id = $1`,
          [member.id, accountId, subId],
        );
      }
    } catch (err) {
      if (!(err instanceof KillBillDown)) {
        console.log(`killbill seed for ${member.email} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}

async function ensureAccount(killbill: KillBillClient, email: string, name: string): Promise<string> {
  const existing = await killbill.findAccount(email);
  if (existing !== null) return existing.accountId;
  const account = await killbill.createAccount(email, name, email);
  return account.accountId;
}

async function ensureSub(killbill: KillBillClient, accountId: string, plan: string): Promise<string> {
  const existing = await killbill.findActiveSubscription(accountId, plan);
  if (existing !== null) return existing.subscriptionId;
  const sub = await killbill.createSubscription(accountId, plan);
  return sub.subscriptionId;
}

async function payFirstInvoice(killbill: KillBillClient, accountId: string): Promise<void> {
  let invoiceId: string | null = null;
  for (let attempt = 0; attempt < 24; attempt++) {
    const invoices = await killbill.accountInvoices(accountId);
    if (invoices.length > 0) {
      invoiceId = invoices[0]!.invoiceId;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (invoiceId === null) return;
  const invoice = await killbill.getInvoice(invoiceId);
  if (invoice.balance <= 0.001) return;
  await killbill.recordPayment(accountId, invoiceId, Math.round(invoice.balance * 100), `pegworth-join-${accountId}`);
}

async function checkPendingMemberships(
  db: Db,
  killbill: KillBillClient,
  status: { storage: 'up' | 'down'; billing: 'up' | 'down' },
): Promise<void> {
  const pending = await db.query<{ user_id: number; tier: string; killbill_account_id: string | null; killbill_subscription_id: string | null }>(
    `SELECT user_id, tier, killbill_account_id, killbill_subscription_id FROM memberships WHERE status = 'pending-payment'`,
  );
  for (const row of pending) {
    if (row.killbill_account_id === null) continue;
    try {
      const plan = TIER_PLANS[row.tier];
      if (plan === undefined) continue;
      const sub =
        row.killbill_subscription_id !== null
          ? await killbill.getSubscription(row.killbill_subscription_id)
          : await killbill.findActiveSubscription(row.killbill_account_id, plan);
      if (sub === null || sub.state !== 'ACTIVE') continue;
      const invoices = await killbill.accountInvoices(row.killbill_account_id);
      if (invoices.length === 0) continue;
      const invoice = await killbill.getInvoice(invoices[0]!.invoiceId);
      if (invoice.balance > 0.001) continue;
      await db.exec(
        `UPDATE memberships SET status = 'active', killbill_subscription_id = $2 WHERE user_id = $1 AND status = 'pending-payment'`,
        [row.user_id, sub.subscriptionId],
      );
    } catch (err) {
      if (err instanceof KillBillDown) {
        status.billing = 'down';
        return;
      }
    }
  }
}

async function reminderSweep(db: Db, mailer: Mailer): Promise<void> {
  const calendar = await getCalendar(db);
  const now = new Date();
  const todayStr = today(calendar, now);
  // Tomorrow is the next calendar day in library time, whether or not the library opens.
  const tomorrow = addDays(todayStr, 1);
  const rows = await db.query<{ id: number; ref: string; due_date: string; email: string }>(
    `SELECT l.id, l.ref, to_char(l.due_date, 'YYYY-MM-DD') as due_date, u.email
     FROM loans l JOIN users u ON u.id = l.member_id
     WHERE l.status = 'out' AND to_char(l.due_date, 'YYYY-MM-DD') = $1`,
    [tomorrow],
  );
  for (const loan of rows) {
    const claimed = await db.query<{ loan_id: number }>(
      'INSERT INTO reminders (loan_id, due_date) VALUES ($1, to_date($2, \'YYYY-MM-DD\')) ON CONFLICT (loan_id, due_date) DO NOTHING RETURNING loan_id',
      [loan.id, loan.due_date],
    );
    if (claimed.length === 0) continue;
    const items = await db.query<{ name: string; tag: string }>(
      `SELECT i.name, i.tag FROM loan_items li JOIN items i ON i.id = li.item_id WHERE li.loan_id = $1`,
      [loan.id],
    );
    const dueByForDate = dueBy(calendar, loan.due_date);
    const body = [
      `Due tomorrow at Pegworth: ${loan.ref}`,
      ``,
      ...items.map((item) => `${item.name} (${item.tag})`),
      ``,
      `Due date: ${loan.due_date}`,
      `The library closes at ${dueByForDate ?? ''} that day.`,
      `Please return everything to the desk.`,
    ].join('\n');
    await mailer.enqueue(loan.email, `Due tomorrow at Pegworth: ${loan.ref}`, body);
  }
}

main();
