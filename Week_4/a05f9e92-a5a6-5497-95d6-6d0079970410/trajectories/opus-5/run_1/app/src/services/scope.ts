/**
 * The expression scope over a record: reference paths are followed through
 * users, departments, configuration items, groups and linked records. The same
 * member sets validate a path when a rule is saved.
 */

import { nowMs } from '../clock';
import { settings } from '../config';
import type { Scope } from '../expr/interpret';
import { TimeValue, unknownPath, type Lookup, type Value } from '../expr/value';
import { businessDaysSince, type BusinessSchedule } from '../domain/schedule';
import { fieldSpec, isTimeField, type TableName } from '../domain/fields';
import type { ConfigurationItem } from '../domain/cmdb';
import type { RoleKey } from '../domain/roles';
import type { Person, RecordFields, RecordRow, WorkGroup } from './store';

/** Reference data every scope needs. */
export interface ScopeData {
  readonly people: ReadonlyMap<string, Person>;
  readonly groups: ReadonlyMap<string, WorkGroup>;
  readonly cis: ReadonlyMap<string, ConfigurationItem>;
  readonly departmentMembers: ReadonlyMap<string, readonly string[]>;
  readonly records: ReadonlyMap<string, RecordRow>;
  readonly schedule: BusinessSchedule;
  readonly effectiveStatus?: ReadonlyMap<string, string>;
}

export function indexBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) map.set(key(item), item);
  return map;
}

const userMembers = [
  'username',
  'display_name',
  'department',
  'roles',
  'time_zone',
  'active',
  'out_of_office',
  'capacity',
] as const;

const departmentMembersNames = ['name', 'members'] as const;

const ciMembers = [
  'name',
  'class',
  'criticality',
  'business_critical',
  'owner_department',
  'status',
  'effective_status',
] as const;

const groupMembers = ['name', 'members', 'escalation_policy'] as const;

const catalogItemMembers = ['id', 'name'] as const;

/** Roots an expression may read beyond the record's own fields. */
const contextRoots = ['variables', 'answers', 'inputs', 'steps', 'previous'] as const;

export interface ScopeOptions {
  readonly table: TableName;
  readonly fields: RecordFields;
  readonly state: string;
  readonly number: string | null;
  readonly previous?: RecordFields;
  readonly previousState?: string;
  readonly variables?: Readonly<Record<string, unknown>>;
  readonly answers?: Readonly<Record<string, unknown>>;
  readonly inputs?: Readonly<Record<string, unknown>>;
  readonly steps?: Readonly<Record<string, Record<string, unknown>>>;
  readonly viewer: { readonly username: string | null; readonly roles: readonly RoleKey[] };
  readonly data: ScopeData;
  /** Overrides the state for one evaluation, used by the SLA engine per segment. */
  readonly stateOverride?: string;
}

export class RecordScope implements Scope {
  constructor(private readonly options: ScopeOptions) {}

  private plain(fields: RecordFields, state: string, path: readonly string[]): Lookup {
    const [head, ...rest] = path;
    if (head === 'state') return rest.length === 0 ? state : unknownPath;
    if (head === 'number') return rest.length === 0 ? this.options.number : unknownPath;
    const spec = fieldSpec(this.options.table, head);
    if (!spec) return unknownPath;
    const raw = fields[head] ?? null;
    if (rest.length === 0) return this.scalar(head, raw);
    if (spec.type !== 'reference' || raw === null) return unknownPath;
    return this.follow(spec.target ?? 'record', String(raw), rest);
  }

  private scalar(field: string, raw: unknown): Value {
    if (raw === null || raw === undefined) return null;
    if (isTimeField(this.options.table, field)) {
      const ms = typeof raw === 'string' ? Date.parse(raw) : Number(raw);
      return Number.isNaN(ms) ? null : new TimeValue(ms);
    }
    if (Array.isArray(raw)) return raw.map((item) => (item === null ? null : (item as Value)));
    if (typeof raw === 'object') return null;
    return raw as Value;
  }

  private follow(target: string, key: string, rest: readonly string[]): Lookup {
    switch (target) {
      case 'user':
        return this.userMember(key, rest);
      case 'ci':
        return this.ciMember(key, rest);
      case 'group':
        return this.groupMember(key, rest);
      case 'catalog_item':
        return this.catalogMember(key, rest);
      default:
        return this.recordMember(key, rest);
    }
  }

  private userMember(username: string, rest: readonly string[]): Lookup {
    const person = this.options.data.people.get(username);
    if (!person) return null;
    const [member, ...tail] = rest;
    switch (member) {
      case 'username':
        return tail.length === 0 ? person.username : unknownPath;
      case 'display_name':
        return tail.length === 0 ? person.displayName : unknownPath;
      case 'roles':
        return tail.length === 0 ? [...person.roles] : unknownPath;
      case 'time_zone':
        return tail.length === 0 ? person.timeZone : unknownPath;
      case 'active':
        return tail.length === 0 ? person.active : unknownPath;
      case 'out_of_office':
        return tail.length === 0 ? person.outOfOffice : unknownPath;
      case 'capacity':
        return tail.length === 0 ? person.capacity : unknownPath;
      case 'department':
        if (tail.length === 0) return person.department;
        return this.departmentMember(person.department, tail);
      default:
        return unknownPath;
    }
  }

  private departmentMember(department: string | null, rest: readonly string[]): Lookup {
    const [member, ...tail] = rest;
    if (tail.length > 0) return unknownPath;
    if (member === 'name') return department;
    if (member === 'members') return [...(this.options.data.departmentMembers.get(department ?? '') ?? [])];
    return unknownPath;
  }

  private ciMember(name: string, rest: readonly string[]): Lookup {
    const item = this.options.data.cis.get(name.toLowerCase());
    if (!item) return null;
    const [member, ...tail] = rest;
    if (tail.length > 0 && member !== 'owner_department') return unknownPath;
    switch (member) {
      case 'name':
        return item.name;
      case 'class':
        return item.className;
      case 'criticality':
        return item.criticality;
      case 'business_critical':
        return item.businessCritical;
      case 'status':
        return item.status;
      case 'effective_status':
        return this.options.data.effectiveStatus?.get(item.name.toLowerCase()) ?? item.status;
      case 'owner_department':
        if (tail.length === 0) return item.ownerDepartment;
        return this.departmentMember(item.ownerDepartment, tail);
      default:
        return unknownPath;
    }
  }

  private groupMember(name: string, rest: readonly string[]): Lookup {
    const group = this.options.data.groups.get(name);
    if (!group) return null;
    const [member, ...tail] = rest;
    if (tail.length > 0) return unknownPath;
    if (member === 'name') return group.name;
    if (member === 'members') return [...group.members];
    if (member === 'escalation_policy') return group.escalationPolicy;
    return unknownPath;
  }

  private catalogMember(id: string, rest: readonly string[]): Lookup {
    const [member, ...tail] = rest;
    if (tail.length > 0) return unknownPath;
    if (member === 'id') return id;
    if (member === 'name') return id;
    return unknownPath;
  }

  private recordMember(number: string, rest: readonly string[]): Lookup {
    const record = this.options.data.records.get(number);
    if (!record) return null;
    const nested = new RecordScope({ ...this.options, table: record.table, fields: record.fields, state: record.state, number: record.number });
    return nested.lookup(rest);
  }

  lookup(path: readonly string[]): Lookup {
    const [head, ...rest] = path;
    if (head === 'previous') return this.previous(rest);
    if (head === 'variables') return this.fromBag(this.options.variables, rest);
    if (head === 'answers') return this.fromBag(this.options.answers, rest);
    if (head === 'inputs') return this.fromBag(this.options.inputs, rest);
    if (head === 'steps') {
      const [stepId, ...tail] = rest;
      const outputs = this.options.steps?.[stepId];
      if (!outputs) return null;
      return this.fromBag(outputs, tail);
    }
    return this.plain(this.options.fields, this.options.stateOverride ?? this.options.state, path);
  }

  previous(path: readonly string[]): Lookup {
    const fields = this.options.previous;
    if (!fields) return unknownPath;
    return this.plain(fields, this.options.previousState ?? this.options.state, path);
  }

  private fromBag(bag: Readonly<Record<string, unknown>> | undefined, rest: readonly string[]): Lookup {
    if (!bag) return null;
    const [name, ...tail] = rest;
    if (name === undefined || tail.length > 0) return unknownPath;
    const value = bag[name];
    if (value === undefined) return null;
    if (value === null || typeof value === 'object') return Array.isArray(value) ? (value as Value) : null;
    return value as Value;
  }

  me(): string | null {
    return this.options.viewer.username;
  }

  hasRole(role: string): boolean {
    return this.options.viewer.roles.includes(role as RoleKey);
  }

  now(): number {
    return nowMs();
  }

  businessDaysSince(value: Value): number {
    const ms = value instanceof TimeValue ? value.ms : typeof value === 'string' ? Date.parse(value) : NaN;
    if (Number.isNaN(ms)) return 0;
    return businessDaysSince(this.options.data.schedule, ms, nowMs());
  }
}

/**
 * True when a path is one the table knows, so an unknown field is refused when a
 * rule is saved rather than when it runs.
 */
export function knownPath(table: TableName, path: readonly string[]): boolean {
  const [head, ...rest] = path;
  if (head === undefined) return false;
  if ((contextRoots as readonly string[]).includes(head)) {
    if (head === 'previous') return knownPath(table, rest);
    if (head === 'steps') return rest.length === 2;
    return rest.length === 1;
  }
  if (head === 'state' || head === 'number') return rest.length === 0;
  const spec = fieldSpec(table, head);
  if (!spec) return false;
  if (rest.length === 0) return true;
  if (spec.type !== 'reference') return false;
  return knownReferenceMember(spec.target ?? 'record', rest);
}

function knownReferenceMember(target: string, rest: readonly string[]): boolean {
  const [member, ...tail] = rest;
  switch (target) {
    case 'user':
      if (!(userMembers as readonly string[]).includes(member)) return false;
      if (tail.length === 0) return true;
      return member === 'department' && (departmentMembersNames as readonly string[]).includes(tail[0]) && tail.length === 1;
    case 'ci':
      if (!(ciMembers as readonly string[]).includes(member)) return false;
      if (tail.length === 0) return true;
      return (
        member === 'owner_department' &&
        (departmentMembersNames as readonly string[]).includes(tail[0]) &&
        tail.length === 1
      );
    case 'group':
      return (groupMembers as readonly string[]).includes(member) && tail.length === 0;
    case 'catalog_item':
      return (catalogItemMembers as readonly string[]).includes(member) && tail.length === 0;
    default:
      // A linked record's own fields are checked when the expression runs.
      return tail.length <= 1;
  }
}

export function pathChecker(table: TableName): (path: readonly string[]) => boolean {
  return (path) => knownPath(table, path);
}

export function presenceTimeoutMs(): number {
  return settings().PRESENCE_TIMEOUT_SECONDS * 1000;
}
