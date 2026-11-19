/**
 * Grading fixtures. The whole fixture is one transaction: a validation error
 * answers 422 and creates nothing.
 */

import { iso, now, nowMs } from '../clock';
import { nextNumber, transaction, type PoolClient } from '../db';
import { validation } from '../errors';
import { tableNames } from '../domain/fields';
import { isRoleKey } from '../domain/roles';
import { hashPassword, newSalt } from '../seed';
import { buildSteps, loadSteps, openStep } from './changes';
import { Engine } from './engine';
import { numberPrefixes } from './recordops';
import { attachSlas, reviewSlas } from './slaservice';
import type { Workspace } from './store';

type Bag = Record<string, unknown>;

function list(body: Bag, key: string): Bag[] {
  const value = body[key];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw validation(`${key} must be a list.`);
  return value as Bag[];
}

function text(value: unknown, fallback = ''): string {
  return value === undefined || value === null ? fallback : String(value);
}

function workspaceOf(item: Bag): Workspace {
  return item.workspace === 'test' ? 'test' : 'live';
}

export interface CreatedSummary {
  readonly [kind: string]: { id?: string | number; name?: string; number?: string }[];
}

/** Lays down every kind in dependency order inside one transaction. */
export async function applyFixtures(body: Bag): Promise<CreatedSummary> {
  const out: Record<string, { id?: string | number; name?: string; number?: string }[]> = {};
  const add = (kind: string, entry: { id?: string | number; name?: string; number?: string }): void => {
    const bucket = out[kind] ?? [];
    bucket.push(entry);
    out[kind] = bucket;
  };

  await transaction(async (client) => {
    for (const item of list(body, 'departments')) {
      const name = text(item.name);
      await client.query(`INSERT INTO department (name) VALUES ($1) ON CONFLICT DO NOTHING`, [name]);
      add('departments', { name });
    }

    for (const item of list(body, 'people')) {
      const username = text(item.username);
      if (username === '') throw validation('A person needs a username.');
      await client.query(
        `INSERT INTO person (username, display_name, department, roles, time_zone, active, can_sign_in)
         VALUES ($1, $2, $3, '[]'::jsonb, 'Europe/Berlin', TRUE, FALSE)
         ON CONFLICT (username) DO UPDATE SET display_name = $2, department = $3`,
        [username, text(item.display_name, username), item.department ?? null],
      );
      add('people', { name: username });
    }

    for (const item of list(body, 'users')) {
      const username = text(item.username);
      if (username === '') throw validation('A user needs a username.');
      const roles = Array.isArray(item.roles) ? item.roles.map(String) : [];
      for (const role of roles) if (!isRoleKey(role)) throw validation(`"${role}" is not a role.`);
      await client.query(
        `INSERT INTO person (username, display_name, department, password_hash, roles, time_zone,
                             out_of_office, capacity, active, can_sign_in)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, TRUE)
         ON CONFLICT (username) DO UPDATE SET display_name = $2, department = $3, password_hash = $4,
           roles = $5::jsonb, time_zone = $6, out_of_office = $7, capacity = $8, active = $9,
           can_sign_in = TRUE`,
        [
          username,
          text(item.display_name, username),
          item.department ?? null,
          hashPassword(text(item.password, `${username}-yard-2026`), newSalt()),
          JSON.stringify(roles),
          text(item.time_zone, 'Europe/Berlin'),
          item.out_of_office === true,
          item.capacity === undefined || item.capacity === null ? null : Number(item.capacity),
          item.active !== false,
        ],
      );
      add('users', { name: username });
    }

    for (const item of list(body, 'groups')) {
      const name = text(item.name);
      await client.query(
        `INSERT INTO work_group (name, members, escalation_policy) VALUES ($1, $2::jsonb, $3)
         ON CONFLICT (name) DO UPDATE SET members = $2::jsonb, escalation_policy = $3`,
        [name, JSON.stringify(item.members ?? []), item.escalation_policy ?? null],
      );
      add('groups', { name });
    }

    for (const item of list(body, 'schedules')) {
      const name = text(item.name);
      await client.query(
        `INSERT INTO business_schedule (name, time_zone, hours, holidays, workspace)
         VALUES ($1, $2, $3::jsonb, $4::jsonb, $5)
         ON CONFLICT (name) DO UPDATE SET time_zone = $2, hours = $3::jsonb, holidays = $4::jsonb`,
        [
          name,
          text(item.time_zone, 'Europe/Berlin'),
          JSON.stringify(item.hours ?? {}),
          JSON.stringify(item.holidays ?? []),
          workspaceOf(item),
        ],
      );
      add('schedules', { name });
    }

    for (const item of list(body, 'sla_definitions')) {
      const name = text(item.name);
      await client.query(
        `INSERT INTO sla_definition (name, table_name, start_expr, pause_expr, stop_expr, schedule,
                                     targets, workspace)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
         ON CONFLICT (workspace, name) DO UPDATE SET table_name = $2, start_expr = $3, pause_expr = $4,
           stop_expr = $5, schedule = $6, targets = $7::jsonb`,
        [
          name,
          text(item.table, 'incident'),
          text(item.start, 'true'),
          text(item.pause, 'false'),
          text(item.stop, 'false'),
          text(item.schedule, 'Office hours'),
          JSON.stringify(item.targets ?? {}),
          workspaceOf(item),
        ],
      );
      add('sla_definitions', { name });
    }

    for (const item of list(body, 'cis')) {
      const name = text(item.name);
      if (name === '') throw validation('An item needs a name.');
      const base = ['name', 'class', 'criticality', 'business_critical', 'owner_department', 'status', 'used_by', 'workspace'];
      const attributes: Bag = {};
      for (const [key, value] of Object.entries(item)) {
        if (!base.includes(key)) attributes[key] = value;
      }
      const usedBy = (item.used_by ?? {}) as { departments?: string[]; people?: string[] };
      await client.query(
        `INSERT INTO configuration_item (name, class_name, criticality, business_critical,
                                         owner_department, status, attributes, used_by_departments,
                                         used_by_people, workspace)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10)
         ON CONFLICT (workspace, lower(name)) DO UPDATE SET class_name = $2, criticality = $3,
           business_critical = $4, owner_department = $5, status = $6, attributes = $7::jsonb,
           used_by_departments = $8::jsonb, used_by_people = $9::jsonb`,
        [
          name,
          text(item.class, 'Configuration item'),
          Number(item.criticality ?? 2),
          item.business_critical === true,
          item.owner_department ?? null,
          text(item.status, 'healthy'),
          JSON.stringify(attributes),
          JSON.stringify(usedBy.departments ?? []),
          JSON.stringify(usedBy.people ?? []),
          workspaceOf(item),
        ],
      );
      add('cis', { name });
    }

    for (const item of list(body, 'relationships')) {
      await client.query(
        `INSERT INTO ci_relationship (source, rel_type, target, workspace) VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [text(item.source), text(item.type), text(item.target), workspaceOf(item)],
      );
      add('relationships', { name: `${text(item.source)} ${text(item.type)} ${text(item.target)}` });
    }

    for (const item of list(body, 'maintenance')) {
      await client.query(
        `INSERT INTO maintenance_window (ci, start_at, end_at, workspace) VALUES ($1, $2, $3, $4)`,
        [text(item.ci), new Date(text(item.start)), new Date(text(item.end)), workspaceOf(item)],
      );
      add('maintenance', { name: text(item.ci) });
    }

    for (const item of list(body, 'rotations')) {
      const name = text(item.name);
      await client.query(
        `INSERT INTO rotation (name, time_zone, handover_weekday, handover_time, members, anchor_date)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)
         ON CONFLICT (name) DO UPDATE SET time_zone = $2, handover_weekday = $3, handover_time = $4,
           members = $5::jsonb, anchor_date = $6`,
        [
          name,
          text(item.time_zone, 'Europe/Berlin'),
          text(item.handover_weekday, 'monday'),
          text(item.handover_time, '09:00'),
          JSON.stringify(item.members ?? []),
          text(item.anchor_date),
        ],
      );
      add('rotations', { name });
    }

    for (const item of list(body, 'overrides')) {
      const row = await client.query<{ id: string }>(
        `INSERT INTO rotation_override (rotation, username, start_at, end_at)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [text(item.rotation), text(item.username), new Date(text(item.start)), new Date(text(item.end))],
      );
      add('overrides', { id: Number(row.rows[0].id) });
    }

    for (const item of list(body, 'escalation_policies')) {
      const name = text(item.name);
      await client.query(
        `INSERT INTO escalation_policy (name, levels) VALUES ($1, $2::jsonb)
         ON CONFLICT (name) DO UPDATE SET levels = $2::jsonb`,
        [name, JSON.stringify(item.levels ?? [])],
      );
      add('escalation_policies', { name });
    }

    for (const item of list(body, 'assignment_rules')) {
      const name = text(item.name);
      await client.query(
        `INSERT INTO assignment_rule (name, run_order, table_name, condition_expr, group_name, active, workspace)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (workspace, name) DO UPDATE SET run_order = $2, table_name = $3,
           condition_expr = $4, group_name = $5, active = $6`,
        [
          name,
          Number(item.order ?? 100),
          text(item.table, 'incident'),
          text(item.condition, 'true'),
          text(item.group),
          item.active !== false,
          workspaceOf(item),
        ],
      );
      add('assignment_rules', { name });
    }

    for (const item of list(body, 'business_rules')) {
      const name = text(item.name);
      await client.query(
        `INSERT INTO business_rule (name, table_name, when_run, run_order, operations, condition_expr,
                                    actions, active, workspace)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8, $9)
         ON CONFLICT (workspace, name) DO UPDATE SET table_name = $2, when_run = $3, run_order = $4,
           operations = $5::jsonb, condition_expr = $6, actions = $7::jsonb, active = $8`,
        [
          name,
          text(item.table, 'incident'),
          text(item.when, 'before'),
          Number(item.order ?? 100),
          JSON.stringify(item.operations ?? ['insert', 'update']),
          text(item.condition, 'true'),
          JSON.stringify(item.actions ?? []),
          item.active !== false,
          workspaceOf(item),
        ],
      );
      add('business_rules', { name });
    }

    for (const item of list(body, 'access_rules')) {
      const name = text(item.name);
      await client.query(
        `INSERT INTO access_rule (name, rule_type, table_name, field, operation, roles, condition_expr,
                                  active, workspace)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
         ON CONFLICT (workspace, name) DO UPDATE SET rule_type = $2, table_name = $3, field = $4,
           operation = $5, roles = $6::jsonb, condition_expr = $7, active = $8`,
        [
          name,
          text(item.type, 'row'),
          text(item.table, 'incident'),
          item.field ?? null,
          text(item.operation, 'read'),
          JSON.stringify(item.roles ?? []),
          item.condition ?? null,
          item.active !== false,
          workspaceOf(item),
        ],
      );
      add('access_rules', { name });
    }

    for (const item of list(body, 'form_policies')) {
      const name = text(item.name);
      await client.query(
        `INSERT INTO form_policy (name, table_name, catalog_item, run_order, condition_expr, actions, workspace)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
         ON CONFLICT (workspace, name) DO UPDATE SET table_name = $2, catalog_item = $3,
           run_order = $4, condition_expr = $5, actions = $6::jsonb`,
        [
          name,
          item.table ?? null,
          item.catalog_item ?? null,
          Number(item.order ?? 100),
          text(item.condition, 'true'),
          JSON.stringify(item.actions ?? []),
          workspaceOf(item),
        ],
      );
      add('form_policies', { name });
    }

    for (const item of list(body, 'catalog_items')) {
      const id = text(item.id);
      await client.query(
        `INSERT INTO catalog_item (id, name, variables, workflow, workspace)
         VALUES ($1, $2, $3::jsonb, $4, $5)
         ON CONFLICT (workspace, id) DO UPDATE SET name = $2, variables = $3::jsonb, workflow = $4`,
        [id, text(item.name, id), JSON.stringify(item.variables ?? []), item.workflow ?? null, workspaceOf(item)],
      );
      add('catalog_items', { id });
    }

    for (const item of list(body, 'guides')) {
      const id = text(item.id);
      await client.query(
        `INSERT INTO order_guide (id, name, questions, rules, workspace)
         VALUES ($1, $2, $3::jsonb, $4::jsonb, $5)
         ON CONFLICT (workspace, id) DO UPDATE SET name = $2, questions = $3::jsonb, rules = $4::jsonb`,
        [
          id,
          text(item.name, id),
          JSON.stringify(item.questions ?? []),
          JSON.stringify(item.rules ?? []),
          workspaceOf(item),
        ],
      );
      add('guides', { id });
    }

    for (const item of list(body, 'workflows')) {
      const name = text(item.name);
      const published = Array.isArray(item.published) ? (item.published as unknown[]) : [];
      const draft = item.draft === null || item.draft === undefined
        ? (published[published.length - 1] ?? [])
        : item.draft;
      await client.query(
        `INSERT INTO workflow (id, name, kind, inputs, outputs, draft, workspace)
         VALUES ($1, $1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6)
         ON CONFLICT (workspace, id) DO UPDATE SET kind = $2, inputs = $3::jsonb, outputs = $4::jsonb,
           draft = $5::jsonb`,
        [
          name,
          text(item.kind, 'flow'),
          JSON.stringify(item.inputs ?? []),
          JSON.stringify(item.outputs ?? []),
          JSON.stringify(draft),
          workspaceOf(item),
        ],
      );
      // Each published step list becomes versions 1, 2 and onward in list order.
      for (let index = 0; index < published.length; index += 1) {
        await client.query(
          `INSERT INTO workflow_version (workflow_id, version, steps, created_at, workspace)
           VALUES ($1, $2, $3::jsonb, $4, $5)
           ON CONFLICT (workspace, workflow_id, version) DO UPDATE SET steps = $3::jsonb`,
          [name, index + 1, JSON.stringify(published[index]), now(), workspaceOf(item)],
        );
      }
      add('workflows', { name });
    }

    for (const item of list(body, 'boards')) {
      const name = text(item.name);
      await client.query(
        `INSERT INTO board (name, rule, n, threshold_percent, window_hours, members, workspace)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
         ON CONFLICT (workspace, name) DO UPDATE SET rule = $2, n = $3, threshold_percent = $4,
           window_hours = $5, members = $6::jsonb`,
        [
          name,
          text(item.rule, 'any'),
          item.n === undefined || item.n === null ? null : Number(item.n),
          item.threshold_percent === undefined || item.threshold_percent === null
            ? null
            : Number(item.threshold_percent),
          Number(item.window_hours ?? 48),
          JSON.stringify(item.members ?? []),
          workspaceOf(item),
        ],
      );
      add('boards', { name });
    }

    for (const item of list(body, 'freeze_windows')) {
      const name = text(item.name);
      await client.query(
        `INSERT INTO freeze_window (name, start_at, end_at, time_zone, scope)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         ON CONFLICT (name) DO UPDATE SET start_at = $2, end_at = $3, time_zone = $4, scope = $5::jsonb`,
        [
          name,
          new Date(text(item.start)),
          new Date(text(item.end)),
          text(item.time_zone, 'Europe/Berlin'),
          JSON.stringify(item.scope ?? 'all'),
        ],
      );
      add('freeze_windows', { name });
    }

    for (const item of list(body, 'delegations')) {
      await client.query(
        `UPDATE person SET delegate = $2, delegate_from = $3, delegate_to = $4 WHERE username = $1`,
        [
          text(item.member),
          text(item.delegate),
          new Date(text(item.from)),
          new Date(text(item.to)),
        ],
      );
      add('delegations', { name: text(item.member) });
    }

    for (const item of list(body, 'inbox_rules')) {
      await client.query(
        `INSERT INTO inbox_rule (event, roles, enabled, workspace) VALUES ($1, $2::jsonb, $3, $4)`,
        [text(item.event), JSON.stringify(item.roles ?? []), item.enabled !== false, workspaceOf(item)],
      );
      add('inbox_rules', { name: text(item.event) });
    }

    for (const item of list(body, 'dashboards')) {
      const id = text(item.id);
      await client.query(
        `INSERT INTO dashboard (id, name, widgets) VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (id) DO UPDATE SET name = $2, widgets = $3::jsonb`,
        [id, text(item.name, id), JSON.stringify(item.widgets ?? [])],
      );
      add('dashboards', { id });
    }

    for (const item of list(body, 'knowledge_articles')) {
      const number = await nextNumber(client, numberPrefixes.article);
      const state = text(item.state, 'published');
      await client.query(
        `INSERT INTO knowledge_article (number, version, title, body, keywords, state, valid_until,
                                        helpful_yes, helpful_no, audience, author, published_at)
         VALUES ($1, 1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9::jsonb, $10, $11)`,
        [
          number,
          text(item.title),
          text(item.body),
          JSON.stringify(item.keywords ?? []),
          state,
          item.valid_until ?? null,
          Number(item.helpful_yes ?? 0),
          Number(item.helpful_no ?? 0),
          JSON.stringify(item.audience ?? { roles: [], departments: [] }),
          text(item.author, 'oona'),
          state === 'published'
            ? (item.published_at ? new Date(text(item.published_at)) : now())
            : null,
        ],
      );
      add('knowledge_articles', { number });
    }

    for (const item of list(body, 'records')) {
      const table = text(item.table);
      if (!(tableNames as readonly string[]).includes(table) && table !== 'request') {
        throw validation(`"${table}" is not a table.`);
      }
      const prefix = numberPrefixes[table];
      if (!prefix) throw validation(`"${table}" is not a table.`);
      const number = await nextNumber(client, prefix);
      const createdAt = item.created_at ? Date.parse(text(item.created_at)) : nowMs();
      const fields = { ...((item.fields ?? {}) as Bag) };
      const state = text(item.state, defaultStateOf(table));
      fields.state = state;
      fields.created_at = iso(new Date(createdAt));
      if (item.parent !== undefined && item.parent !== null) fields.parent = item.parent;
      if (item.problem !== undefined && item.problem !== null) fields.problem = item.problem;
      const history = Array.isArray(item.state_history) && item.state_history.length > 0
        ? (item.state_history as { state: string; at: string }[])
        : [{ state, at: iso(new Date(createdAt)) }];
      const versions: Record<string, number> = {};
      for (const key of Object.keys(fields)) versions[key] = 1;
      versions.state = 1;
      await client.query(
        `INSERT INTO record (number, table_name, state, fields, versions, state_history,
                             created_at, updated_at, created_by, workspace)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7, $7, $8, $9)`,
        [
          number,
          table,
          state,
          JSON.stringify(fields),
          JSON.stringify(versions),
          JSON.stringify(history),
          new Date(createdAt),
          text(item.created_by, 'oona'),
          workspaceOf(item),
        ],
      );
      add('records', { number });
    }

    for (const item of list(body, 'votes')) {
      const number = text(item.change);
      const step = Number(item.step ?? 1);
      const username = text(item.username);
      const decision = text(item.decision, 'approve');
      const at = item.at ? new Date(text(item.at)) : now();
      await client.query(
        `INSERT INTO approval_vote (number, step, voter, voted_by, decision, at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [number, step, username, text(item.on_behalf_of, username) || username, decision, at],
      );
      add('votes', { name: `${number}:${step}:${username}` });
    }

  });

  // SLAs attach and compute from the history once the records exist.
  const engine = await Engine.load('live');
  for (const entry of out.records ?? []) {
    const record = engine.records.get(String(entry.number));
    if (!record) continue;
    await transaction(async (client) => {
      await attachSlas(client, engine, record, record.createdAt);
      await reviewSlas(client, engine, record);
    });
  }
  await openFixtureApprovalSteps(engine);

  return out;
}

function defaultStateOf(table: string): string {
  switch (table) {
    case 'incident':
    case 'problem':
      return 'new';
    case 'change':
      return 'draft';
    case 'request_item':
      return 'submitted';
    case 'task':
      return 'open';
    default:
      return 'open';
  }
}

/**
 * A fixture change already in peer_review, board_vote or emergency board_vote
 * has its open step opened at its last history time.
 */
async function openFixtureApprovalSteps(engine: Engine): Promise<void> {
  for (const record of engine.records.values()) {
    if (record.table !== 'change') continue;
    if (record.state !== 'peer_review' && record.state !== 'board_vote') continue;
    const steps = await loadSteps(record.number);
    if (steps.some((s) => s.status === 'open')) continue;
    const last = record.stateHistory[record.stateHistory.length - 1];
    const at = last ? Date.parse(last.at) : record.createdAt;
    await transaction(async (client) => {
      if (steps.length === 0) await buildSteps(client, engine, record);
      const fresh = await loadSteps(record.number);
      const model = String(record.fields.model ?? 'normal');
      const which = record.state === 'peer_review' || model === 'emergency' ? 1 : 2;
      if (fresh.some((s) => s.step === which)) {
        await openStep(client, engine, record, which, Number.isNaN(at) ? record.createdAt : at);
      }
    });
  }
}

export type { PoolClient };
