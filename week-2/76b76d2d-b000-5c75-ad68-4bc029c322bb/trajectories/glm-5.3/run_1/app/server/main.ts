import type { Request, Response } from 'express';
import type { Config } from './config';
import { loadConfig } from './config';
import { KillBillClient } from './services/killbill';
import { MailService } from './services/mail';
import { OutboxService } from './services/outbox';
import { StatusService } from './services/status';
import { query } from './services/database';
import { applySchema, applySeed } from './data/seed';
import { readBody, crossOriginGuard, buildScope, parseCookies, type CookiedRequest } from './http/scope';
import { publicApi } from './http/api/public';
import { bookingApi } from './http/api/booking';
import { accountApi } from './http/api/account';
import { staffApi } from './http/api/staff';
import { AppServices } from './http/api/handlers';
import { membershipRow, membershipView } from './services/membership';
import { creditBalance } from './services/finance';
import { bookingByRef } from './services/refund';
import { bookingView } from './services/checkout';
import { programmePage } from './pages/programme';
import { screeningPage, checkoutPage, bookingPage, notFoundPage, type PageSession } from './pages/public';
import {
  accountPage, membershipPage, giftPage, giftRedemptionPage,
  signInPage, signUpPage, bookingLinkPage, contactPage,
} from './pages/forms';
import { staffConsolePage } from './pages/staff-console';
import type { Locale, Tier } from './domain/model';
import { isSafePath, localePath } from './domain/safepath';
import { giftByToken } from './services/gifts';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ServerContext {
  cfg: Config;
  kb: KillBillClient;
  mail: MailService;
  outbox: OutboxService;
  status: StatusService;
  schemaReady: boolean;
}

async function sessionFromRequest(req: CookiedRequest): Promise<PageSession> {
  const token = req.cookies.halide_session;
  if (!token) {
    return { signedIn: false, isPatron: false, accountNumber: null, name: null, email: null };
  }
  const res = await query<{ number: string; name: string; email: string; role: string; locale: string }>(
    `SELECT a.number, a.name, a.email, a.role, a.locale
     FROM sessions s JOIN accounts a ON a.id = s.account_id
     WHERE s.token = $1`,
    [token],
  );
  const row = res.rows[0];
  if (!row) {
    return { signedIn: false, isPatron: false, accountNumber: null, name: null, email: null };
  }
  return {
    signedIn: true,
    isPatron: row.role === 'patron',
    accountNumber: row.number,
    name: row.name,
    email: row.email,
  };
}

export async function buildServer(): Promise<{
  app: import('express').Express;
  ctx: ServerContext;
}> {
  const cfg = loadConfig();
  const express = (await import('express')).default;
  const app = express();

  const kb = new KillBillClient(cfg);
  const mail = new MailService(cfg);
  const outbox = new OutboxService(cfg, mail);
  const status = new StatusService(cfg, kb, async () => {
    const probe = await mail.probe();
    return probe.up;
  });

  const services: AppServices = { cfg, kb, mail, outbox, status };
  const ctx: ServerContext = { cfg, kb, mail, outbox, status, schemaReady: false };

  app.disable('x-powered-by');
  app.set('etag', false);

  // Health, answered even while dependencies are down.
  app.get('/api/health', (_req, res) => {
    if (!ctx.schemaReady) {
      res.status(503).json({ status: 'starting' });
      return;
    }
    res.json({ status: 'ok' });
  });

  // Assets: only built assets and fonts are served.
  const assetsDir = path.join(__dirname, '../assets');
  const mimeTypes: Record<string, string> = {
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.ttf': 'font/ttf',
    '.woff2': 'font/woff2',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
  };
  app.use('/assets', (req: Request, res: Response) => {
    // Only built assets are served, and never anything outside the tree.
    const relative = path.normalize(req.path).replace(/^(\.\.\\|\/\\)+/, '');
    const file = path.join(assetsDir, relative);
    if (!file.startsWith(assetsDir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.status(404).end();
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.setHeader('Content-Type', mimeTypes[ext] ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    fs.createReadStream(file).pipe(res);
  });

  // The locale route: sets the cookie and redirects with the swapped prefix.
  app.get('/locale/:locale', (req: CookiedRequest, res: Response) => {
    const locale = req.params.locale === 'en' || req.params.locale === 'fr' ? req.params.locale : null;
    if (!locale) {
      res.status(404).end();
      return;
    }
    res.setHeader('Set-Cookie', `halide_locale=${locale}; Path=/; HttpOnly; SameSite=Lax`);
    const next = typeof req.query.next === 'string' ? req.query.next : '';
    const target = isSafePath(next) ? localePath(locale, next) : `/${locale}/`;
    res.setHeader('Location', target);
    res.status(303).end();
  });

  // The root redirect: the locale rule picks the prefix.
  app.get('/', (req: CookiedRequest, res: Response) => {
    const cookies = parseCookies(req.headers.cookie);
    const cookie = cookies.halide_locale === 'en' || cookies.halide_locale === 'fr' ? cookies.halide_locale : null;
    const accept = typeof req.headers['accept-language'] === 'string' ? req.headers['accept-language'] : '';
    const locale: Locale = cookie ?? (accept.trim().toLowerCase().startsWith('en') ? 'en' : 'fr');
    res.setHeader('Location', `/${locale}/`);
    res.status(303).end();
  });

  app.use(crossOriginGuard);
  app.use(readBody);
  app.use(buildScope);

  // API routes.
  app.use(publicApi(services));
  app.use(bookingApi(services));
  app.use(accountApi(services));
  app.use(staffApi(services));

  // Page routes.
  app.get('/:locale/', pageHandler(async (req, locale) => {
    const seasonParam = typeof req.query.season === 'string' ? req.query.season : null;
    const session = await sessionFromRequest(req);
    return programmePage(locale, req.path, session.signedIn, seasonParam);
  }));

  app.get('/:locale/screenings/:id', pageHandler(async (req, locale) => {
    const session = await sessionFromRequest(req);
    const id = req.params.id as string;
    const exists = await query('SELECT id FROM screenings WHERE id = $1', [id]);
    if (exists.rows.length === 0) {
      return { status: 404, html: notFoundPage(locale, req.path, session) };
    }
    return screeningPage(locale, req.path, session, id);
  }));

  app.get('/:locale/checkout/:holdId', pageHandler(async (req, locale) => {
    const session = await sessionFromRequest(req);
    return checkoutPage(locale, req.path, session, req.params.holdId as string);
  }));

  app.get('/:locale/account/bookings/:ref', pageHandler(async (req, locale) => {
    const session = await sessionFromRequest(req);
    if (!session.isPatron) return { status: 404, html: notFoundPage(locale, req.path, session) };
    const booking = await bookingByRef(req.params.ref as string);
    if (!booking || booking.account_id === null) return { status: 404, html: notFoundPage(locale, req.path, session) };
    const account = await query<{ id: number }>('SELECT id FROM accounts WHERE number = $1', [session.accountNumber]);
    if (!account.rows[0] || booking.account_id !== account.rows[0].id) {
      return { status: 404, html: notFoundPage(locale, req.path, session) };
    }
    const confirmed = new URL(req.url, 'http://x').searchParams.get('confirmed') === '1';
    const view = await bookingView(booking.ref);
    return bookingPage(locale, req.path, session, view, confirmed, session.email ?? '');
  }));

  app.get('/:locale/b/:token', pageHandler(async (req, locale) => {
    const session = await sessionFromRequest(req);
    const link = await query<{ booking_ref: string; active: boolean }>(
      'SELECT booking_ref, active FROM guest_links WHERE token = $1',
      [req.params.token as string],
    );
    const l = link.rows[0];
    if (!l || !l.active) return { status: 404, html: notFoundPage(locale, req.path, session) };
    const booking = await bookingByRef(l.booking_ref);
    if (!booking) return { status: 404, html: notFoundPage(locale, req.path, session) };
    const confirmed = new URL(req.url, 'http://x').searchParams.get('confirmed') === '1';
    const view = await bookingView(booking.ref);
    const email = booking.guest_email ?? '';
    return bookingPage(locale, req.path, session, view, confirmed, email);
  }));

  app.get('/:locale/account', pageHandler(async (req, locale) => {
    const session = await sessionFromRequest(req);
    if (!session.isPatron) return { status: 404, html: notFoundPage(locale, req.path, session) };
    const account = await query<{ id: number }>('SELECT id FROM accounts WHERE number = $1', [session.accountNumber]);
    const accountId = account.rows[0]?.id ?? 0;
    const membership = await membershipRow(accountId);
    const credit = await creditBalance(session.accountNumber as string);
    const bookings = await query<{ ref: string; state: string }>(
      'SELECT ref, state FROM bookings WHERE account_id = $1 ORDER BY created_at DESC',
      [accountId],
    );
    return accountPage(locale, req.path, session, {
      membership: membership ? (membershipView(membership) as unknown as Record<string, unknown>) : null,
      creditBalanceCents: credit.balance_cents,
      movements: credit.movements,
      bookings: bookings.rows,
    });
  }));

  app.get('/:locale/membership', pageHandler(async (req, locale) => {
    const session = await sessionFromRequest(req);
    let membership = null;
    let balance = 0;
    if (session.isPatron) {
      const account = await query<{ id: number }>('SELECT id FROM accounts WHERE number = $1', [session.accountNumber]);
      const row = await membershipRow(account.rows[0]?.id ?? 0);
      membership = row ? membershipView(row) : null;
      balance = (await creditBalance(session.accountNumber as string)).balance_cents;
    }
    return membershipPage(locale, req.path, session, {
      membership: membership as unknown as Record<string, unknown> | null,
      creditBalanceCents: balance,
    });
  }));

  app.get('/:locale/gift', pageHandler(async (req, locale) => {
    const session = await sessionFromRequest(req);
    return giftPage(locale, req.path, session);
  }));

  app.get('/:locale/gift/:token', pageHandler(async (req, locale) => {
    const session = await sessionFromRequest(req);
    const gift = await giftByToken(req.params.token as string);
    if (!gift || gift.state !== 'unredeemed') return { status: 404, html: notFoundPage(locale, req.path, session) };
    return giftRedemptionPage(locale, req.path, session, {
      tier: gift.tier as Tier,
      fromName: gift.purchaserName,
      message: gift.message,
    });
  }));

  app.get('/:locale/signin', pageHandler(async (req, locale) => {
    const session = await sessionFromRequest(req);
    return signInPage(locale, req.path, session);
  }));

  app.get('/:locale/signup', pageHandler(async (req, locale) => {
    const session = await sessionFromRequest(req);
    return signUpPage(locale, req.path, session);
  }));

  app.get('/:locale/booking-link', pageHandler(async (req, locale) => {
    const session = await sessionFromRequest(req);
    return bookingLinkPage(locale, req.path, session);
  }));

  app.get('/:locale/contact', pageHandler(async (req, locale) => {
    const session = await sessionFromRequest(req);
    return contactPage(locale, req.path, session);
  }));

  app.get('/:locale/staff', pageHandler(async (req, locale) => {
    const session = await sessionFromRequest(req);
    if (!session.signedIn || session.isPatron) return { status: 404, html: notFoundPage(locale, req.path, session) };
    const account = await query<{ role: string }>(
      'SELECT role FROM accounts WHERE number = $1 OR email = $2',
      [session.accountNumber, session.email],
    );
    const role = account.rows[0]?.role;
    if (role !== 'door' && role !== 'programmer' && role !== 'finance') {
      return { status: 404, html: notFoundPage(locale, req.path, session) };
    }
    return staffConsolePage(locale, req.path, session, role);
  }));

  // Everything else: the one not-found answer for pages.
  app.use((req: CookiedRequest, res: Response) => {
    if (req.path.startsWith('/api/')) {
      res.status(404).json({ error: { code: 'not_found', message: '' } });
      return;
    }
    const cookies = parseCookies(req.headers.cookie);
    const cookie = cookies.halide_locale === 'en' || cookies.halide_locale === 'fr' ? cookies.halide_locale : null;
    const accept = typeof req.headers['accept-language'] === 'string' ? req.headers['accept-language'] : '';
    const locale: Locale = cookie ?? (accept.trim().toLowerCase().startsWith('en') ? 'en' : 'fr');
    res.status(404).send(notFoundPage(locale, req.path, { signedIn: false, isPatron: false, accountNumber: null, name: null, email: null }));
  });

  return { app, ctx };
}

/**
 * The one boot sequence: retry Postgres, apply schema and seed, upload the
 * catalogue, start the probes and the outbox, then listen.
 */
export async function serve(): Promise<void> {
  const { app, ctx } = await buildServer();

  // Postgres is required: retry every 2 seconds until it is reachable.
  for (;;) {
    try {
      await query('SELECT 1');
      break;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  await applySchema();
  await applySeed();
  ctx.schemaReady = true;

  // The catalogue, uploaded once when missing, retrying every 5 seconds.
  const uploadCatalogue = async () => {
    for (;;) {
      try {
        await ctx.kb.ensureCatalogue();
        break;
      } catch {
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  };
  void uploadCatalogue();

  ctx.status.start();
  ctx.outbox.start();

  app.listen(ctx.cfg.port, '0.0.0.0', () => {
    process.stdout.write(`serving on ${ctx.cfg.port}\n`);
  });
}

void serve().catch((err) => {
  process.stderr.write(`failed to start: ${String(err)}\n`);
  process.exit(1);
});

type PageResult = string | { status: number; html: string };
type PageRenderer = (req: CookiedRequest, locale: Locale) => Promise<PageResult>;

function pageHandler(render: PageRenderer) {
  return async (req: CookiedRequest, res: Response): Promise<void> => {
    const rawLocale = String(req.params.locale ?? 'fr');
    if (rawLocale !== 'en' && rawLocale !== 'fr') {
      const session: PageSession = { signedIn: false, isPatron: false, accountNumber: null, name: null, email: null };
      res.status(404).send(notFoundPage('fr', req.path, session));
      return;
    }
    const locale = rawLocale as Locale;
    const cookies = parseCookies(req.headers.cookie);
    const cookieLocale = cookies.halide_locale === 'en' || cookies.halide_locale === 'fr' ? cookies.halide_locale : null;
    if (cookieLocale !== locale) {
      res.setHeader('Set-Cookie', `halide_locale=${locale}; Path=/; HttpOnly; SameSite=Lax`);
    }
    const result = await render(req, locale);
    if (typeof result === 'string') {
      res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(result);
      return;
    }
    res.status(result.status).setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(result.html);
  };
}
