/** Inserts records exactly as given. Used for the starter data and for the grading seed route. */
import { randomUUID } from "node:crypto";
import { hashPassword } from "./auth.js";
import type { Tx } from "./db.js";
import { invalid } from "./http.js";

type Keyed = Record<string, any>;
type Ids = Record<string, Record<string, string>>;

const BUILT_IN = ["assignee", "start", "due", "effort"];

export async function seedWorld(tx: Tx, body: Keyed, now: Date): Promise<Record<string, unknown>> {
  const ids: Ids = { people: {}, teams: {}, projects: {}, fields: {}, tasks: {}, rules: {}, goals: {}, forms: {}, approvals: {}, inbox: {} };
  const sections: Record<string, Record<string, string>> = {};
  const person = (key: string) => {
    const id = ids.people[key];
    if (!id) throw invalid({ person: `Unknown person ${key}` });
    return id;
  };

  for (const p of body.people ?? []) {
    ids.people[p.key] = randomUUID();
    await tx.query("INSERT INTO people (id, name, email, password_hash, verified, created_at) VALUES ($1,$2,$3,$4,$5,$6)",
      [ids.people[p.key], p.name, p.email, hashPassword(p.password), p.verified === true, now]);
  }
  const teamOfPerson: Record<string, string> = {};
  for (const t of body.teams ?? []) {
    ids.teams[t.key] = randomUUID();
    await tx.query("INSERT INTO teams (id, name, join_code) VALUES ($1,$2,$3)", [ids.teams[t.key], t.name, t.joinCode ?? `JOIN-${randomUUID().slice(0, 8)}`]);
    for (const key of new Set<string>([...(t.members ?? []), ...(t.coordinators ?? [])])) {
      const role = (t.coordinators ?? []).includes(key) ? "coordinator" : "member";
      await tx.query("INSERT INTO memberships (team_id, person_id, role) VALUES ($1,$2,$3)", [ids.teams[t.key], person(key), role]);
      teamOfPerson[key] ??= ids.teams[t.key];
    }
  }
  for (const c of body.capacities ?? []) {
    await tx.query("INSERT INTO capacities (team_id, person_id, weekday, hours) VALUES ($1,$2,$3,$4)", [teamOfPerson[c.person], person(c.person), c.weekday, c.hours]);
  }

  const fieldIds = new Map<string, string>();
  for (const p of body.projects ?? []) {
    const projectId = (ids.projects[p.key] = randomUUID());
    await tx.query("INSERT INTO projects (id, team_id, name, created_at) VALUES ($1,$2,$3,$4)", [projectId, ids.teams[p.team], p.name, now]);
    sections[p.key] = {};
    for (const [index, name] of (p.sections as string[]).entries()) {
      sections[p.key][name] = randomUUID();
      await tx.query("INSERT INTO sections (id, project_id, name, position) VALUES ($1,$2,$3,$4)", [sections[p.key][name], projectId, name, index + 1]);
    }
    const fieldByName = new Map<string, string>();
    const addField = async (key: string | null, name: string, type: string, options: string[], formula: string | null) => {
      const id = randomUUID();
      if (key) {
        ids.fields[key] = id;
        fieldIds.set(key, id);
      }
      fieldByName.set(name, id);
      await tx.query("INSERT INTO fields (id, project_id, name, type, options, formula, position) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [id, projectId, name, type, JSON.stringify(options), formula, fieldByName.size]);
    };
    for (const f of p.fields ?? []) await addField(f.key, f.name, f.type, f.options ?? [], f.formula ?? null);

    const groupCounts = new Map<string, number>();
    for (const t of p.tasks ?? []) {
      const id = (ids.tasks[t.key] = randomUUID());
      const parentId = t.parent ? ids.tasks[t.parent] : null;
      const sectionId = sections[p.key][t.section];
      const group = parentId ?? sectionId;
      const position = t.position ?? (groupCounts.get(group) ?? 0) + 1;
      groupCounts.set(group, Math.max(groupCounts.get(group) ?? 0, position));
      const values: Record<string, unknown> = {};
      for (const [name, value] of Object.entries(t.values ?? {})) if (fieldByName.has(name)) values[fieldByName.get(name)!] = value;
      await tx.query(
        `INSERT INTO tasks (id, project_id, name, description, section_id, position, parent_id, assignee_id, start_date, due_date, effort,
           completed, version, recurrence, values, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,1,$13,$14,$15)`,
        [id, projectId, t.name, t.description ?? "", sectionId, position, parentId, t.assignee ? person(t.assignee) : null, t.start ?? null,
          t.due ?? null, t.effort ?? null, t.completed === true, t.recurrence ?? null, JSON.stringify(values), t.createdAt ?? now]);
    }
    for (const d of p.dependencies ?? []) {
      await tx.query("INSERT INTO dependencies (from_task, to_task) VALUES ($1,$2)", [ids.tasks[d.from], ids.tasks[d.to]]);
    }
    const fieldRef = (key: string | undefined) => (key && !BUILT_IN.includes(key) ? fieldIds.get(key) ?? key : key);
    const optionValue = (field: string | undefined, value: unknown) => (field === "assignee" && typeof value === "string" && ids.people[value] ? ids.people[value] : value);
    for (const [index, r] of (p.rules ?? []).entries()) {
      const id = (ids.rules[r.key] = randomUUID());
      const trigger = { ...r.trigger };
      if (trigger.field) trigger.field = fieldRef(trigger.field);
      if (trigger.value !== undefined) trigger.value = optionValue(r.trigger.field, trigger.value);
      if (trigger.section) trigger.section = sections[p.key][trigger.section];
      const condition = r.condition ? { ...r.condition, field: fieldRef(r.condition.field), value: optionValue(r.condition.field, r.condition.value) } : null;
      const action = { ...r.action };
      if (action.type === "set_field") {
        action.value = optionValue(action.target, action.value);
        action.target = fieldRef(action.target);
      }
      if (action.type === "move_to_section") action.target = sections[p.key][action.target];
      if (action.type === "assign_to") action.target = ids.people[action.target] ?? action.target;
      await tx.query("INSERT INTO rules (id, project_id, name, position, trigger, condition, action, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [id, projectId, r.name, r.position ?? index + 1, JSON.stringify(trigger), condition ? JSON.stringify(condition) : null, JSON.stringify(action), now]);
    }
    for (const f of p.forms ?? []) {
      const id = (ids.forms[f.key] = randomUUID());
      await tx.query("INSERT INTO forms (id, project_id, slug, section_id, title) VALUES ($1,$2,$3,$4,$5)", [id, projectId, f.slug, sections[p.key][f.section], f.title]);
      if (!fieldByName.has("Requested by")) await addField(null, "Requested by", "text", [], null);
    }
  }

  const goalIds = body.goals ?? [];
  for (const g of goalIds) ids.goals[g.key] = randomUUID();
  for (const g of goalIds) {
    await tx.query("INSERT INTO goals (id, team_id, name, weight, manual_value, owner_id) VALUES ($1,$2,$3,$4,$5,$6)",
      [ids.goals[g.key], ids.teams[g.team], g.name, g.weight ?? 1, g.manual ?? 0, g.owner ? person(g.owner) : null]);
  }
  for (const g of goalIds) {
    if (g.parent) await tx.query("UPDATE goals SET parent_id = $2 WHERE id = $1", [ids.goals[g.key], ids.goals[g.parent]]);
    for (const link of g.projects ?? []) {
      await tx.query("INSERT INTO goal_projects (goal_id, project_id, weight) VALUES ($1,$2,$3)", [ids.goals[g.key], ids.projects[link.project], link.weight ?? 1]);
    }
  }
  for (const a of body.approvals ?? []) {
    const id = (ids.approvals[a.key] = randomUUID());
    await tx.query("INSERT INTO approvals (id, task_id, approver_id, requester_id, status, created_at) VALUES ($1,$2,$3,$4,$5,$6)",
      [id, ids.tasks[a.task], person(a.approver), person(a.requester), a.status ?? "requested", now]);
  }
  for (const i of body.inbox ?? []) {
    const id = (ids.inbox[i.key] = randomUUID());
    await tx.query("INSERT INTO inbox (id, person_id, text, task_id, kind, read, created_at) VALUES ($1,$2,$3,$4,'note',$5,$6)",
      [id, person(i.person), i.text, i.task ? ids.tasks[i.task] : null, i.read === true, i.createdAt ?? now]);
  }
  for (const h of body.history ?? []) {
    await tx.query("INSERT INTO history (task_id, text, created_at) VALUES ($1,$2,$3)", [ids.tasks[h.task], h.text, h.createdAt ?? now]);
  }
  return { ...ids, sections };
}

/** The starter workspace, created only when the database is empty. */
export async function seedStarter(tx: Tx, now: Date): Promise<void> {
  const password = "weekly-demo-1";
  const task = (key: string, name: string, extra: Keyed = {}) => ({ key, name, section: "To do", assignee: "noor", ...extra });
  await seedWorld(tx, {
    people: [
      { key: "noor", name: "Noor Halvorsen", email: "noor@everyweek.example", password, verified: true },
      { key: "ilse", name: "Ilse Marchetti", email: "ilse@everyweek.example", password, verified: true },
      { key: "tomas", name: "Tomas Okonkwo", email: "tomas@everyweek.example", password, verified: true },
    ],
    teams: [{ key: "team", name: "Larder Street Kitchen", joinCode: "LARDER-2026", members: ["noor", "ilse", "tomas"], coordinators: ["noor"] }],
    capacities: [{ person: "noor", weekday: "fri", hours: 4 }],
    projects: [
      {
        key: "orders", team: "team", name: "Weekly orders", sections: ["To do", "Doing", "Review", "Done"],
        fields: [
          { key: "stage", name: "Stage", type: "single_select", options: ["Draft", "Ready", "Review"] },
          { key: "priority", name: "Priority", type: "single_select", options: ["Low", "Medium", "High"] },
          { key: "tags", name: "Tags", type: "multi_select", options: ["Fresh", "Dry", "Frozen"] },
          { key: "category", name: "Category", type: "single_select", options: ["Dry goods", "Fresh", "Equipment"] },
          { key: "rate", name: "Rate", type: "number" },
          { key: "extra", name: "Extra", type: "number" },
          { key: "cost", name: "Cost", type: "formula", formula: "{Effort} * {Rate}" },
        ],
        tasks: [
          task("a", "Order dry goods", { start: "2026-03-02", due: "2026-03-04", effort: 12 }),
          task("b", "Pack orders", { start: "2026-03-04", due: "2026-03-06", effort: 10 }),
          task("c", "Count freezer", { section: "Doing", start: "2026-03-06", due: "2026-03-09", effort: 5 }),
          task("d", "Weigh stock", { assignee: "ilse", due: "2026-03-02", effort: 2.5, values: { Rate: 40 }, recurrence: "Every week on Monday" }),
        ],
        forms: [{ key: "form", slug: "supply-request", section: "To do", title: "Supply request" }],
      },
      {
        key: "upkeep", team: "team", name: "Machine upkeep", sections: ["To do", "Done"],
        tasks: [task("e", "Oil the slicer", { assignee: null }), task("f", "Replace saw blade", { assignee: null }), task("g", "Clean the mixer", { assignee: null })],
      },
    ],
    goals: [
      { key: "root", team: "team", name: "Run a steady year", owner: "noor" },
      { key: "kitchen", team: "team", name: "Kitchen runs on time", parent: "root", weight: 2, owner: "noor", projects: [{ project: "orders", weight: 3 }] },
      { key: "upkeep", team: "team", name: "Upkeep never lapses", parent: "root", weight: 1, owner: "noor", projects: [{ project: "upkeep", weight: 1 }] },
      { key: "suppliers", team: "team", name: "Suppliers confirmed", parent: "kitchen", weight: 1, manual: 40, owner: "noor" },
      { key: "parts", team: "team", name: "Spare parts stocked", parent: "upkeep", weight: 1, manual: 90, owner: "noor" },
    ],
    inbox: [{ key: "welcome", person: "noor", text: "Welcome to Everyweek" }],
  }, now);
}
