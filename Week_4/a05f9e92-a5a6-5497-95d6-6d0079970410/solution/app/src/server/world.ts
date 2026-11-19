import { fieldSpec } from "../shared/fields.js";
import type { Scope, Value } from "../shared/expression.js";
import type { Table } from "../shared/types.js";
import { now } from "./clock.js";
import { openDaysBetween, type Schedule } from "./schedule.js";
import { localDateKey } from "../shared/tz.js";
import { query, type Row, type Tx } from "./db.js";

export type Fields = Record<string, Value>;

export interface StateEntry {
  state: string;
  at: string;
}

export interface RecordObj {
  number: string;
  table: Table;
  fields: Fields;
  versions: Record<string, number>;
  history: StateEntry[];
  createdBy: string | null;
  closeAt: string | null;
  createdAt: string;
}

interface Person {
  username: string;
  display_name: string;
  department: string;
  active: boolean;
  roles: string[];
  time_zone: string;
  out_of_office: boolean;
  capacity: number | null;
  digest: string;
  hasLogin: boolean;
}

export interface Ci {
  name: string;
  class: string;
  criticality: number;
  business_critical: boolean;
  owner_department: string;
  status: string;
  attributes: Record<string, Value>;
  used_by: { departments: string[]; people: string[] } | null;
}

interface Group {
  name: string;
  members: string[];
  escalation_policy: string | null;
}

export function toRecord(row: Row): RecordObj {
  return {
    number: row.number as string,
    table: row.table_name as Table,
    fields: row.fields as Fields,
    versions: row.versions as Record<string, number>,
    history: row.state_history as StateEntry[],
    createdBy: (row.created_by as string | null) ?? null,
    closeAt: (row.close_at as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

/** A snapshot of the directory, the service map and (on demand) records, for resolving paths in expressions. */
/** A request as reference paths read it: `request.requester`, `request.state`. */
interface RequestRef {
  number: string;
  state: "open" | "closed";
  requester: string;
  requested_for: string | null;
}

export function requestState(closed: boolean): RequestRef["state"] {
  return closed ? "closed" : "open";
}

export class World {
  people = new Map<string, Person>();
  cis = new Map<string, Ci>();
  groups = new Map<string, Group>();
  records = new Map<string, RecordObj>();
  requests = new Map<string, RequestRef>();
  catalog = new Map<string, { id: string; name: string }>();
  departmentNames = new Set<string>();
  /** The business schedule named `Office hours`, used by `business_days_since` and the reopen deadline. */
  office: Schedule | null = null;

  static async load(tx?: Tx): Promise<World> {
    const run = tx ? tx.query.bind(tx) : query;
    const world = new World();
    const people = await run(
        `SELECT p.username, p.display_name, p.department, p.active, u.roles, u.time_zone, u.out_of_office, u.capacity, u.digest, (u.username IS NOT NULL) AS has_login
         FROM people p LEFT JOIN users u ON u.username = p.username`,
      );
    const cis = await run("SELECT name, class, criticality, business_critical, owner_department, status, attributes, used_by FROM cis");
    const groups = await run("SELECT name, members, escalation_policy FROM groups");
    const departments = await run("SELECT name FROM departments");
    const office = await run("SELECT content FROM config_items WHERE workspace = 'live' AND kind = 'schedule' AND name = 'Office hours'");
    world.office = (office[0]?.content as Schedule | undefined) ?? null;
    for (const d of departments) world.departmentNames.add(d.name as string);
    for (const p of people) {
      world.people.set(p.username as string, {
        username: p.username as string,
        display_name: p.display_name as string,
        department: p.department as string,
        active: p.active as boolean,
        roles: (p.roles as string[] | null) ?? [],
        time_zone: (p.time_zone as string | null) ?? "Europe/Berlin",
        out_of_office: (p.out_of_office as boolean | null) ?? false,
        capacity: (p.capacity as number | null) ?? null,
        digest: (p.digest as string | null) ?? "immediate",
        hasLogin: p.has_login as boolean,
      });
    }
    for (const c of cis) {
      world.cis.set(c.name as string, {
        name: c.name as string,
        class: c.class as string,
        criticality: c.criticality as number,
        business_critical: c.business_critical as boolean,
        owner_department: c.owner_department as string,
        status: c.status as string,
        attributes: c.attributes as Record<string, Value>,
        used_by: (c.used_by as Ci["used_by"]) ?? null,
      });
    }
    for (const g of groups) {
      world.groups.set(g.name as string, { name: g.name as string, members: g.members as string[], escalation_policy: (g.escalation_policy as string | null) ?? null });
    }
    return world;
  }

  async loadRecords(tx?: Tx, table?: Table): Promise<this> {
    const run = tx ? tx.query.bind(tx) : query;
    const rows = table ? await run("SELECT * FROM records WHERE table_name = $1 ORDER BY id", [table]) : await run("SELECT * FROM records ORDER BY id");
    for (const row of rows) {
      const rec = toRecord(row);
      this.records.set(rec.number, rec);
    }
    for (const row of await run("SELECT number, requester, requested_for, closed FROM requests")) {
      const number = row.number as string;
      this.requests.set(number, { number, state: requestState(row.closed as boolean), requester: row.requester as string, requested_for: (row.requested_for as string | null) ?? null });
    }
    return this;
  }

  async loadCatalog(tx?: Tx): Promise<this> {
    const run = tx ? tx.query.bind(tx) : query;
    const rows = await run("SELECT content FROM config_items WHERE workspace = 'live' AND kind = 'catalog_item'");
    for (const row of rows) {
      const content = row.content as { id: string; name: string };
      this.catalog.set(content.id, { id: content.id, name: content.name });
    }
    return this;
  }

  person(username: Value): Person | undefined {
    return typeof username === "string" ? this.people.get(username) : undefined;
  }

  /** The stored name of an item: item names compare case-insensitively. */
  itemName(name: string): string | undefined {
    return [...this.cis.keys()].find((stored) => stored.toLowerCase() === name.toLowerCase());
  }

  displayName(username: string | null | undefined): string {
    if (!username) return "nobody";
    return this.people.get(username)?.display_name ?? username;
  }

  /** Number of directory people in a department. */
  departmentMembers(department: string): string[] {
    return [...this.people.values()].filter((p) => p.department === department && p.active).map((p) => p.username);
  }

  followReference(target: string, value: Value, rest: string[]): Value {
    if (value === null || rest.length === 0) return value;
    const [attribute, ...deeper] = rest as [string, ...string[]];
    switch (target) {
      case "user": {
        const person = this.person(value);
        if (!person) return null;
        if (attribute === "department") return person.department;
        const bag = person as unknown as Record<string, Value>;
        return bag[attribute] ?? null;
      }
      case "ci": {
        const ci = typeof value === "string" ? this.cis.get(value) : undefined;
        if (!ci) return null;
        const bag = ci as unknown as Record<string, Value>;
        return bag[attribute] ?? ci.attributes[attribute] ?? null;
      }
      case "group":
        return attribute === "name" && typeof value === "string" ? value : null;
      case "catalog_item": {
        const item = typeof value === "string" ? this.catalog.get(value) : undefined;
        return item ? ((item as unknown as Record<string, Value>)[attribute] ?? null) : null;
      }
      case "request": {
        const request = typeof value === "string" ? this.requests.get(value) : undefined;
        return request ? ((request as unknown as Record<string, Value>)[attribute] ?? null) : null;
      }
      default: {
        const rec = typeof value === "string" ? this.records.get(value) : undefined;
        if (!rec) return null;
        if (attribute === "number") return rec.number;
        const next = rec.fields[attribute] ?? null;
        const spec = fieldSpec(rec.table, attribute);
        return spec?.reference && deeper.length > 0 ? this.followReference(spec.reference, next, deeper) : next;
      }
    }
  }
}

interface ScopeExtras {
  variables?: Record<string, Value>;
  answers?: Record<string, Value>;
  inputs?: Record<string, Value>;
  steps?: Record<string, Record<string, Value>>;
  previous?: Fields | null;
  inserting?: boolean;
}

export interface Actor {
  username: string;
  roles: readonly string[];
}

/** Binds an expression scope to one record, its world, and the acting person. */
export function recordScope(world: World, rec: { table: Table; number: string | null; fields: Fields }, actor: Actor, extras: ScopeExtras = {}): Scope {
  const resolve = (fields: Fields, parts: string[]): Value => {
    const [head, ...rest] = parts as [string, ...string[]];
    if (head === "variables" || head === "answers" || head === "inputs") {
      const bag = extras[head] ?? {};
      return bag[rest[0] ?? ""] ?? null;
    }
    if (head === "steps") return extras.steps?.[rest[0] ?? ""]?.[rest[1] ?? ""] ?? null;
    if (head === "number") return rec.number;
    const value = fields[head] ?? null;
    const spec = fieldSpec(rec.table, head);
    if (rest.length === 0 || !spec?.reference) return rest.length === 0 ? value : null;
    return world.followReference(spec.reference, value, rest);
  };
  const scope: Scope = {
    path: (parts) => (parts[0] === "previous" ? resolve(extras.previous ?? rec.fields, parts.slice(1)) : resolve(rec.fields, parts)),
    me: () => actor.username,
    hasRole: (role) => actor.roles.includes(role),
    now: () => now(),
    inserting: extras.inserting ?? false,
    businessDaysSince: (value) => (typeof value === "string" && world.office && !Number.isNaN(Date.parse(value)) ? openDaysBetween(world.office, localDateKey(Date.parse(value), world.office.time_zone), now()) : null),
  };
  if (extras.previous !== undefined) {
    const before = extras.previous;
    scope.previous = (parts) => (before === null ? undefined : resolve(before, parts));
  }
  return scope;
}
