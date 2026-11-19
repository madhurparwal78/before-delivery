/**
 * The app server: the three pages, the media route and the API. It is
 * same-origin only, sets no cookies and sends no CORS or policy headers.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  ENQUIRY_RECIPIENT,
  checkEnquiry,
  enquiryBody,
  enquirySubject,
  failingFields,
  normaliseEnquiry,
  projectTypeLabel,
  type EnquiryInput,
} from '../shared/enquiry.js';
import { MEDIA_MANIFEST, mediaObjectForKey } from '../shared/media.js';
import { parseCategoryParam } from '../shared/rules.js';
import { PROJECTS, projectBySlug, serviceById } from '../shared/seed.js';
import { loadConfig } from './config.js';
import { Mailer, MailUnavailableError } from './mail.js';
import { MediaLibrary } from './media-library.js';
import { ObjectStore, StorageUnreachableError } from './storage.js';
import { CASE_STUDY_HEADING_ID, renderCaseStudyMain } from './render/case-study.js';
import { HOME_HEADING_ID, renderHomeMain } from './render/home.js';
import { renderDocument } from './render/layout.js';
import { NOT_FOUND_HEADING_ID, renderNotFoundMain } from './render/not-found.js';

const MAX_BODY_BYTES = 16384;

const JSON_TYPE = 'application/json; charset=utf-8';
const HTML_TYPE = 'text/html; charset=utf-8';

const ERRORS = {
  notFound: { status: 404, body: { error: 'not_found', message: 'Not found.' } },
  methodNotAllowed: {
    status: 405,
    body: { error: 'method_not_allowed', message: 'Method not allowed.' },
  },
  tooLarge: { status: 413, body: { error: 'too_large', message: 'The request body is too large.' } },
  badRequest: {
    status: 400,
    body: { error: 'bad_request', message: 'The request body must be a JSON object.' },
  },
  mediaUnavailable: {
    status: 503,
    body: { error: 'media_unavailable', message: 'The media library is unavailable.' },
  },
  mailUnavailable: {
    status: 503,
    body: { error: 'mail_unavailable', message: 'The mail server is unavailable.' },
  },
} as const;

const publicDir = join(dirname(fileURLToPath(import.meta.url)), 'public');

const STATIC_FILES = new Map<string, string>([
  ['/client.js', 'text/javascript; charset=utf-8'],
  ['/site.css', 'text/css; charset=utf-8'],
]);

const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': JSON_TYPE, 'content-length': Buffer.byteLength(payload) });
  res.end(payload);
};

const sendError = (
  res: ServerResponse,
  error: { readonly status: number; readonly body: unknown },
): void => sendJson(res, error.status, error.body);

const sendHtml = (res: ServerResponse, status: number, html: string): void => {
  res.writeHead(status, { 'content-type': HTML_TYPE, 'content-length': Buffer.byteLength(html) });
  res.end(html);
};

const notFoundPage = (): string =>
  renderDocument({
    title: 'Not found | Ottoline Rask',
    kind: 'not-found',
    headingId: NOT_FOUND_HEADING_ID,
    main: renderNotFoundMain(),
  });

interface BodyResult {
  readonly kind: 'object' | 'too-large' | 'not-object';
  readonly value?: Record<string, unknown>;
}

const readBody = async (req: IncomingMessage): Promise<BodyResult> => {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > MAX_BODY_BYTES) return { kind: 'too-large' };
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: 'not-object' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { kind: 'not-object' };
  }
  return { kind: 'object', value: parsed as Record<string, unknown> };
};

const asString = (value: unknown): string => (typeof value === 'string' ? value : '');

const config = loadConfig();
const store = new ObjectStore(config.storage);
const media = new MediaLibrary(store, config.mediaProbeSeconds);
const mailer = new Mailer(config.mail);

const renderHome = (url: URL): string => {
  const pressed = parseCategoryParam(url.searchParams.get('category'));
  const serviceValue = url.searchParams.get('service');
  const service = serviceValue === null ? undefined : serviceById(serviceValue);
  // A hash and reduced motion are only known in the browser, which puts the
  // intro into its done state at once on load.
  const introStartsDone =
    url.searchParams.has('service') || url.searchParams.has('category');
  return renderDocument({
    title: 'Ottoline Rask | Developer and digital creator',
    kind: 'home',
    headingId: HOME_HEADING_ID,
    main: renderHomeMain({
      pressed,
      selectedService: service?.id ?? null,
      introStartsDone,
    }),
  });
};

const renderCaseStudy = (slug: string, url: URL): string | null => {
  const project = projectBySlug(slug);
  if (project === undefined) return null;
  const pressed = parseCategoryParam(url.searchParams.get('category'));
  const calloutValue = Number.parseInt(url.searchParams.get('callout') ?? '', 10);
  const callout = project.callouts.some((item) => item.n === calloutValue) ? calloutValue : null;
  return renderDocument({
    title: `${project.title} | Ottoline Rask`,
    kind: 'case-study',
    headingId: CASE_STUDY_HEADING_ID,
    slug: project.slug,
    main: renderCaseStudyMain({ project, pressed, callout }),
  });
};

const serveStatic = async (res: ServerResponse, pathname: string): Promise<boolean> => {
  const contentType = STATIC_FILES.get(pathname);
  if (contentType !== undefined) {
    const bytes = await readFile(join(publicDir, pathname.slice(1)));
    res.writeHead(200, { 'content-type': contentType, 'content-length': bytes.length });
    res.end(bytes);
    return true;
  }
  const font = /^\/fonts\/([a-z0-9-]+\.woff2)$/.exec(pathname);
  if (font !== null) {
    const name = font[1] ?? '';
    const bytes = await readFile(join(publicDir, 'fonts', name));
    res.writeHead(200, {
      'content-type': 'font/woff2',
      'content-length': bytes.length,
      'cache-control': 'public, max-age=31536000, immutable',
    });
    res.end(bytes);
    return true;
  }
  return false;
};

const handleMedia = async (res: ServerResponse, key: string): Promise<void> => {
  if (mediaObjectForKey(key) === undefined) {
    sendError(res, ERRORS.notFound);
    return;
  }
  try {
    const object = await media.read(key);
    if (object === null) {
      sendError(res, ERRORS.notFound);
      return;
    }
    res.writeHead(200, {
      'content-type': object.contentType,
      'content-length': object.bytes.length,
      'x-content-type-options': 'nosniff',
    });
    res.end(object.bytes);
  } catch (error) {
    if (!(error instanceof StorageUnreachableError)) throw error;
    sendError(res, ERRORS.mediaUnavailable);
  }
};

const handleEnquiry = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const body = await readBody(req);
  if (body.kind === 'too-large') {
    sendError(res, ERRORS.tooLarge);
    return;
  }
  if (body.kind === 'not-object' || body.value === undefined) {
    sendError(res, ERRORS.badRequest);
    return;
  }
  const raw: EnquiryInput = {
    name: asString(body.value['name']),
    email: asString(body.value['email']),
    projectType: asString(body.value['projectType']),
    budget: asString(body.value['budget']),
    message: asString(body.value['message']),
  };
  const enquiry = normaliseEnquiry(raw);
  const messages = checkEnquiry(enquiry);
  if (failingFields(messages).length > 0) {
    sendJson(res, 422, {
      error: 'invalid',
      message: 'The enquiry has invalid fields.',
      fields: messages,
    });
    return;
  }
  try {
    await mailer.send({
      to: ENQUIRY_RECIPIENT,
      from: mailer.from,
      replyTo: enquiry.email,
      subject: enquirySubject(projectTypeLabel(enquiry.projectType) ?? '', enquiry.name),
      body: enquiryBody(enquiry),
    });
  } catch (error) {
    if (!(error instanceof MailUnavailableError)) throw error;
    sendError(res, ERRORS.mailUnavailable);
    return;
  }
  sendJson(res, 201, { status: 'sent' });
};

const handleGrading = async (
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
): Promise<boolean> => {
  if (config.gradingKey === null) return false;
  const mediaKey = pathname.startsWith('/api/grading/media/')
    ? pathname.slice('/api/grading/media/'.length)
    : null;
  const isReset = pathname === '/api/grading/reset';
  if (mediaKey === null && !isReset) return false;

  if (mediaKey !== null && method !== 'DELETE') {
    sendError(res, ERRORS.methodNotAllowed);
    return true;
  }
  if (isReset && method !== 'POST') {
    sendError(res, ERRORS.methodNotAllowed);
    return true;
  }
  if (req.headers['x-grading-key'] !== config.gradingKey) {
    sendError(res, ERRORS.notFound);
    return true;
  }
  if (mediaKey !== null) {
    if (mediaObjectForKey(mediaKey) === undefined) {
      sendError(res, ERRORS.notFound);
      return true;
    }
    await media.remove(mediaKey);
    res.writeHead(204);
    res.end();
    return true;
  }
  await media.restoreAll();
  sendJson(res, 200, { status: 'ok' });
  return true;
};

const handleApi = async (
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
): Promise<void> => {
  if (await handleGrading(req, res, pathname, method)) return;

  if (pathname === '/api/health') {
    if (method !== 'GET') {
      sendError(res, ERRORS.methodNotAllowed);
      return;
    }
    const [storageAnswers, mailAccepts] = await Promise.all([media.check(), mailer.accepts()]);
    sendJson(res, 200, { status: storageAnswers && mailAccepts ? 'ok' : 'unavailable' });
    return;
  }
  if (pathname === '/api/media') {
    if (method !== 'GET') {
      sendError(res, ERRORS.methodNotAllowed);
      return;
    }
    const report = await media.availability();
    sendJson(res, 200, {
      status: report.reachable ? 'available' : 'unavailable',
      objects: report.objects,
    });
    return;
  }
  if (pathname === '/api/enquiries') {
    if (method !== 'POST') {
      sendError(res, ERRORS.methodNotAllowed);
      return;
    }
    await handleEnquiry(req, res);
    return;
  }
  sendError(res, ERRORS.notFound);
};

const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', 'http://localhost');
  const pathname = url.pathname;

  if (pathname.startsWith('/api/')) {
    await handleApi(req, res, pathname, method);
    return;
  }
  if (pathname === '/media' || pathname.startsWith('/media/')) {
    if (method !== 'GET') {
      sendError(res, ERRORS.methodNotAllowed);
      return;
    }
    await handleMedia(res, pathname.slice('/media/'.length));
    return;
  }
  if (method !== 'GET') {
    sendError(res, ERRORS.methodNotAllowed);
    return;
  }
  if (await serveStatic(res, pathname)) return;

  if (pathname === '/') {
    sendHtml(res, 200, renderHome(url));
    return;
  }
  const work = /^\/work\/([^/]+)$/.exec(pathname);
  if (work !== null) {
    const page = renderCaseStudy(work[1] ?? '', url);
    if (page !== null) {
      sendHtml(res, 200, page);
      return;
    }
  }
  sendHtml(res, 404, notFoundPage());
};

const server = createServer((req, res) => {
  handle(req, res).catch((error: unknown) => {
    process.stderr.write(`Request failed: ${String(error)}\n`);
    if (!res.headersSent) sendJson(res, 500, { error: 'server_error', message: 'Server error.' });
    else res.end();
  });
});

await media.start();

server.listen(config.port, '0.0.0.0', () => {
  process.stdout.write(
    `Ottoline Rask Selected Builds on http://0.0.0.0:${config.port} ` +
      `(${PROJECTS.length} projects, ${MEDIA_MANIFEST.length} media objects)\n`,
  );
});
