import {
  INTERVIEW_NOT_FOUND_MESSAGE,
  INVALID_MESSAGE,
  NOT_FOUND_MESSAGE,
  SCENARIO_NOT_FOUND_MESSAGE,
  SHEET_FILENAME,
  SHEET_UNAVAILABLE_MESSAGE,
  TOO_LARGE_MESSAGE,
} from '../shared/messages';
import type {
  ContentResponse,
  Interview,
  InterviewNeighbour,
  InterviewResponse,
} from '../shared/types';
import { readGradingBody } from '../shared/validate';
import { gotenbergAnswers, renderSheet } from './sheet';
import type { ContentStore } from './store';

export const BODY_LIMIT = 262_144;

export type Reply =
  | { kind: 'json'; status: number; body: unknown }
  | { kind: 'pdf'; body: Buffer; filename: string };

export type BodyReader = () => Promise<Buffer | 'too_large'>;

export interface ApiContext {
  store: ContentStore;
  gotenbergUrl: string;
  gradingKey: string | null;
}

type ReadRoute =
  | { name: 'health' }
  | { name: 'content' }
  | { name: 'sheet' }
  | { name: 'interview'; slug: string }
  | { name: 'scenario'; id: string };

function errorReply(status: number, code: string, message: string): Reply {
  return { kind: 'json', status, body: { error: code, message } };
}

export const NOT_FOUND_REPLY = errorReply(404, 'not_found', NOT_FOUND_MESSAGE);
const TOO_LARGE_REPLY = errorReply(413, 'too_large', TOO_LARGE_MESSAGE);
const INVALID_REPLY = errorReply(422, 'invalid', INVALID_MESSAGE);

function resolveReadRoute(pathname: string): ReadRoute | null {
  if (pathname === '/api/health') {
    return { name: 'health' };
  }
  if (pathname === '/api/content') {
    return { name: 'content' };
  }
  if (pathname === '/api/product/sheet') {
    return { name: 'sheet' };
  }
  const slug = /^\/api\/interviews\/([^/]+)$/.exec(pathname)?.[1];
  if (slug !== undefined) {
    return { name: 'interview', slug };
  }
  const id = /^\/api\/scenarios\/([^/]+)$/.exec(pathname)?.[1];
  if (id !== undefined) {
    return { name: 'scenario', id };
  }
  return null;
}

function neighbour(
  interviews: Interview[],
  index: number,
): InterviewNeighbour | null {
  const found = interviews[index];
  return found === undefined ? null : { slug: found.slug, name: found.name };
}

async function health(context: ApiContext): Promise<Reply> {
  const [postgres, gotenberg] = await Promise.all([
    context.store.answers(),
    gotenbergAnswers(context.gotenbergUrl),
  ]);
  return {
    kind: 'json',
    status: 200,
    body: { status: postgres && gotenberg ? 'ok' : 'unavailable' },
  };
}

async function content(context: ApiContext): Promise<Reply> {
  const record = await context.store.read();
  const body: ContentResponse = {
    edition: record.edition,
    product: record.product,
    interviews: record.interviews.map((item) => ({
      slug: item.slug,
      name: item.name,
      role: item.role,
      category: item.category,
      lede: item.lede,
      hue: item.hue,
    })),
    scenarios: record.scenarios.map((item) => ({
      id: item.id,
      mode: item.mode,
      name: item.name,
    })),
  };
  return { kind: 'json', status: 200, body };
}

async function interview(context: ApiContext, slug: string): Promise<Reply> {
  const record = await context.store.read();
  const index = record.interviews.findIndex((item) => item.slug === slug);
  const found = record.interviews[index];
  if (found === undefined) {
    return errorReply(404, 'not_found', INTERVIEW_NOT_FOUND_MESSAGE);
  }
  const body: InterviewResponse = {
    ...found,
    previous: neighbour(record.interviews, index - 1),
    next: neighbour(record.interviews, index + 1),
  };
  return { kind: 'json', status: 200, body };
}

async function scenario(context: ApiContext, id: string): Promise<Reply> {
  const record = await context.store.read();
  const found = record.scenarios.find((item) => item.id === id);
  if (found === undefined) {
    return errorReply(404, 'not_found', SCENARIO_NOT_FOUND_MESSAGE);
  }
  return { kind: 'json', status: 200, body: found };
}

async function productSheet(context: ApiContext): Promise<Reply> {
  const record = await context.store.read();
  const pdf = await renderSheet(
    context.gotenbergUrl,
    record.product,
    record.edition,
  );
  if (pdf === null) {
    return errorReply(503, 'sheet_unavailable', SHEET_UNAVAILABLE_MESSAGE);
  }
  return { kind: 'pdf', body: pdf, filename: SHEET_FILENAME };
}

async function replaceContent(
  context: ApiContext,
  readBody: BodyReader,
): Promise<Reply> {
  const raw = await readBody();
  if (raw === 'too_large') {
    return TOO_LARGE_REPLY;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8')) as unknown;
  } catch {
    return INVALID_REPLY;
  }
  const body = readGradingBody(parsed);
  if (body === null) {
    return INVALID_REPLY;
  }
  return {
    kind: 'json',
    status: 200,
    body: { edition: await context.store.replace(body) },
  };
}

async function answerReadRoute(
  context: ApiContext,
  route: ReadRoute,
): Promise<Reply> {
  switch (route.name) {
    case 'health':
      return health(context);
    case 'content':
      return content(context);
    case 'sheet':
      return productSheet(context);
    case 'interview':
      return interview(context, route.slug);
    case 'scenario':
      return scenario(context, route.id);
  }
}

/**
 * Answers an `/api/...` request. The checks run in the published order: the
 * path and method, then the grading key, then the body size, then the shape.
 */
export async function handleApi(
  context: ApiContext,
  method: string,
  pathname: string,
  gradingKeyHeader: string | undefined,
  readBody: BodyReader,
): Promise<Reply> {
  if (pathname === '/api/grading/content') {
    if (method !== 'PUT' && method !== 'DELETE') {
      return NOT_FOUND_REPLY;
    }
    if (context.gradingKey === null || gradingKeyHeader !== context.gradingKey) {
      return NOT_FOUND_REPLY;
    }
    if (method === 'DELETE') {
      return {
        kind: 'json',
        status: 200,
        body: { edition: await context.store.restore() },
      };
    }
    return replaceContent(context, readBody);
  }

  const route = resolveReadRoute(pathname);
  if (route === null || method !== 'GET') {
    return NOT_FOUND_REPLY;
  }
  if ((await readBody()) === 'too_large') {
    return TOO_LARGE_REPLY;
  }
  return answerReadRoute(context, route);
}
