import type { DiffEntry, Overrides } from '../../shared/types.js';
import { redactLeaf } from './redaction.js';

export type Manifest = Record<string, unknown>;

export interface DiffSide {
  manifests: readonly Manifest[];
  overrides: Overrides;
}

export function manifestRef(manifest: Manifest): string {
  const metadata = (manifest.metadata ?? {}) as Record<string, unknown>;
  const namespace = typeof metadata.namespace === 'string' ? metadata.namespace : 'default';
  return `${String(manifest.kind)}/${namespace}/${String(metadata.name)}`;
}

function flatten(value: unknown, prefix: string, into: Map<string, unknown>): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => flatten(item, `${prefix}[${index}]`, into));
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      flatten(child, prefix === '' ? key : `${prefix}.${key}`, into);
    }
    return;
  }
  into.set(prefix, value);
}

function leaves(manifest: Manifest): Map<string, unknown> {
  const into = new Map<string, unknown>();
  flatten(manifest, '', into);
  return into;
}

function byRef(manifests: readonly Manifest[]): Map<string, Manifest> {
  return new Map(manifests.map((manifest) => [manifestRef(manifest), manifest]));
}

function overrideLeaves(overrides: Overrides): Map<string, unknown> {
  const into = new Map<string, unknown>();
  for (const [key, value] of Object.entries(overrides.parameters)) into.set(`parameters.${key}`, value);
  for (const [key, value] of Object.entries(overrides.replicas)) into.set(`replicas.${key}`, value);
  return into;
}

function compareLeaves(
  resource: string,
  kind: string,
  before: Map<string, unknown>,
  after: Map<string, unknown>,
): DiffEntry[] {
  const entries: DiffEntry[] = [];
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
  for (const path of paths) {
    const hadBefore = before.has(path);
    const hasAfter = after.has(path);
    const beforeValue = before.get(path);
    const afterValue = after.get(path);
    if (hadBefore && hasAfter && beforeValue === afterValue) continue;
    entries.push({
      resource,
      path,
      change: !hadBefore ? 'added' : !hasAfter ? 'removed' : 'modified',
      before: hadBefore ? redactLeaf(kind, path, beforeValue) : null,
      after: hasAfter ? redactLeaf(kind, path, afterValue) : null,
    });
  }
  return entries;
}

/**
 * Compares a promotion's bundle and frozen overrides against the stage's current revision.
 * A stage with no current revision shows every resource as added.
 */
export function buildDiff(current: DiffSide | null, next: DiffSide): DiffEntry[] {
  const nextByRef = byRef(next.manifests);
  if (!current) {
    const added: DiffEntry[] = [...nextByRef.keys()]
      .sort()
      .map((ref) => ({ resource: ref, path: '', change: 'added' as const, before: null, after: null }));
    added.push(
      ...compareLeaves('overrides', 'overrides', new Map(), overrideLeaves(next.overrides)),
    );
    return added;
  }

  const currentByRef = byRef(current.manifests);
  const refs = [...new Set([...currentByRef.keys(), ...nextByRef.keys()])].sort();
  const entries: DiffEntry[] = [];

  for (const ref of refs) {
    const before = currentByRef.get(ref);
    const after = nextByRef.get(ref);
    if (!before) {
      entries.push({ resource: ref, path: '', change: 'added', before: null, after: null });
      continue;
    }
    if (!after) {
      entries.push({ resource: ref, path: '', change: 'removed', before: null, after: null });
      continue;
    }
    entries.push(...compareLeaves(ref, String(after.kind), leaves(before), leaves(after)));
  }

  entries.push(
    ...compareLeaves(
      'overrides',
      'overrides',
      overrideLeaves(current.overrides),
      overrideLeaves(next.overrides),
    ),
  );
  return entries;
}
