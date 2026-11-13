// Typed reads of single keys from a reader map.
import { NEVER, parseDurationMs } from "./duration.ts";
import { asScalar, entryOf } from "./nodes.ts";
import { messages, type Problems } from "./problems.ts";
import type { YamlMap, YamlNode } from "./yaml.ts";

export function readText(map: YamlMap, key: string): string | null {
  const scalar = asScalar(entryOf(map, key)?.value);
  return scalar && scalar.value !== null ? scalar.text : null;
}

export function readBool(map: YamlMap, key: string): boolean | null {
  const text = readText(map, key);
  if (text === "true") return true;
  if (text === "false") return false;
  return null;
}

export function oneOf<T extends string>(text: string | null, allowed: readonly T[]): T | null {
  return allowed.find((candidate) => candidate === text) ?? null;
}

export function readVariables(node: YamlNode | undefined): Record<string, string> {
  const variables: Record<string, string> = {};
  if (node?.kind !== "map") return variables;
  for (const entry of node.entries) {
    if (entry.value.kind === "scalar") variables[entry.key] = entry.value.text;
  }
  return variables;
}

export function readDuration(map: YamlMap, key: string, problems: Problems, allowNever: false): number | null;
export function readDuration(
  map: YamlMap,
  key: string,
  problems: Problems,
  allowNever: true,
): number | typeof NEVER | null;
export function readDuration(
  map: YamlMap,
  key: string,
  problems: Problems,
  allowNever: boolean,
): number | typeof NEVER | null {
  const entry = entryOf(map, key);
  if (!entry) return null;
  const text = entry.value.kind === "scalar" ? entry.value.text : "";
  if (entry.value.kind === "scalar" && entry.value.value === null) return null;
  const parsed = parseDurationMs(text);
  if (parsed === null || (parsed === NEVER && !allowNever)) {
    problems.add(entry.line, messages.badDuration(text));
    return null;
  }
  return parsed;
}
