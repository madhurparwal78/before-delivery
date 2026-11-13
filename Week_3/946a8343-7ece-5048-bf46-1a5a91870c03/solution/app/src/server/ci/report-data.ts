// The four report formats an `emit` reads, and the comparisons the request page shows (DP-26, DP-44).
import type { ReportKind } from "./commands.ts";
import { isRecord } from "../json.ts";

type TestStatus = "passed" | "failed" | "skipped";
export interface TestCase {
  readonly name: string;
  readonly status: TestStatus;
  readonly ms: number;
}
export interface QualityItem {
  readonly fingerprint: string;
  readonly severity: string;
  readonly path: string;
  readonly line: number;
  readonly message: string;
}
type Severity = "low" | "medium" | "high" | "critical";
export interface SecurityItem {
  readonly id: string;
  readonly severity: Severity;
  readonly title: string;
  readonly path: string;
  readonly line: number;
}

export type ReportData =
  | { readonly kind: "tests"; readonly cases: readonly TestCase[] }
  | { readonly kind: "coverage"; readonly percent: number }
  | { readonly kind: "quality"; readonly items: readonly QualityItem[] }
  | { readonly kind: "security"; readonly items: readonly SecurityItem[] };

function isSeverity(value: unknown): value is Severity {
  return value === "low" || value === "medium" || value === "high" || value === "critical";
}

type Json = Record<string, unknown>;

function record(value: unknown): Json | null {
  return isRecord(value) ? value : null;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseTests(value: unknown): ReportData | null {
  const cases = record(value)?.["cases"];
  if (!Array.isArray(cases)) return null;
  const parsed: TestCase[] = [];
  for (const item of cases) {
    const entry = record(item);
    const status = entry?.["status"];
    if (entry === null || typeof entry["name"] !== "string" || !finite(entry["ms"])) return null;
    if (status !== "passed" && status !== "failed" && status !== "skipped") return null;
    parsed.push({ name: entry["name"], status, ms: entry["ms"] });
  }
  return { kind: "tests", cases: parsed };
}

function parseQuality(value: unknown): ReportData | null {
  if (!Array.isArray(value)) return null;
  const items: QualityItem[] = [];
  for (const item of value) {
    const entry = record(item);
    if (entry === null) return null;
    const { fingerprint, severity, path, line, message } = entry;
    if (typeof fingerprint !== "string" || typeof severity !== "string" || typeof path !== "string") return null;
    if (!finite(line) || typeof message !== "string") return null;
    items.push({ fingerprint, severity, path, line, message });
  }
  return { kind: "quality", items };
}

function parseSecurity(value: unknown): ReportData | null {
  if (!Array.isArray(value)) return null;
  const items: SecurityItem[] = [];
  for (const item of value) {
    const entry = record(item);
    if (entry === null) return null;
    const { id, severity, title, path, line } = entry;
    if (typeof id !== "string" || !isSeverity(severity)) return null;
    if (typeof title !== "string" || typeof path !== "string" || !finite(line)) return null;
    items.push({ id, severity, title, path, line });
  }
  return { kind: "security", items };
}

/** The data of a report file, or null when the text does not fit the format of `kind`. */
export function parseReport(kind: ReportKind, text: string): ReportData | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (kind === "tests") return parseTests(value);
  if (kind === "quality") return parseQuality(value);
  if (kind === "security") return parseSecurity(value);
  const percent = record(value)?.["percent"];
  return finite(percent) ? { kind: "coverage", percent } : null;
}

interface TestSummary {
  readonly text: string;
  readonly new_failures: string[];
  readonly failed: number;
  readonly passed: number;
  readonly skipped: number;
}

export function testSummary(head: readonly TestCase[] | null, base: readonly TestCase[] | null): TestSummary {
  if (head === null) return { text: "No test report.", new_failures: [], failed: 0, passed: 0, skipped: 0 };
  const failedBefore = new Set((base ?? []).filter((item) => item.status === "failed").map((item) => item.name));
  const fresh: string[] = [];
  for (const item of head) {
    if (item.status === "failed" && !failedBefore.has(item.name) && !fresh.includes(item.name)) fresh.push(item.name);
  }
  const count = (status: TestStatus): number => head.filter((item) => item.status === status).length;
  const failed = count("failed");
  const passed = count("passed");
  const skipped = count("skipped");
  return { text: `${fresh.length} new failures, ${failed} failed, ${passed} passed, ${skipped} skipped`, new_failures: fresh, failed, passed, skipped };
}

function twoDecimals(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}

export function coverageSummary(head: number | null, base: number | null): { text: string; head: number | null; base: number | null } {
  if (head === null) return { text: "Coverage unknown", head, base };
  if (base === null) return { text: `Coverage ${twoDecimals(head)}% (no base)`, head, base };
  const rounded = Math.round((head - base) * 100) / 100;
  const sign = rounded < 0 ? "-" : "+";
  return { text: `Coverage ${twoDecimals(head)}% (${sign}${twoDecimals(Math.abs(rounded))})`, head, base };
}

export function qualitySummary(
  head: readonly QualityItem[] | null,
  base: readonly QualityItem[] | null,
): { text: string; new: string[]; resolved: string[] } {
  if (head === null) return { text: "No code quality report.", new: [], resolved: [] };
  const before = new Set((base ?? []).map((item) => item.fingerprint));
  const now = new Set(head.map((item) => item.fingerprint));
  const added = [...now].filter((fingerprint) => !before.has(fingerprint));
  const resolved = [...before].filter((fingerprint) => !now.has(fingerprint));
  return { text: `${added.length} new, ${resolved.length} resolved`, new: added, resolved };
}

export function securityText(open: number): string {
  if (open === 0) return "No security findings need review.";
  return open === 1 ? "1 security finding needs review." : `${open} security findings need review.`;
}
