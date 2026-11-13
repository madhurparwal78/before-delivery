import { flattenEvent } from './mapping.js';

export type Condition = { field: string; op: 'eq' | 'ne' | 'exists'; value?: unknown };

export type Processor = {
  type: 'split' | 'rename' | 'set' | 'parse_date' | 'drop' | 'redact';
  field?: string;
  pattern?: string;
  targets?: string[];
  from?: string;
  to?: string;
  value?: unknown;
  format?: 'iso' | 'epoch_ms';
  if?: Condition;
};

export type RawEvent = Record<string, unknown>;

export type StepStatus = 'applied' | 'skipped' | 'failed' | 'dropped';

export type Step = {
  step: number;
  processor: string;
  status: StepStatus;
  event: RawEvent;
  changed: string[];
  text?: string;
};

export type PipelineRun = {
  outcome: 'stored' | 'dropped' | 'failed';
  error?: string;
  event: RawEvent;
  steps: Step[];
};

const IPV4 = /(?<!\d)(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?!\d)/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const DIGITS = /\d+/g;

export function getPath(event: RawEvent, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = event;
  for (const part of parts) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as RawEvent)[part];
  }
  return current;
}

export function setPath(event: RawEvent, path: string, value: unknown): void {
  const parts = path.split('.');
  let current: RawEvent = event;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const next = current[parts[index]];
    if (next === null || typeof next !== 'object' || Array.isArray(next)) {
      current[parts[index]] = {};
    }
    current = current[parts[index]] as RawEvent;
  }
  current[parts[parts.length - 1]] = value;
}

export function deletePath(event: RawEvent, path: string): void {
  const parts = path.split('.');
  let current: RawEvent = event;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const next = current[parts[index]];
    if (next === null || typeof next !== 'object') return;
    current = next as RawEvent;
  }
  delete current[parts[parts.length - 1]];
}

function conditionHolds(condition: Condition | undefined, event: RawEvent): boolean {
  if (!condition) return true;
  const value = getPath(event, condition.field);
  if (condition.op === 'exists') return value !== undefined;
  if (condition.op === 'eq') return JSON.stringify(value) === JSON.stringify(condition.value);
  return JSON.stringify(value) !== JSON.stringify(condition.value);
}

function redact(value: string, pattern: 'ipv4' | 'email' | 'digits'): string {
  const expression = pattern === 'ipv4' ? IPV4 : pattern === 'email' ? EMAIL : DIGITS;
  return value.replace(expression, '[hidden]');
}

function changedFields(before: RawEvent, after: RawEvent): string[] {
  const left = flattenEvent({ ...before, _id: undefined });
  const right = flattenEvent({ ...after, _id: undefined });
  const names = new Set([...Object.keys(left), ...Object.keys(right)]);
  const changed: string[] = [];
  for (const name of names) {
    if (JSON.stringify(left[name]) !== JSON.stringify(right[name])) changed.push(name);
  }
  return changed.sort();
}

type Applied = { event: RawEvent } | { dropped: true } | { failed: string };

function applyProcessor(processor: Processor, event: RawEvent): Applied {
  const next: RawEvent = structuredClone(event);
  switch (processor.type) {
    case 'drop':
      return { dropped: true };
    case 'set':
      setPath(next, processor.field as string, processor.value);
      return { event: next };
    case 'rename': {
      const from = processor.from as string;
      const value = getPath(next, from);
      if (value === undefined) return { failed: `field ${from} is missing` };
      deletePath(next, from);
      setPath(next, processor.to as string, value);
      return { event: next };
    }
    case 'split': {
      const field = processor.field as string;
      const value = getPath(next, field);
      if (value === undefined) return { failed: `field ${field} is missing` };
      const targets = processor.targets ?? [];
      const parts = String(value).split(processor.pattern as string);
      if (parts.length !== targets.length) {
        return { failed: `split made ${parts.length} parts, expected ${targets.length}` };
      }
      targets.forEach((target, index) => setPath(next, target, parts[index]));
      return { event: next };
    }
    case 'parse_date': {
      const field = processor.field as string;
      const value = getPath(next, field);
      if (value === undefined) return { failed: `field ${field} is missing` };
      if (processor.format === 'epoch_ms') {
        const numeric = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(numeric)) return { failed: `${String(value)} is not a date` };
        setPath(next, '@timestamp', new Date(numeric).toISOString());
        return { event: next };
      }
      const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
      if (!Number.isFinite(parsed)) return { failed: `${String(value)} is not a date` };
      setPath(next, '@timestamp', new Date(parsed).toISOString());
      return { event: next };
    }
    case 'redact': {
      const field = processor.field as string;
      const value = getPath(next, field);
      if (typeof value !== 'string') return { event: next };
      setPath(next, field, redact(value, processor.pattern as 'ipv4' | 'email' | 'digits'));
      return { event: next };
    }
    default:
      return { failed: `unknown processor ${String(processor.type)}` };
  }
}

/** The one place a pipeline runs: ingest and simulation share it. */
export function runPipeline(
  name: string,
  processors: Processor[],
  input: RawEvent,
): PipelineRun {
  let event = structuredClone(input);
  const steps: Step[] = [];
  for (let index = 0; index < processors.length; index += 1) {
    const processor = processors[index];
    const step = index + 1;
    if (!conditionHolds(processor.if, event)) {
      steps.push({
        step,
        processor: processor.type,
        status: 'skipped',
        event,
        changed: [],
        text: 'Skipped: condition false',
      });
      continue;
    }
    const applied = applyProcessor(processor, event);
    if ('dropped' in applied) {
      steps.push({ step, processor: processor.type, status: 'dropped', event, changed: [], text: 'Dropped' });
      return { outcome: 'dropped', event, steps };
    }
    if ('failed' in applied) {
      const text = `Pipeline ${name} failed at processor ${step}: ${applied.failed}.`;
      steps.push({ step, processor: processor.type, status: 'failed', event, changed: [], text });
      return { outcome: 'failed', error: text, event, steps };
    }
    const changed = changedFields(event, applied.event);
    event = applied.event;
    steps.push({ step, processor: processor.type, status: 'applied', event, changed });
  }
  return { outcome: 'stored', event, steps };
}

const TYPES = new Set(['split', 'rename', 'set', 'parse_date', 'drop', 'redact']);

/** Validation of a saved pipeline: each reason becomes `Processor <k>: <reason>.` */
export function validateProcessors(input: unknown): { processors: Processor[] } | { fields: Record<string, string> } {
  if (!Array.isArray(input)) {
    return { fields: { processors: 'Processors must be a list.' } };
  }
  const fields: Record<string, string> = {};
  const processors: Processor[] = [];
  input.forEach((item, index) => {
    const step = index + 1;
    const key = `processors.${index}`;
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      fields[key] = `Processor ${step}: must be an object.`;
      return;
    }
    const processor = item as Processor;
    if (!TYPES.has(String(processor.type))) {
      fields[key] = `Processor ${step}: unknown type ${String(processor.type)}.`;
      return;
    }
    const need = (name: string): boolean => {
      const value = (processor as Record<string, unknown>)[name];
      if (typeof value !== 'string' || value === '') {
        fields[key] = `Processor ${step}: ${name} is required.`;
        return false;
      }
      return true;
    };
    switch (processor.type) {
      case 'split':
        if (!need('field') || !need('pattern')) return;
        if (!Array.isArray(processor.targets) || processor.targets.length === 0) {
          fields[key] = `Processor ${step}: targets is required.`;
          return;
        }
        break;
      case 'rename':
        if (!need('from') || !need('to')) return;
        break;
      case 'set':
        if (!need('field')) return;
        if (processor.value === undefined) {
          fields[key] = `Processor ${step}: value is required.`;
          return;
        }
        break;
      case 'parse_date':
        if (!need('field')) return;
        if (processor.format !== 'iso' && processor.format !== 'epoch_ms') {
          fields[key] = `Processor ${step}: format must be iso or epoch_ms.`;
          return;
        }
        break;
      case 'redact':
        if (!need('field')) return;
        if (!['ipv4', 'email', 'digits'].includes(String(processor.pattern))) {
          fields[key] = `Processor ${step}: pattern must be ipv4, email or digits.`;
          return;
        }
        break;
      case 'drop':
        break;
      default:
        break;
    }
    if (processor.if !== undefined) {
      const condition = processor.if;
      if (
        condition === null ||
        typeof condition !== 'object' ||
        typeof condition.field !== 'string' ||
        !['eq', 'ne', 'exists'].includes(String(condition.op))
      ) {
        fields[key] = `Processor ${step}: if needs a field and op of eq, ne or exists.`;
        return;
      }
    }
    processors.push(processor);
  });
  if (Object.keys(fields).length > 0) return { fields };
  return { processors };
}
