import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { requireMember } from './auth.js';
import { JSON_BODY_LIMIT } from './config.js';
import type { UploadBody } from './uploads.js';
import { HttpError, crossOrigin, malformedJson, notFound, toHttpError, unsupportedMediaType } from './errors.js';

const CLIENT_DIR = resolve(import.meta.dirname, '../client');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

/** Addresses the single-page app answers itself; everything else is the not-found page with a 404. */
const PAGE_ROUTES = [
  /^\/$/,
  /^\/(join|confirm|signin|feed|network|notifications|search|jobs|my-jobs|settings|messaging)$/,
  /^\/posts\/[^/]+$/,
  /^\/hashtag\/[^/]+$/,
  /^\/in\/[^/]+(\/mutual)?$/,
  /^\/messaging\/(with\/)?[^/]+$/,
  /^\/jobs\/[^/]+(\/applicants|\/edit)?$/,
  /^\/company\/[^/]+$/,
];

interface UploadRouteConfig {
  upload?: boolean;
}

function isJson(contentType: string): boolean {
  return /^application\/json(\s*;.*)?$/i.test(contentType.trim());
}

function isMultipart(contentType: string): boolean {
  return /^multipart\/form-data\s*;/i.test(contentType.trim());
}

function sendClientFile(reply: FastifyReply, file: string, status = 200): FastifyReply {
  const type = CONTENT_TYPES[extname(file)] ?? 'application/octet-stream';
  const immutable = file.includes(`${join(CLIENT_DIR, 'assets')}`) || file.includes(`${join(CLIENT_DIR, 'fonts')}`);
  return reply
    .status(status)
    .header('Content-Type', type)
    .header('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache')
    .send(readFileSync(file));
}

function refuse(reply: FastifyReply, error: HttpError): FastifyReply {
  return reply.status(error.status).send(error.body);
}

function decodedPath(path: string): string | null {
  try {
    return decodeURIComponent(path);
  } catch {
    return null;
  }
}

function handleUnmatched(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  const path = request.url.split('?')[0] ?? '/';
  const decoded = decodedPath(path);
  if (path.startsWith('/api/') || path.startsWith('/media/') || (request.method !== 'GET' && request.method !== 'HEAD')) {
    return refuse(reply, notFound());
  }
  const index = join(CLIENT_DIR, 'index.html');
  if (!existsSync(index)) return refuse(reply, notFound());
  const file = decoded === null ? null : normalize(join(CLIENT_DIR, decoded));
  if (file?.startsWith(CLIENT_DIR + '/') && existsSync(file) && statSync(file).isFile() && file !== index) return sendClientFile(reply, file);
  return sendClientFile(reply, index, decoded !== null && PAGE_ROUTES.some((route) => route.test(decoded)) ? 200 : 404);
}

export type RouteModule = (app: FastifyInstance) => Promise<void>;

/** Builds the server. Public routes need no session; member routes run behind it. */
export async function buildApp(publicRoutes: RouteModule[], memberRoutes: RouteModule[]): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: JSON_BODY_LIMIT, trustProxy: false,
    routerOptions: { ignoreTrailingSlash: true },
    frameworkErrors: (error, _request, reply) => refuse(reply, toHttpError(error)),
  });

  // 1. A write from another origin is refused before anything is read.
  app.addHook('onRequest', async (request) => {
    if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') return;
    const origin = request.headers.origin;
    if (origin && origin !== `http://${request.headers.host}` && origin !== `https://${request.headers.host}`) {
      throw crossOrigin();
    }
  });

  // 2 and 3. Body size is enforced while reading; then the media type. Both come before authentication.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (request: FastifyRequest, body: Buffer, done) => {
    const contentType = request.headers['content-type'] ?? '';
    const upload = (request.routeOptions.config as UploadRouteConfig).upload === true;
    if (upload && isMultipart(contentType)) return done(null, { contentType, bytes: body } satisfies UploadBody);
    if (!upload && isJson(contentType)) {
      if (body.length === 0) return done(null, {});
      try {
        return done(null, JSON.parse(body.toString('utf8')));
      } catch {
        return done(malformedJson());
      }
    }
    return done(unsupportedMediaType());
  });

  app.setErrorHandler((error: unknown, _request, reply) => {
    const failure = toHttpError(error);
    if (failure.status === 500) console.error('unhandled error', error);
    return refuse(reply, failure);
  });
  app.setNotFoundHandler((request, reply) => handleUnmatched(request, reply));

  for (const routes of publicRoutes) await app.register(routes);
  await app.register(async (member) => {
    member.addHook('preHandler', requireMember);
    for (const routes of memberRoutes) await member.register(routes);
  });
  return app;
}
