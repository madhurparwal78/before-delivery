/**
 * Typed loaders over Postgres. Everything a request needs about one workspace is
 * read here, so each rule has exactly one source of data.
 */

import { query, type PoolClient } from '../db';
import type { AccessRule } from '../domain/access';
import type { AssignmentRule } from '../domain/assignment';
import {
  type ClassName,
  type ConfigurationItem,
  type MaintenanceWindow,
  type Relationship,
  type RelationshipType,
  ServiceMap,
} from '../domain/cmdb';
import type { TableName } from '../domain/fields';
import type { Article } from '../domain/knowledge';
import type { InboxRule } from '../domain/inbox';
import type { EscalationPolicy, Rotation, RotationOverride } from '../domain/oncall';
import type { QuorumRule } from '../domain/quorum';
import type { RoleKey } from '../domain/roles';
import type { BusinessSchedule, HourRange } from '../domain/schedule';
import type { SlaDefinition, SlaInstanceRow } from '../domain/sla';
import type { WeekdayKey } from '../domain/zone';

export type Workspace = 'live' | 'test';

export type FieldValue = string | number | boolean | null | Record<string, unknown> | unknown[];

export interface RecordFields {
  [field: string]: FieldValue;
}

export interface StateHistoryEntry {
  readonly state: string;
  readonly at: string;
}

export interface RecordRow {
  readonly number: string;
  readonly table: TableName;
  readonly state: string;
  readonly fields: RecordFields;
  readonly versions: Readonly<Record<string, number>>;
  readonly stateHistory: readonly StateHistoryEntry[];
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly createdBy: string | null;
  readonly workspace: Workspace;
}

interface RawRecord {
  number: string;
  table_name: string;
  state: string;
  fields: RecordFields;
  versions: Record<string, number>;
  state_history: StateHistoryEntry[];
  created_at: Date;
  updated_at: Date;
  created_by: string | null;
  workspace: string;
}

function toRecord(raw: RawRecord): RecordRow {
  return {
    number: raw.number,
    table: raw.table_name as TableName,
    state: raw.state,
    fields: raw.fields ?? {},
    versions: raw.versions ?? {},
    stateHistory: raw.state_history ?? [],
    createdAt: raw.created_at.getTime(),
    updatedAt: raw.updated_at.getTime(),
    createdBy: raw.created_by,
    workspace: raw.workspace as Workspace,
  };
}

export async function loadRecords(workspace: Workspace, table?: TableName): Promise<RecordRow[]> {
  const raw = table
    ? await query<RawRecord>(
        `SELECT * FROM record WHERE workspace = $1 AND table_name = $2 ORDER BY number`,
        [workspace, table],
      )
    : await query<RawRecord>(`SELECT * FROM record WHERE workspace = $1 ORDER BY number`, [workspace]);
  return raw.map(toRecord);
}

export async function loadRecord(number: string): Promise<RecordRow | null> {
  const raw = await query<RawRecord>(`SELECT * FROM record WHERE number = $1`, [number]);
  return raw[0] ? toRecord(raw[0]) : null;
}

export async function loadRecordsByNumbers(numbers: readonly string[]): Promise<RecordRow[]> {
  if (numbers.length === 0) return [];
  const raw = await query<RawRecord>(
    `SELECT * FROM record WHERE number = ANY($1::text[]) ORDER BY number`,
    [numbers],
  );
  return raw.map(toRecord);
}

export interface Person {
  readonly username: string;
  readonly displayName: string;
  readonly department: string | null;
  readonly roles: readonly RoleKey[];
  readonly timeZone: string;
  readonly outOfOffice: boolean;
  readonly capacity: number | null;
  readonly active: boolean;
  readonly canSignIn: boolean;
  readonly digest: 'immediate' | 'daily';
  readonly delegate: string | null;
  readonly delegateFrom: number | null;
  readonly delegateTo: number | null;
}

interface RawPerson {
  username: string;
  display_name: string;
  department: string | null;
  roles: RoleKey[];
  time_zone: string;
  out_of_office: boolean;
  capacity: number | null;
  active: boolean;
  can_sign_in: boolean;
  digest: string;
  delegate: string | null;
  delegate_from: Date | null;
  delegate_to: Date | null;
}

function toPerson(raw: RawPerson): Person {
  return {
    username: raw.username,
    displayName: raw.display_name,
    department: raw.department,
    roles: raw.roles ?? [],
    timeZone: raw.time_zone,
    outOfOffice: raw.out_of_office,
    capacity: raw.capacity,
    active: raw.active,
    canSignIn: raw.can_sign_in,
    digest: raw.digest === 'daily' ? 'daily' : 'immediate',
    delegate: raw.delegate,
    delegateFrom: raw.delegate_from ? raw.delegate_from.getTime() : null,
    delegateTo: raw.delegate_to ? raw.delegate_to.getTime() : null,
  };
}

export async function loadPeople(): Promise<Person[]> {
  const raw = await query<RawPerson>(`SELECT * FROM person ORDER BY username`);
  return raw.map(toPerson);
}

export async function loadPerson(username: string): Promise<Person | null> {
  const raw = await query<RawPerson>(`SELECT * FROM person WHERE username = $1`, [username]);
  return raw[0] ? toPerson(raw[0]) : null;
}

export interface WorkGroup {
  readonly name: string;
  readonly members: readonly string[];
  readonly escalationPolicy: string | null;
  readonly lastAssigned: string | null;
}

export async function loadGroups(): Promise<WorkGroup[]> {
  const raw = await query<{
    name: string;
    members: string[];
    escalation_policy: string | null;
    last_assigned: string | null;
  }>(`SELECT * FROM work_group ORDER BY name`);
  return raw.map((r) => ({
    name: r.name,
    members: r.members ?? [],
    escalationPolicy: r.escalation_policy,
    lastAssigned: r.last_assigned,
  }));
}

export async function loadDepartments(): Promise<string[]> {
  const raw = await query<{ name: string }>(`SELECT name FROM department ORDER BY name`);
  return raw.map((r) => r.name);
}

export async function loadSchedules(workspace: Workspace): Promise<BusinessSchedule[]> {
  const raw = await query<{
    name: string;
    time_zone: string;
    hours: Record<WeekdayKey, HourRange[]>;
    holidays: string[];
  }>(`SELECT * FROM business_schedule WHERE workspace = $1 ORDER BY name`, [workspace]);
  return raw.map((r) => ({
    name: r.name,
    timeZone: r.time_zone,
    hours: r.hours,
    holidays: r.holidays ?? [],
  }));
}

export async function loadSlaDefinitions(workspace: Workspace): Promise<SlaDefinition[]> {
  const raw = await query<{
    name: string;
    table_name: string;
    start_expr: string;
    pause_expr: string;
    stop_expr: string;
    schedule: string;
    targets: Record<string, number>;
  }>(`SELECT * FROM sla_definition WHERE workspace = $1 ORDER BY name`, [workspace]);
  return raw.map((r) => ({
    name: r.name,
    table: r.table_name,
    start: r.start_expr,
    pause: r.pause_expr,
    stop: r.stop_expr,
    schedule: r.schedule,
    targets: r.targets,
  }));
}

export async function loadSlaInstances(number: string): Promise<SlaInstanceRow[]> {
  const raw = await query<{
    id: string;
    number: string;
    definition: string;
    priority: number;
    start_at: Date;
    target_seconds: number;
    breached: boolean;
    cancelled: boolean;
    thresholds_sent: number[];
  }>(`SELECT * FROM sla_instance WHERE number = $1 ORDER BY id`, [number]);
  return raw.map((r) => ({
    id: Number(r.id),
    recordNumber: r.number,
    definition: r.definition,
    priority: r.priority,
    startAt: r.start_at.getTime(),
    targetSeconds: r.target_seconds,
    breached: r.breached,
    cancelled: r.cancelled,
    thresholdsSent: r.thresholds_sent ?? [],
  }));
}

export async function loadAllSlaInstances(): Promise<SlaInstanceRow[]> {
  const raw = await query<{
    id: string;
    number: string;
    definition: string;
    priority: number;
    start_at: Date;
    target_seconds: number;
    breached: boolean;
    cancelled: boolean;
    thresholds_sent: number[];
  }>(`SELECT * FROM sla_instance WHERE NOT cancelled ORDER BY id`);
  return raw.map((r) => ({
    id: Number(r.id),
    recordNumber: r.number,
    definition: r.definition,
    priority: r.priority,
    startAt: r.start_at.getTime(),
    targetSeconds: r.target_seconds,
    breached: r.breached,
    cancelled: r.cancelled,
    thresholdsSent: r.thresholds_sent ?? [],
  }));
}

interface RawCi {
  id: string;
  name: string;
  class_name: string;
  criticality: number;
  business_critical: boolean;
  owner_department: string | null;
  status: string;
  attributes: Record<string, unknown>;
  used_by_departments: string[];
  used_by_people: string[];
}

export async function loadCis(workspace: Workspace): Promise<ConfigurationItem[]> {
  const raw = await query<RawCi>(`SELECT * FROM configuration_item WHERE workspace = $1 ORDER BY name`, [
    workspace,
  ]);
  return raw.map((r) => ({
    id: Number(r.id),
    name: r.name,
    className: r.class_name as ClassName,
    criticality: r.criticality,
    businessCritical: r.business_critical,
    ownerDepartment: r.owner_department,
    status: r.status as ConfigurationItem['status'],
    attributes: r.attributes ?? {},
    usedByDepartments: r.used_by_departments ?? [],
    usedByPeople: r.used_by_people ?? [],
  }));
}

export async function loadRelationships(workspace: Workspace): Promise<Relationship[]> {
  const raw = await query<{ source: string; rel_type: string; target: string }>(
    `SELECT source, rel_type, target FROM ci_relationship WHERE workspace = $1 ORDER BY id`,
    [workspace],
  );
  return raw.map((r) => ({ source: r.source, type: r.rel_type as RelationshipType, target: r.target }));
}

export async function loadMaintenance(workspace: Workspace): Promise<MaintenanceWindow[]> {
  const raw = await query<{ ci: string; start_at: Date; end_at: Date }>(
    `SELECT ci, start_at, end_at FROM maintenance_window WHERE workspace = $1 ORDER BY id`,
    [workspace],
  );
  return raw.map((r) => ({ ci: r.ci, start: r.start_at.getTime(), end: r.end_at.getTime() }));
}

export async function buildServiceMap(workspace: Workspace, at: number): Promise<ServiceMap> {
  const [cis, relationships, maintenance] = await Promise.all([
    loadCis(workspace),
    loadRelationships(workspace),
    loadMaintenance(workspace),
  ]);
  return new ServiceMap(cis, relationships, maintenance, at);
}

export async function loadAccessRules(workspace: Workspace): Promise<AccessRule[]> {
  const raw = await query<{
    name: string;
    rule_type: string;
    table_name: string;
    field: string | null;
    operation: string;
    roles: RoleKey[];
    condition_expr: string | null;
    active: boolean;
  }>(`SELECT * FROM access_rule WHERE workspace = $1 ORDER BY name`, [workspace]);
  return raw.map((r) => ({
    name: r.name,
    type: r.rule_type as AccessRule['type'],
    table: r.table_name,
    field: r.field,
    operation: r.operation as AccessRule['operation'],
    roles: r.roles ?? [],
    condition: r.condition_expr,
    active: r.active,
  }));
}

export async function loadAssignmentRules(workspace: Workspace): Promise<AssignmentRule[]> {
  const raw = await query<{
    name: string;
    run_order: number;
    table_name: string;
    condition_expr: string;
    group_name: string;
    active: boolean;
  }>(`SELECT * FROM assignment_rule WHERE workspace = $1 ORDER BY run_order, name`, [workspace]);
  return raw.map((r) => ({
    name: r.name,
    order: r.run_order,
    table: r.table_name,
    condition: r.condition_expr,
    group: r.group_name,
    active: r.active,
  }));
}

export type RuleTiming = 'before' | 'after' | 'background';

export interface BusinessRuleRow {
  readonly name: string;
  readonly table: string;
  readonly when: RuleTiming;
  readonly order: number;
  readonly operations: readonly string[];
  readonly condition: string;
  readonly actions: readonly Record<string, unknown>[];
  readonly active: boolean;
}

export async function loadBusinessRules(workspace: Workspace): Promise<BusinessRuleRow[]> {
  const raw = await query<{
    name: string;
    table_name: string;
    when_run: string;
    run_order: number;
    operations: string[];
    condition_expr: string;
    actions: Record<string, unknown>[];
    active: boolean;
  }>(`SELECT * FROM business_rule WHERE workspace = $1 ORDER BY run_order, name`, [workspace]);
  return raw.map((r) => ({
    name: r.name,
    table: r.table_name,
    when: r.when_run as RuleTiming,
    order: r.run_order,
    operations: r.operations ?? [],
    condition: r.condition_expr,
    actions: r.actions ?? [],
    active: r.active,
  }));
}

export interface FormPolicyAction {
  readonly field: string;
  readonly mandatory: boolean | null;
  readonly visible: boolean | null;
  readonly read_only: boolean | null;
}

export interface FormPolicyRow {
  readonly name: string;
  readonly table: string | null;
  readonly catalogItem: string | null;
  readonly order: number;
  readonly condition: string;
  readonly actions: readonly FormPolicyAction[];
}

export async function loadFormPolicies(workspace: Workspace): Promise<FormPolicyRow[]> {
  const raw = await query<{
    name: string;
    table_name: string | null;
    catalog_item: string | null;
    run_order: number;
    condition_expr: string;
    actions: FormPolicyAction[];
  }>(`SELECT * FROM form_policy WHERE workspace = $1 ORDER BY run_order, name`, [workspace]);
  return raw.map((r) => ({
    name: r.name,
    table: r.table_name,
    catalogItem: r.catalog_item,
    order: r.run_order,
    condition: r.condition_expr,
    actions: r.actions ?? [],
  }));
}

export interface CatalogVariable {
  readonly name: string;
  readonly label: string;
  readonly type: 'text' | 'multiline' | 'select' | 'checkbox' | 'date' | 'number' | 'reference';
  readonly required: boolean;
  readonly default: unknown;
  readonly choices: readonly {
    readonly value: string;
    readonly label: string;
    readonly when: { readonly variable: string; readonly equals: unknown } | null;
  }[];
}

export interface CatalogItemRow {
  readonly id: string;
  readonly name: string;
  readonly variables: readonly CatalogVariable[];
  readonly workflow: string | null;
}

export async function loadCatalogItems(workspace: Workspace): Promise<CatalogItemRow[]> {
  const raw = await query<{ id: string; name: string; variables: CatalogVariable[]; workflow: string | null }>(
    `SELECT * FROM catalog_item WHERE workspace = $1 ORDER BY name`,
    [workspace],
  );
  return raw.map((r) => ({ id: r.id, name: r.name, variables: r.variables ?? [], workflow: r.workflow }));
}

export interface OrderGuideRow {
  readonly id: string;
  readonly name: string;
  readonly questions: readonly CatalogVariable[];
  readonly rules: readonly { readonly item: string; readonly condition: string }[];
}

export async function loadGuides(workspace: Workspace): Promise<OrderGuideRow[]> {
  const raw = await query<{
    id: string;
    name: string;
    questions: CatalogVariable[];
    rules: { item: string; condition: string }[];
  }>(`SELECT * FROM order_guide WHERE workspace = $1 ORDER BY name`, [workspace]);
  return raw.map((r) => ({
    id: r.id,
    name: r.name,
    questions: r.questions ?? [],
    rules: r.rules ?? [],
  }));
}

export interface BoardRow {
  readonly name: string;
  readonly rule: QuorumRule;
  readonly n: number | null;
  readonly thresholdPercent: number | null;
  readonly windowHours: number;
  readonly members: readonly { readonly username: string; readonly weight: number }[];
}

export async function loadBoards(workspace: Workspace): Promise<BoardRow[]> {
  const raw = await query<{
    name: string;
    rule: string;
    n: number | null;
    threshold_percent: number | null;
    window_hours: number;
    members: { username: string; weight: number }[];
  }>(`SELECT * FROM board WHERE workspace = $1 ORDER BY name`, [workspace]);
  return raw.map((r) => ({
    name: r.name,
    rule: r.rule as QuorumRule,
    n: r.n,
    thresholdPercent: r.threshold_percent,
    windowHours: r.window_hours,
    members: r.members ?? [],
  }));
}

export type FreezeScope = 'all' | { readonly items: readonly string[] };

export interface FreezeWindowRow {
  readonly name: string;
  readonly start: number;
  readonly end: number;
  readonly timeZone: string;
  readonly scope: FreezeScope;
}

export async function loadFreezeWindows(): Promise<FreezeWindowRow[]> {
  const raw = await query<{
    name: string;
    start_at: Date;
    end_at: Date;
    time_zone: string;
    scope: FreezeScope;
  }>(`SELECT * FROM freeze_window ORDER BY name`);
  return raw.map((r) => ({
    name: r.name,
    start: r.start_at.getTime(),
    end: r.end_at.getTime(),
    timeZone: r.time_zone,
    scope: r.scope,
  }));
}

export async function loadRotations(): Promise<Rotation[]> {
  const raw = await query<{
    name: string;
    time_zone: string;
    handover_weekday: string;
    handover_time: string;
    members: string[];
    anchor_date: string;
  }>(`SELECT * FROM rotation ORDER BY name`);
  return raw.map((r) => ({
    name: r.name,
    timeZone: r.time_zone,
    handoverWeekday: r.handover_weekday,
    handoverTime: r.handover_time,
    members: r.members ?? [],
    anchorDate: r.anchor_date,
  }));
}

export async function loadOverrides(): Promise<RotationOverride[]> {
  const raw = await query<{
    id: string;
    rotation: string;
    username: string;
    start_at: Date;
    end_at: Date;
  }>(`SELECT * FROM rotation_override ORDER BY id`);
  return raw.map((r) => ({
    id: Number(r.id),
    rotation: r.rotation,
    username: r.username,
    start: r.start_at.getTime(),
    end: r.end_at.getTime(),
  }));
}

export async function loadEscalationPolicies(): Promise<EscalationPolicy[]> {
  const raw = await query<{ name: string; levels: EscalationPolicy['levels'] }>(
    `SELECT * FROM escalation_policy ORDER BY name`,
  );
  return raw.map((r) => ({ name: r.name, levels: r.levels ?? [] }));
}

export async function loadArticles(): Promise<Article[]> {
  const raw = await query<{
    number: string;
    version: number;
    title: string;
    body: string;
    keywords: string[];
    state: string;
    valid_until: string | null;
    helpful_yes: number;
    helpful_no: number;
    audience: { roles?: string[]; departments?: string[] };
    published_at: Date | null;
  }>(`SELECT * FROM knowledge_article ORDER BY number, version`);
  return raw.map((r) => ({
    number: r.number,
    version: r.version,
    title: r.title,
    body: r.body,
    keywords: r.keywords ?? [],
    state: r.state as Article['state'],
    validUntil: r.valid_until,
    helpfulYes: r.helpful_yes,
    helpfulNo: r.helpful_no,
    audienceRoles: r.audience?.roles ?? [],
    audienceDepartments: r.audience?.departments ?? [],
    publishedAt: r.published_at ? r.published_at.getTime() : null,
  }));
}

export async function loadInboxRules(workspace: Workspace): Promise<InboxRule[]> {
  const raw = await query<{ event: string; roles: RoleKey[]; enabled: boolean }>(
    `SELECT event, roles, enabled FROM inbox_rule WHERE workspace = $1 ORDER BY id`,
    [workspace],
  );
  return raw.map((r) => ({ event: r.event, roles: r.roles ?? [], enabled: r.enabled }));
}

export interface SavedFilterRow {
  readonly id: number;
  readonly name: string;
  readonly table: TableName;
  readonly filter: string;
  readonly shared: boolean;
  readonly owner: string | null;
  readonly order: number;
}

export async function loadSavedFilters(): Promise<SavedFilterRow[]> {
  const raw = await query<{
    id: string;
    name: string;
    table_name: string;
    filter_text: string;
    shared: boolean;
    owner: string | null;
    queue_order: number;
  }>(`SELECT * FROM saved_filter ORDER BY queue_order, id`);
  return raw.map((r) => ({
    id: Number(r.id),
    name: r.name,
    table: r.table_name as TableName,
    filter: r.filter_text,
    shared: r.shared,
    owner: r.owner,
    order: r.queue_order,
  }));
}

/** Members of each department, for impact people counting and manager rows. */
export async function departmentMembers(): Promise<Map<string, string[]>> {
  const people = await loadPeople();
  const map = new Map<string, string[]>();
  for (const person of people) {
    if (!person.department) continue;
    const list = map.get(person.department);
    if (list) list.push(person.username);
    else map.set(person.department, [person.username]);
  }
  return map;
}

export async function recordExists(number: string): Promise<boolean> {
  const rows = await query<{ n: string }>(`SELECT number AS n FROM record WHERE number = $1`, [number]);
  return rows.length > 0;
}

export async function insertActivity(
  client: PoolClient,
  number: string,
  at: Date,
  kind: string,
  text: string,
  actor: string | null,
  actingFor: string | null = null,
): Promise<void> {
  await client.query(
    `INSERT INTO record_activity (number, at, actor, acting_for, kind, text)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [number, at, actor, actingFor, kind, text],
  );
}

export async function insertAudit(
  client: PoolClient,
  number: string,
  at: Date,
  field: string,
  before: unknown,
  after: unknown,
  actor: string | null,
  actingFor: string | null,
  reason: string | null,
): Promise<void> {
  await client.query(
    `INSERT INTO record_audit (number, at, actor, acting_for, field, before_value, after_value, reason)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)`,
    [number, at, actor, actingFor, field, JSON.stringify(before ?? null), JSON.stringify(after ?? null), reason],
  );
}
