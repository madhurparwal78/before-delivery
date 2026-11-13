import http from 'node:http';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConfig } from './config.ts';
import { PgPool } from './db/pg.ts';
import { applySchema } from './db/schema.ts';
import { seedDatabase } from './db/seed.ts';
import { KillBillApi } from './services/killbill.ts';
import { PocketBase } from './services/pocketbase.ts';
import { Storage } from './services/storage.ts';
import { Smtp } from './services/smtp.ts';
import { MailQueue } from './services/mail.ts';
import type { App } from './api/app.ts';
import { ApiError, type RouteContext, type Handler } from './api/http.ts';
import { registerPlatformRoutes } from './api/platform.ts';
import { registerExhibitionRoutes } from './api/exhibition.ts';
import { registerCommerceRoutes } from './api/commerce.ts';
import { registerMembershipRoutes } from './api/membership.ts';
import { registerStudioRoutes } from './api/studio.ts';
import { registerManagerRoutes } from './api/manager.ts';
import { startWorkers } from './workers.ts';
import { renderIndexPage, renderChapterPage, renderTimelinePage, renderSourcesPage, renderSessionsPage, renderSupportPage, renderAccountPage, renderStudioPage, renderBoxOfficePage, notFoundPage } from './pages/render.ts';

const JSON_BODY_LIMIT = 65_536;
const UPLOAD_TOTAL_LIMIT = 20_100_000;

interface Route {
  method: string;
  parts: string[];
  handler: Handler;
}

// dist/server/main.js is two levels below the application root.
const thisDir = dirname(fileURLToPath(import.meta.url));
const rootDir = thisDir.endsWith(join('dist', 'server')) ? join(thisDir, '..', '..') : thisDir;

export async function main(): Promise<void> {
  const config = readConfig();
  const pool = new PgPool(config.databaseUrl, 8);
  const kb = new KillBillApi(config);
  const pb = new PocketBase(config);
  const storage = new Storage(config);
  const smtp = new Smtp(config);
  const mail = new MailQueue(pool, smtp);

  const app: App = {
    config,
    pool,
    kb,
    pb,
    storage,
    smtp,
    mail,
    now: () => Date.now(),
  };

  const routes: Route[] = [];
  const addRoute = (method: string, pattern: string, handler: Handler): void => {
    routes.push({ method, parts: pattern.split('/').filter(Boolean), handler });
  };

  registerPlatformRoutes(app, addRoute);
  registerExhibitionRoutes(app, addRoute);
  registerCommerceRoutes(app, addRoute);
  registerMembershipRoutes(app, addRoute);
  registerStudioRoutes(app, addRoute);
  registerManagerRoutes(app, addRoute);

  // Health always answers ok, even when a provider is down.
  addRoute('GET', '/api/health', async (ctx) => {
    ctx.res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    ctx.res.end(JSON.stringify({ status: 'ok' }));
  });

  const server = http.createServer(async (req, res) => {
    try {
      await handleRequest(app, routes, req, res);
    } catch (e) {
      if (e instanceof ApiError) {
        const body = JSON.stringify(e.body());
        res.writeHead(e.status, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(body);
        return;
      }
      console.error('request error:', e instanceof Error ? `${(e as Error & { code?: string }).code ?? ''} ${e.message}` : e);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: { code: 'internal', message: 'Something went wrong.' } }));
      } else {
        res.end();
      }
    }
  });

  // Schema and seed are applied idempotently; retried when providers are down.
  void (async () => {
    for (;;) {
      try {
        await applySchema(pool);
        await seedDatabase(app);
        console.log('schema and seed applied');
        break;
      } catch (e) {
        console.error('schema or seed failed, retrying:', e instanceof Error ? `${e.message}` : e);
        await new Promise((r) => setTimeout(r, 10_000));
      }
    }
  })();
  void (async () => {
    // PocketBase collections and the seeded people are retried in the background.
    for (;;) {
      try {
        await pb.ensureCollections();
        await seedPeople(app);
        console.log('collections and people seeded');
        break;
      } catch (e) {
        console.error('collections or people seed failed, retrying:', e instanceof Error ? `${e.message}` : e);
        await new Promise((r) => setTimeout(r, 15_000));
      }
    }
  })();
  void (async () => {
    for (;;) {
      try {
        const catalogXml = buildCatalogXml();
        await kb.ensureCatalog(catalogXml);
        console.log('kill bill catalog synced');
        break;
      } catch (e) {
        console.error('catalog sync failed, retrying:', e instanceof Error ? `${e.message}` : e);
        await new Promise((r) => setTimeout(r, 30_000));
      }
    }
  })();

  const stopWorkers = startWorkers(app);
  server.on('close', stopWorkers);

  const port = config.port;
  server.on('error', (err: Error) => {
    console.error('listen error', err.message);
    process.exit(1);
  });
  server.listen(port, '0.0.0.0', () => {
    console.log(`sightline listening on 0.0.0.0:${port}`);
  });
}

function buildCatalogXml(): string {
  const tpl = CATALOG_TEMPLATE;
  const ticketPrices = ['EUR', 'GBP', 'USD', 'JPY']
    .map((c) => `<price><currency>${c}</currency><value>${c === 'JPY' ? '2000' : ((TICKET[c] ?? 1200) / 100).toFixed(2)}</value></price>`)
    .join('\n');
  const plans = ['reader', 'fellow', 'patron']
    .map((tier) => {
      const prices = ['EUR', 'GBP', 'USD', 'JPY']
        .map((c) => `<price><currency>${c}</currency><value>${c === 'JPY' ? (TIERS[tier]?.[c] ?? 0) : ((TIERS[tier]?.[c] ?? 0) / 100).toFixed(2)}</value></price>`)
        .join('\n');
      return `    <plan name="supporter-${tier}-monthly" prettyName="${tier}">
      <product>supporter-${tier}</product>
      <initialPhases/>
      <finalPhase prettyName="${tier}" type="EVERGREEN">
        <duration>
          <unit>UNLIMITED</unit>
        </duration>
        <recurring>
          <billingPeriod>MONTHLY</billingPeriod>
          <recurringPrice>
${prices}
          </recurringPrice>
        </recurring>
      </finalPhase>
    </plan>`;
    })
    .join('\n');
  return tpl
    .replace('__EFFECTIVE_DATE__', new Date().toISOString().slice(0, 19) + '.000Z')
    .replace('__TICKET_PRICES__', ticketPrices)
    .replace('__SUPPORTER_PLANS__', plans);
}

// The catalog template is embedded at build time; see the assets copy.
const CATALOG_TEMPLATE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<catalog>
  <effectiveDate>__EFFECTIVE_DATE__</effectiveDate>
  <catalogName>Sightline</catalogName>
  <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
  <currencies>
    <currency>EUR</currency>
    <currency>GBP</currency>
    <currency>USD</currency>
    <currency>JPY</currency>
  </currencies>
  <products>
    <product name="guided-session-ticket"><category>BASE</category></product>
    <product name="supporter-reader"><category>BASE</category></product>
    <product name="supporter-fellow"><category>BASE</category></product>
    <product name="supporter-patron"><category>BASE</category></product>
  </products>
  <rules>
    <changePolicy><changePolicyCase><policy>IMMEDIATE</policy></changePolicyCase></changePolicy>
    <changeAlignment><changeAlignmentCase><alignment>START_OF_SUBSCRIPTION</alignment></changeAlignmentCase></changeAlignment>
    <cancelPolicy><cancelPolicyCase><policy>END_OF_TERM</policy></cancelPolicyCase></cancelPolicy>
    <createAlignment><createAlignmentCase><alignment>START_OF_BUNDLE</alignment></createAlignmentCase></createAlignment>
    <billingAlignment><billingAlignmentCase><alignment>ACCOUNT</alignment></billingAlignmentCase></billingAlignment>
    <priceList><priceListCase><toPriceList>Default</toPriceList></priceListCase></priceList>
  </rules>
  <plans>
    <plan name="guided-session-ticket" prettyName="Guided session ticket">
      <product>guided-session-ticket</product>
      <initialPhases/>
      <finalPhase prettyName="Ticket" type="EVERGREEN">
        <duration><unit>UNLIMITED</unit></duration>
        <fixed>
          <fixedPrice>
__TICKET_PRICES__
          </fixedPrice>
        </fixed>
      </finalPhase>
    </plan>
__SUPPORTER_PLANS__
  </plans>
  <priceLists>
    <defaultPriceList name="Default">
      <plans>
        <plan>guided-session-ticket</plan>
        <plan>supporter-reader-monthly</plan>
        <plan>supporter-fellow-monthly</plan>
        <plan>supporter-patron-monthly</plan>
      </plans>
    </defaultPriceList>
  </priceLists>
</catalog>`;

const TICKET: Record<string, number> = { EUR: 1200, GBP: 1000, USD: 1400, JPY: 2000 };
const TIERS: Record<string, Record<string, number>> = {
  reader: { EUR: 500, GBP: 400, USD: 600, JPY: 800 },
  fellow: { EUR: 1200, GBP: 1000, USD: 1400, JPY: 2000 },
  patron: { EUR: 3000, GBP: 2600, USD: 3500, JPY: 5000 },
};

async function seedPeople(app: App): Promise<void> {
  const { SEED_PEOPLE, SEED_PASSWORD } = await import('./core/seed.ts');
  for (const p of SEED_PEOPLE) {
    await app.pb.ensureUser(p.name, p.email, p.role, SEED_PASSWORD);
  }
}

async function handleRequest(app: App, routes: Route[], req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  void app;
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname;

  // Same-origin writes: a state-changing request whose Origin differs is refused.
  const origin = req.headers.origin ?? null;
  if (method !== 'GET' && method !== 'HEAD' && origin) {
    const host = req.headers.host ?? '';
    const originHost = new URL(origin).host;
    if (originHost !== host) {
      const err = new ApiError(403, 'forbidden_origin');
      res.writeHead(err.status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(err.body()));
      return;
    }
  }

  if (path.startsWith('/api/')) {
    // Route match
    const parts = path.split('/').filter(Boolean);
    for (const route of routes) {
      if (route.method !== method) continue;
      if (route.parts.length !== parts.length) continue;
      let ok = true;
      for (let i = 0; i < parts.length; i++) {
        const rp = route.parts[i]!;
        if (rp.startsWith(':')) continue;
        if (rp !== parts[i]) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;

      const cookies: Record<string, string> = {};
      const cookieHeader = req.headers.cookie;
      if (cookieHeader) {
        for (const pair of cookieHeader.split(';')) {
          const idx = pair.indexOf('=');
          if (idx > 0) cookies[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
        }
      }
      const ctx: RouteContext = {
        req,
        res,
        method,
        path,
        query: url.searchParams,
        cookies,
        origin,
        setCookie: (c: string) => {
          // Applied at once so a response written inside the handler still carries it.
          const existing = res.getHeader('Set-Cookie');
          const all = typeof existing === 'string' ? [existing] : Array.isArray(existing) ? [...existing] : [];
          all.push(c);
          res.setHeader('Set-Cookie', all.length === 1 ? all[0]! : all);
        },
        json: async () => JSON.parse((await rawBody()) || '{}'),
        rawBody: (): Promise<string> => rawBody(),
      };
      let raw: string | null = null;
      const rawBody = async (): Promise<string> => {
        if (raw !== null) return raw;
        // Limits and content types are checked before anything else.
        const contentType = String(req.headers['content-type'] ?? '');
        const isUpload = contentType.startsWith('multipart/form-data');
        if (req.method !== 'GET' && req.method !== 'HEAD' && contentType !== '' && !isUpload && !contentType.startsWith('application/json')) {
          throw new ApiError(415, 'unsupported_media_type');
        }
        const limit = isUpload ? UPLOAD_TOTAL_LIMIT : JSON_BODY_LIMIT;
        const chunks: Buffer[] = [];
        let total = 0;
        let tooLarge = false;
        await new Promise<void>((resolve) => {
          req.on('data', (chunk: Buffer) => {
            if (tooLarge) return;
            total += chunk.length;
            if (total > limit) {
              tooLarge = true;
              chunks.length = 0;
              // Drain the rest so the response can still be delivered.
              return;
            }
            chunks.push(chunk);
          });
          req.on('end', resolve);
          req.on('error', resolve);
        });
        if (tooLarge) {
          raw = '';
          throw new ApiError(413, 'payload_too_large');
        }
        raw = Buffer.concat(chunks).toString('binary');
        return raw;
      };
      try {
        await route.handler(ctx);
      } catch (e) {
        if (e instanceof ApiError) {
          if (!res.headersSent) {
            res.writeHead(e.status, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(e.body()));
          }
          return;
        }
        throw e;
      }
      return;
    }
    const err = new ApiError(404, 'not_found');
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(err.body()));
    return;
  }

  if (method === 'GET') {
    await servePage(app, res, path);
    return;
  }
  await serveStatic(res, path);
}

/** Pages: the server renders each screen from the live database. */
async function servePage(app: App, res: http.ServerResponse, path: string): Promise<void> {
  const notFound = (): void => {
    const body = notFoundPage();
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(body);
  };
  const send = (html: string): void => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
  };
  try {
    if (path === '/' || path === '/chapters') {
      send(await renderIndexPage(app));
      return;
    }
    const chapterMatch = path.match(/^\/chapters\/(\d)$/);
    if (chapterMatch) {
      const html = await renderChapterPage(app, Number(chapterMatch[1]));
      if (html.includes("We couldn't find that room")) {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(html);
        return;
      }
      send(html);
      return;
    }
    if (path === '/timeline') {
      send(await renderTimelinePage(app));
      return;
    }
    if (path === '/sources') {
      send(await renderSourcesPage(app));
      return;
    }
    if (path === '/sessions') {
      send(await renderSessionsPage(app));
      return;
    }
    if (path === '/support') {
      send(await renderSupportPage(app));
      return;
    }
    if (path === '/account') {
      send(await renderAccountPage(app));
      return;
    }
    if (path === '/studio') {
      send(await renderStudioPage(app));
      return;
    }
    if (path === '/box-office') {
      send(await renderBoxOfficePage(app));
      return;
    }
    // Anything else is a static asset; serveStatic refuses source and credentials.
    if (!serveStatic(res, path)) notFound();
  } catch {
    notFound();
  }
}

/** Static assets: the built frontend, fonts and media; never source or credentials. */
function serveStatic(res: http.ServerResponse, path: string): boolean {
  const forbidden =
    path.startsWith('/src') ||
    path === '/run.json' ||
    path === '/package.json' ||
    path === '/tsconfig.json' ||
    path.startsWith('/node_modules') ||
    path === '/esbuild.config.mjs' ||
    path.startsWith('/.env') ||
    path === '/AGENTS.md' ||
    path.startsWith('/assets/');
  // Source files and credentials are never served.
  if (forbidden) return false;

  const root = rootDir;
  const candidate = path.replace(/^\//, '');
  const filePath = normalize(join(root, 'public', candidate));
  if (!filePath.startsWith(join(root, 'public'))) return false;

  const tryServe = (p: string): boolean => {
    if (!existsSync(p) || !statSync(p).isFile()) return false;
    const ext = extname(p);
    const types: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.ttf': 'font/ttf',
      '.woff2': 'font/woff2',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.mp3': 'audio/mpeg',
      '.ogg': 'audio/ogg',
      '.json': 'application/json',
    };
    const body = readFileSync(p);
    res.writeHead(200, {
      'Content-Type': types[ext] ?? 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=3600',
    });
    res.end(body);
    return true;
  };

  return tryServe(filePath);
}

void main();
