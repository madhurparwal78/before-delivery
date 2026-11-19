import { newId, query } from './db.js';
import { config } from './config.js';
import { setFixedNow } from './clock.js';
import { createPerson } from './auth.js';
import {
  invalid,
  jsonBody,
  notFound,
  sendJson,
  type Ctx,
  type Router,
} from './http.js';
import { SEED_BODY_LIMIT } from './config.js';
import { runDueWork } from './due.js';

type Keyed = Record<string, string>;

interface SeedResult {
  people: Keyed;
  teams: Keyed;
  projects: Keyed;
  sections: Record<string, Keyed>;
  fields: Keyed;
  tasks: Keyed;
  rules: Keyed;
  goals: Keyed;
  forms: Keyed;
  approvals: Keyed;
  inbox: Keyed;
}

function list(value: unknown): Record<string, any>[] {
  return Array.isArray(value) ? (value as Record<string, any>[]) : [];
}

function stamp(record: Record<string, any>): string | null {
  return typeof record.createdAt === 'string' ? new Date(record.createdAt).toISOString() : null;
}

async function seed(body: Record<string, unknown>): Promise<SeedResult> {
  const out: SeedResult = {
    people: {},
    teams: {},
    projects: {},
    sections: {},
    fields: {},
    tasks: {},
    rules: {},
    goals: {},
    forms: {},
    approvals: {},
    inbox: {},
  };

  for (const person of list(body.people)) {
    const created = await createPerson({
      name: String(person.name),
      email: String(person.email),
      password: String(person.password ?? 'weekly-demo-1'),
      verified: person.verified !== false,
    });
    out.people[String(person.key)] = created.id;
    const at = stamp(person);
    if (at) await query(`UPDATE people SET created_at = $1 WHERE id = $2`, [at, created.id]);
  }

  for (const team of list(body.teams)) {
    const id = newId();
    const at = stamp(team);
    await query(
      `INSERT INTO teams (id, name, join_code, created_at) VALUES ($1,$2,$3,COALESCE($4::timestamptz, now()))`,
      [id, String(team.name), String(team.joinCode ?? `TEAM-${id.slice(0, 6)}`), at],
    );
    out.teams[String(team.key)] = id;
    const coordinators = new Set((team.coordinators ?? []).map((k: string) => String(k)));
    const members = new Set<string>([
      ...(team.members ?? []).map((k: string) => String(k)),
      ...coordinators,
    ]);
    for (const key of members) {
      const personId = out.people[key];
      if (!personId) continue;
      await query(
        `INSERT INTO memberships (team_id, person_id, role) VALUES ($1,$2,$3)
         ON CONFLICT (team_id, person_id) DO UPDATE SET role = EXCLUDED.role`,
        [id, personId, coordinators.has(key) ? 'coordinator' : 'member'],
      );
    }
  }

  for (const capacity of list(body.capacities)) {
    const personId = out.people[String(capacity.person)];
    if (!personId) continue;
    const teams = await query<{ team_id: string }>(
      `SELECT team_id FROM memberships WHERE person_id = $1`,
      [personId],
    );
    for (const team of teams) {
      await query(
        `INSERT INTO capacities (team_id, person_id, weekday, hours) VALUES ($1,$2,$3,$4)
         ON CONFLICT (team_id, person_id, weekday) DO UPDATE SET hours = EXCLUDED.hours`,
        [team.team_id, personId, String(capacity.weekday), Number(capacity.hours)],
      );
    }
  }

  for (const project of list(body.projects)) {
    const teamId = out.teams[String(project.team)];
    const id = newId();
    const at = stamp(project);
    await query(
      `INSERT INTO projects (id, team_id, name, created_at)
       VALUES ($1,$2,$3,COALESCE($4::timestamptz, now()))`,
      [id, teamId, String(project.name), at],
    );
    out.projects[String(project.key)] = id;
    const sectionIds: Keyed = {};
    const names = (project.sections ?? []).map((s: unknown) => String(s));
    for (let i = 0; i < names.length; i += 1) {
      const sectionId = newId();
      await query(`INSERT INTO sections (id, project_id, name, position) VALUES ($1,$2,$3,$4)`, [
        sectionId,
        id,
        names[i],
        i + 1,
      ]);
      sectionIds[names[i]] = sectionId;
    }
    out.sections[String(project.key)] = sectionIds;

    const fieldIdByKey: Keyed = {};
    const fieldList = list(project.fields);
    for (let i = 0; i < fieldList.length; i += 1) {
      const field = fieldList[i];
      const fieldId = newId();
      await query(
        `INSERT INTO fields (id, project_id, name, type, options, formula, position)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          fieldId,
          id,
          String(field.name),
          String(field.type),
          JSON.stringify((field.options ?? []).map((o: unknown) => String(o))),
          field.formula === undefined || field.formula === null ? null : String(field.formula),
          i + 1,
        ],
      );
      const key = String(field.key ?? field.name);
      fieldIdByKey[key] = fieldId;
      out.fields[key] = fieldId;
    }
    const fieldsByName = await query<{ id: string; name: string; type: string }>(
      `SELECT id, name, type FROM fields WHERE project_id = $1`,
      [id],
    );

    const taskList = list(project.tasks);
    const taskIdByKey: Keyed = {};
    const counters = new Map<string, number>();
    for (const task of taskList) {
      const taskId = newId();
      const sectionId = sectionIds[String(task.section)] ?? Object.values(sectionIds)[0];
      const parentId = task.parent ? taskIdByKey[String(task.parent)] : null;
      const bucket = parentId ?? `s:${sectionId}`;
      const next = (counters.get(bucket) ?? 0) + 1;
      counters.set(bucket, next);
      const position = task.position === undefined ? next : Number(task.position);
      await query(
        `INSERT INTO tasks (id, project_id, section_id, parent_id, name, description, position,
           assignee_id, start_date, due_date, effort, completed, completed_on, recurrence, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,COALESCE($15::timestamptz, now()))`,
        [
          taskId,
          id,
          sectionId,
          parentId,
          String(task.name),
          String(task.description ?? ''),
          position,
          task.assignee ? out.people[String(task.assignee)] : null,
          task.start ?? null,
          task.due ?? null,
          task.effort === undefined || task.effort === null ? null : Number(task.effort),
          task.completed === true,
          task.completed === true ? (task.due ?? null) : null,
          task.recurrence ?? null,
          stamp(task),
        ],
      );
      taskIdByKey[String(task.key ?? task.name)] = taskId;
      out.tasks[String(task.key ?? task.name)] = taskId;
      for (const [name, value] of Object.entries(task.values ?? {})) {
        const field = fieldsByName.find((f) => f.name === name);
        if (!field) continue;
        await query(`INSERT INTO task_values (task_id, field_id, value) VALUES ($1,$2,$3)`, [
          taskId,
          field.id,
          JSON.stringify(value),
        ]);
      }
    }

    const resolveFieldRef = (ref: unknown): string => {
      const key = String(ref);
      if (['assignee', 'start', 'due', 'effort'].includes(key)) return key;
      return fieldIdByKey[key] ?? fieldsByName.find((f) => f.name === key)?.id ?? key;
    };

    const ruleList = list(project.rules);
    for (let i = 0; i < ruleList.length; i += 1) {
      const rule = ruleList[i];
      const ruleId = newId();
      const trigger = { ...(rule.trigger ?? {}) };
      if (trigger.field !== undefined) trigger.field = resolveFieldRef(trigger.field);
      if (trigger.section !== undefined) trigger.section = sectionIds[String(trigger.section)];
      const condition = rule.condition ? { ...rule.condition } : null;
      if (condition && condition.field !== undefined) {
        condition.field = resolveFieldRef(condition.field);
      }
      const action = { ...(rule.action ?? {}) };
      if (action.type === 'move_to_section') action.target = sectionIds[String(action.target)];
      else if (action.type === 'assign_to') action.target = out.people[String(action.target)];
      else if (action.type === 'set_field') action.target = resolveFieldRef(action.target);
      await query(
        `INSERT INTO rules (id, project_id, name, position, trigger, condition, action, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8::timestamptz, now()))`,
        [
          ruleId,
          id,
          String(rule.name),
          rule.position === undefined ? i + 1 : Number(rule.position),
          JSON.stringify(trigger),
          condition ? JSON.stringify(condition) : null,
          JSON.stringify(action),
          stamp(rule),
        ],
      );
      out.rules[String(rule.key ?? rule.name)] = ruleId;
    }

    for (const form of list(project.forms)) {
      const formId = newId();
      await query(
        `INSERT INTO forms (id, project_id, section_id, slug, title) VALUES ($1,$2,$3,$4,$5)`,
        [formId, id, sectionIds[String(form.section)], String(form.slug), String(form.title)],
      );
      out.forms[String(form.key ?? form.slug)] = formId;
      const existing = await query(
        `SELECT 1 FROM fields WHERE project_id = $1 AND name = 'Requested by'`,
        [id],
      );
      if (existing.length === 0) {
        const count = await query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM fields WHERE project_id = $1`,
          [id],
        );
        await query(
          `INSERT INTO fields (id, project_id, name, type, options, formula, position)
           VALUES ($1,$2,'Requested by','text','[]'::jsonb,NULL,$3)`,
          [newId(), id, Number(count[0].count) + 1],
        );
      }
    }

    for (const dependency of list(project.dependencies)) {
      await query(
        `INSERT INTO dependencies (from_task, to_task) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [taskIdByKey[String(dependency.from)], taskIdByKey[String(dependency.to)]],
      );
    }
  }

  for (const goal of list(body.goals)) {
    const id = newId();
    await query(
      `INSERT INTO goals (id, team_id, name, parent_id, weight, manual_value, owner_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8::timestamptz, now()))`,
      [
        id,
        out.teams[String(goal.team)],
        String(goal.name),
        goal.parent ? out.goals[String(goal.parent)] : null,
        goal.weight === undefined ? 1 : Number(goal.weight),
        goal.manual === undefined ? 0 : Number(goal.manual),
        goal.owner ? out.people[String(goal.owner)] : null,
        stamp(goal),
      ],
    );
    out.goals[String(goal.key)] = id;
    for (const link of list(goal.projects)) {
      await query(
        `INSERT INTO goal_projects (goal_id, project_id, weight) VALUES ($1,$2,$3)
         ON CONFLICT (goal_id, project_id) DO UPDATE SET weight = EXCLUDED.weight`,
        [id, out.projects[String(link.project)], link.weight === undefined ? 1 : Number(link.weight)],
      );
    }
  }

  for (const approval of list(body.approvals)) {
    const id = newId();
    await query(
      `INSERT INTO approvals (id, task_id, approver_id, requester_id, status, created_at)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6::timestamptz, now()))`,
      [
        id,
        out.tasks[String(approval.task)],
        out.people[String(approval.approver)],
        approval.requester ? out.people[String(approval.requester)] : null,
        String(approval.status ?? 'requested'),
        stamp(approval),
      ],
    );
    out.approvals[String(approval.key)] = id;
  }

  for (const item of list(body.inbox)) {
    const id = newId();
    const personId = out.people[String(item.person)];
    const teams = await query<{ team_id: string }>(
      `SELECT team_id FROM memberships WHERE person_id = $1 LIMIT 1`,
      [personId],
    );
    await query(
      `INSERT INTO inbox_items (id, person_id, team_id, text, task_id, kind, read, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8::timestamptz, now()))`,
      [
        id,
        personId,
        teams.length > 0 ? teams[0].team_id : null,
        String(item.text),
        item.task ? out.tasks[String(item.task)] : null,
        String(item.kind ?? 'note'),
        item.read === true,
        stamp(item),
      ],
    );
    out.inbox[String(item.key)] = id;
  }

  for (const entry of list(body.history)) {
    await query(
      `INSERT INTO task_history (id, task_id, text, created_at)
       VALUES ($1,$2,$3,COALESCE($4::timestamptz, now()))`,
      [newId(), out.tasks[String(entry.task)], String(entry.text), stamp(entry)],
    );
  }

  return out;
}

export function registerGradingRoutes(router: Router): void {
  const guard = (ctx: Ctx): void => {
    if (!config.grading || ctx.req.headers['x-everyweek-grading'] !== '1') throw notFound();
  };

  router.add('POST', '/grading/seed', async (ctx) => {
    guard(ctx);
    const body = jsonBody(ctx, SEED_BODY_LIMIT);
    sendJson(ctx.res, 201, await seed(body));
  });

  router.add('POST', '/grading/clock', async (ctx) => {
    guard(ctx);
    const body = jsonBody(ctx);
    const raw = typeof body.now === 'string' ? body.now : '';
    const value = new Date(raw);
    if (Number.isNaN(value.getTime())) {
      throw invalid({ now: 'Enter a timestamp like 2026-03-02T09:00:00Z' });
    }
    const { previous } = await setFixedNow(value);
    await runDueWork(previous, value);
    sendJson(ctx.res, 200, { now: value.toISOString() });
  });
}
