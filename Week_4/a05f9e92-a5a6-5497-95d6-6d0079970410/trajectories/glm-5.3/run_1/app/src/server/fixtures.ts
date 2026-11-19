// Fixtures: create any published fixture in one transaction.
// A validation error answers 422 with the normal body and creates nothing.

import { clock } from './db.js';
import type { PoolClient } from 'pg';
import type { Ctx } from './server.js';
import { ApiError } from './errors.js';
import { hashPassword } from './seeddata.js';
import { Table } from '../shared/model.js';

interface FixtureBody {
  departments?: Array<{ name: string }>;
  people?: Array<{ username: string; display_name: string; department: string }>;
  users?: Array<{ username: string; password: string; display_name: string; roles: string[]; department: string; time_zone?: string; out_of_office?: boolean; capacity?: number | null; active?: boolean }>;
  groups?: Array<{ name: string; members: string[]; escalation_policy?: string | null }>;
  schedules?: Array<{ name: string; time_zone: string; hours: Record<string, Array<[string, string]>>; holidays?: string[] }>;
  sla_definitions?: Array<{ name: string; table: string; start: string; pause: string; stop: string; schedule: string; targets: Record<string, number> }>;
  cis?: Array<{ name: string; class: string; criticality: number; business_critical?: boolean; owner_department?: string | null; status?: string; used_by?: { departments?: string[]; people?: string[] }; attributes?: Record<string, unknown>; workspace?: string }>;
  relationships?: Array<{ source: string; type: string; target: string }>;
  maintenance?: Array<{ ci: string; start: string; end: string }>;
  rotations?: Array<{ name: string; time_zone: string; handover_weekday?: string; handover_time?: string; members: string[]; anchor_date: string }>;
  overrides?: Array<{ rotation: string; username: string; start: string; end: string }>;
  escalation_policies?: Array<{ name: string; levels: Array<{ target: { rotation?: string; user?: string }; ack_minutes: number | null }> }>;
  assignment_rules?: Array<{ name: string; order?: number; table: string; condition: string; group: string; active?: boolean; workspace?: string }>;
  business_rules?: Array<{ name: string; table: string; when: string; order?: number; operations?: string[]; condition: string; actions: unknown[]; active?: boolean; workspace?: string }>;
  access_rules?: Array<{ name: string; type: string; table: string; field?: string | null; operation: string; roles: string[]; condition?: string | null; active?: boolean; workspace?: string }>;
  form_policies?: Array<{ name: string; table?: string | null; catalog_item?: string | null; order?: number; condition: string; actions: unknown[]; workspace?: string }>;
  catalog_items?: Array<{ id: string; name: string; variables: unknown[]; workflow: string; workspace?: string }>;
  guides?: Array<{ id: string; name: string; questions: unknown[]; rules: Array<{ item: string; condition: string }>; workspace?: string }>;
  workflows?: Array<{ name: string; kind?: string; inputs?: unknown[]; outputs?: unknown[]; draft?: unknown[] | null; published?: unknown[][]; workspace?: string }>;
  boards?: Array<{ name: string; rule: string; n?: number | null; threshold_percent?: number | null; window_hours?: number; members: Array<{ username: string; weight: number }> }>;
  freeze_windows?: Array<{ name: string; start: string; end: string; time_zone: string; scope: string | { items: string[] } }>;
  delegations?: Array<{ member: string; delegate: string; from: string; to: string }>;
  records?: Array<{ table: Table; fields: Record<string, unknown>; state?: string; created_at?: string; state_history?: Array<{ state: string; at?: string }>; parent?: string | null; problem?: string | null; created_by?: string | null; workspace?: string }>;
  votes?: Array<{ change: string; step: number; username: string; decision: string; on_behalf_of?: string | null; at?: string }>;
  knowledge_articles?: Array<{ title: string; body: string; keywords?: string[]; valid_until?: string | null; audience?: { roles?: string[]; departments?: string[] }; state?: string; helpful_yes?: number; helpful_no?: number; author?: string | null; published_at?: string | null }>;
  inbox_rules?: Array<{ event: string; roles: string[]; enabled: boolean }>;
  dashboards?: Array<{ id: string; name: string; widgets: Array<Record<string, unknown>> }>;
}

export async function applyFixtures(ctx: Ctx, body: FixtureBody): Promise<Record<string, Array<{ id?: string | number; name?: string; number?: string }>>> {
  const created: Record<string, Array<{ id?: string | number; name?: string; number?: string }>> = {};

  try {
    await ctx.db.withTransaction(async (client: PoolClient) => {
      const q = (sql: string, params: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }> =>
        client.query(sql, params as never[]) as Promise<{ rows: Array<Record<string, unknown>> }>;

      created.departments = [];
      for (const d of body.departments ?? []) {
        await q(`INSERT INTO departments(name) VALUES ($1) ON CONFLICT DO NOTHING`, [d.name]);
        created.departments.push({ name: d.name });
      }

      created.people = [];
      for (const p of body.people ?? []) {
        await q(`INSERT INTO people(username, display_name, department, password_hash, time_zone) VALUES ($1,$2,$3,NULL,'Europe/Berlin') ON CONFLICT DO NOTHING`, [p.username, p.display_name, p.department]);
        created.people.push({ name: p.username });
      }

      created.users = [];
      for (const u of body.users ?? []) {
        await q(
          `INSERT INTO people(username, display_name, department, roles, password_hash, time_zone, out_of_office, capacity, active, digest)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'immediate')
           ON CONFLICT (username) DO UPDATE SET display_name = EXCLUDED.display_name, department = EXCLUDED.department,
             roles = EXCLUDED.roles, password_hash = EXCLUDED.password_hash, time_zone = EXCLUDED.time_zone,
             out_of_office = EXCLUDED.out_of_office, capacity = EXCLUDED.capacity, active = EXCLUDED.active`,
          [u.username, u.display_name, u.department, u.roles, hashPassword(u.password), u.time_zone ?? 'Europe/Berlin', u.out_of_office ?? false, u.capacity ?? null, u.active ?? true],
        );
        created.users.push({ name: u.username });
      }

      created.groups = [];
      for (const g of body.groups ?? []) {
        await q(`INSERT INTO groups(name, members, escalation_policy) VALUES ($1,$2,$3) ON CONFLICT (name) DO UPDATE SET members = EXCLUDED.members, escalation_policy = EXCLUDED.escalation_policy`, [g.name, g.members, g.escalation_policy ?? null]);
        created.groups.push({ name: g.name });
      }

      created.schedules = [];
      for (const s of body.schedules ?? []) {
        await q(`INSERT INTO schedules(name, time_zone, hours, holidays) VALUES ($1,$2,$3,$4) ON CONFLICT (name) DO UPDATE SET time_zone = EXCLUDED.time_zone, hours = EXCLUDED.hours, holidays = EXCLUDED.holidays`, [s.name, s.time_zone, JSON.stringify(s.hours), s.holidays ?? []]);
        created.schedules.push({ name: s.name });
      }

      created.sla_definitions = [];
      for (const s of body.sla_definitions ?? []) {
        await q(`INSERT INTO sla_definitions(name, "table", start_expr, pause_expr, stop_expr, schedule, targets) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (name) DO UPDATE SET start_expr = EXCLUDED.start_expr, pause_expr = EXCLUDED.pause_expr, stop_expr = EXCLUDED.stop_expr, schedule = EXCLUDED.schedule, targets = EXCLUDED.targets`,
          [s.name, s.table, s.start, s.pause, s.stop, s.schedule, JSON.stringify(s.targets)]);
        created.sla_definitions.push({ name: s.name });
      }

      created.cis = [];
      for (const c of body.cis ?? []) {
        const res = await q(
          `INSERT INTO cis(name, "class", criticality, business_critical, owner_department, status, attributes, used_by_departments, used_by_people)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (lower(name)) DO UPDATE SET "class" = EXCLUDED."class", criticality = EXCLUDED.criticality,
             business_critical = EXCLUDED.business_critical, status = EXCLUDED.status, attributes = EXCLUDED.attributes,
             used_by_departments = EXCLUDED.used_by_departments, used_by_people = EXCLUDED.used_by_people
           RETURNING id`,
          [c.name, c.class, c.criticality, c.business_critical ?? false, c.owner_department ?? null, c.status ?? 'healthy', JSON.stringify(c.attributes ?? {}), c.used_by?.departments ?? [], c.used_by?.people ?? []],
        );
        created.cis.push({ id: res.rows[0]?.id as number, name: c.name });
      }

      created.relationships = [];
      for (const r of body.relationships ?? []) {
        await q(`INSERT INTO relationships(source, type, target) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [r.source, r.type, r.target]);
        created.relationships.push({ name: `${r.source} ${r.type} ${r.target}` });
      }

      created.maintenance = [];
      for (const m of body.maintenance ?? []) {
        await q(`INSERT INTO maintenance_windows(ci, start, "end") VALUES ($1,$2,$3)`, [m.ci, new Date(m.start), new Date(m.end)]);
        created.maintenance.push({ name: m.ci });
      }

      created.rotations = [];
      for (const r of body.rotations ?? []) {
        await q(`INSERT INTO rotations(name, time_zone, handover_weekday, handover_time, members, anchor_date) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (name) DO UPDATE SET time_zone = EXCLUDED.time_zone, members = EXCLUDED.members, anchor_date = EXCLUDED.anchor_date`,
          [r.name, r.time_zone, r.handover_weekday ?? 'monday', r.handover_time ?? '09:00', r.members, r.anchor_date]);
        created.rotations.push({ name: r.name });
      }

      created.overrides = [];
      for (const o of body.overrides ?? []) {
        await q(`INSERT INTO rotation_overrides(rotation, username, start, "end") VALUES ($1,$2,$3,$4)`, [o.rotation, o.username, new Date(o.start), new Date(o.end)]);
        created.overrides.push({ name: o.username });
      }

      created.escalation_policies = [];
      for (const p of body.escalation_policies ?? []) {
        await q(`INSERT INTO escalation_policies(name, levels) VALUES ($1,$2) ON CONFLICT (name) DO UPDATE SET levels = EXCLUDED.levels`, [p.name, JSON.stringify(p.levels)]);
        created.escalation_policies.push({ name: p.name });
      }

      created.assignment_rules = [];
      for (const r of body.assignment_rules ?? []) {
        await q(`INSERT INTO assignment_rules(name, "order", "table", condition, "group", active, workspace) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (name) DO UPDATE SET "order" = EXCLUDED."order", condition = EXCLUDED.condition, "group" = EXCLUDED."group", active = EXCLUDED.active`,
          [r.name, r.order ?? 100, r.table, r.condition, r.group, r.active ?? true, r.workspace ?? 'live']);
        created.assignment_rules.push({ name: r.name });
      }

      created.business_rules = [];
      for (const r of body.business_rules ?? []) {
        await q(`INSERT INTO business_rules(name, "table", "when", "order", operations, condition, actions, active, workspace) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (name) DO UPDATE SET condition = EXCLUDED.condition, actions = EXCLUDED.actions, active = EXCLUDED.active`,
          [r.name, r.table, r.when, r.order ?? 100, r.operations ?? ['insert', 'update'], r.condition, JSON.stringify(r.actions), r.active ?? true, r.workspace ?? 'live']);
        created.business_rules.push({ name: r.name });
      }

      created.access_rules = [];
      for (const r of body.access_rules ?? []) {
        await q(`INSERT INTO access_rules(name, type, "table", field, operation, roles, condition, active, workspace) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (name) DO UPDATE SET type = EXCLUDED.type, field = EXCLUDED.field, roles = EXCLUDED.roles, condition = EXCLUDED.condition, active = EXCLUDED.active`,
          [r.name, r.type, r.table, r.field ?? null, r.operation, r.roles, r.condition ?? null, r.active ?? true, r.workspace ?? 'live']);
        created.access_rules.push({ name: r.name });
      }

      created.form_policies = [];
      for (const p of body.form_policies ?? []) {
        await q(`INSERT INTO form_policies(name, "table", catalog_item, "order", condition, actions, workspace) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (name) DO UPDATE SET condition = EXCLUDED.condition, actions = EXCLUDED.actions`,
          [p.name, p.table ?? null, p.catalog_item ?? null, p.order ?? 100, p.condition, JSON.stringify(p.actions), p.workspace ?? 'live']);
        created.form_policies.push({ name: p.name });
      }

      created.catalog_items = [];
      for (const item of body.catalog_items ?? []) {
        await q(`INSERT INTO catalog_items(id, name, variables, workflow, workspace) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, variables = EXCLUDED.variables, workflow = EXCLUDED.workflow`,
          [item.id, item.name, JSON.stringify(item.variables), item.workflow, item.workspace ?? 'live']);
        created.catalog_items.push({ id: item.id, name: item.name });
      }

      created.guides = [];
      for (const g of body.guides ?? []) {
        await q(`INSERT INTO guides(id, name, questions, rules, workspace) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, questions = EXCLUDED.questions, rules = EXCLUDED.rules`,
          [g.id, g.name, JSON.stringify(g.questions), JSON.stringify(g.rules), g.workspace ?? 'live']);
        created.guides.push({ id: g.id, name: g.name });
      }

      created.workflows = [];
      for (const w of body.workflows ?? []) {
        const res = await q(`INSERT INTO workflows(name, kind, inputs, outputs, draft, workspace) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (name) DO UPDATE SET kind = EXCLUDED.kind, draft = EXCLUDED.draft RETURNING id`,
          [w.name, w.kind ?? 'flow', JSON.stringify(w.inputs ?? []), JSON.stringify(w.outputs ?? []), JSON.stringify(w.draft ?? []), w.workspace ?? 'live']);
        const id = Number(res.rows[0].id);
        const existing = await q(`SELECT version FROM workflow_versions WHERE workflow = $1`, [id]);
        if (existing.rows.length === 0) {
          let version = 1;
          for (const steps of w.published ?? []) {
            await q(`INSERT INTO workflow_versions(workflow, version, steps, published_at) VALUES ($1,$2,$3,$4)`, [id, version, JSON.stringify(steps), new Date(clock.nowMs())]);
            version++;
          }
        }
        created.workflows.push({ id, name: w.name });
      }

      created.boards = [];
      for (const b of body.boards ?? []) {
        await q(`INSERT INTO boards(name, rule, n, threshold_percent, window_hours, members) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (name) DO UPDATE SET rule = EXCLUDED.rule, n = EXCLUDED.n, threshold_percent = EXCLUDED.threshold_percent, window_hours = EXCLUDED.window_hours, members = EXCLUDED.members`,
          [b.name, b.rule, b.n ?? null, b.threshold_percent ?? null, b.window_hours ?? 48, JSON.stringify(b.members)]);
        created.boards.push({ name: b.name });
      }

      created.freeze_windows = [];
      for (const f of body.freeze_windows ?? []) {
        const scopeKind = f.scope === 'all' ? 'all' : 'items';
        const scopeItems = f.scope === 'all' ? [] : (f.scope as { items: string[] }).items;
        await q(`INSERT INTO freeze_windows(name, start, "end", time_zone, scope_kind, scope_items) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (name) DO UPDATE SET start = EXCLUDED.start, "end" = EXCLUDED."end", time_zone = EXCLUDED.time_zone, scope_kind = EXCLUDED.scope_kind, scope_items = EXCLUDED.scope_items`,
          [f.name, new Date(f.start), new Date(f.end), f.time_zone, scopeKind, scopeItems]);
        created.freeze_windows.push({ name: f.name });
      }

      created.delegations = [];
      for (const d of body.delegations ?? []) {
        await q(`UPDATE people SET delegate = $2, delegate_from = $3, delegate_to = $4 WHERE username = $1`, [d.member, d.delegate, new Date(d.from), new Date(d.to)]);
        created.delegations.push({ name: d.delegate });
      }

      created.records = [];
      for (const r of body.records ?? []) {
        const { allocateNumber } = await import('./recordengine.js');
        const number = await allocateNumber({ query: q } as never, r.table);
        const now = r.created_at ? Date.parse(r.created_at) : clock.nowMs();
        const state = r.state ?? (r.table === 'change' ? 'draft' : 'new');
        const fields = { ...r.fields, created_at: new Date(now).toISOString() };
        await q(
          `INSERT INTO records(number, "table", state, workspace, fields, priority_overridden, created_at, created_by, updated_at)
           VALUES ($1,$2,$3,$4,$5,FALSE,$6,$7,$6)`,
          [number, r.table, state, r.workspace ?? 'live', JSON.stringify(fields), new Date(now), r.created_by ?? 'oona'],
        );
        const history = r.state_history ?? [{ state }];
        for (const entry of history) {
          const at = entry.at ? Date.parse(entry.at) : now;
          await q(`INSERT INTO state_history(record, state, at) VALUES ($1,$2,$3)`, [number, entry.state, new Date(at)]);
        }
        for (const field of Object.keys(fields)) {
          await q(`INSERT INTO field_versions(record, field, version) VALUES ($1,$2,1) ON CONFLICT DO NOTHING`, [number, field]);
        }
        if (r.parent) {
          await q(`INSERT INTO record_links(kind, parent, child) VALUES ('parent',$1,$2) ON CONFLICT DO NOTHING`, [r.parent, number]);
        }
        if (r.problem) {
          await q(`INSERT INTO record_links(kind, parent, child) VALUES ('incident',$1,$2) ON CONFLICT DO NOTHING`, [r.problem, number]);
        }
        created.records.push({ number });
      }

      created.votes = [];
      for (const v of body.votes ?? []) {
        const step = await q(`SELECT id FROM approval_steps WHERE change = $1 AND step = $2`, [v.change, v.step]);
        if (!step.rows.length) {
          throw new ApiError(422, 'validation', `No step ${v.step} on ${v.change}.`);
        }
        await q(`INSERT INTO votes(step_id, voter, voted_by, decision, comment, at) VALUES ($1,$2,$3,$4,'',$5)`,
          [step.rows[0].id, v.username, v.on_behalf_of ?? v.username, v.decision, new Date(v.at ? Date.parse(v.at) : clock.nowMs())]);
        created.votes.push({ name: v.username });
      }

      created.knowledge_articles = [];
      for (const a of body.knowledge_articles ?? []) {
        const { allocateNamedNumber } = await import('./recordengine.js');
        const number = await allocateNamedNumber({ query: q } as never, 'article');
        await q(
          `INSERT INTO articles(number, title, body, keywords, state, valid_until, helpful_yes, helpful_no, audience_roles, audience_departments, author, published_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [number, a.title, a.body, a.keywords ?? [], a.state ?? 'published', a.valid_until ?? null, a.helpful_yes ?? 0, a.helpful_no ?? 0, a.audience?.roles ?? [], a.audience?.departments ?? [], a.author ?? 'oona', a.published_at === null || a.published_at === undefined ? new Date(clock.nowMs()) : new Date(a.published_at)],
        );
        created.knowledge_articles.push({ number });
      }

      created.inbox_rules = [];
      for (const rule of body.inbox_rules ?? []) {
        await q(`INSERT INTO inbox_rules(event, roles, enabled) VALUES ($1,$2,$3)`, [rule.event, rule.roles, rule.enabled]);
        created.inbox_rules.push({ name: rule.event });
      }

      created.dashboards = [];
      for (const d of body.dashboards ?? []) {
        await q(`INSERT INTO dashboards(id, name, widgets) VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, widgets = EXCLUDED.widgets`, [d.id, d.name, JSON.stringify(d.widgets)]);
        created.dashboards.push({ id: d.id, name: d.name });
      }
    });
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(422, 'validation', e instanceof Error ? e.message : 'The fixture could not be created.');
  }

  return created;
}
