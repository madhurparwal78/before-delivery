import type { JsonObject, JsonValue } from '../../shared/types';
import { isObject } from '../util';

export interface TemplateContext {
  trigger: JsonValue;
  steps: Record<string, JsonValue>;
  loop: { index: number; item: JsonValue } | null;
  runId: string;
}

const EXPRESSION = /\{\{\s*([^{}]*?)\s*\}\}/g;

interface Lookup {
  found: boolean;
  value: JsonValue;
}

function walk(value: JsonValue, parts: string[]): Lookup {
  let current: JsonValue = value;
  for (const part of parts) {
    if (Array.isArray(current)) {
      const index = Number(part);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return { found: false, value: null };
      current = current[index];
      continue;
    }
    if (isObject(current) && Object.prototype.hasOwnProperty.call(current, part)) {
      current = current[part];
      continue;
    }
    return { found: false, value: null };
  }
  return { found: true, value: current };
}

function lookup(path: string, context: TemplateContext): Lookup {
  const parts = path.split('.').filter((part) => part !== '');
  if (parts.length === 0) return { found: false, value: null };
  const [root, ...rest] = parts;
  if (root === 'trigger') return walk(context.trigger, rest);
  if (root === 'run') {
    return rest.length === 1 && rest[0] === 'id' ? { found: true, value: context.runId } : { found: false, value: null };
  }
  if (root === 'steps') {
    if (rest.length === 0) return { found: false, value: null };
    const [stepId, ...tail] = rest;
    if (!Object.prototype.hasOwnProperty.call(context.steps, stepId)) return { found: false, value: null };
    return walk(context.steps[stepId], tail);
  }
  if (root === 'loop') {
    if (context.loop === null || rest.length === 0) return { found: false, value: null };
    if (rest[0] === 'index') {
      return rest.length === 1 ? { found: true, value: context.loop.index } : { found: false, value: null };
    }
    if (rest[0] === 'item') return walk(context.loop.item, rest.slice(1));
    return { found: false, value: null };
  }
  return { found: false, value: null };
}

export function asText(value: JsonValue): string {
  if (value === null) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

/**
 * Resolves a template field. A field that is exactly one expression keeps the value's
 * type; any other field becomes a string. An unknown path resolves to empty text and
 * adds a log line.
 */
export function resolveTemplate(text: string, context: TemplateContext, log: string[]): JsonValue {
  const matches = [...text.matchAll(EXPRESSION)];
  if (matches.length === 0) return text;
  const note = (path: string): void => {
    const line = `Unknown template path: ${path}`;
    if (!log.includes(line)) log.push(line);
  };
  if (matches.length === 1 && matches[0][0] === text) {
    const result = lookup(matches[0][1], context);
    if (!result.found) {
      note(matches[0][1]);
      return '';
    }
    return result.value;
  }
  return text.replace(EXPRESSION, (_match: string, path: string) => {
    const result = lookup(path, context);
    if (!result.found) {
      note(path);
      return '';
    }
    return asText(result.value);
  });
}

export function resolveText(value: JsonValue | undefined, context: TemplateContext, log: string[]): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') return asText(value);
  return asText(resolveTemplate(value, context, log));
}

export function resolveValues(values: JsonValue | undefined, context: TemplateContext, log: string[]): JsonObject {
  const output: JsonObject = {};
  if (!isObject(values)) return output;
  for (const [name, template] of Object.entries(values)) {
    output[name] = typeof template === 'string' ? resolveTemplate(template, context, log) : template;
  }
  return output;
}
