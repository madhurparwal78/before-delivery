import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import {
  applySchema,
  connectWithRetry,
  databaseReachable,
  findEnquiryByToken,
  listEnquiries,
  loadContent,
  replaceContent,
  restoreStartingContent,
} from './db.js';
import { readContent } from './contentShape.js';
import { submitEnquiry } from './enquiries.js';
import { mailServerReachable } from './mail.js';
import { pdfServiceReachable, renderBrief } from './pdf.js';
import { neighbours } from '../content/selection.js';
import { SERVICES } from '../content/copy.js';
import { PROJECT_TYPES } from '../shared/copy.js';
import { renderCaseStudy } from '../render/caseStudy.js';
import { renderHome } from '../render/home.js';
import {
  renderBriefUnavailable,
  renderPageNotFound,
  renderPrivacy,
  renderProjectNotFound,
} from '../render/pages.js';
import type { CategoryId, ProjectTypeId } from '../shared/types.js';

const BODY_LIMIT = 262_144;
const PUBLIC_DIR = path.join(import.meta.dirname, '..', 'public');

const STATIC_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
};

type Answer = (request: http.IncomingMessage, response: http.ServerResponse) => Promise<void>;

interface Route {
  pattern: RegExp;
  methods: Record<string, Answer>;
}

const send = (
  response: http.ServerResponse,
  status: number,
  type: string,
  body: Buffer | string,
  extra: Record<string, string> = {},
): void => {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
  response.writeHead(status, {
    'content-type': type,
    'content-length': buffer.byteLength,
    ...extra,
  });
  response.end(response.req.method === 'HEAD' ? undefined : buffer);
};

const sendJson = (response: http.ServerResponse, status: number, body: unknown): void =>
  send(response, status, 'application/json; charset=utf-8', JSON.stringify(body));

const sendHtml = (response: http.ServerResponse, status: number, body: string): void =>
  send(response, status, 'text/html; charset=utf-8', body, { 'cache-control': 'no-store' });

const notFoundJson = { error: 'not_found', message: 'Not found.' };

const asCategory = (value: string | null): CategoryId | null => {
  const service = SERVICES.find((candidate) => candidate.id === value);
  return service ? service.id : null;
};

const asProjectType = (value: string | null): ProjectTypeId | null => {
  const option = PROJECT_TYPES.find((candidate) => candidate.id === value);
  return option ? option.id : null;
};

type BodyRead =
  | { kind: 'body'; raw: Buffer }
  | { kind: 'too_large' };

async function readBody(request: http.IncomingMessage): Promise<BodyRead> {
  const declared = Number(request.headers['content-length'] ?? '0');
  if (Number.isFinite(declared) && declared > BODY_LIMIT) {
    request.resume();
    return { kind: 'too_large' };
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const part = chunk as Buffer;
    size += part.byteLength;
    if (size > BODY_LIMIT) {
      request.destroy();
      return { kind: 'too_large' };
    }
    chunks.push(part);
  }
  return { kind: 'body', raw: Buffer.concat(chunks) };
}

/** A body that parses but is not an object fails the shape or field checks, not the parse. */
const parseJson = (raw: Buffer): Record<string, unknown> | null => {
  try {
    const value: unknown = JSON.parse(raw.toString('utf8'));
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return null;
  }
};

async function withJsonBody(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  handle: (body: Record<string, unknown>) => Promise<void>,
): Promise<void> {
  const body = await readBody(request);
  if (body.kind === 'too_large') {
    sendJson(response, 413, { error: 'too_large', message: 'The request body is too large.' });
    return;
  }
  const parsed = parseJson(body.raw);
  if (parsed === null) {
    sendJson(response, 400, { error: 'bad_request', message: 'The request body must be JSON.' });
    return;
  }
  await handle(parsed);
}

const gradingAllowed = (request: http.IncomingMessage): boolean =>
  config.gradingKey !== null && request.headers['x-grading-key'] === config.gradingKey;

const homeAnswer: Answer = async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const content = await loadContent();
  sendHtml(
    response,
    200,
    renderHome({
      content,
      category: asCategory(url.searchParams.get('category')),
      service: asCategory(url.searchParams.get('service')),
      projectType: asProjectType(url.searchParams.get('type')),
    }),
  );
};

const caseStudyAnswer: Answer = async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const slug = decodeURIComponent(url.pathname.slice('/work/'.length));
  const content = await loadContent();
  const project = content.projects.find((candidate) => candidate.slug === slug);
  if (!project) {
    sendHtml(response, 404, renderProjectNotFound());
    return;
  }
  const category = asCategory(url.searchParams.get('category'));
  const sequence = neighbours(content.projects, category, slug);
  sendHtml(
    response,
    200,
    renderCaseStudy({
      project,
      index: content.projects.indexOf(project),
      previous: sequence.previous,
      next: sequence.next,
      category,
    }),
  );
};

const briefAnswer: Answer = async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const token = url.pathname.slice('/briefs/'.length, -'.pdf'.length);
  const enquiry = await findEnquiryByToken(token);
  if (!enquiry) {
    sendHtml(response, 404, renderPageNotFound());
    return;
  }
  try {
    const pdf = await renderBrief(enquiry);
    send(response, 200, 'application/pdf', pdf, {
      'content-disposition': `attachment; filename="${enquiry.reference}-brief.pdf"`,
      'cache-control': 'no-store',
    });
  } catch {
    sendHtml(response, 503, renderBriefUnavailable(enquiry.reference));
  }
};

const staticAnswer: Answer = async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const relative = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  const file = path.join(PUBLIC_DIR, relative);
  const type = STATIC_TYPES[path.extname(file)];
  if (!file.startsWith(path.join(PUBLIC_DIR, 'assets')) || type === undefined) {
    sendHtml(response, 404, renderPageNotFound());
    return;
  }
  try {
    const body = await readFile(file);
    send(response, 200, type, body, {
      'cache-control': type === 'font/woff2' ? 'public, max-age=86400' : 'no-cache',
    });
  } catch {
    sendHtml(response, 404, renderPageNotFound());
  }
};

const routes: Route[] = [
  { pattern: /^\/$/, methods: { GET: homeAnswer } },
  { pattern: /^\/privacy$/, methods: { GET: async (_request, response) => sendHtml(response, 200, renderPrivacy()) } },
  { pattern: /^\/work\/[^/]+$/, methods: { GET: caseStudyAnswer } },
  { pattern: /^\/briefs\/[0-9a-f]{32}\.pdf$/, methods: { GET: briefAnswer } },
  { pattern: /^\/assets\/.+$/, methods: { GET: staticAnswer } },
  {
    pattern: /^\/api\/health$/,
    methods: {
      GET: async (_request, response) => {
        const [database, mail, pdf] = await Promise.all([
          databaseReachable(),
          mailServerReachable(),
          pdfServiceReachable(),
        ]);
        sendJson(response, 200, { status: database && mail && pdf ? 'ok' : 'unavailable' });
      },
    },
  },
  {
    pattern: /^\/api\/enquiries$/,
    methods: {
      POST: async (request, response) => {
        await withJsonBody(request, response, async (body) => {
          const result = await submitEnquiry(body);
          sendJson(response, result.status, result.body);
        });
      },
    },
  },
  {
    pattern: /^\/api\/grading\/content$/,
    methods: {
      PUT: async (request, response) => {
        if (!gradingAllowed(request)) {
          sendJson(response, 404, notFoundJson);
          return;
        }
        await withJsonBody(request, response, async (body) => {
          const content = readContent(body);
          if (content === null) {
            sendJson(response, 422, {
              error: 'invalid',
              message: 'The content does not match the published shape.',
            });
            return;
          }
          sendJson(response, 200, { edition: await replaceContent(content) });
        });
      },
      DELETE: async (request, response) => {
        if (!gradingAllowed(request)) {
          sendJson(response, 404, notFoundJson);
          return;
        }
        sendJson(response, 200, { edition: await restoreStartingContent() });
      },
    },
  },
  {
    pattern: /^\/api\/grading\/enquiries$/,
    methods: {
      GET: async (request, response) => {
        if (!gradingAllowed(request)) {
          sendJson(response, 404, notFoundJson);
          return;
        }
        const enquiries = await listEnquiries();
        sendJson(response, 200, {
          enquiries: enquiries.map((enquiry) => ({
            reference: enquiry.reference,
            name: enquiry.name,
            email: enquiry.email,
            project_type: enquiry.projectType,
            budget: enquiry.budget,
            description: enquiry.description,
            mail: enquiry.mail,
          })),
        });
      },
    },
  },
];

const isApi = (pathname: string): boolean => pathname.startsWith('/api/');

async function handle(
  request: http.IncomingMessage,
  response: http.ServerResponse,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const route = routes.find((candidate) => candidate.pattern.test(url.pathname));
  if (!route) {
    if (isApi(url.pathname)) sendJson(response, 404, notFoundJson);
    else sendHtml(response, 404, renderPageNotFound());
    return;
  }
  const method = request.method === 'HEAD' ? 'GET' : (request.method ?? 'GET');
  const answer = route.methods[method];
  if (!answer) {
    sendJson(response, 405, {
      error: 'method_not_allowed',
      message: 'Method not allowed.',
    });
    return;
  }
  await answer(request, response);
}

const server = http.createServer((request, response) => {
  handle(request, response).catch(() => {
    if (!response.headersSent) {
      if (isApi(new URL(request.url ?? '/', 'http://localhost').pathname)) {
        sendJson(response, 503, { error: 'unavailable', message: 'The service is unavailable.' });
      } else {
        sendHtml(response, 503, renderPageNotFound());
      }
    } else {
      response.end();
    }
  });
});

await connectWithRetry();
await applySchema();
server.listen(config.port, '0.0.0.0');
