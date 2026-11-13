// Helpers over reader nodes: lookup, text extraction, deep merge and re-lining.
import type { YamlEntry, YamlMap, YamlNode, YamlScalar } from "./yaml.ts";

export const EMPTY_MAP: YamlMap = { kind: "map", line: 1, entries: [] };

export function entryOf(map: YamlMap, key: string): YamlEntry | undefined {
  let found: YamlEntry | undefined;
  for (const entry of map.entries) if (entry.key === key) found = entry;
  return found;
}

export function asMap(node: YamlNode | undefined): YamlMap | null {
  return node?.kind === "map" ? node : null;
}

export function asScalar(node: YamlNode | undefined): YamlScalar | null {
  return node?.kind === "scalar" ? node : null;
}

// A single scalar counts as a list of one.
export function scalarItems(node: YamlNode | undefined): YamlScalar[] {
  if (node?.kind === "scalar") return node.value === null ? [] : [node];
  if (node?.kind === "list") return node.items.filter((item): item is YamlScalar => item.kind === "scalar");
  return [];
}

export function textsOf(node: YamlNode | undefined): string[] {
  return scalarItems(node).map((item) => item.text);
}

function mergeNodes(base: YamlNode, over: YamlNode): YamlNode {
  if (base.kind !== "map" || over.kind !== "map") return over;
  return mergeMaps(base, over);
}

export function mergeMaps(base: YamlMap, over: YamlMap): YamlMap {
  const entries: YamlEntry[] = [...base.entries];
  for (const entry of over.entries) {
    const at = entries.findIndex((candidate) => candidate.key === entry.key);
    const existing = entries[at];
    if (existing) entries[at] = { key: entry.key, line: entry.line, value: mergeNodes(existing.value, entry.value) };
    else entries.push(entry);
  }
  return { kind: "map", line: over.line, entries };
}

export function withoutKey(map: YamlMap, key: string): YamlMap {
  return { ...map, entries: map.entries.filter((entry) => entry.key !== key) };
}

function relocate(node: YamlNode, line: number): YamlNode {
  if (node.kind === "scalar") return { ...node, line };
  if (node.kind === "list") return { kind: "list", line, items: node.items.map((item) => relocate(item, line)) };
  return relocateMap(node, line);
}

export function relocateMap(map: YamlMap, line: number): YamlMap {
  return {
    kind: "map",
    line,
    entries: map.entries.map((entry) => ({ key: entry.key, line, value: relocate(entry.value, line) })),
  };
}
