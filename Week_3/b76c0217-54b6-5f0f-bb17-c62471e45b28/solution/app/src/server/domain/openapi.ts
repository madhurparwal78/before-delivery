// OpenAPI 3.0 JSON: what an import accepts, and the reference page generated for each operation.
// Generation is deterministic: the same stored file always gives the same page source.

import { isSlug } from '../../shared/rules';

type ParameterLocation = 'path' | 'query' | 'header';

export interface Parameter {
  name: string;
  in: ParameterLocation;
  required: boolean;
  description: string;
  type: string;
}

export interface ResponseSpec {
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
  hasRequestBody: boolean;
  requestExample: unknown;
  responses: ResponseSpec[];
}

/** The file is not an OpenAPI 3.0 JSON document with a unique operationId on every operation. */
export class InvalidOpenApiError extends Error {}

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
const LOCATIONS: ParameterLocation[] = ['path', 'query', 'header'];

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

function exampleOf(media: unknown): unknown {
  if (!isObject(media) || !isObject(media.content)) {
    return undefined;
  }
  const content = media.content;
  const json = content['application/json'];
  const chosen = isObject(json) ? json : Object.values(content).find(isObject);
  return isObject(chosen) ? chosen.example : undefined;
}

function parametersOf(pathItem: Json, operation: Json): Parameter[] {
  const merged = new Map<string, Parameter>();
  for (const source of [pathItem.parameters, operation.parameters]) {
    for (const entry of Array.isArray(source) ? source : []) {
      if (isObject(entry) && typeof entry.name === 'string' && LOCATIONS.includes(entry.in as ParameterLocation)) {
        const location = entry.in as ParameterLocation;
        merged.set(`${location}:${entry.name}`, {
          name: entry.name,
          in: location,
          required: location === 'path' || entry.required === true,
          description: text(entry.description),
          type: isObject(entry.schema) ? text(entry.schema.type) : '',
        });
      }
    }
  }
  return LOCATIONS.flatMap((location) => [...merged.values()].filter((p) => p.in === location));
}

export function parseOpenApi(source: string): Operation[] {
  let document: unknown;
  try {
    document = JSON.parse(source);
  } catch {
    throw new InvalidOpenApiError();
  }
  if (!isObject(document) || typeof document.openapi !== 'string' || !document.openapi.startsWith('3.0.') || !isObject(document.paths)) {
    throw new InvalidOpenApiError();
  }
  const operations: Operation[] = [];
  for (const [path, pathItem] of Object.entries(document.paths)) {
    if (!isObject(pathItem)) {
      throw new InvalidOpenApiError();
    }
    for (const method of Object.keys(pathItem).filter((key) => METHODS.includes(key))) {
      const operation = pathItem[method];
      if (!isObject(operation) || typeof operation.operationId !== 'string' || !isSlug(operation.operationId)) {
        throw new InvalidOpenApiError();
      }
      const responses = isObject(operation.responses) ? operation.responses : {};
      operations.push({
        operationId: operation.operationId,
        method: method.toUpperCase(),
        path,
        summary: text(operation.summary) || operation.operationId,
        description: text(operation.description),
        parameters: parametersOf(pathItem, operation),
        hasRequestBody: isObject(operation.requestBody),
        requestExample: exampleOf(operation.requestBody),
        responses: Object.entries(responses)
          .filter(([code]) => /^\d{3}$/.test(code))
          .map(([code, response]) => ({
            code: Number(code),
            description: isObject(response) ? text(response.description) : '',
            example: exampleOf(response),
          }))
          .sort((a, b) => a.code - b.code),
      });
    }
  }
  if (new Set(operations.map((operation) => operation.operationId)).size !== operations.length) {
    throw new InvalidOpenApiError();
  }
  return operations;
}

const escapeMarkdown = (value: string): string => value.replace(/[\\`*_{}[\]()#+!|<>~]/g, '\\$&').replace(/\s+/g, ' ');
const json = (value: unknown): string => '```json\n' + JSON.stringify(value, null, 2) + '\n```';

/** The page source of one operation: the sections of the brief, in order, with those that are empty left out. */
export function referenceSource(operation: Operation): string {
  const sections = [`\`${operation.method} ${operation.path}\``];
  if (operation.description !== '') {
    sections.push(escapeMarkdown(operation.description));
  }
  if (operation.parameters.length > 0) {
    sections.push(
      [
        '## Parameters',
        '',
        '| Name | In | Type | Required | Description |',
        '| --- | --- | --- | --- | --- |',
        ...operation.parameters.map(
          (p) => `| \`${p.name}\` | ${p.in} | ${p.type === '' ? '' : `\`${p.type}\``} | ${p.required ? 'Yes' : 'No'} | ${escapeMarkdown(p.description)} |`,
        ),
      ].join('\n'),
    );
  }
  if (operation.requestExample !== undefined) {
    sections.push(['## Request body', '', json(operation.requestExample)].join('\n'));
  }
  if (operation.responses.length > 0) {
    sections.push(
      [
        '## Responses',
        ...operation.responses.flatMap((response) => [
          '',
          `### ${response.code} ${escapeMarkdown(response.description)}`.trimEnd(),
          ...(response.example === undefined ? [] : ['', json(response.example)]),
        ]),
      ].join('\n'),
    );
  }
  sections.push('## Try it');
  return sections.join('\n\n') + '\n';
}

/** The documented response code the Try it panel starts on: the lowest 2xx, else the first documented. */
export function defaultCode(operation: Operation): number | undefined {
  return (operation.responses.find((r) => r.code >= 200 && r.code < 300) ?? operation.responses[0])?.code;
}
