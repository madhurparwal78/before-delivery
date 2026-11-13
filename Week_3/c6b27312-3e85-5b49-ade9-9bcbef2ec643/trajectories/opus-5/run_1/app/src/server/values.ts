import { sentenceCaseLabel } from '../shared/labels';
import { displayAtMost, matchesNumberGrammar, withUnit } from '../shared/numbers';
import { RawLeaf, RawNode, rawLeaves } from '../shared/rawjson';
import { ManifestEntry, ParameterValue, Values } from '../tine/manifest';
import { invalid, valueGrammar } from './errors';

const NUMERIC_KEYS = new Set(['seq', 'ms', 'operation', 'fov', 'quantity', 'position', 'target', 'up']);

function innermostKey(path: string[]): string {
  for (let index = path.length - 1; index >= 0; index -= 1) {
    if (!/^[0-9]+$/.test(path[index])) return path[index];
  }
  return 'value';
}

function describe(path: string[], manifest: ManifestEntry[] | null): { field: string; label: string } {
  if (path.length === 2 && path[0] === 'values') {
    const name = path[1];
    const entry = manifest?.find((candidate) => candidate.name === name);
    return { field: name, label: entry ? entry.label : sentenceCaseLabel(name) };
  }
  const key = innermostKey(path);
  return { field: key, label: sentenceCaseLabel(key) };
}

function numericExpected(leaf: RawLeaf, manifest: ManifestEntry[] | null): boolean {
  const path = leaf.path;
  if (path.length === 2 && path[0] === 'values') {
    const entry = manifest?.find((candidate) => candidate.name === path[1]);
    return entry ? entry.kind === 'length' || entry.kind === 'angle' || entry.kind === 'count' : false;
  }
  return NUMERIC_KEYS.has(innermostKey(path));
}

/**
 * House rule H1: the grammar is checked on each number's source text, in request-text
 * order, before every other values check.
 */
export function checkNumberGrammar(raw: RawNode | null, manifest: ManifestEntry[] | null): void {
  if (!raw) return;
  for (const leaf of rawLeaves(raw)) {
    if (leaf.node.kind === 'number') {
      if (!matchesNumberGrammar(leaf.node.raw)) {
        const named = describe(leaf.path, manifest);
        throw valueGrammar(named.field, named.label);
      }
    } else if (leaf.node.kind === 'string' && numericExpected(leaf, manifest)) {
      const named = describe(leaf.path, manifest);
      throw valueGrammar(named.field, named.label);
    }
  }
}

function limitsMessage(entry: ManifestEntry): string {
  const min = displayAtMost(entry.min!, 2);
  const max = displayAtMost(entry.max!, 2);
  const tail = entry.unit === null ? max : withUnit(max, entry.unit);
  return `${entry.label} must be between ${min} and ${tail}.`;
}

/** The values checks, in the published order, after the number grammar. */
export function validateValues(manifest: ManifestEntry[], provided: Record<string, unknown>): Values {
  const errors: Record<string, string> = {};
  const values: Values = {};
  for (const [name, value] of Object.entries(provided)) {
    const entry = manifest.find((candidate) => candidate.name === name);
    if (!entry || entry.derived) {
      errors[name] = 'Unknown parameter.';
      continue;
    }
    if (entry.kind === 'enum') {
      if (typeof value !== 'string' || !entry.options!.includes(value)) {
        errors[name] = `Choose one of ${entry.options!.join(', ')}.`;
        continue;
      }
      values[name] = value;
      continue;
    }
    if (entry.kind === 'boolean') {
      if (typeof value !== 'boolean') {
        errors[name] = 'Enter true or false.';
        continue;
      }
      values[name] = value;
      continue;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      errors[name] = `${entry.label} takes a plain decimal such as 12.5.`;
      continue;
    }
    if (
      (entry.min !== undefined && value < entry.min) ||
      (entry.max !== undefined && value > entry.max)
    ) {
      if (entry.min !== undefined && entry.max !== undefined) {
        errors[name] = limitsMessage(entry);
        continue;
      }
    }
    if (entry.kind === 'count' && !Number.isInteger(value)) {
      errors[name] = 'Enter a whole number.';
      continue;
    }
    values[name] = value === 0 ? 0 : value;
  }
  if (Object.keys(errors).length > 0) throw invalid(errors);
  return values;
}

export function valuesFrom(body: Record<string, unknown>): Record<string, unknown> {
  const values = body.values;
  if (values === undefined || values === null) return {};
  if (typeof values !== 'object' || Array.isArray(values)) throw invalid({ values: 'Unknown parameter.' });
  return values as Record<string, unknown>;
}

export function parameterValueOf(entry: ManifestEntry): ParameterValue {
  return entry.value;
}
