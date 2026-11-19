import { TABLE_FIELDS } from "../shared/fields.js";
import { ROLES, TABLES, type Table } from "../shared/types.js";
import { assertExpression } from "./conditions.js";
import { captureChange } from "./configsets.js";
import type { Env } from "./env.js";
import { validation } from "./errors.js";
import { validateBusinessRule, validateFormPolicy, type AssignmentRule, type BusinessRule, type FormPolicy } from "./rules.js";
import { configGet, configList, configPut, type Workspace } from "./store.js";
import { isValidZone, WEEKDAY_KEYS } from "../shared/tz.js";
import type { Schedule } from "./schedule.js";
import type { SlaDefinition } from "./sla.js";
import type { AccessRule } from "./access.js";
import type { CatalogItem } from "./catalog.js";
import { inboxRuleName, type InboxRule } from "./inbox.js";
import type { WorkflowContent } from "./workflows.js";

export type ConfigKind = "business_rule" | "access_rule" | "assignment_rule" | "form_policy" | "sla_definition" | "schedule" | "catalog_item" | "inbox_rule" | "workflow";

type Body = Record<string, unknown>;

function text(body: Body, key: string, errors: Record<string, string>): string {
  const value = body[key];
  if (typeof value !== "string" || value.trim() === "") errors[key] = `${key} is required.`;
  return typeof value === "string" ? value : "";
}

function finish(errors: Record<string, string>): void {
  if (Object.keys(errors).length > 0) validation(`${Object.keys(errors).length} problems to fix before saving.`, errors);
}

function table(body: Body, errors: Record<string, string>, key = "table"): Table {
  const value = body[key];
  if (!TABLES.includes(value as Table)) errors[key] = "Choose a table.";
  return value as Table;
}

function order(body: Body): number {
  return typeof body.order === "number" ? body.order : 100;
}

function active(body: Body): boolean {
  return body.active === undefined ? true : body.active === true;
}

async function groupExists(env: Env, name: string, errors: Record<string, string>): Promise<void> {
  if (!env.world.groups.has(name)) errors.group = `Group "${name}" does not exist.`;
}

/** Normalises and validates the create body of one captured kind; refuses with the published error. */
async function normalise(env: Env, kind: ConfigKind, body: Body, workspace: Workspace): Promise<{ name: string; content: unknown }> {
  const errors: Record<string, string> = {};
  switch (kind) {
    case "business_rule": {
      const name = text(body, "name", errors);
      const t = table(body, errors);
      const when = body.when;
      if (when !== "before" && when !== "after" && when !== "background") errors.when = "Use before, after or background.";
      const operations = Array.isArray(body.operations) ? (body.operations as string[]) : [];
      if (operations.length === 0 || operations.some((o) => o !== "insert" && o !== "update")) errors.operations = "Use insert, update or both.";
      finish(errors);
      const rule: BusinessRule = {
        name,
        table: t,
        when: when as BusinessRule["when"],
        order: order(body),
        operations: operations as BusinessRule["operations"],
        condition: typeof body.condition === "string" ? body.condition : "true",
        actions: Array.isArray(body.actions) ? (body.actions as BusinessRule["actions"]) : [],
        active: active(body),
      };
      validateBusinessRule(rule);
      return { name, content: rule };
    }
    case "access_rule": {
      const name = text(body, "name", errors);
      const t = table(body, errors);
      if (body.type !== "table" && body.type !== "row" && body.type !== "field") errors.type = "Use table, row or field.";
      if (body.operation !== "read" && body.operation !== "write") errors.operation = "Use read or write.";
      const roles = Array.isArray(body.roles) ? (body.roles as string[]) : [];
      if (roles.some((r) => !(ROLES as readonly string[]).includes(r))) errors.roles = "Use the five role keys.";
      if (body.type === "field" && (typeof body.field !== "string" || !TABLE_FIELDS[t]?.some((f) => f.name === body.field))) errors.field = "Choose a field of the table.";
      finish(errors);
      const condition = typeof body.condition === "string" && body.condition !== "" ? body.condition : null;
      if (condition) assertExpression(condition, { table: t });
      const rule: AccessRule = { name, type: body.type as AccessRule["type"], table: t, field: body.type === "field" ? (body.field as string) : null, operation: body.operation as AccessRule["operation"], roles, condition, active: active(body) };
      return { name, content: rule };
    }
    case "assignment_rule": {
      const name = text(body, "name", errors);
      const t = table(body, errors);
      const group = text(body, "group", errors);
      await groupExists(env, group, errors);
      const condition = typeof body.condition === "string" ? body.condition : "true";
      if (Object.keys(errors).length === 0) assertExpression(condition, { table: t });
      finish(errors);
      const rule: AssignmentRule = { name, order: order(body), table: t, condition, group, active: active(body) };
      return { name, content: rule };
    }
    case "form_policy": {
      const name = text(body, "name", errors);
      const actions = Array.isArray(body.actions) ? (body.actions as FormPolicy["actions"]) : [];
      const t = body.table === null || body.table === undefined ? null : table(body, errors);
      const item = typeof body.catalog_item === "string" ? body.catalog_item : null;
      if (t === null && item === null) errors.table = "A policy applies to a table or a catalog item.";
      finish(errors);
      const policy: FormPolicy = { name, table: t, catalog_item: item, order: order(body), condition: typeof body.condition === "string" ? body.condition : "true", actions };
      validateFormPolicy(policy);
      return { name, content: policy };
    }
    case "sla_definition": {
      const name = text(body, "name", errors);
      const t = table(body, errors);
      const schedule = text(body, "schedule", errors);
      const targets = body.targets as Record<string, number> | undefined;
      if (!targets || ["1", "2", "3", "4", "5"].some((p) => typeof targets[p] !== "number" || targets[p]! <= 0)) errors.targets = "Give a target in seconds for priorities 1 to 5.";
      finish(errors);
      for (const key of ["start", "pause", "stop"] as const) assertExpression(typeof body[key] === "string" ? (body[key] as string) : "false", { table: t });
      const def: SlaDefinition = { name, table: t, start: String(body.start ?? "true"), pause: String(body.pause ?? "false"), stop: String(body.stop ?? "false"), schedule, targets: targets! };
      return { name, content: def };
    }
    case "schedule": {
      const name = text(body, "name", errors);
      const zone = text(body, "time_zone", errors);
      if (zone && !isValidZone(zone)) errors.time_zone = "Use an IANA time zone such as Europe/Berlin.";
      const hours = body.hours as Record<string, unknown> | undefined;
      if (!hours || WEEKDAY_KEYS.some((d) => !Array.isArray(hours[d]))) errors.hours = "Give opening hours for mon to sun.";
      finish(errors);
      const schedule: Schedule = { name, time_zone: zone, hours: hours as Schedule["hours"], holidays: Array.isArray(body.holidays) ? (body.holidays as string[]) : [] };
      return { name, content: schedule };
    }
    case "catalog_item": {
      const id = text(body, "id", errors);
      const name = text(body, "name", errors);
      const workflow = text(body, "workflow", errors);
      if (!Array.isArray(body.variables)) errors.variables = "Variables must be a list.";
      finish(errors);
      const item: CatalogItem = { id, name, workflow, variables: body.variables as CatalogItem["variables"] };
      return { name, content: item };
    }
    case "inbox_rule": {
      const event = text(body, "event", errors);
      const roles = Array.isArray(body.roles) ? (body.roles as string[]) : [];
      finish(errors);
      const enabled = body.enabled !== false;
      const taken = new Set((await configList<InboxRule>("inbox_rule", workspace, env.tx)).map((r) => r.name));
      const name = typeof body.name === "string" && body.name !== "" ? body.name : inboxRuleName({ event, roles, enabled }, taken);
      const rule: InboxRule = { name, event, roles, enabled };
      return { name, content: rule };
    }
    case "workflow": {
      const name = text(body, "name", errors);
      if (body.kind !== "flow" && body.kind !== "subflow") errors.kind = "Use flow or subflow.";
      finish(errors);
      const flow: WorkflowContent = { name, kind: body.kind as WorkflowContent["kind"], inputs: Array.isArray(body.inputs) ? (body.inputs as WorkflowContent["inputs"]) : [], outputs: Array.isArray(body.outputs) ? (body.outputs as WorkflowContent["outputs"]) : [], draft: Array.isArray(body.draft) ? (body.draft as WorkflowContent["draft"]) : [] };
      return { name, content: flow };
    }
  }
}

export async function saveConfig(env: Env, kind: ConfigKind, body: Body, workspace: Workspace, urlName?: string): Promise<{ id: number; content: unknown; created: boolean }> {
  const { name, content } = await normalise(env, kind, urlName ? { ...body, name: urlName } : body, workspace);
  const existing = await configGet<unknown>(kind, name, workspace, env.tx);
  const merged = kind === "workflow" && existing ? { ...(existing.content as WorkflowContent), ...(content as WorkflowContent), draft: (existing.content as WorkflowContent).draft } : content;
  const id = await configPut(env.tx, workspace, kind, name, merged);
  if (workspace === "test") await captureChange(env, kind, name);
  return { id, content: merged, created: !existing };
}
