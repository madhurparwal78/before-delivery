import http from 'node:http';
import { matchApiRoute } from './api/index.js';
import { config } from './config.js';
import { applySchema } from './db/schema.js';
import { seedDatabase } from './db/seed.js';
import { query } from './db/pool.js';
import { expireDueIntentsEverywhere } from './domain/treasury.js';
import { ApiError } from './http/errors.js';
import { bearerToken } from './http/auth.js';
import { authenticate, runApiRoute } from './http/pipeline.js';
import { errorHead, toApiError, writeApiResponse } from './http/respond.js';
import { handlePageRequest } from './web/router.js';
import { serveAsset } from './web/assets.js';

const MAX_BODY_BYTES = 1000000;
const state = { ready: false };

/** Reads the body and answers null once it passes the pinned size limit. */
async function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let overflow = false;
    request.on('data', (chunk) => {
      if (overflow) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        overflow = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(overflow ? null : Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function isJsonContentType(headers) {
  const value = headers['content-type'];
  if (!value) return null;
  return value.split(';')[0].trim().toLowerCase() === 'application/json';
}

function parseBody(rawBody, headers) {
  const jsonType = isJsonContentType(headers);
  if (jsonType === false) throw new ApiError('UNSUPPORTED_MEDIA_TYPE');
  if (!rawBody.length) return {};
  let parsed;
  try {
    parsed = JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw new ApiError('MALFORMED_JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ApiError('VALIDATION_ERROR', { details: { field: 'body' } });
  }
  return parsed;
}

async function handleHealth(response) {
  if (!state.ready) {
    writePlain(response, 503, { status: 'starting' });
    return;
  }
  try {
    await query('SELECT 1');
    writePlain(response, 200, { status: 'ok' });
  } catch {
    writePlain(response, 503, { status: 'unavailable' });
  }
}

function writePlain(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  response.end(body);
}

async function handleApi(request, response, url, rawBody) {
  try {
    const { route, params } = matchApiRoute(request.method, url.pathname);
    if (!route) throw new ApiError('NOT_FOUND');
    const body = parseBody(rawBody, request.headers);
    const principal = await authenticate({ route, headers: request.headers, bearer: bearerToken(request) });
    const ctx = {
      method: request.method,
      path: url.pathname,
      params,
      query: url.searchParams,
      headers: request.headers,
      body,
      principal,
      organization: principal ? principal.organization : null,
      createdBy: principal ? (principal.member ? principal.member.id : principal.apiKey.id) : null
    };
    const answer = await runApiRoute({ route, ctx, rawBody });
    if (answer.csv !== undefined) {
      response.writeHead(answer.status, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="corvo-intents.csv"',
        'Content-Length': Buffer.byteLength(answer.csv),
        'Cache-Control': 'no-store'
      });
      response.end(answer.csv);
      return;
    }
    writeApiResponse(response, answer);
  } catch (error) {
    const apiError = toApiError(error);
    if (apiError.code === 'INTERNAL_ERROR') process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
    writeApiResponse(response, { status: apiError.status, head: errorHead(apiError) });
  }
}

const server = http.createServer(async (request, response) => {
  let rawBody;
  try {
    rawBody = await readBody(request);
  } catch {
    response.destroy();
    return;
  }

  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  if (rawBody === null) {
    const tooLarge = new ApiError('PAYLOAD_TOO_LARGE');
    if (url.pathname.startsWith('/api/')) {
      writeApiResponse(response, { status: tooLarge.status, head: errorHead(tooLarge) });
    } else {
      response.writeHead(413, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(tooLarge.message);
    }
    return;
  }
  if (url.pathname === '/api/health') {
    await handleHealth(response);
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    await handleApi(request, response, url, rawBody);
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    serveAsset(url.pathname, response);
    return;
  }
  await handlePageRequest({ request, response, url, rawBody, ready: () => state.ready });
});

async function boot() {
  for (;;) {
    try {
      await applySchema();
      await seedDatabase();
      state.ready = true;
      return;
    } catch (error) {
      state.ready = false;
      process.stderr.write(`boot retry: ${error.message}\n`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

server.listen(config.port, '0.0.0.0', () => {
  process.stdout.write(`corvo listening on ${config.port}\n`);
});

boot();

setInterval(() => {
  if (!state.ready) return;
  expireDueIntentsEverywhere().catch(() => {});
}, 2000).unref();
