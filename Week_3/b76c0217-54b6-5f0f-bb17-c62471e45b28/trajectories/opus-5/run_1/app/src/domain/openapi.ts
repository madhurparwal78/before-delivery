import { uniqueAnchors } from './anchors';
import { escapeHtml, type HeadingInfo } from './markdown';

/** OpenAPI 3.0 import, reference page generation and the mock route's answers. */

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;

export interface Parameter {
  name: string;
  in: 'path' | 'query' | 'header';
  type: string;
  required: boolean;
  description: string;
}

export interface ResponseDoc {
  code: number;
  description: string;
  example: unknown;
}

export interface Operation {
  operationId: string;
  method: string;
  path: string;
  summary: string;
  description: string;
  parameters: Parameter[];
  requestBodyExample: unknown;
  hasRequestBody: boolean;
  responses: ResponseDoc[];
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asString = (value: unknown): string => (typeof value === 'string' ? value : '');

function exampleOf(content: unknown): { present: boolean; example: unknown } {
  const media = asRecord(content)?.['application/json'];
  const record = asRecord(media);
  if (record === null) return { present: false, example: null };
  return { present: 'example' in record, example: record.example ?? null };
}

function parametersOf(raw: unknown): Parameter[] {
  const list = Array.isArray(raw) ? raw : [];
  const parsed: Parameter[] = [];
  for (const entry of list) {
    const record = asRecord(entry);
    if (record === null) continue;
    const where = asString(record.in);
    if (where !== 'path' && where !== 'query' && where !== 'header') continue;
    parsed.push({
      name: asString(record.name),
      in: where,
      type: asString(asRecord(record.schema)?.type) || 'string',
      required: where === 'path' ? true : record.required === true,
      description: asString(record.description),
    });
  }
  const order = { path: 0, query: 1, header: 2 } as const;
  return parsed
    .map((parameter, index) => ({ parameter, index }))
    .sort((a, b) => order[a.parameter.in] - order[b.parameter.in] || a.index - b.index)
    .map((entry) => entry.parameter);
}

export interface ParsedSpec {
  operations: Operation[];
}

/** Accepts an OpenAPI 3.0 JSON file whose operations all have unique ids. */
export function parseSpec(bytes: Buffer): ParsedSpec | null {
  let document: unknown;
  try {
    document = JSON.parse(bytes.toString('utf8'));
  } catch {
    return null;
  }
  const root = asRecord(document);
  if (root === null) return null;
  if (!asString(root.openapi).startsWith('3.0.')) return null;
  const paths = asRecord(root.paths);
  if (paths === null) return null;
  const operations: Operation[] = [];
  const seen = new Set<string>();
  for (const [path, pathItemRaw] of Object.entries(paths)) {
    const pathItem = asRecord(pathItemRaw);
    if (pathItem === null) return null;
    for (const [method, operationRaw] of Object.entries(pathItem)) {
      if (!(METHODS as readonly string[]).includes(method)) continue;
      const operation = asRecord(operationRaw);
      if (operation === null) return null;
      const operationId = asString(operation.operationId);
      if (operationId === '' || seen.has(operationId)) return null;
      seen.add(operationId);
      const requestBody = asRecord(operation.requestBody);
      const bodyExample = exampleOf(requestBody?.content);
      const responses: ResponseDoc[] = [];
      for (const [code, responseRaw] of Object.entries(asRecord(operation.responses) ?? {})) {
        const response = asRecord(responseRaw);
        if (response === null || !/^\d{3}$/.test(code)) continue;
        responses.push({
          code: Number(code),
          description: asString(response.description),
          example: exampleOf(response.content).example,
        });
      }
      responses.sort((a, b) => a.code - b.code);
      operations.push({
        operationId,
        method: method.toUpperCase(),
        path,
        summary: asString(operation.summary),
        description: asString(operation.description),
        parameters: parametersOf(operation.parameters),
        requestBodyExample: bodyExample.example,
        hasRequestBody: requestBody !== null,
        responses,
      });
    }
  }
  return operations.length === 0 ? null : { operations };
}

export const findOperation = (spec: ParsedSpec, operationId: string): Operation | undefined =>
  spec.operations.find((operation) => operation.operationId === operationId);

export const defaultResponseCode = (operation: Operation): number => {
  const success = operation.responses.find((response) => response.code >= 200 && response.code < 300);
  return (success ?? operation.responses[0]).code;
};

const pretty = (value: unknown): string => JSON.stringify(value, null, 2);

/** The read-only page source shown in the editor for a generated reference page. */
export function referenceSource(operation: Operation): string {
  const lines: string[] = [`${operation.method} ${operation.path}`, ''];
  if (operation.description !== '') lines.push(operation.description, '');
  if (operation.parameters.length > 0) {
    lines.push('## Parameters', '');
    for (const parameter of operation.parameters) {
      lines.push(
        `- ${parameter.name} (${parameter.in}, ${parameter.type}, ${parameter.required ? 'Yes' : 'No'}) ${parameter.description}`.trimEnd(),
      );
    }
    lines.push('');
  }
  if (operation.hasRequestBody) {
    lines.push('## Request body', '', '```json', pretty(operation.requestBodyExample), '```', '');
  }
  if (operation.responses.length > 0) {
    lines.push('## Responses', '');
    for (const response of operation.responses) {
      lines.push(`### ${response.code} ${response.description}`, '', '```json', pretty(response.example), '```', '');
    }
  }
  lines.push('## Try it', '');
  return lines.join('\n');
}

export interface ReferenceContext {
  siteSlug: string;
  versionSlug: string;
}

export interface ReferenceRender {
  aboveTitle: string;
  html: string;
  text: string;
  headings: HeadingInfo[];
}

/** Generated identically every time from the stored file (DP-30). */
export function renderReference(operation: Operation, ctx: ReferenceContext): ReferenceRender {
  const headingTexts: { level: number; text: string }[] = [];
  const plan = (level: number, text: string): void => {
    headingTexts.push({ level, text });
  };
  if (operation.parameters.length > 0) plan(2, 'Parameters');
  if (operation.hasRequestBody) plan(2, 'Request body');
  if (operation.responses.length > 0) {
    plan(2, 'Responses');
    for (const response of operation.responses) plan(3, `${response.code} ${response.description}`);
  }
  plan(2, 'Try it');
  const anchors = uniqueAnchors(headingTexts.map((heading) => heading.text));
  const headings: HeadingInfo[] = headingTexts.map((heading, index) => ({
    level: heading.level,
    text: heading.text,
    anchor: anchors[index],
  }));

  let next = 0;
  const heading = (): string => {
    const info = headings[next];
    next += 1;
    return `<div class="heading-row"><h${info.level} id="${escapeHtml(info.anchor as string)}">${escapeHtml(info.text)}</h${info.level}><a class="anchor-link" href="#${escapeHtml(info.anchor as string)}" aria-label="Link to ${escapeHtml(info.text)}">#</a></div>`;
  };

  const parts: string[] = [];
  const text: string[] = [operation.method, operation.path, operation.summary];
  if (operation.description !== '') {
    parts.push(`<p>${escapeHtml(operation.description)}</p>`);
    text.push(operation.description);
  }
  if (operation.parameters.length > 0) {
    parts.push(heading());
    const rows = operation.parameters
      .map((parameter) => {
        text.push(parameter.name, parameter.description);
        return `<tr><td class="mono">${escapeHtml(parameter.name)}</td><td>${escapeHtml(parameter.in)}</td><td class="mono">${escapeHtml(parameter.type)}</td><td>${parameter.required ? 'Yes' : 'No'}</td><td>${escapeHtml(parameter.description)}</td></tr>`;
      })
      .join('');
    parts.push(
      `<div class="scroll-box"><table class="params"><thead><tr><th>Name</th><th>In</th><th>Type</th><th>Required</th><th>Description</th></tr></thead><tbody>${rows}</tbody></table></div>`,
    );
  }
  if (operation.hasRequestBody) {
    parts.push(heading());
    const body = pretty(operation.requestBodyExample);
    text.push(body);
    parts.push(`<div class="code-block"><pre><code class="language-json">${escapeHtml(body)}</code></pre></div>`);
  }
  if (operation.responses.length > 0) {
    parts.push(heading());
    for (const response of operation.responses) {
      parts.push(heading());
      const body = pretty(response.example);
      text.push(response.description, body);
      parts.push(`<div class="code-block"><pre><code class="language-json">${escapeHtml(body)}</code></pre></div>`);
    }
  }
  parts.push(heading());
  parts.push(tryItPanel(operation, ctx));

  return {
    aboveTitle: `<p class="operation-line mono">${escapeHtml(`${operation.method} ${operation.path}`)}</p>`,
    html: parts.join('\n'),
    text: text.join(' '),
    headings,
  };
}

function tryItPanel(operation: Operation, ctx: ReferenceContext): string {
  const fields = operation.parameters
    .map((parameter, index) => {
      const id = `try-${operation.operationId}-p${index}`;
      return `<div class="field"><label for="${id}">${escapeHtml(parameter.name)}</label><input id="${id}" type="text" data-parameter="${escapeHtml(parameter.name)}"${parameter.required ? ' data-required="true" aria-required="true"' : ''}><p class="field-error" id="${id}-error" hidden></p></div>`;
    })
    .join('');
  const bodyField = operation.hasRequestBody
    ? `<div class="field"><label for="try-${operation.operationId}-body">Request body</label><textarea id="try-${operation.operationId}-body" rows="5" data-body="true">${escapeHtml(pretty(operation.requestBodyExample))}</textarea><p class="field-error" id="try-${operation.operationId}-body-error" hidden></p></div>`
    : '';
  const codes = operation.responses
    .map(
      (response) =>
        `<option value="${response.code}"${response.code === defaultResponseCode(operation) ? ' selected' : ''}>${response.code}</option>`,
    )
    .join('');
  return [
    `<section class="try-it" aria-label="Try it" data-try-it data-operation="${escapeHtml(operation.operationId)}" data-site="${escapeHtml(ctx.siteSlug)}" data-version="${escapeHtml(ctx.versionSlug)}">`,
    fields,
    bodyField,
    `<div class="field"><label for="try-${operation.operationId}-code">Response code</label><select id="try-${operation.operationId}-code" data-response-code>${codes}</select></div>`,
    '<button type="button" class="primary" data-send-request>Send request</button>',
    '<p class="try-status mono" data-try-status hidden></p>',
    '<pre class="try-body" data-try-body hidden></pre>',
    '</section>',
  ].join('');
}
