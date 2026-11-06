import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';
import type { Readiness } from '../db/readiness.js';
import type { Accounts } from '../db/accounts.js';
import {
  ApiError,
  invalidBody,
  invalidPath,
  methodNotAllowed,
  notFoundPath,
  payloadTooLarge,
  unauthenticated,
  unavailable,
  unsupportedMediaType,
} from './errors.js';
import { APP_HTML, STARTING_HTML, isPageRoute } from './pages.js';
import { buildManifest, digestOf, V1_OBJECTS, V2_OBJECTS } from '../api/manifest.js';
import {
  ROUTES,
  checkRole,
  routesFor,
  type ApiResponse,
  type RequestContext,
  type RouteDefinition,
  type Services,
} from '../api/routes.js';
import { SUNSET_HEADER, type ApiVersion } from '../api/versions.js';
import type { Json } from '../api/shapes.js';

const JSON_TYPE = 'application/json; charset=utf-8';
const HTML_TYPE = 'text/html; charset=utf-8';
const MAX_BODY_BYTES = 10_240;
const METHOD_ORDER = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'];

const ASSET_TYPES: Readonly<Record<string, string>> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
};

const CONTRACT_BODY = JSON.stringify({
  v1: digestOf(buildManifest(V1_OBJECTS, ROUTES.filter((route) => route.v1))),
  v2: digestOf(buildManifest(V2_OBJECTS, ROUTES.filter((route) => route.v2))),
});

export interface ServerOptions {
  readonly services: Services;
  readonly accounts: Accounts;
  readonly readiness: Readiness;
  readonly publicDirectory: string;
}

export function createAppServer(options: ServerOptions): Server {
  return createServer((request, response) => {
    void handle(options, request, response).catch(() => {
      if (!response.headersSent) send(response, 'GET', 503, JSON_TYPE, errorBody('v1', unavailable()), {});
      else response.end();
    });
  });
}

async function handle(options: ServerOptions, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const target = request.url ?? '/';
  const url = new URL(target, 'http://localhost');
  const rawPath = url.pathname;
  const method = (request.method ?? 'GET').toUpperCase();

  if (rawPath === '/api' || rawPath.startsWith('/api/')) {
    await handleApi(options, request, response, rawPath, url, method);
    return;
  }
  await handleWeb(options, response, rawPath, method);
}

function versionOfPath(rawPath: string): ApiVersion {
  return rawPath === '/api/v2' || rawPath.startsWith('/api/v2/') ? 'v2' : 'v1';
}

function carriesVersionHeaders(rawPath: string): boolean {
  if (rawPath === '/api/health' || rawPath === '/api/_contract') return false;
  return versionOfPath(rawPath) === 'v1';
}

async function handleApi(
  options: ServerOptions,
  request: IncomingMessage,
  response: ServerResponse,
  rawPath: string,
  url: URL,
  method: string,
): Promise<void> {
  const version = versionOfPath(rawPath);
  const extraHeaders: Record<string, string> = carriesVersionHeaders(rawPath)
    ? { Deprecation: 'true', Sunset: SUNSET_HEADER }
    : {};
  const fail = (error: ApiError): void => {
    send(response, method, error.status, JSON_TYPE, errorBody(version, error), {
      ...extraHeaders,
      ...error.headers,
    });
  };

  let decodedPath: string;
  try {
    decodedPath = decodePath(rawPath);
  } catch {
    fail(invalidPath());
    return;
  }

  if (decodedPath === '/api/health') {
    if (method !== 'GET' && method !== 'HEAD') {
      fail(methodNotAllowed('GET, HEAD'));
      return;
    }
    const ready = options.readiness.isReady;
    send(response, method, ready ? 200 : 503, JSON_TYPE, JSON.stringify({ status: ready ? 'ok' : 'starting' }), {});
    return;
  }
  if (decodedPath === '/api/_contract') {
    if (method !== 'GET' && method !== 'HEAD') {
      fail(methodNotAllowed('GET, HEAD'));
      return;
    }
    send(response, method, 200, JSON_TYPE, CONTRACT_BODY, {});
    return;
  }

  const prefix = version === 'v2' ? '/api/v2' : decodedPath.startsWith('/api/v1') ? '/api/v1' : '/api';
  const relative = decodedPath.slice(prefix.length);
  const candidates = routesFor(version).filter((route) => matchPath(route.path, relative) !== null);
  if (candidates.length === 0) {
    fail(notFoundPath());
    return;
  }
  const effectiveMethod = method === 'HEAD' ? 'GET' : method;
  const resolved = candidates.find((route) => route.method === effectiveMethod);
  if (resolved === undefined) {
    fail(methodNotAllowed(allowHeader(candidates)));
    return;
  }
  if (!options.readiness.isReady) {
    fail(unavailable());
    return;
  }

  let body: Json | undefined;
  try {
    const raw = await readBody(request);
    if (raw.length > 0) {
      if (!isJsonContentType(request.headers['content-type'])) throw unsupportedMediaType();
      try {
        body = JSON.parse(raw.toString('utf8')) as Json;
      } catch {
        throw invalidBody();
      }
    }
  } catch (error) {
    fail(error instanceof ApiError ? error : payloadTooLarge());
    return;
  }

  try {
    const token = bearerToken(request.headers['authorization']);
    const account = token === null ? null : await options.accounts.accountForToken(token);
    if (token !== null && account === null && (resolved.auth === 'bearer' || resolved.auth === 'attendee' || resolved.auth === 'organiser')) {
      throw unauthenticated();
    }
    checkRole(resolved, account, token === null || account === null ? null : token);
    const params = matchPath(resolved.path, relative) as Readonly<Record<string, string>>;
    await checkResource(options.services, resolved, params);
    if (resolved.settles === true) await options.services.booking.settleDueSessions();
    const context: RequestContext = {
      version,
      prefix,
      params,
      query: url.searchParams,
      body,
      account,
      token,
      headers: request.headers,
    };
    const answer = await resolved.handle(options.services, context);
    sendApiResponse(response, method, answer, extraHeaders);
  } catch (error) {
    fail(error instanceof ApiError ? error : unavailable());
  }
}

async function checkResource(
  services: Services,
  route: RouteDefinition,
  params: Readonly<Record<string, string>>,
): Promise<void> {
  if (route.resource === 'session') {
    const found = await services.reads.sessionCapacity(params['id'] as string);
    if (!found.exists) throw new ApiError(404, 'not_found', 'We could not find that session.');
  } else if (route.resource === 'speaker') {
    const found = await services.reads.speaker(params['slug'] as string);
    if (found === null) throw new ApiError(404, 'not_found', 'We could not find that speaker.');
  }
}

function sendApiResponse(
  response: ServerResponse,
  method: string,
  answer: ApiResponse,
  extraHeaders: Readonly<Record<string, string>>,
): void {
  const headers = { ...extraHeaders, ...(answer.headers ?? {}) };
  const payload = answer.text ?? JSON.stringify(answer.json ?? null);
  send(response, method, answer.status, answer.contentType ?? JSON_TYPE, payload, headers);
}

async function handleWeb(
  options: ServerOptions,
  response: ServerResponse,
  rawPath: string,
  method: string,
): Promise<void> {
  if (method !== 'GET' && method !== 'HEAD') {
    send(response, method, 405, HTML_TYPE, APP_HTML, { Allow: 'GET, HEAD' });
    return;
  }
  let path: string;
  try {
    path = decodePath(rawPath);
  } catch {
    send(response, method, 404, HTML_TYPE, APP_HTML, {});
    return;
  }
  if (path.startsWith('/assets/')) {
    await sendAsset(options.publicDirectory, response, path, method);
    return;
  }
  if (!options.readiness.isReady) {
    send(response, method, 503, HTML_TYPE, STARTING_HTML, {});
    return;
  }
  send(response, method, isPageRoute(path) ? 200 : 404, HTML_TYPE, APP_HTML, {});
}

async function sendAsset(
  publicDirectory: string,
  response: ServerResponse,
  path: string,
  method: string,
): Promise<void> {
  const relative = normalize(path).replace(/^(\.\.(\/|$))+/, '');
  const file = join(publicDirectory, relative);
  const type = ASSET_TYPES[extname(file)];
  if (type === undefined || !file.startsWith(join(publicDirectory, 'assets'))) {
    send(response, method, 404, HTML_TYPE, '', {});
    return;
  }
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not a file');
    response.writeHead(200, {
      'Content-Type': type,
      'Content-Length': String(info.size),
      'Cache-Control': 'public, max-age=3600',
    });
    if (method === 'HEAD') {
      response.end();
      return;
    }
    createReadStream(file).pipe(response);
  } catch {
    send(response, method, 404, HTML_TYPE, '', {});
  }
}

function send(
  response: ServerResponse,
  method: string,
  status: number,
  contentType: string,
  payload: string,
  headers: Readonly<Record<string, string>>,
): void {
  const buffer = Buffer.from(payload, 'utf8');
  response.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': String(buffer.length),
    ...headers,
  });
  if (method === 'HEAD') response.end();
  else response.end(buffer);
}

function errorBody(version: ApiVersion, error: ApiError): string {
  const extras: Record<string, Json> = {};
  if (error.extras.fields !== undefined) extras['fields'] = { ...error.extras.fields };
  if (error.extras.conflictsWith !== undefined) extras['conflicts_with'] = error.extras.conflictsWith;
  if (error.extras.reserved !== undefined) extras['reserved'] = error.extras.reserved;
  if (version === 'v1') {
    return JSON.stringify({ error: error.code, message: error.message, ...extras });
  }
  return JSON.stringify({ error: { code: error.code, message: error.message, ...extras } });
}

function decodePath(rawPath: string): string {
  return rawPath
    .split('/')
    .map((segment) => decodeURIComponent(segment))
    .join('/');
}

function matchPath(pattern: string, path: string): Record<string, string> | null {
  const patternParts = pattern.split('/');
  const pathParts = path.split('/');
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (const [index, part] of patternParts.entries()) {
    const actual = pathParts[index] as string;
    if (part.startsWith('{') && part.endsWith('}')) {
      if (actual === '') return null;
      params[part.slice(1, -1)] = actual;
      continue;
    }
    if (part !== actual) return null;
  }
  return params;
}

function allowHeader(candidates: readonly RouteDefinition[]): string {
  const methods = new Set<string>(candidates.map((route) => route.method));
  if (methods.has('GET')) methods.add('HEAD');
  return METHOD_ORDER.filter((method) => methods.has(method)).join(', ');
}

function isJsonContentType(header: string | undefined): boolean {
  if (header === undefined) return false;
  const mediaType = (header.split(';')[0] ?? '').trim().toLowerCase();
  return mediaType === 'application/json';
}

function bearerToken(header: string | undefined): string | null {
  if (header === undefined) return null;
  const match = /^Bearer (.+)$/.exec(header.trim());
  return match?.[1] ?? null;
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        // Keep draining so the answer still reaches the caller.
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (tooLarge) reject(payloadTooLarge());
      else resolve(Buffer.concat(chunks));
    });
    request.on('error', () => reject(invalidBody()));
  });
}
