/**
 * The per-request engine: one loaded view of a workspace, the access context
 * built from it, and the serialisation every surface shares. Derived values are
 * computed here once, on the server.
 */

import { nowMs } from '../clock';
import { settings } from '../config';
import { notFound } from '../errors';
import { condition as evaluateCondition, type Scope } from '../expr/interpret';
import {
  type AccessContext,
  type AccessRecord,
  type AccessRule,
  canReadField,
  canSeeRecord,
  type Viewer,
} from '../domain/access';
import type { AssignmentRule } from '../domain/assignment';
import { impactOf, type ConfigurationItem, type Impact, ServiceMap } from '../domain/cmdb';
import {
  choiceLabel,
  fieldLabel,
  fieldSpec,
  priorityLabels,
  tableFields,
  type TableName,
} from '../domain/fields';
import type { InboxRule } from '../domain/inbox';
import type { EscalationPolicy, Rotation, RotationOverride } from '../domain/oncall';
import { priorityFrom } from '../domain/priority';
import type { RoleKey } from '../domain/roles';
import type { BusinessSchedule } from '../domain/schedule';
import {
  computeSla,
  type SlaComputed,
  type SlaDefinition,
  type SlaInstanceRow,
  type StateSegment,
} from '../domain/sla';
import { allowedTransitions, type Mover, stateLabel } from '../domain/transitions';
import { RecordScope, indexBy, type ScopeData } from './scope';
import {
  buildServiceMap,
  departmentMembers,
  type BoardRow,
  type BusinessRuleRow,
  type CatalogItemRow,
  type FormPolicyRow,
  type FreezeWindowRow,
  loadAccessRules,
  loadAssignmentRules,
  loadBoards,
  loadBusinessRules,
  loadCatalogItems,
  loadEscalationPolicies,
  loadFormPolicies,
  loadFreezeWindows,
  loadGroups,
  loadGuides,
  loadInboxRules,
  loadOverrides,
  loadPeople,
  loadRecords,
  loadRotations,
  loadSchedules,
  loadSlaDefinitions,
  loadSlaInstances,
  type OrderGuideRow,
  type Person,
  type RecordFields,
  type RecordRow,
  type Workspace,
  type WorkGroup,
} from './store';

export const officeHoursName = 'Office hours';

export interface Caller {
  readonly username: string;
  readonly roles: readonly RoleKey[];
  readonly department: string | null;
  readonly timeZone: string;
  readonly displayName: string;
  /** The operator behind an impersonated session, when there is one. */
  readonly actor: string;
  readonly impersonating: boolean;
  readonly workspace: Workspace;
  /** True for the server itself, which may make the `system` moves. */
  readonly system?: boolean;
}

export class Engine {
  private constructor(
    readonly workspace: Workspace,
    readonly at: number,
    readonly people: Map<string, Person>,
    readonly groups: Map<string, WorkGroup>,
    readonly map: ServiceMap,
    readonly schedules: Map<string, BusinessSchedule>,
    readonly slaDefinitions: SlaDefinition[],
    readonly accessRules: AccessRule[],
    readonly assignmentRules: AssignmentRule[],
    readonly businessRules: BusinessRuleRow[],
    readonly formPolicies: FormPolicyRow[],
    readonly catalogItems: Map<string, CatalogItemRow>,
    readonly guides: Map<string, OrderGuideRow>,
    readonly boards: Map<string, BoardRow>,
    readonly freezeWindows: FreezeWindowRow[],
    readonly rotations: Map<string, Rotation>,
    readonly overrides: RotationOverride[],
    readonly escalationPolicies: Map<string, EscalationPolicy>,
    readonly inboxRules: InboxRule[],
    readonly departmentMembers: Map<string, string[]>,
    readonly records: Map<string, RecordRow>,
  ) {}

  static async load(workspace: Workspace, at: number = nowMs()): Promise<Engine> {
    const [
      people,
      groups,
      map,
      schedules,
      slaDefinitions,
      accessRules,
      assignmentRules,
      businessRules,
      formPolicies,
      catalogItems,
      guides,
      boards,
      freezeWindows,
      rotations,
      overrides,
      escalationPolicies,
      inboxRules,
      members,
      records,
    ] = await Promise.all([
      loadPeople(),
      loadGroups(),
      buildServiceMap(workspace, at),
      loadSchedules(workspace),
      loadSlaDefinitions(workspace),
      loadAccessRules(workspace),
      loadAssignmentRules(workspace),
      loadBusinessRules(workspace),
      loadFormPolicies(workspace),
      loadCatalogItems(workspace),
      loadGuides(workspace),
      loadBoards(workspace),
      loadFreezeWindows(),
      loadRotations(),
      loadOverrides(),
      loadEscalationPolicies(),
      loadInboxRules(workspace),
      departmentMembers(),
      loadRecords(workspace),
    ]);
    return new Engine(
      workspace,
      at,
      indexBy(people, (p) => p.username),
      indexBy(groups, (g) => g.name),
      map,
      indexBy(schedules, (s) => s.name),
      slaDefinitions,
      accessRules,
      assignmentRules,
      businessRules,
      formPolicies,
      indexBy(catalogItems, (c) => c.id),
      indexBy(guides, (g) => g.id),
      indexBy(boards, (b) => b.name),
      freezeWindows,
      indexBy(rotations, (r) => r.name),
      overrides,
      indexBy(escalationPolicies, (p) => p.name),
      inboxRules,
      members,
      indexBy(records, (r) => r.number),
    );
  }

  get businessZone(): string {
    return settings().BUSINESS_TIME_ZONE;
  }

  schedule(name: string): BusinessSchedule {
    const found = this.schedules.get(name);
    if (found) return found;
    return {
      name,
      timeZone: this.businessZone,
      hours: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] },
      holidays: [],
    };
  }

  get officeHours(): BusinessSchedule {
    return this.schedule(officeHoursName);
  }

  person(username: string | null): Person | null {
    return username === null ? null : (this.people.get(username) ?? null);
  }

  displayName(username: string | null): string {
    return this.person(username)?.displayName ?? username ?? '';
  }

  get scopeData(): ScopeData {
    return {
      people: this.people,
      groups: this.groups,
      cis: indexBy(this.map.items, (c) => c.name.toLowerCase()),
      departmentMembers: this.departmentMembers,
      records: this.records,
      schedule: this.officeHours,
      effectiveStatus: this.map.effectiveStatuses(),
    };
  }

  /** A scope for one record, used by rules, filters and SLA conditions. */
  scopeFor(
    record: { table: TableName; fields: RecordFields; state: string; number: string | null },
    viewer: { username: string | null; roles: readonly RoleKey[] },
    extra: {
      previous?: RecordFields;
      previousState?: string;
      stateOverride?: string;
      variables?: Readonly<Record<string, unknown>>;
    } = {},
  ): Scope {
    return new RecordScope({
      table: record.table,
      fields: record.fields,
      state: record.state,
      number: record.number,
      viewer,
      data: this.scopeData,
      variables:
        extra.variables ??
        (record.table === 'request_item'
          ? ((record.fields.variables as Readonly<Record<string, unknown>>) ?? {})
          : undefined),
      previous: extra.previous,
      previousState: extra.previousState,
      stateOverride: extra.stateOverride,
    });
  }

  accessContext(caller: Caller): AccessContext {
    const viewer: Viewer = {
      username: caller.username,
      roles: caller.roles,
      department: caller.department,
    };
    return {
      viewer,
      rules: this.accessRules,
      departmentMembers: this.departmentMembers.get(caller.department ?? '') ?? [],
      matches: (text, record) => {
        const row = this.records.get(record.number);
        const scope = this.scopeFor(
          {
            table: record.table,
            fields: record.fields as RecordFields,
            state: row?.state ?? String(record.fields.state ?? ''),
            number: record.number,
          },
          viewer,
        );
        try {
          return evaluateCondition(text, scope);
        } catch {
          return false;
        }
      },
    };
  }

  static asAccessRecord(record: RecordRow): AccessRecord {
    return { table: record.table, number: record.number, fields: record.fields };
  }

  /** A record the caller may not see answers 404 on every endpoint. */
  visible(caller: Caller, record: RecordRow): boolean {
    return canSeeRecord(this.accessContext(caller), Engine.asAccessRecord(record));
  }

  requireVisible(caller: Caller, number: string): RecordRow {
    const record = this.records.get(number);
    if (!record || !this.visible(caller, record)) throw notFound();
    return record;
  }

  visibleRecords(caller: Caller, table?: TableName): RecordRow[] {
    const context = this.accessContext(caller);
    return [...this.records.values()].filter(
      (r) => (table === undefined || r.table === table) && canSeeRecord(context, Engine.asAccessRecord(r)),
    );
  }

  readableFieldNames(caller: Caller, record: RecordRow): string[] {
    const context = this.accessContext(caller);
    const access = Engine.asAccessRecord(record);
    return tableFields[record.table]
      .map((f) => f.name)
      .filter((name) => canReadField(context, access, record.table, name));
  }

  /** The business-critical flag of a record's item, for the priority bump. */
  itemOf(fields: RecordFields): ConfigurationItem | null {
    const name = fields.configuration_item;
    if (typeof name !== 'string') return null;
    return this.map.find(name) ?? null;
  }

  computedPriority(table: TableName, fields: RecordFields): number {
    const impact = Number(fields.impact ?? 3);
    const urgency = Number(fields.urgency ?? (table === 'request_item' ? 2 : 3));
    return priorityFrom(impact, urgency, this.itemOf(fields)?.businessCritical ?? false);
  }

  impact(name: string): Impact | null {
    return impactOf(this.map, name, this.departmentMembers);
  }

  /** The server clock now, which SLA maths and history segments read. */
  now(): number {
    return nowMs();
  }

  /** The record's state history as segments, for the SLA engine. */
  segmentsOf(record: RecordRow, until: number = nowMs()): StateSegment[] {
    const history = [...record.stateHistory]
      .map((h) => ({ state: h.state, at: Date.parse(h.at) }))
      .filter((h) => !Number.isNaN(h.at))
      .sort((a, b) => a.at - b.at);
    if (history.length === 0) history.push({ state: record.state, at: record.createdAt });
    const out: StateSegment[] = [];
    history.forEach((entry, index) => {
      const next = history[index + 1];
      out.push({ state: entry.state, from: entry.at, to: next ? next.at : Math.max(until, entry.at) + 1 });
    });
    return out;
  }

  definition(name: string): SlaDefinition | undefined {
    return this.slaDefinitions.find((d) => d.name === name);
  }

  /** Computes one SLA from its row and the record's history. */
  computeOne(record: RecordRow, row: SlaInstanceRow): SlaComputed {
    const definition = this.definition(row.definition);
    const schedule = this.schedule(definition?.schedule ?? officeHoursName);
    const segments = this.segmentsOf(record);
    const judge = (state: string): { paused: boolean; stopped: boolean } => {
      if (!definition) return { paused: false, stopped: false };
      const scope = this.scopeFor(
        { table: record.table, fields: record.fields, state: record.state, number: record.number },
        { username: null, roles: ['operator'] },
        { stateOverride: state },
      );
      const safe = (text: string): boolean => {
        try {
          return evaluateCondition(text, scope);
        } catch {
          return false;
        }
      };
      return { paused: safe(definition.pause), stopped: safe(definition.stop) };
    };
    return computeSla(row, segments, judge, schedule, nowMs());
  }

  async slasOf(record: RecordRow): Promise<SlaComputed[]> {
    const rows = await loadSlaInstances(record.number);
    return rows.map((row) => this.computeOne(record, row));
  }

  /** The moves this caller may make from a record's current state. */
  moversFor(caller: Caller, record: RecordRow): Mover[] {
    const movers: Mover[] = [...caller.roles];
    if (caller.system === true) movers.push('system');
    if (record.fields.caller === caller.username) movers.push('caller');
    if (record.fields.requested_for === caller.username || record.fields.requester === caller.username) {
      movers.push('requester');
    }
    return movers;
  }

  transitionsFor(caller: Caller, record: RecordRow): { to: string; label: string }[] {
    const model = record.table === 'change' ? String(record.fields.model ?? 'normal') : null;
    return allowedTransitions(record.table, model, record.state, this.moversFor(caller, record)).map((row) => ({
      to: row.to,
      label: stateLabel(record.table, row.to),
    }));
  }

  /** The readable text of a field's value. */
  displayOf(table: TableName, field: string, value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const spec = fieldSpec(table, field);
    if (!spec) return String(value);
    if (spec.type === 'reference') {
      switch (spec.target) {
        case 'user':
          return this.displayName(String(value));
        case 'ci':
          return this.map.find(String(value))?.name ?? String(value);
        case 'group':
          return String(value);
        case 'catalog_item':
          return this.catalogItems.get(String(value))?.name ?? String(value);
        default:
          return String(value);
      }
    }
    if (field === 'priority') return `${value} ${priorityLabels[Number(value)] ?? ''}`.trim();
    const choice = choiceLabel(table, field, value);
    if (choice) return choice;
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  labelOf(table: TableName, field: string): string {
    return fieldLabel(table, field);
  }
}
