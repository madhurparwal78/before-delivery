import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPool, prepareDatabase, readContent } from './db.js';
import { handleApi, handleGrading, type ApiConfig } from './api.js';
import { notFound as notFoundResponse, tooLarge } from './replies.js';
import { layout } from './layout.js';
import {
  contactPage,
  interviewNotFoundPage,
  interviewPage,
  legalPage,
  notFoundPage,
  privacyPage,
  storePage,
  storyPage,
} from './views.js';

const PORT = Number(process.env.APP_PUBLIC_PORT ?? 4173);
const DATABASE_URL = process.env.DATABASE_URL ?? '';
const GOTENBERG_URL = (process.env.GOTENBERG_URL ?? '').replace(/\/$/, '');
const GRADING_KEY = process.env.GRADING_KEY ?? null;

const apiConfig: ApiConfig = { gotenbergUrl: GOTENBERG_URL, gradingKey: GRADING_KEY };

const rootDir = fileURLToPath(new URL('../..', import.meta.url));
const publicDir = join(rootDir, 'public');

const STATIC_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

const BLOCKED_PATHS = /^\/(\.env|run\.json|package(-lock)?\.json|tsconfig.*\.json|build\.mjs|THIRD_PARTY_NOTICES\.md|src|views|dist|node_modules)(\/|$)/;

function send(res: ServerResponse, status: number, body: string | Buffer, type: string, extra?: Record<string, string>): void {
  res.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'same-origin',
    ...extra,
  });
  res.end(body);
}

function page(res: ServerResponse, status: number, title: string, body: string): void {
  send(res, status, layout({ title }, body), 'text/html; charset=utf-8');
}

async function readBody(req: IncomingMessage, limit: number): Promise<{ ok: boolean; tooLarge: boolean; raw: Buffer }> {
  const chunks: Buffer[] = [];
  let total = 0;
  let tooLarge = false;
  for await (const chunk of req) {
    total += (chunk as Buffer).length;
    if (total > limit) {
      tooLarge = true;
      break;
    }
    chunks.push(chunk as Buffer);
  }
  return { ok: !tooLarge, tooLarge, raw: Buffer.concat(chunks) };
}

function toWebRequest(req: IncomingMessage, body: Buffer): Request {
  const protocol = 'http';
  const host = req.headers.host ?? 'localhost';
  const url = `${protocol}://${host}${req.url ?? '/'}`;
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else {
      headers.set(name, String(value));
    }
  }
  return new Request(url, {
    method: req.method ?? 'GET',
    headers,
    body: body.length === 0 && (req.method === 'GET' || req.method === 'HEAD') ? undefined : body,
  });
}

async function serveStatic(pathname: string): Promise<{ body: Buffer; type: string } | null> {
  const clean = normalize(pathname);
  if (clean.includes('..')) return null;
  const filePath = join(publicDir, clean);
  const type = STATIC_TYPES[extname(filePath)];
  if (!type) return null;
  try {
    const body = await readFile(filePath);
    return { body, type };
  } catch {
    return null;
  }
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);

  if (BLOCKED_PATHS.test(pathname)) {
    page(res, 404, 'Not found | Vireo Pace', notFoundPage());
    return;
  }

  if (pathname.startsWith('/api/')) {
    const body = await readBody(req, 262144);
    let response: Response;
    if (body.tooLarge) {
      response = tooLarge();
    } else {
      const webRequest = toWebRequest(req, body.raw);
      response =
        (await handleGrading(webRequest, pathname, apiConfig)) ??
        (await handleApi(webRequest, pathname, apiConfig)) ??
        notFoundResponse();
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const headers: Record<string, string> = {};
    response.headers.forEach((value, name) => {
      headers[name] = value;
    });
    send(res, response.status, buffer, headers['content-type'] ?? 'application/json; charset=utf-8', headers);
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    page(res, 404, 'Not found | Vireo Pace', notFoundPage());
    return;
  }

  const staticFile = await serveStatic(pathname);
  if (staticFile) {
    send(res, 200, staticFile.body, staticFile.type);
    return;
  }

  switch (pathname) {
    case '/':
      page(res, 200, 'Vireo Pace | Alder Quay Laboratories', storyPage());
      return;
    case '/store':
      page(res, 200, 'Online store | Vireo Pace', storePage());
      return;
    case '/contact':
      page(res, 200, 'Contact | Alder Quay Laboratories', contactPage());
      return;
    case '/privacy':
      page(res, 200, 'Privacy | Alder Quay Laboratories', privacyPage());
      return;
    case '/legal':
      page(res, 200, 'Legal | Alder Quay Laboratories', legalPage());
      return;
    default: {
      const interviewMatch = pathname.match(/^\/interviews\/([a-z0-9-]+)$/);
      if (interviewMatch) {
        const slug = interviewMatch[1] ?? '';
        const stored = await readContent();
        const known = stored?.interviews.some((interview) => interview.slug === slug) ?? false;
        if (known) {
          page(res, 200, 'Vireo Pace interviews', interviewPage());
        } else {
          page(res, 404, 'Not found | Vireo Pace', interviewNotFoundPage());
        }
        return;
      }
      page(res, 404, 'Not found | Vireo Pace', notFoundPage());
    }
  }
}

async function start(): Promise<void> {
  if (DATABASE_URL) openPool(DATABASE_URL);

  const retryDatabase = async (): Promise<void> => {
    for (;;) {
      try {
        await prepareDatabase();
        return;
      } catch (error) {
        console.error('database not ready, retrying', error instanceof Error ? error.message : error);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  };
  const databaseReady = retryDatabase();

  const server = createServer((req, res) => {
    handle(req, res).catch((error) => {
      console.error('request failed', error);
      if (!res.headersSent) {
        page(res, 404, 'Not found | Vireo Pace', notFoundPage());
      } else {
        res.end();
      }
    });
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Vireo Pace listening on port ${PORT}`);
  });

  await databaseReady;
  console.log('content record ready');
}

start();
