// Publish refusals and the checks behind them. One place validates draft
// content for publishing (and for the grading setup's versions).

import { CONFIG, PORTS, STEP_KINDS, TRIGGER_KINDS, GRID_COLS, GRID_ROWS } from "./config.js";
import type { AutomationContent } from "./graph.js";
import { connectedFromTrigger, insideLoopEach, portOf } from "./graph.js";
import { parseSchedule } from "./schedule.js";
import { charCount } from "./text.js";
import { ApiError } from "./errors.js";

export const MAX_NAME = 60;

export function labelFor(kind: string, key: string): string {
  const map: Record<string, Record<string, string>> = {
    form: { path: "Form path", form_fields: "Form fields" },
    schedule: { schedule: "Schedule" },
    webhook: { path: "Hook path" },
    row_added: { table: "Table" },
    set: { values: "Values" },
    filter: { left: "Left", right: "Right", operator: "Operator" },
    branch: { left: "Left", right: "Right", operator: "Operator" },
    loop: { list: "List", table: "Table", source: "Loop over" },
    wait: { seconds: "Seconds" },
    send_email: { to: "To", subject: "Subject", body: "Body" },
    add_row: { table: "Table", values: "Values" },
    update_row: { table: "Table", row_id: "Row id", values: "Values" },
    call_webhook: { url: "URL" },
  };
  return map[kind]?.[key] ?? key;
}

const PATH_RE = /^[a-z0-9-]+$/;

export interface PublishError { step_id: string; error: string }

// Checks in the published order: trigger first, then s1, s2... in numeric
// order; each step checked in the published order.
export function validateForPublish(c: AutomationContent): PublishError | null {
  const connected = connectedFromTrigger(c);
  // numeric order for steps; trigger first
  const steps = [...c.steps].sort((a, b) => stepNum(a.id) - stepNum(b.id));
  const ordered = [{ id: "trigger", kind: c.trigger.kind, fields: c.trigger.fields }, ...steps.map((s) => ({ id: s.id, kind: s.kind, fields: s.fields }))];

  // loop detection: a loop inside another loop's each part
  const loopIds = c.steps.filter((s) => s.kind === "loop").map((s) => s.id);

  for (const s of ordered) {
    // 1. connected
    if (s.id !== "trigger" && !connected.has(s.id)) {
      return { step_id: s.id, error: `Step ${s.id} is not connected to the trigger` };
    }
    const f = s.fields ?? {};
    // 2. required fields
    const req = requiredFields(s.kind, f);
    if (req) return { step_id: s.id, error: `Step ${s.id} needs a value for ${req}` };
    // 3. trigger-specific
    if (s.id === "trigger") {
      if (s.kind === "schedule") {
        const spec = parseSchedule(String(f.schedule ?? ""));
        if (!spec) return { step_id: "trigger", error: "Step trigger has a schedule that is not every N minutes or daily at HH:MM" };
      }
    }
    // 4. wait bounds
    if (s.kind === "wait") {
      const n = Number(f.seconds);
      if (!Number.isFinite(n) || n < 1 || n > CONFIG.waitMaxSeconds) {
        return { step_id: s.id, error: `Step ${s.id} must wait between 1 and ${CONFIG.waitMaxSeconds} seconds` };
      }
    }
    // 5. webhook URL host
    if (s.kind === "call_webhook") {
      const bad = webhookUrlRefused(String(f.url ?? ""));
      if (bad) return { step_id: s.id, error: `Step ${s.id} can only call this app's own address` };
    }
    // 6. loop inside loop
    if (s.kind === "loop") {
      for (const other of loopIds) {
        if (other !== s.id && insideLoopEach(c, other).has(s.id)) {
          return { step_id: s.id, error: `Step ${s.id} is a loop inside another loop` };
        }
      }
    }
  }
  return null;
}

function stepNum(id: string): number {
  const m = /^s(\d+)$/.exec(id);
  return m ? Number(m[1]) : 999999;
}

function requiredFields(kind: string, f: Record<string, unknown>): string | null {
  const nonEmpty = (v: unknown) => typeof v === "string" ? v.trim() !== "" : v !== undefined && v !== null;
  switch (kind) {
    case "form": {
      if (!nonEmpty(f.path)) return labelFor("form", "path");
      const ff = f.form_fields;
      if (!Array.isArray(ff) || ff.length === 0) return labelFor("form", "form_fields");
      return null;
    }
    case "schedule":
      return nonEmpty(f.schedule) ? null : labelFor("schedule", "schedule");
    case "webhook":
      return nonEmpty(f.path) ? null : labelFor("webhook", "path");
    case "row_added":
      return nonEmpty(f.table) ? null : labelFor("row_added", "table");
    case "manual":
      return null;
    case "set": {
      const v = f.values;
      if (!v || typeof v !== "object" || Array.isArray(v)) return labelFor("set", "values");
      const keys = Object.keys(v as Record<string, unknown>);
      if (keys.length === 0) return labelFor("set", "values");
      for (const k of keys) if (k.trim() === "") return labelFor("set", "values");
      return null;
    }
    case "filter":
    case "branch": {
      if (!nonEmpty(f.left)) return labelFor(kind, "left");
      const op = String(f.operator ?? "");
      if (op !== "is empty" && op !== "is not empty" && !nonEmpty(f.right)) return labelFor(kind, "right");
      return null;
    }
    case "loop": {
      const source = String(f.source ?? "list");
      if (source === "table") return nonEmpty(f.table) ? null : labelFor("loop", "table");
      return nonEmpty(f.list) ? null : labelFor("loop", "list");
    }
    case "wait":
      return f.seconds !== undefined && f.seconds !== null && String(f.seconds) !== "" ? null : labelFor("wait", "seconds");
    case "send_email":
      if (!nonEmpty(f.to)) return labelFor("send_email", "to");
      if (!nonEmpty(f.subject)) return labelFor("send_email", "subject");
      if (!nonEmpty(f.body)) return labelFor("send_email", "body");
      return null;
    case "add_row":
      return nonEmpty(f.table) ? null : labelFor("add_row", "table");
    case "update_row":
      if (!nonEmpty(f.table)) return labelFor("update_row", "table");
      return nonEmpty(f.row_id) ? null : labelFor("update_row", "row_id");
    case "call_webhook":
      return nonEmpty(f.url) ? null : labelFor("call_webhook", "url");
    default:
      return null;
  }
}

// A call_webhook URL must be /hooks/... or this app's own host.
export function webhookUrlRefused(url: string): boolean {
  const u = url.trim();
  if (u.startsWith("/hooks/")) return false;
  if (/^https?:\/\//i.test(u)) {
    try {
      const parsed = new URL(u);
      const pub = new URL(CONFIG.publicUrl);
      if (parsed.host === pub.host) return false;
      const own = [`127.0.0.1:${CONFIG.port}`, `localhost:${CONFIG.port}`];
      if (own.includes(parsed.host)) return false;
      return true;
    } catch {
      return true;
    }
  }
  return true;
}

export function nameTooLong(name: string): boolean {
  return charCount(name) > MAX_NAME;
}

export function pathValid(p: string): boolean {
  return PATH_RE.test(p);
}

export { STEP_KINDS, TRIGGER_KINDS, PORTS, GRID_COLS, GRID_ROWS, portOf };
