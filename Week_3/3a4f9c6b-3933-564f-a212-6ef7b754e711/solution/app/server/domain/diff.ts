// The diff of a promotion against the stage's current revision, and redaction: the only place secret
// values are replaced, so every copy (API, evidence column, link page, snapshots, messages) reads redacted.
import type { DiffEntry, Overrides } from "../../shared/api.js";
import { isRecord } from "../validate.js";

export interface Manifest {
  apiVersion: string;
  kind: string;
  metadata: { name: string; namespace?: string };
  [field: string]: unknown;
}

interface Revision { manifests: Manifest[]; overrides: Overrides }

type Segment = string | number;

const REDACTED = "[redacted]";
const SECRET_FIELDS: Record<string, Segment[][]> = {
  Secret: [["data"], ["stringData"]],
  SealedSecret: [["spec", "encryptedData"], ["spec", "template", "data"]],
};

function isSecret(kind: string, path: Segment[]): boolean {
  return (SECRET_FIELDS[kind] ?? []).some((prefix) => prefix.every((segment, i) => path[i] === segment));
}

/** A copy of `value` (found at `path` in a `kind` manifest) with every secret value replaced; key names stay. */
function redact(kind: string, path: Segment[], value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map((item, i) => redact(kind, [...path, i], item));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(kind, [...path, key], item)]));
  }
  return isSecret(kind, path) ? REDACTED : value;
}

export function refOf(manifest: Manifest): string {
  return `${manifest.kind}/${manifest.metadata.namespace ?? "default"}/${manifest.metadata.name}`;
}

function formatPath(path: Segment[]): string {
  return path.reduce<string>((text, segment) =>
    typeof segment === "number" ? `${text}[${segment}]` : text ? `${text}.${segment}` : segment, "");
}


function leaves(kind: string, resource: string, path: Segment[], before: unknown, after: unknown, out: DiffEntry[]): void {
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  if ((isRecord(before) || before === undefined) && (isRecord(after) || after === undefined)) {
    const keys = [...new Set([...Object.keys(after ?? {}), ...Object.keys(before ?? {})])];
    for (const key of keys) leaves(kind, resource, [...path, key], before?.[key], after?.[key], out);
    return;
  }
  if ((Array.isArray(before) || before === undefined) && (Array.isArray(after) || after === undefined)) {
    const length = Math.max(before?.length ?? 0, after?.length ?? 0);
    for (let i = 0; i < length; i += 1) leaves(kind, resource, [...path, i], before?.[i], after?.[i], out);
    return;
  }
  out.push({
    resource,
    path: formatPath(path),
    change: before === undefined ? "added" : after === undefined ? "removed" : "modified",
    before: redact(kind, path, before),
    after: redact(kind, path, after),
  });
}

/** One entry per added or removed resource, one per changed leaf of a modified one, then the overrides. */
export function diffRevisions(next: Revision, current: Revision | null): DiffEntry[] {
  const out: DiffEntry[] = [];
  const previous = new Map((current?.manifests ?? []).map((m) => [refOf(m), m]));
  const upcoming = new Set(next.manifests.map(refOf));
  for (const manifest of next.manifests) {
    const ref = refOf(manifest);
    const old = previous.get(ref);
    if (!old) out.push({ resource: ref, path: "", change: "added", before: null, after: null });
    else leaves(manifest.kind, ref, [], old, manifest, out);
  }
  for (const [ref] of previous) {
    if (!upcoming.has(ref)) out.push({ resource: ref, path: "", change: "removed", before: null, after: null });
  }
  leaves("", "overrides", [], current?.overrides ?? {}, next.overrides, out);
  return out;
}
