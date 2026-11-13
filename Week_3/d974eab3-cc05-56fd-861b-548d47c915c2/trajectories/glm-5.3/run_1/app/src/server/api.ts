import type { ContentRecord } from '../domain/content.js';
import { parseGradingBody } from '../domain/shape.js';
import { startingContent } from '../domain/seed.js';
import { currentEdition, readContent, writeContent } from './db.js';
import { invalid, json, notFound, sheetUnavailable, tooLarge, BODY_LIMIT } from './replies.js';
import { sheetHtml } from './sheet.js';

const SHEET_TIMEOUT_MS = 20_000;
const HEALTH_TIMEOUT_MS = 2_000;

function contentUnavailable(): Response {
  return json(503, { error: 'content_unavailable', message: 'The story cannot be loaded right now. Please reload the page.' });
}

export interface ApiConfig {
  gotenbergUrl: string;
  gradingKey: string | null;
}

export async function handleApi(
  request: Request,
  pathname: string,
  config: ApiConfig,
): Promise<Response | null> {
  if (!pathname.startsWith('/api/')) return null;

  const grading = await handleGrading(request, pathname, config);
  if (grading) return grading;

  if (request.method !== 'GET') return notFound();

  if (pathname === '/api/health') {
    const status = (await checkHealth(config)) ? 'ok' : 'unavailable';
    return json(200, { status });
  }

  if (pathname === '/api/content') {
    const content = await readContent();
    if (!content) return contentUnavailable();
    return json(200, contentView(content));
  }

  if (pathname === '/api/product/sheet') {
    return productSheet(config);
  }

  const interviewMatch = pathname.match(/^\/api\/interviews\/([a-z0-9-]+)$/);
  if (interviewMatch) {
    const content = await readContent();
    if (!content) return contentUnavailable();
    const slug = interviewMatch[1] ?? '';
    const interview = content.interviews.find((item) => item.slug === slug);
    if (!interview) {
      return json(404, { error: 'not_found', message: 'This interview does not exist.' });
    }
    const index = content.interviews.indexOf(interview);
    const previous = content.interviews[index - 1];
    const next = content.interviews[index + 1];
    return json(200, {
      slug: interview.slug,
      name: interview.name,
      role: interview.role,
      category: interview.category,
      lede: interview.lede,
      hue: interview.hue,
      answers: interview.answers,
      previous: previous ? { slug: previous.slug, name: previous.name } : null,
      next: next ? { slug: next.slug, name: next.name } : null,
    });
  }

  const scenarioMatch = pathname.match(/^\/api\/scenarios\/([a-z0-9-]+)$/);
  if (scenarioMatch) {
    const content = await readContent();
    if (!content) return contentUnavailable();
    const scenario = content.scenarios.find((item) => item.id === scenarioMatch[1]);
    if (!scenario) {
      return json(404, { error: 'not_found', message: 'This scenario does not exist.' });
    }
    return json(200, scenario);
  }

  return notFound();
}

export async function handleGrading(
  request: Request,
  pathname: string,
  config: ApiConfig,
): Promise<Response | null> {
  if (config.gradingKey === null) return null;
  if (pathname !== '/api/grading/content') return null;

  if (request.method !== 'PUT' && request.method !== 'DELETE') return notFound();

  if (request.headers.get('x-grading-key') !== config.gradingKey) return notFound();

  if (request.method === 'DELETE') {
    const start = startingContent(1);
    await writeContent(start);
    return json(200, { edition: 1 });
  }

  const raw = await request.arrayBuffer();
  if (raw.byteLength > BODY_LIMIT) return tooLarge();

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return invalid();
  }
  const next = parseGradingBody(parsed);
  if (!next) return invalid();

  const edition = await currentEdition();
  if (edition === null) return contentUnavailable();
  await writeContent({ ...next, edition: edition + 1 });
  return json(200, { edition: edition + 1 });
}

function contentView(content: ContentRecord) {
  return {
    edition: content.edition,
    product: content.product,
    interviews: content.interviews.map((interview) => ({
      slug: interview.slug,
      name: interview.name,
      role: interview.role,
      category: interview.category,
      lede: interview.lede,
      hue: interview.hue,
    })),
    scenarios: content.scenarios.map((scenario) => ({
      id: scenario.id,
      mode: scenario.mode,
      name: scenario.name,
    })),
  };
}

async function productSheet(config: ApiConfig): Promise<Response> {
  const content = await readContent();
  if (!content) return contentUnavailable();

  const form = new FormData();
  form.append('index.html', new Blob([sheetHtml(content)], { type: 'text/html' }), 'index.html');

  try {
    const gotenberg = await fetch(`${config.gotenbergUrl}/forms/chromium/convert/html`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(SHEET_TIMEOUT_MS),
    });
    if (!gotenberg.ok) return sheetUnavailable();
    const pdf = await gotenberg.arrayBuffer();
    if (pdf.byteLength === 0) return sheetUnavailable();
    return new Response(pdf, {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': 'attachment; filename="vireo-pace-product-sheet.pdf"',
      },
    });
  } catch {
    return sheetUnavailable();
  }
}

async function checkHealth(config: ApiConfig): Promise<boolean> {
  try {
    const response = await fetch(`${config.gotenbergUrl}/health`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    if (!response.ok) return false;
    await readContent();
    return true;
  } catch {
    return false;
  }
}
