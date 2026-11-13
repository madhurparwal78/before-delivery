// Derived markers (DP-76): each one is computed from a current value against its baseline, never set by an event.
import type { ManifestEntry } from "../shared/api";
import type { Values } from "../shared/tine";

/** The `was` marker, amber frame and `<n> modified` all read this: a value that differs from the source default. */
export function isModified(entry: ManifestEntry, values: Values): boolean {
  return !entry.derived && values[entry.name] !== undefined && values[entry.name] !== entry.default;
}

export function modifiedCount(manifest: ManifestEntry[], values: Values): number {
  return manifest.filter((entry) => isModified(entry, values)).length;
}

/** The values of every controllable parameter, with defaults filling any name a stored record omits. */
export function complete(manifest: ManifestEntry[], values: Values): Values {
  const out: Values = {};
  for (const entry of manifest) if (!entry.derived) out[entry.name] = values[entry.name] ?? entry.default;
  return out;
}

export function sameValues(a: Values, b: Values): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((key) => a[key] === b[key]);
}

/** The tape belongs to the loaded revision: it is disabled while the configuration differs from that revision's values. */
export function tapeDisabled(manifest: ManifestEntry[], values: Values, revisionValues: Values): boolean {
  return !sameValues(complete(manifest, values), complete(manifest, revisionValues));
}

/** A report is stale while the values or the process differ from the ones it ran with. */
export function reportStale(manifest: ManifestEntry[], values: Values, process: string, report: { values: Values; process: string }): boolean {
  return process !== report.process || !sameValues(complete(manifest, values), complete(manifest, report.values));
}
