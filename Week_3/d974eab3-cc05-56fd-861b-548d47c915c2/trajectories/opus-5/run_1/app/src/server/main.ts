import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { SiteCopy } from '../shared/types';
import { BODY_LIMIT, handleApi, type ApiContext, type Reply } from './api';
import { loadAssets, type Asset } from './assets';
import { readConfig } from './config';
import {
  contactPage,
  interviewMissingPage,
  interviewPage,
  legalPage,
  notFoundPage,
  privacyPage,
  storePage,
  storyPage,
} from './pages';
import { ContentStore } from './store';

/** The answer while Postgres has not yet accepted a connection. */
const STARTING_MESSAGE = 'The site is still starting. Please try again shortly.';
const STARTING_REPLY: Reply = {
  kind: 'json',
  status: 503,
  body: { error: 'starting', message: STARTING_MESSAGE },
};
const STARTING_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Vireo Pace | Alder Quay Laboratories</title></head>
<body><p>${STARTING_MESSAGE}</p></body></html>`;

function readBodyWithLimit(request: IncomingMessage): Promise<Buffer | 'too_large'> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    request.on('data', (chunk: Buffer) => {
      if (settled) {
        return;
      }
      size += chunk.length;
      if (size > BODY_LIMIT) {
        settled = true;
        resolve('too_large');
        request.resume();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (!settled) {
        settled = true;
        resolve(Buffer.concat(chunks));
      }
    });
    request.on('error', (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
  });
}

function sendReply(
  response: ServerResponse,
  reply: Reply,
  method: string,
): void {
  if (reply.kind === 'pdf') {
    response.writeHead(200, {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${reply.filename}"`,
      'content-length': reply.body.length,
    });
    response.end(method === 'HEAD' ? undefined : reply.body);
    return;
  }
  const body = Buffer.from(JSON.stringify(reply.body), 'utf8');
  response.writeHead(reply.status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
  });
  response.end(method === 'HEAD' ? undefined : body);
}

function sendHtml(
  response: ServerResponse,
  status: number,
  html: string,
  method: string,
): void {
  const body = Buffer.from(html, 'utf8');
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': body.length,
  });
  response.end(method === 'HEAD' ? undefined : body);
}

function sendAsset(
  response: ServerResponse,
  asset: Asset,
  method: string,
): void {
  response.writeHead(200, {
    'content-type': asset.contentType,
    'content-length': asset.body.length,
    'cache-control': 'public, max-age=3600',
  });
  response.end(method === 'HEAD' ? undefined : asset.body);
}

interface PageAnswer {
  status: number;
  html: string;
}

function answerPage(
  pathname: string,
  site: SiteCopy,
  interviewName: (slug: string) => string | null,
): PageAnswer {
  switch (pathname) {
    case '/':
      return { status: 200, html: storyPage(site) };
    case '/store':
      return { status: 200, html: storePage(site) };
    case '/contact':
      return { status: 200, html: contactPage(site) };
    case '/privacy':
      return { status: 200, html: privacyPage(site) };
    case '/legal':
      return { status: 200, html: legalPage(site) };
    default:
      break;
  }
  const slug = /^\/interviews\/([^/]+)$/.exec(pathname)?.[1];
  if (slug !== undefined) {
    const name = interviewName(slug);
    return name === null
      ? { status: 404, html: interviewMissingPage(site) }
      : { status: 200, html: interviewPage(site, name, slug) };
  }
  return { status: 404, html: notFoundPage(site) };
}

async function main(): Promise<void> {
  const config = readConfig();
  const store = new ContentStore(config.databaseUrl);
  const assets = await loadAssets();
  const context: ApiContext = {
    store,
    gotenbergUrl: config.gotenbergUrl,
    gradingKey: config.gradingKey,
  };

  const server = createServer((request, response) => {
    const method = request.method ?? 'GET';
    const url = new URL(request.url ?? '/', 'http://localhost');
    const pathname = url.pathname;

    const handle = async (): Promise<void> => {
      if (pathname.startsWith('/api/')) {
        const headerValue = request.headers['x-grading-key'];
        const reply = await handleApi(
          context,
          method,
          pathname,
          Array.isArray(headerValue) ? headerValue[0] : headerValue,
          () => readBodyWithLimit(request),
        );
        request.resume();
        sendReply(response, reply, method);
        return;
      }

      if (method !== 'GET' && method !== 'HEAD') {
        request.resume();
        const record = await store.read();
        sendHtml(response, 404, notFoundPage(record.site), method);
        return;
      }

      const asset = assets.get(pathname);
      if (asset !== undefined) {
        request.resume();
        sendAsset(response, asset, method);
        return;
      }

      request.resume();
      const record = await store.read();
      const answer = answerPage(
        pathname,
        record.site,
        (slug) =>
          record.interviews.find((item) => item.slug === slug)?.name ?? null,
      );
      sendHtml(response, answer.status, answer.html, method);
    };

    handle().catch((error: unknown) => {
      process.stderr.write(
        `Request failed: ${String(error instanceof Error ? error.message : error)}\n`,
      );
      if (!response.headersSent) {
        if (pathname.startsWith('/api/')) {
          sendReply(response, STARTING_REPLY, method);
        } else {
          sendHtml(response, 503, STARTING_HTML, method);
        }
        return;
      }
      response.end();
    });
  });

  server.listen(config.port, '0.0.0.0', () => {
    process.stdout.write(`Vireo Pace is listening on port ${config.port}.\n`);
  });

  await store.connect();
}

void main().catch((error: unknown) => {
  process.stderr.write(`Vireo Pace could not start: ${String(error)}\n`);
  process.exitCode = 1;
});
