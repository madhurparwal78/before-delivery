// The part page's address (DP-04, DP-16, DP-65) and the change lines the conflict alert and compare page share.
import type { ManifestEntry } from "../shared/api";
import { NNBSP, display } from "../shared/numbers";
import { compareText } from "../shared/order";
import { configValue, type Value, type Values } from "../shared/tine";

interface ParsedConfig {
  values: Values;
  dropped: string[];
}

/** The defaults plus every usable `name=value` pair; unknown names and unusable values are dropped, in link order. */
export function parseConfig(text: string, manifest: ManifestEntry[]): ParsedConfig {
  const values: Values = {};
  for (const entry of manifest) if (!entry.derived) values[entry.name] = entry.default;
  const dropped: string[] = [];
  for (const pair of text.split(",")) {
    if (pair === "") continue;
    const eq = pair.indexOf("=");
    const name = eq < 0 ? pair : pair.slice(0, eq);
    const entry = manifest.find((m) => m.name === name);
    const value = entry && eq >= 0 ? configValue(entry, pair.slice(eq + 1)) : null;
    if (entry && value !== null) values[name] = value;
    else if (!dropped.includes(name)) dropped.push(name);
  }
  return { values, dropped };
}

/** Only non-default values, sorted by name in code-point order. */
export function buildConfig(manifest: ManifestEntry[], values: Values): string {
  return manifest
    .filter((entry) => !entry.derived && values[entry.name] !== undefined && values[entry.name] !== entry.default)
    .sort((a, b) => compareText(a.name, b.name))
    .map((entry) => `${entry.name}=${String(values[entry.name])}`)
    .join(",");
}

const KNOWN = ["revision", "config", "operation", "save"];

/** A query string with `revision`, `config`, `operation` and `save` first, in that order. The config stays readable. */
export function searchOf(params: Record<string, string | null | undefined>): string {
  const keys = [...KNOWN.filter((k) => k in params), ...Object.keys(params).filter((k) => !KNOWN.includes(k))];
  const pairs = keys.filter((k) => params[k] !== null && params[k] !== undefined).map((k) => `${k}=${k === "config" ? params[k] : encodeURIComponent(params[k] as string)}`);
  return pairs.length ? `?${pairs.join("&")}` : "";
}

export function partAddress(slug: string, params: Record<string, string | null | undefined>): string {
  return `/parts/${slug}${searchOf(params)}`;
}

/** The decoded parameters of a query string. */
export function paramsOf(search: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(search).entries());
}

function valueText(entry: ManifestEntry, value: Value): string {
  if (typeof value === "boolean") return value ? "on" : "off";
  if (typeof value === "string") return value;
  return display(value, entry.kind === "count" ? 0 : entry.precision);
}

/** `<Label>: <before> → <after> <unit>`: lengths in millimetres, angles in degrees, nothing after counts, booleans and enums. */
export function changeLine(entry: ManifestEntry, before: Value, after: Value): string {
  const unit = entry.kind === "length" || entry.kind === "angle" ? `${NNBSP}${entry.unit}` : "";
  return `${entry.label}: ${valueText(entry, before)} → ${valueText(entry, after)}${unit}`;
}

/** One change line per parameter whose value differs, in declaration order. */
export function changeLines(manifest: ManifestEntry[], before: Values, after: Values): string[] {
  return manifest
    .filter((entry) => !entry.derived)
    .flatMap((entry) => {
      const b = before[entry.name] ?? entry.default;
      const a = after[entry.name] ?? entry.default;
      return b === a ? [] : [changeLine(entry, b, a)];
    });
}

const draftKey = (slug: string, head: string): string => `tinework:draft:${slug}:${head}`;

interface Draft {
  values: Values;
  message: string;
}

export function readDraft(slug: string): { head: string; draft: Draft } | null {
  const prefix = `tinework:draft:${slug}:`;
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i) as string;
    if (!key.startsWith(prefix)) continue;
    try {
      return { head: key.slice(prefix.length), draft: JSON.parse(window.localStorage.getItem(key) as string) as Draft };
    } catch {
      return null;
    }
  }
  return null;
}

export function clearDrafts(slug: string): void {
  const prefix = `tinework:draft:${slug}:`;
  for (const key of Object.keys(window.localStorage)) if (key.startsWith(prefix)) window.localStorage.removeItem(key);
}

export function writeDraft(slug: string, head: string, draft: Draft): void {
  clearDrafts(slug);
  window.localStorage.setItem(draftKey(slug, head), JSON.stringify(draft));
}
