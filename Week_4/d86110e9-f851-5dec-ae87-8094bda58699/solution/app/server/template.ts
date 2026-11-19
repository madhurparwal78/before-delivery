import { isObject, type Json } from './json.js';

export interface TemplateScope {
  trigger: Json;
  steps: ReadonlyMap<string, Json>;
  loop: { item: Json; index: number } | null;
  runId: string;
}

const WHOLE = /^\{\{([^{}]*)\}\}$/;
const EXPRESSION = /\{\{([^{}]*)\}\}/g;

function walk(root: Json | undefined, path: string[]): Json | undefined {
  let node = root;
  for (const part of path) {
    if (Array.isArray(node)) {
      if (!/^\d+$/.test(part)) return undefined;
      node = node[Number(part)];
    } else if (isObject(node)) {
      node = Object.hasOwn(node, part) ? node[part] : undefined;
    } else {
      return undefined;
    }
    if (node === undefined) return undefined;
  }
  return node;
}

function lookup(scope: TemplateScope, expression: string): Json | undefined {
  const [root, ...rest] = expression.split('.');
  switch (root) {
    case 'trigger':
      return walk(scope.trigger, rest);
    case 'steps': {
      const [id, ...path] = rest;
      return id === undefined || !scope.steps.has(id) ? undefined : walk(scope.steps.get(id), path);
    }
    case 'loop': {
      if (scope.loop === null) return undefined;
      const [part, ...path] = rest;
      if (part === 'index' && path.length === 0) return scope.loop.index;
      return part === 'item' ? walk(scope.loop.item, path) : undefined;
    }
    case 'run':
      return rest.length === 1 && rest[0] === 'id' ? scope.runId : undefined;
    default:
      return undefined;
  }
}

export function stringify(value: Json): string {
  if (value === null) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** Resolves templates against one scope and remembers every path that did not exist. */
export class Template {
  readonly unknown: string[] = [];

  constructor(private readonly scope: TemplateScope) {}

  private read(expression: string): Json | undefined {
    const path = expression.trim();
    const value = lookup(this.scope, path);
    if (value === undefined) this.unknown.push(path);
    return value;
  }

  /** A field that is one whole expression keeps the value's type; anything else becomes text. */
  value(input: Json): Json {
    if (typeof input !== 'string') return input;
    const whole = WHOLE.exec(input);
    if (whole) return this.read(whole[1] ?? '') ?? '';
    return this.text(input);
  }

  text(input: Json): string {
    if (typeof input !== 'string') return stringify(input);
    return input.replace(EXPRESSION, (_match, expression: string) => stringify(this.read(expression) ?? ''));
  }

  values(input: Json): Record<string, Json> {
    const out: Record<string, Json> = {};
    if (!isObject(input)) return out;
    for (const [name, template] of Object.entries(input)) out[name] = this.value(template);
    return out;
  }
}
