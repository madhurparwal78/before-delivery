// Pure rules of the admin module: path segments, visibility order, the webhook allow-list and the webhook signature.
import { createHmac } from "node:crypto";
import type { Visibility } from "../access.ts";
import { isOneOf } from "../json.ts";

export const MAX_GROUP_LEVELS = 4;
const SEGMENT = /^[a-z0-9-]{2,40}$/;
export const SEGMENT_MESSAGE = "Use 2 to 40 characters: a-z, 0-9 and -.";
export const NEST_MESSAGE = "Groups can only nest 4 levels.";

const VISIBILITY_ORDER: Readonly<Record<Visibility, number>> = { private: 0, internal: 1, public: 2 };

export function exceedsVisibility(child: Visibility, parent: Visibility): boolean {
  return VISIBILITY_ORDER[child] > VISIBILITY_ORDER[parent];
}

export const visibilityMessage = (parent: Visibility): string => `Visibility can't exceed the parent group's: ${parent}.`;

export function isSegment(value: string): boolean {
  return SEGMENT.test(value);
}

export function groupLevels(path: string): number {
  return path.split("/").length;
}

export function parentPath(path: string): string | null {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? null : path.slice(0, slash);
}

// A group path is valid when every segment is and it nests at most four levels. Returns the refusal text or null.
export function groupPathProblem(path: string): string | null {
  const segments = path.split("/");
  if (segments.length > MAX_GROUP_LEVELS) return NEST_MESSAGE;
  return segments.every(isSegment) ? null : SEGMENT_MESSAGE;
}

const DEFAULT_PORTS: Readonly<Record<string, string>> = { "http:": "80", "https:": "443" };

// `host:port` of a webhook URL as the allow-list compares it (default ports 80 and 443), or null when it is no http(s) URL.
export function targetOf(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const port = DEFAULT_PORTS[parsed.protocol];
  if (port === undefined) return null;
  return `${parsed.hostname.toLowerCase()}:${parsed.port === "" ? port : parsed.port}`;
}

// An allow-list entry is `host:port`; a bare host stands for the default ports.
export function allowedTargets(entries: readonly string[]): ReadonlySet<string> {
  const targets = new Set<string>();
  for (const entry of entries) {
    const lower = entry.toLowerCase();
    if (/:\d+$/.test(lower)) targets.add(lower);
    else for (const port of Object.values(DEFAULT_PORTS)) targets.add(`${lower}:${port}`);
  }
  return targets;
}

export function targetAllowed(url: string, entries: readonly string[]): boolean {
  const target = targetOf(url);
  return target !== null && allowedTargets(entries).has(target);
}

export function signature(secret: string, timestamp: number, rawBody: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`;
}

export const WEBHOOK_EVENTS = ["push", "merge_request", "pipeline", "deployment", "issue"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export function isWebhookEvent(value: unknown): value is WebhookEvent {
  return isOneOf(WEBHOOK_EVENTS, value);
}

export function isRegex(source: string): boolean {
  try {
    new RegExp(source);
    return true;
  } catch {
    return false;
  }
}

export function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}
