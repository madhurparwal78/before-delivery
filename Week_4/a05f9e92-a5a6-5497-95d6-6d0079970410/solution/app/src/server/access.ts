import { holds } from "../shared/expression.js";
import { compile } from "./conditions.js";
import { fieldSpec, fieldsOf, labelOf } from "../shared/fields.js";
import { TABLE_LABELS, type Table } from "../shared/types.js";
import { fail } from "./errors.js";
import { recordScope, type RecordObj, type World } from "./world.js";
import type { Tx } from "./db.js";

export interface AccessRule {
  name: string;
  type: "table" | "row" | "field";
  table: string;
  field: string | null;
  operation: "read" | "write";
  roles: string[];
  condition: string | null;
  active: boolean;
}

interface Viewer {
  username: string;
  roles: readonly string[];
  department: string;
}

const REQUESTER_READ: Partial<Record<Table, string[]>> = {
  incident: ["number", "short_description", "description", "state", "priority", "caller", "created_at", "resolved_at", "sla_breached"],
  request_item: ["number", "short_description", "request", "item", "quantity", "variables", "requested_for", "state", "priority", "created_at", "cancel_reason"],
};
const REQUESTER_WRITE: Partial<Record<Table, string[]>> = { incident: ["short_description", "description"] };
/** What Report a fault submits: a requester names the item when creating an incident, and cannot read or change it afterwards. */
const REQUESTER_CREATE: Partial<Record<Table, string[]>> = { incident: ["short_description", "description", "configuration_item"] };
const DESK_TABLES: Table[] = ["incident", "problem", "task", "request_item"];

export async function loadAccessRules(tx: Tx): Promise<AccessRule[]> {
  const rows = await tx.query("SELECT content FROM config_items WHERE workspace = 'live' AND kind = 'access_rule' ORDER BY id");
  return rows.map((r) => r.content as AccessRule).filter((r) => r.active);
}

interface Grant {
  visible: boolean;
  fields: "all" | ReadonlySet<string>;
}

/** The one place record access is decided: baseline grants first, then table, row and field rules. */
export class Access {
  constructor(
    readonly viewer: Viewer,
    private readonly rules: AccessRule[],
    private readonly world: World,
  ) {}

  get isOperator(): boolean {
    return this.viewer.roles.includes("operator");
  }

  private applies(rule: AccessRule, rec: { table: Table; number: string | null; fields: RecordObj["fields"] }): boolean {
    if (!rule.roles.some((r) => this.viewer.roles.includes(r))) return false;
    if (rule.condition === null || rule.condition === "") return true;
    return holds(compile(rule.condition), recordScope(this.world, rec, this.viewer));
  }

  private baseline(rec: RecordObj): Grant {
    const roles = this.viewer.roles;
    if (roles.includes("operator")) return { visible: true, fields: "all" };
    if (roles.includes("technician") && (DESK_TABLES.includes(rec.table) || rec.table === "change")) return { visible: true, fields: "all" };
    if (roles.includes("approver") && rec.table === "change") return { visible: true, fields: "all" };
    const caller = rec.fields.caller;
    const requestedFor = rec.fields.requested_for;
    const callerDepartment = typeof caller === "string" ? this.world.person(caller)?.department : undefined;
    const forDepartment = typeof requestedFor === "string" ? this.world.person(requestedFor)?.department : undefined;
    if (roles.includes("manager")) {
      const inDepartment = (rec.table === "incident" && callerDepartment === this.viewer.department) || (rec.table === "request_item" && forDepartment === this.viewer.department);
      if (inDepartment || (rec.table === "incident" && rec.fields.is_major === true)) return { visible: true, fields: "all" };
    }
    const own =
      (rec.table === "incident" && caller === this.viewer.username) ||
      (rec.table === "request_item" && (requestedFor === this.viewer.username || rec.createdBy === this.viewer.username));
    if (own) return { visible: true, fields: new Set(REQUESTER_READ[rec.table] ?? []) };
    return { visible: false, fields: new Set() };
  }

  canRead(rec: RecordObj): boolean {
    if (!this.baseline(rec).visible) return false;
    if (this.isOperator) return true;
    return !this.rules.some((r) => r.operation === "read" && (r.type === "table" || r.type === "row") && r.table === rec.table && this.applies(r, rec));
  }

  /** Field names the viewer can read on this record. */
  readable(rec: RecordObj): Set<string> {
    const grant = this.baseline(rec);
    const all = fieldsOf(rec.table).map((f) => f.name);
    const allowed = grant.fields === "all" ? all : all.filter((f) => (grant.fields as ReadonlySet<string>).has(f));
    if (this.isOperator) return new Set(allowed);
    const denied = this.rules.filter((r) => r.type === "field" && r.operation === "read" && r.table === rec.table && r.field && this.applies(r, rec)).map((r) => r.field!);
    return new Set(allowed.filter((f) => !denied.includes(f)));
  }

  /** Fields the viewer can never read on any record of the table: unconditional denials. */
  unreadableForTable(table: Table): Set<string> {
    const all = fieldsOf(table).map((f) => f.name);
    if (this.isOperator) return new Set();
    const roles = this.viewer.roles;
    let allowed: string[];
    if (roles.includes("technician") || roles.includes("approver") || roles.includes("manager")) allowed = all;
    else allowed = all.filter((f) => (REQUESTER_READ[table] ?? []).includes(f));
    const denied = this.rules
      .filter((r) => r.type === "field" && r.operation === "read" && r.table === table && r.field && (!r.condition || r.condition === "") && r.roles.some((x) => roles.includes(x)))
      .map((r) => r.field!);
    return new Set(all.filter((f) => !allowed.includes(f) || denied.includes(f)));
  }

  /** Refuses a write with 403 `denied` or `field_denied`. */
  assertWrite(table: Table, rec: RecordObj | null, fields: string[], transition: { fields: string[] } | null = null): void {
    const transitionFields = transition?.fields ?? [];
    if (this.isOperator) return;
    const roles = this.viewer.roles;
    const subject = rec ?? { table, number: null, fields: {} as RecordObj["fields"] };
    const tableDenied = this.rules.some((r) => (r.type === "table" || r.type === "row") && r.operation === "write" && r.table === table && this.applies(r, subject));
    const deskWrites = roles.includes("technician") && DESK_TABLES.includes(table);
    const ownWrites = (rec === null ? REQUESTER_CREATE : REQUESTER_WRITE)[table] ?? [];
    const mayTouchTable = deskWrites || ownWrites.length > 0 || transitionFields.length > 0;
    if (tableDenied || (!mayTouchTable && transition === null)) fail(403, "denied", `You cannot change ${TABLE_LABELS[table]} records.`);
    for (const name of fields) {
      const label = labelOf(table, name);
      const baselineOk = deskWrites || ownWrites.includes(name) || transitionFields.includes(name);
      const ruleDenied = this.rules.some((r) => r.type === "field" && r.table === table && r.field === name && this.applies(r, subject));
      if (!baselineOk || ruleDenied || !fieldSpec(table, name)) fail(403, "field_denied", `You cannot change ${label}.`);
    }
  }

  /** Same answer as an unknown field when a path starts at a field the viewer cannot read anywhere. */
  readableForTable(table: Table, name: string): boolean {
    return !this.unreadableForTable(table).has(name);
  }
}
