// The five script commands (DP-25). Variables are expanded before a line is parsed.
import { isOneOf } from "../json.ts";
const REPORT_KINDS = ["tests", "coverage", "quality", "security"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

type Command =
  | { readonly kind: "print"; readonly text: string }
  | { readonly kind: "write"; readonly path: string; readonly text: string }
  | { readonly kind: "wait"; readonly ms: number }
  | { readonly kind: "exit"; readonly code: number }
  | { readonly kind: "emit"; readonly report: ReportKind; readonly path: string }
  | { readonly kind: "unknown"; readonly text: string };

function isReportKind(value: string): value is ReportKind {
  return isOneOf(REPORT_KINDS, value);
}

/** A workspace path stays inside the workspace: relative, no empty or `..` segments. */
function isWorkspacePath(path: string): boolean {
  if (path === "" || path.startsWith("/")) return false;
  return path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

export function parseCommand(line: string): Command {
  const unknown: Command = { kind: "unknown", text: line };
  const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(line);
  if (match === null) return unknown;
  const verb = match[1] ?? "";
  const rest = match[2] ?? "";
  if (verb === "print") return { kind: "print", text: rest };
  if (verb === "write") {
    const parts = /^(\S+)(?:\s+([\s\S]*))?$/.exec(rest);
    const path = parts?.[1] ?? "";
    return isWorkspacePath(path) ? { kind: "write", path, text: parts?.[2] ?? "" } : unknown;
  }
  if (verb === "wait") return /^\d{1,9}$/.test(rest.trim()) ? { kind: "wait", ms: Number(rest.trim()) } : unknown;
  if (verb === "exit") return /^-?\d{1,9}$/.test(rest.trim()) ? { kind: "exit", code: Number(rest.trim()) } : unknown;
  if (verb === "emit") {
    const parts = rest.trim().split(/\s+/);
    const [kind, path, extra] = parts;
    if (kind !== undefined && path !== undefined && extra === undefined && isReportKind(kind) && isWorkspacePath(path)) {
      return { kind: "emit", report: kind, path };
    }
  }
  return unknown;
}
