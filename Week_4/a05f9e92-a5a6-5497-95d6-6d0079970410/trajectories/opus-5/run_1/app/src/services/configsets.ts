/**
 * Configuration sets: capture in the test workspace, export to storage, preview
 * against live with collisions, commit with per-item choices, and back out
 * exactly.
 */

import { randomUUID } from 'node:crypto';

import { iso, now } from '../clock';
import { nextNumber, query, transaction, type PoolClient } from '../db';
import { ApiError, conflict, notFound, validation } from '../errors';
import { objectKeys } from './storage';

export const capturedKinds = [
  'catalog_item',
  'workflow',
  'business_rule',
  'access_rule',
  'form_policy',
  'sla_definition',
  'schedule',
  'assignment_rule',
  'inbox_rule',
] as const;

export type CapturedKind = (typeof capturedKinds)[number];

export type SetState = 'open' | 'exported' | 'committed' | 'backed_out';

export interface SetItem {
  readonly kind: CapturedKind;
  readonly name: string;
  readonly deleted: boolean;
  readonly content: Record<string, unknown> | null;
}

export interface ConfigSetRow {
  readonly id: string;
  readonly number: string;
  readonly name: string;
  readonly state: SetState;
  readonly items: readonly SetItem[];
  readonly objectKey: string | null;
  readonly snapshots: readonly SetItem[] | null;
  readonly applied: readonly string[] | null;
}

interface RawSet {
  id: string;
  number: string;
  name: string;
  state: string;
  items: SetItem[];
  object_key: string | null;
  snapshots: SetItem[] | null;
  applied: string[] | null;
}

function toSet(raw: RawSet): ConfigSetRow {
  return {
    id: raw.id,
    number: raw.number,
    name: raw.name,
    state: raw.state as SetState,
    items: raw.items ?? [],
    objectKey: raw.object_key,
    snapshots: raw.snapshots,
    applied: raw.applied,
  };
}

export async function loadSets(): Promise<ConfigSetRow[]> {
  const rows = await query<RawSet>(`SELECT * FROM config_set ORDER BY created_at DESC, number DESC`);
  return rows.map(toSet);
}

export async function loadSet(id: string): Promise<ConfigSetRow | null> {
  const rows = await query<RawSet>(`SELECT * FROM config_set WHERE id = $1`, [id]);
  return rows[0] ? toSet(rows[0]) : null;
}

export async function openSet(): Promise<ConfigSetRow | null> {
  const rows = await query<RawSet>(`SELECT * FROM config_set WHERE state = 'open' LIMIT 1`);
  return rows[0] ? toSet(rows[0]) : null;
}

export async function createSet(name: string): Promise<ConfigSetRow> {
  if (await openSet()) throw conflict('set_already_open', 'A set is already open.');
  const id = randomUUID();
  const number = await transaction((client) => nextNumber(client, 'SET-'));
  await query(
    `INSERT INTO config_set (id, number, name, state, items, created_at)
     VALUES ($1, $2, $3, 'open', '[]'::jsonb, $4)`,
    [id, number, name, now()],
  );
  const set = await loadSet(id);
  if (!set) throw notFound();
  return set;
}

/**
 * While a set is open, every change to a captured kind in the test workspace
 * records that item's latest content, keyed by kind and name.
 */
export async function recordChange(
  workspace: string,
  kind: CapturedKind,
  name: string,
  content: Record<string, unknown> | null,
  deleted = false,
): Promise<void> {
  if (workspace !== 'test') return;
  const set = await openSet();
  if (!set) return;
  const items = set.items.filter((item) => !(item.kind === kind && item.name === name));
  items.push({ kind, name, deleted, content });
  await query(`UPDATE config_set SET items = $2::jsonb WHERE id = $1`, [set.id, JSON.stringify(items)]);
}

/** The live content of one captured item, for comparison and snapshots. */
export async function liveContent(
  kind: CapturedKind,
  name: string,
): Promise<Record<string, unknown> | null> {
  switch (kind) {
    case 'business_rule': {
      const rows = await query<Record<string, unknown>>(
        `SELECT name, table_name, when_run, run_order, operations, condition_expr, actions, active
         FROM business_rule WHERE workspace = 'live' AND name = $1`,
        [name],
      );
      return rows[0] ? normaliseRule(rows[0]) : null;
    }
    case 'access_rule': {
      const rows = await query<Record<string, unknown>>(
        `SELECT name, rule_type, table_name, field, operation, roles, condition_expr, active
         FROM access_rule WHERE workspace = 'live' AND name = $1`,
        [name],
      );
      return rows[0] ? normaliseAccess(rows[0]) : null;
    }
    case 'assignment_rule': {
      const rows = await query<Record<string, unknown>>(
        `SELECT name, run_order, table_name, condition_expr, group_name, active
         FROM assignment_rule WHERE workspace = 'live' AND name = $1`,
        [name],
      );
      return rows[0]
        ? {
            name: rows[0].name,
            order: rows[0].run_order,
            table: rows[0].table_name,
            condition: rows[0].condition_expr,
            group: rows[0].group_name,
            active: rows[0].active,
          }
        : null;
    }
    case 'form_policy': {
      const rows = await query<Record<string, unknown>>(
        `SELECT name, table_name, catalog_item, run_order, condition_expr, actions
         FROM form_policy WHERE workspace = 'live' AND name = $1`,
        [name],
      );
      return rows[0]
        ? {
            name: rows[0].name,
            table: rows[0].table_name,
            catalog_item: rows[0].catalog_item,
            order: rows[0].run_order,
            condition: rows[0].condition_expr,
            actions: rows[0].actions,
          }
        : null;
    }
    case 'sla_definition': {
      const rows = await query<Record<string, unknown>>(
        `SELECT name, table_name, start_expr, pause_expr, stop_expr, schedule, targets
         FROM sla_definition WHERE workspace = 'live' AND name = $1`,
        [name],
      );
      return rows[0]
        ? {
            name: rows[0].name,
            table: rows[0].table_name,
            start: rows[0].start_expr,
            pause: rows[0].pause_expr,
            stop: rows[0].stop_expr,
            schedule: rows[0].schedule,
            targets: rows[0].targets,
          }
        : null;
    }
    case 'schedule': {
      const rows = await query<Record<string, unknown>>(
        `SELECT name, time_zone, hours, holidays FROM business_schedule
         WHERE workspace = 'live' AND name = $1`,
        [name],
      );
      return rows[0]
        ? {
            name: rows[0].name,
            time_zone: rows[0].time_zone,
            hours: rows[0].hours,
            holidays: rows[0].holidays,
          }
        : null;
    }
    case 'catalog_item': {
      const rows = await query<Record<string, unknown>>(
        `SELECT id, name, variables, workflow FROM catalog_item WHERE workspace = 'live' AND id = $1`,
        [name],
      );
      return rows[0] ?? null;
    }
    case 'workflow': {
      const rows = await query<Record<string, unknown>>(
        `SELECT id, name, kind, inputs, outputs, draft FROM workflow WHERE workspace = 'live' AND id = $1`,
        [name],
      );
      if (!rows[0]) return null;
      const versions = await query<{ version: number; steps: unknown }>(
        `SELECT version, steps FROM workflow_version
         WHERE workspace = 'live' AND workflow_id = $1 AND NOT withdrawn ORDER BY version DESC LIMIT 1`,
        [name],
      );
      return {
        name: rows[0].name,
        kind: rows[0].kind,
        inputs: rows[0].inputs,
        outputs: rows[0].outputs,
        draft: rows[0].draft,
        published: versions[0] ? { version: versions[0].version, steps: versions[0].steps } : null,
      };
    }
    case 'inbox_rule': {
      const rows = await query<{ event: string; roles: unknown; enabled: boolean }>(
        `SELECT event, roles, enabled FROM inbox_rule WHERE workspace = 'live' ORDER BY id`,
      );
      return { rules: rows };
    }
  }
}

function normaliseRule(row: Record<string, unknown>): Record<string, unknown> {
  return {
    name: row.name,
    table: row.table_name,
    when: row.when_run,
    order: row.run_order,
    operations: row.operations,
    condition: row.condition_expr,
    actions: row.actions,
    active: row.active,
  };
}

function normaliseAccess(row: Record<string, unknown>): Record<string, unknown> {
  return {
    name: row.name,
    type: row.rule_type,
    table: row.table_name,
    field: row.field,
    operation: row.operation,
    roles: row.roles,
    condition: row.condition_expr,
    active: row.active,
  };
}

export type PreviewAction = 'create' | 'update' | 'unchanged' | 'collision' | 'delete';

export interface PreviewItem {
  readonly kind: CapturedKind;
  readonly name: string;
  readonly action: PreviewAction;
}

function sameContent(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** The content live held when it was last promoted or seeded. */
async function originContent(kind: CapturedKind, name: string): Promise<Record<string, unknown> | null> {
  const rows = await query<{ content: Record<string, unknown> | null }>(
    `SELECT content FROM config_item_origin WHERE kind = $1 AND name = $2`,
    [kind, name],
  );
  return rows[0]?.content ?? null;
}

export async function previewSet(set: ConfigSetRow): Promise<PreviewItem[]> {
  const out: PreviewItem[] = [];
  for (const item of set.items) {
    const live = await liveContent(item.kind, item.name);
    if (item.deleted) {
      out.push({ kind: item.kind, name: item.name, action: live === null ? 'unchanged' : 'delete' });
      continue;
    }
    if (live === null) {
      out.push({ kind: item.kind, name: item.name, action: 'create' });
      continue;
    }
    if (sameContent(live, item.content)) {
      out.push({ kind: item.kind, name: item.name, action: 'unchanged' });
      continue;
    }
    const origin = await originContent(item.kind, item.name);
    const liveUntouched = origin === null || sameContent(origin, live);
    out.push({ kind: item.kind, name: item.name, action: liveUntouched ? 'update' : 'collision' });
  }
  return out;
}

export function setFileJson(set: ConfigSetRow): string {
  return JSON.stringify({
    format: 'switchyard-config-set',
    version: 1,
    number: set.number,
    name: set.name,
    exported_at: iso(now()),
    items: set.items.map((item) => ({
      kind: item.kind,
      name: item.name,
      deleted: item.deleted,
      content: item.content,
    })),
  });
}

export function setJson(set: ConfigSetRow): Record<string, unknown> {
  return {
    id: set.id,
    number: set.number,
    name: set.name,
    state: set.state,
    items: set.items.map((item) => ({ kind: item.kind, name: item.name, deleted: item.deleted })),
    key: set.objectKey,
  };
}

export type Choice = 'take_set' | 'keep_live';

/** Applies one item's content to live, inside the caller's transaction. */
async function applyItem(client: PoolClient, item: SetItem): Promise<void> {
  const content = item.content ?? {};
  if (item.deleted) {
    await deleteLive(client, item.kind, item.name);
    return;
  }
  switch (item.kind) {
    case 'business_rule':
      await client.query(
        `INSERT INTO business_rule (name, table_name, when_run, run_order, operations, condition_expr,
                                    actions, active, workspace)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8, 'live')
         ON CONFLICT (workspace, name) DO UPDATE SET table_name = $2, when_run = $3, run_order = $4,
           operations = $5::jsonb, condition_expr = $6, actions = $7::jsonb, active = $8`,
        [
          item.name,
          content.table,
          content.when,
          Number(content.order ?? 100),
          JSON.stringify(content.operations ?? []),
          String(content.condition ?? 'true'),
          JSON.stringify(content.actions ?? []),
          content.active !== false,
        ],
      );
      return;
    case 'access_rule':
      await client.query(
        `INSERT INTO access_rule (name, rule_type, table_name, field, operation, roles, condition_expr,
                                  active, workspace)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, 'live')
         ON CONFLICT (workspace, name) DO UPDATE SET rule_type = $2, table_name = $3, field = $4,
           operation = $5, roles = $6::jsonb, condition_expr = $7, active = $8`,
        [
          item.name,
          content.type,
          content.table,
          content.field ?? null,
          content.operation,
          JSON.stringify(content.roles ?? []),
          content.condition ?? null,
          content.active !== false,
        ],
      );
      return;
    case 'assignment_rule':
      await client.query(
        `INSERT INTO assignment_rule (name, run_order, table_name, condition_expr, group_name, active, workspace)
         VALUES ($1, $2, $3, $4, $5, $6, 'live')
         ON CONFLICT (workspace, name) DO UPDATE SET run_order = $2, table_name = $3,
           condition_expr = $4, group_name = $5, active = $6`,
        [
          item.name,
          Number(content.order ?? 100),
          content.table,
          String(content.condition ?? 'true'),
          content.group,
          content.active !== false,
        ],
      );
      return;
    case 'form_policy':
      await client.query(
        `INSERT INTO form_policy (name, table_name, catalog_item, run_order, condition_expr, actions, workspace)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'live')
         ON CONFLICT (workspace, name) DO UPDATE SET table_name = $2, catalog_item = $3,
           run_order = $4, condition_expr = $5, actions = $6::jsonb`,
        [
          item.name,
          content.table ?? null,
          content.catalog_item ?? null,
          Number(content.order ?? 100),
          String(content.condition ?? 'true'),
          JSON.stringify(content.actions ?? []),
        ],
      );
      return;
    case 'sla_definition':
      await client.query(
        `INSERT INTO sla_definition (name, table_name, start_expr, pause_expr, stop_expr, schedule,
                                     targets, workspace)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'live')
         ON CONFLICT (workspace, name) DO UPDATE SET table_name = $2, start_expr = $3, pause_expr = $4,
           stop_expr = $5, schedule = $6, targets = $7::jsonb`,
        [
          item.name,
          content.table,
          content.start,
          content.pause,
          content.stop,
          content.schedule,
          JSON.stringify(content.targets ?? {}),
        ],
      );
      return;
    case 'schedule':
      await client.query(
        `INSERT INTO business_schedule (name, time_zone, hours, holidays, workspace)
         VALUES ($1, $2, $3::jsonb, $4::jsonb, 'live')
         ON CONFLICT (name) DO UPDATE SET time_zone = $2, hours = $3::jsonb, holidays = $4::jsonb`,
        [
          item.name,
          content.time_zone,
          JSON.stringify(content.hours ?? {}),
          JSON.stringify(content.holidays ?? []),
        ],
      );
      return;
    case 'catalog_item':
      await client.query(
        `INSERT INTO catalog_item (id, name, variables, workflow, workspace)
         VALUES ($1, $2, $3::jsonb, $4, 'live')
         ON CONFLICT (workspace, id) DO UPDATE SET name = $2, variables = $3::jsonb, workflow = $4`,
        [item.name, content.name, JSON.stringify(content.variables ?? []), content.workflow ?? null],
      );
      return;
    case 'workflow': {
      await client.query(
        `INSERT INTO workflow (id, name, kind, inputs, outputs, draft, workspace)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, 'live')
         ON CONFLICT (workspace, id) DO UPDATE SET name = $2, kind = $3, inputs = $4::jsonb,
           outputs = $5::jsonb, draft = $6::jsonb`,
        [
          item.name,
          content.name ?? item.name,
          content.kind ?? 'flow',
          JSON.stringify(content.inputs ?? []),
          JSON.stringify(content.outputs ?? []),
          JSON.stringify(content.draft ?? []),
        ],
      );
      const published = content.published as { version: number; steps: unknown } | null | undefined;
      if (published) {
        const latest = await client.query<{ version: number; steps: unknown }>(
          `SELECT version, steps FROM workflow_version WHERE workspace = 'live' AND workflow_id = $1
             AND NOT withdrawn ORDER BY version DESC LIMIT 1`,
          [item.name],
        );
        if (!latest.rows[0] || !sameContent(latest.rows[0].steps, published.steps)) {
          const next = (latest.rows[0]?.version ?? 0) + 1;
          await client.query(
            `INSERT INTO workflow_version (workflow_id, version, steps, created_at, workspace)
             VALUES ($1, $2, $3::jsonb, $4, 'live')`,
            [item.name, next, JSON.stringify(published.steps), now()],
          );
        }
      }
      return;
    }
    case 'inbox_rule': {
      await client.query(`DELETE FROM inbox_rule WHERE workspace = 'live'`);
      for (const rule of (content.rules as Record<string, unknown>[]) ?? []) {
        await client.query(
          `INSERT INTO inbox_rule (event, roles, enabled, workspace) VALUES ($1, $2::jsonb, $3, 'live')`,
          [rule.event, JSON.stringify(rule.roles ?? []), rule.enabled !== false],
        );
      }
      return;
    }
  }
}

async function deleteLive(client: PoolClient, kind: CapturedKind, name: string): Promise<void> {
  const tables: Readonly<Record<CapturedKind, string | null>> = {
    business_rule: 'business_rule',
    access_rule: 'access_rule',
    assignment_rule: 'assignment_rule',
    form_policy: 'form_policy',
    sla_definition: 'sla_definition',
    schedule: 'business_schedule',
    catalog_item: 'catalog_item',
    workflow: 'workflow',
    inbox_rule: null,
  };
  const table = tables[kind];
  if (table === null) return;
  const column = kind === 'catalog_item' || kind === 'workflow' ? 'id' : 'name';
  await client.query(`DELETE FROM ${table} WHERE workspace = 'live' AND ${column} = $1`, [name]);
}

export interface CommitOutcome {
  readonly applied: number;
  readonly set: ConfigSetRow;
}

/** Workflows are applied before catalog items, so an item's flow exists first. */
function commitOrder(a: SetItem, b: SetItem): number {
  const rank = (kind: CapturedKind): number => (kind === 'workflow' ? 0 : kind === 'catalog_item' ? 1 : 2);
  return rank(a.kind) - rank(b.kind);
}

export async function commitSet(
  set: ConfigSetRow,
  choices: Readonly<Record<string, Choice>>,
): Promise<CommitOutcome> {
  if (set.state !== 'exported') throw conflict('not_exported', 'Export the set before committing it.');
  const preview = await previewSet(set);
  for (const item of preview) {
    if (item.action !== 'collision') continue;
    if (!choices[`${item.kind}:${item.name}`]) {
      throw new ApiError(422, 'choice_required', `Choose Take set or Keep live for ${item.name}.`);
    }
  }

  const snapshots: SetItem[] = [];
  const appliedNames: string[] = [];
  const toApply = [...set.items].sort(commitOrder);

  await transaction(async (client) => {
    for (const item of toApply) {
      const found = preview.find((p) => p.kind === item.kind && p.name === item.name);
      if (!found) continue;
      if (found.action === 'unchanged') continue;
      if (found.action === 'collision' && choices[`${item.kind}:${item.name}`] === 'keep_live') continue;
      const before = await liveContent(item.kind, item.name);
      snapshots.push({ kind: item.kind, name: item.name, deleted: before === null, content: before });
      await applyItem(client, item);
      await client.query(
        `INSERT INTO config_item_origin (kind, name, content) VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (kind, name) DO UPDATE SET content = $3::jsonb`,
        [item.kind, item.name, JSON.stringify(item.content)],
      );
      appliedNames.push(`${item.kind}:${item.name}`);
    }
    await client.query(
      `UPDATE config_set SET state = 'committed', snapshots = $2::jsonb, applied = $3::jsonb,
              committed_at = $4 WHERE id = $1`,
      [set.id, JSON.stringify(snapshots), JSON.stringify(appliedNames), now()],
    );
  });

  const after = await loadSet(set.id);
  if (!after) throw notFound();
  return { applied: appliedNames.length, set: after };
}

/** Back-out restores the snapshots exactly, deleting what the commit created. */
export async function backOutSet(set: ConfigSetRow): Promise<ConfigSetRow> {
  if (set.state !== 'committed') throw conflict('not_committed', 'Only a committed set can be backed out.');
  const later = await query<{ applied: string[]; number: string }>(
    `SELECT applied, number FROM config_set
     WHERE state = 'committed' AND committed_at > (SELECT committed_at FROM config_set WHERE id = $1)`,
    [set.id],
  );
  const mine = new Set(set.applied ?? []);
  for (const row of later) {
    for (const key of row.applied ?? []) {
      if (mine.has(key)) {
        throw conflict('later_set', `A later set changed ${key.split(':')[1]}; back that out first.`);
      }
    }
  }

  await transaction(async (client) => {
    for (const snapshot of set.snapshots ?? []) {
      if (snapshot.content === null) {
        await deleteLive(client, snapshot.kind, snapshot.name);
        await client.query(`DELETE FROM config_item_origin WHERE kind = $1 AND name = $2`, [
          snapshot.kind,
          snapshot.name,
        ]);
        continue;
      }
      await applyItem(client, { ...snapshot, deleted: false });
      await client.query(
        `INSERT INTO config_item_origin (kind, name, content) VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (kind, name) DO UPDATE SET content = $3::jsonb`,
        [snapshot.kind, snapshot.name, JSON.stringify(snapshot.content)],
      );
    }
    // A version this commit published is withdrawn; its number is never reused.
    for (const item of set.items) {
      if (item.kind !== 'workflow') continue;
      const published = (item.content?.published ?? null) as { version: number } | null;
      if (!published) continue;
      await client.query(
        `UPDATE workflow_version SET withdrawn = TRUE
         WHERE workspace = 'live' AND workflow_id = $1 AND steps = $2::jsonb AND NOT withdrawn`,
        [item.name, JSON.stringify((item.content?.published as { steps: unknown }).steps)],
      );
    }
    await client.query(`UPDATE config_set SET state = 'backed_out' WHERE id = $1`, [set.id]);
  });

  const after = await loadSet(set.id);
  if (!after) throw notFound();
  return after;
}

export async function markExported(id: string, key: string): Promise<ConfigSetRow> {
  await query(`UPDATE config_set SET state = 'exported', object_key = $2, exported_at = $3 WHERE id = $1`, [
    id,
    key,
    now(),
  ]);
  const set = await loadSet(id);
  if (!set) throw notFound();
  return set;
}

export async function setFromFile(text: string): Promise<ConfigSetRow> {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw validation('That is not a configuration set file.');
  }
  if (parsed.format !== 'switchyard-config-set') {
    throw validation('That is not a configuration set file.');
  }
  const id = randomUUID();
  const number = String(parsed.number ?? (await transaction((client) => nextNumber(client, 'SET-'))));
  await query(
    `INSERT INTO config_set (id, number, name, state, items, object_key, exported_at, created_at)
     VALUES ($1, $2, $3, 'exported', $4::jsonb, $5, $6, $6)`,
    [
      id,
      number,
      String(parsed.name ?? number),
      JSON.stringify(parsed.items ?? []),
      objectKeys.configSet(number),
      now(),
    ],
  );
  const set = await loadSet(id);
  if (!set) throw notFound();
  return set;
}
