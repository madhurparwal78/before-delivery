import { ROLES } from "../../../shared/types.js";
import { formatLocalIso, isValidZone, localTextToIso } from "../../../shared/tz.js";

export type Plain = Record<string, unknown>;
export type Values = Record<string, string | boolean | string[]>;

export type FieldKind = "text" | "area" | "number" | "json" | "bool" | "datetime" | "secret" | "roles";

export interface FieldSpec {
  key: string;
  kind: FieldKind;
  /** Empty text is sent as null. */
  nullable?: boolean;
  hint?: string;
  /** Read-only once the record exists, because the record is addressed by it. */
  fixed?: boolean;
}

export interface KindSpec {
  listPath: string;
  /** The member of the list response that holds the records. */
  listKey: string;
  /** The member that names a record in the list. */
  nameKey: string;
  /** The member that addresses a record in the URL. */
  idKey: string;
  fields: FieldSpec[];
  blank: Plain;
}

export const ROLE_KEYS: readonly string[] = ROLES;

const EXPRESSION = "Written in the expression language.";
const TABLES_HINT = "incident, problem, change, request_item or task.";

/** The member name in sentence case, for example `time_zone` becomes `Time zone`. */
export function labelOf(key: string): string {
  const spaced = key.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const HOURS = { mon: [["08:00", "17:00"]], tue: [["08:00", "17:00"]], wed: [["08:00", "17:00"]], thu: [["08:00", "17:00"]], fri: [["08:00", "17:00"]], sat: [], sun: [] };

export const KINDS: Record<string, KindSpec> = {
  "business-rules": {
    listPath: "/api/business-rules",
    listKey: "business_rules",
    nameKey: "name",
    idKey: "name",
    fields: [
      { key: "name", kind: "text", fixed: true },
      { key: "table", kind: "text", hint: TABLES_HINT },
      { key: "when", kind: "text", hint: "before, after or background." },
      { key: "order", kind: "number", hint: "Rules run by ascending order." },
      { key: "operations", kind: "json", hint: "A JSON list of insert and update." },
      { key: "condition", kind: "area", hint: EXPRESSION },
      { key: "actions", kind: "json", hint: "A JSON list of action objects." },
      { key: "active", kind: "bool" },
    ],
    blank: { name: "", table: "", when: "", order: 100, operations: ["insert", "update"], condition: "true", actions: [], active: true },
  },
  "access-rules": {
    listPath: "/api/access-rules",
    listKey: "access_rules",
    nameKey: "name",
    idKey: "name",
    fields: [
      { key: "name", kind: "text", fixed: true },
      { key: "type", kind: "text", hint: "table, row or field." },
      { key: "table", kind: "text", hint: TABLES_HINT },
      { key: "field", kind: "text", nullable: true, hint: "The hidden field of a field rule. Empty otherwise." },
      { key: "operation", kind: "text", hint: "read or write." },
      { key: "roles", kind: "json", hint: "A JSON list of the role keys the rule denies." },
      { key: "condition", kind: "area", nullable: true, hint: `${EXPRESSION} Empty applies to every record.` },
      { key: "active", kind: "bool" },
    ],
    blank: { name: "", type: "", table: "", field: null, operation: "", roles: [], condition: null, active: true },
  },
  "assignment-rules": {
    listPath: "/api/assignment-rules",
    listKey: "assignment_rules",
    nameKey: "name",
    idKey: "name",
    fields: [
      { key: "name", kind: "text", fixed: true },
      { key: "order", kind: "number", hint: "The first matching rule by ascending order wins." },
      { key: "table", kind: "text", hint: TABLES_HINT },
      { key: "condition", kind: "area", hint: EXPRESSION },
      { key: "group", kind: "text", hint: "The name of an existing group." },
      { key: "active", kind: "bool" },
    ],
    blank: { name: "", order: 100, table: "", condition: "true", group: "", active: true },
  },
  "form-policies": {
    listPath: "/api/form-policies",
    listKey: "form_policies",
    nameKey: "name",
    idKey: "name",
    fields: [
      { key: "name", kind: "text", fixed: true },
      { key: "table", kind: "text", nullable: true, hint: "A table, or empty when the policy is for a catalog item." },
      { key: "catalog_item", kind: "text", nullable: true, hint: "A catalog item id, or empty when the policy is for a table." },
      { key: "order", kind: "number", hint: "Policies apply by ascending order." },
      { key: "condition", kind: "area", hint: EXPRESSION },
      { key: "actions", kind: "json", hint: "A JSON list of field, mandatory, visible and read_only objects." },
    ],
    blank: { name: "", table: null, catalog_item: null, order: 100, condition: "true", actions: [] },
  },
  "sla-definitions": {
    listPath: "/api/sla-definitions",
    listKey: "sla_definitions",
    nameKey: "name",
    idKey: "name",
    fields: [
      { key: "name", kind: "text", fixed: true },
      { key: "table", kind: "text", hint: TABLES_HINT },
      { key: "start", kind: "area", hint: `When the clock starts. ${EXPRESSION}` },
      { key: "pause", kind: "area", hint: `When the clock pauses. ${EXPRESSION}` },
      { key: "stop", kind: "area", hint: `When the clock stops. ${EXPRESSION}` },
      { key: "schedule", kind: "text", hint: "The name of a business schedule." },
      { key: "targets", kind: "json", hint: 'Seconds for priorities 1 to 5, for example {"1": 900}.' },
    ],
    blank: { name: "", table: "", start: "true", pause: "false", stop: "false", schedule: "", targets: { "1": 900, "2": 1800, "3": 3600, "4": 14400, "5": 28800 } },
  },
  schedules: {
    listPath: "/api/schedules",
    listKey: "schedules",
    nameKey: "name",
    idKey: "name",
    fields: [
      { key: "name", kind: "text", fixed: true },
      { key: "time_zone", kind: "text", hint: "An IANA zone such as Europe/Berlin." },
      { key: "hours", kind: "json", hint: "Wall times in the schedule's time zone for mon to sun." },
      { key: "holidays", kind: "json", hint: "A JSON list of YYYY-MM-DD dates in the schedule's time zone." },
    ],
    blank: { name: "", time_zone: "", hours: HOURS, holidays: [] },
  },
  "escalation-policies": {
    listPath: "/api/escalation-policies",
    listKey: "escalation_policies",
    nameKey: "name",
    idKey: "name",
    fields: [
      { key: "name", kind: "text", fixed: true },
      { key: "levels", kind: "json", hint: "A JSON list of levels, each with a rotation or user target and ack_minutes." },
    ],
    blank: { name: "", levels: [] },
  },
  boards: {
    listPath: "/api/boards",
    listKey: "boards",
    nameKey: "name",
    idKey: "name",
    fields: [
      { key: "name", kind: "text", fixed: true },
      { key: "rule", kind: "text", hint: "all, any, n_of_m or weighted." },
      { key: "n", kind: "number", nullable: true, hint: "How many votes the n_of_m rule needs." },
      { key: "threshold_percent", kind: "number", nullable: true, hint: "The weighted rule's threshold, 1 to 100." },
      { key: "window_hours", kind: "number", hint: "Hours a vote stays open." },
      { key: "members", kind: "json", hint: "A JSON list of usernames with a weight each." },
    ],
    blank: { name: "", rule: "", n: null, threshold_percent: null, window_hours: 48, members: [] },
  },
  "freeze-windows": {
    listPath: "/api/freeze-windows",
    listKey: "freeze_windows",
    nameKey: "name",
    idKey: "name",
    fields: [
      { key: "name", kind: "text", fixed: true },
      { key: "start", kind: "datetime", hint: "YYYY-MM-DD HH:mm in the time zone below." },
      { key: "end", kind: "datetime", hint: "YYYY-MM-DD HH:mm in the time zone below. The end is exclusive." },
      { key: "time_zone", kind: "text", hint: "An IANA zone such as Europe/Berlin." },
      { key: "scope", kind: "json", hint: 'The string "all", or {"items": [item names]}.' },
    ],
    blank: { name: "", start: "", end: "", time_zone: "", scope: "all" },
  },
  "catalog-items": {
    listPath: "/api/catalog/items",
    listKey: "items",
    nameKey: "name",
    idKey: "id",
    fields: [
      { key: "id", kind: "text", fixed: true },
      { key: "name", kind: "text" },
      { key: "variables", kind: "json", hint: "A JSON list of the item's variables." },
      { key: "workflow", kind: "text", hint: "The name of the flow that fulfils the item." },
    ],
    blank: { id: "", name: "", variables: [], workflow: "" },
  },
  "inbox-rules": {
    listPath: "/api/inbox-rules",
    listKey: "rules",
    nameKey: "name",
    idKey: "name",
    fields: [
      { key: "name", kind: "text", hint: "Empty names the rule after its event and roles." },
      { key: "event", kind: "text", hint: "For example assigned, mentioned or page." },
      { key: "roles", kind: "json", hint: "A JSON list of the roles that receive the event." },
      { key: "enabled", kind: "bool" },
    ],
    blank: { name: "", event: "", roles: [], enabled: true },
  },
  users: {
    listPath: "/api/users",
    listKey: "users",
    nameKey: "display_name",
    idKey: "username",
    fields: [
      { key: "username", kind: "text", fixed: true },
      { key: "password", kind: "secret", hint: "Leave empty to keep the current password." },
      { key: "display_name", kind: "text" },
      { key: "roles", kind: "roles" },
      { key: "department", kind: "text" },
      { key: "time_zone", kind: "text", hint: "An IANA zone such as Europe/Berlin." },
      { key: "out_of_office", kind: "bool" },
      { key: "capacity", kind: "number", nullable: true, hint: "Empty means no limit." },
      { key: "active", kind: "bool" },
    ],
    blank: { username: "", password: "", display_name: "", roles: [], department: "", time_zone: "", out_of_office: false, capacity: null, active: true },
  },
};

/** The form values of a record, or of a new one. Instants are shown in the zone of the record's own form. */
export function toValues(spec: KindSpec, row: Plain | null): Values {
  const source = row ?? spec.blank;
  const zone = typeof source.time_zone === "string" ? source.time_zone : "";
  const values: Values = {};
  for (const field of spec.fields) {
    const raw = source[field.key];
    switch (field.kind) {
      case "bool":
        values[field.key] = raw === true;
        break;
      case "roles":
        values[field.key] = Array.isArray(raw) ? (raw as string[]) : [];
        break;
      case "json":
        values[field.key] = JSON.stringify(raw ?? null);
        break;
      case "datetime":
        values[field.key] = typeof raw === "string" && raw !== "" && isValidZone(zone) ? formatLocalIso(raw, zone) : "";
        break;
      case "secret":
        values[field.key] = "";
        break;
      default:
        values[field.key] = raw === null || raw === undefined ? "" : String(raw);
    }
  }
  return values;
}

/** The request body for the form values, or the problems the browser itself can see before sending. */
export function toBody(spec: KindSpec, values: Values): { body: Plain; errors: Record<string, string> } {
  const body: Plain = {};
  const errors: Record<string, string> = {};
  const zone = String(values.time_zone ?? "");
  for (const field of spec.fields) {
    const value = values[field.key];
    switch (field.kind) {
      case "bool":
        body[field.key] = value === true;
        break;
      case "roles":
        body[field.key] = value;
        break;
      case "secret":
        if (typeof value === "string" && value !== "") body[field.key] = value;
        break;
      case "number": {
        const typed = String(value).trim();
        if (typed === "" && field.nullable) body[field.key] = null;
        else if (typed === "" || Number.isNaN(Number(typed))) errors[field.key] = typed === "" ? `${labelOf(field.key)} is required.` : "Enter a number.";
        else body[field.key] = Number(typed);
        break;
      }
      case "json": {
        try {
          body[field.key] = JSON.parse(String(value)) as unknown;
        } catch {
          errors[field.key] = "Enter valid JSON.";
        }
        break;
      }
      case "datetime": {
        const instant = localTextToIso(String(value), zone);
        if (instant !== null) body[field.key] = instant;
        else if (isValidZone(zone)) errors[field.key] = "Use YYYY-MM-DD HH:mm.";
        else errors.time_zone = "Use an IANA time zone.";
        break;
      }
      default: {
        const text = String(value);
        body[field.key] = field.nullable && text.trim() === "" ? null : text;
      }
    }
  }
  return { body, errors };
}

interface SaveCall {
  method: "POST" | "PUT" | "PATCH";
  path: string;
  body: unknown;
}

/** The request that saves a record: create with POST, update with PUT by name (or the kind's own update route). */
export function saveCall(slug: string, spec: KindSpec, original: Plain | null, body: Plain, rows: Plain[]): SaveCall {
  const id = original ? encodeURIComponent(String(original[spec.idKey])) : null;
  switch (slug) {
    case "inbox-rules":
      return { method: "PUT", path: spec.listPath, body: { rules: original ? rows.map((row) => (row === original ? body : row)) : [...rows, body] } };
    case "users": {
      if (!original) return { method: "POST", path: spec.listPath, body };
      const { username: _fixed, ...changes } = body;
      return { method: "PATCH", path: `${spec.listPath}/${id}`, body: changes };
    }
    case "escalation-policies":
    case "freeze-windows":
    case "assignment-rules":
    case "form-policies":
      return { method: "POST", path: spec.listPath, body };
    default:
      return original ? { method: "PUT", path: `${spec.listPath}/${id}`, body } : { method: "POST", path: spec.listPath, body };
  }
}
