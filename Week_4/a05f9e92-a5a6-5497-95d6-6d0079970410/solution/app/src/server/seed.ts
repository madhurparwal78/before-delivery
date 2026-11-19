import { hashPassword } from "./auth.js";
import { now } from "./clock.js";
import { query, transaction, type Tx } from "./db.js";
import { Env, SYSTEM } from "./env.js";
import { save } from "./records.js";
import { configPut } from "./store.js";
import type { Step, WorkflowContent } from "./workflows.js";

const PASSWORD_SUFFIX = "-yard-2026";
const ALL_ROLES = ["operator", "technician", "approver", "manager", "requester"];

const USERS: Array<[string, string, string[], string, string]> = [
  ["oona", "Oona Petrakis", ["operator"], "IT provider", "Europe/Berlin"],
  ["teodor", "Teodor Lindqvist", ["technician"], "IT provider", "Europe/Berlin"],
  ["bastian", "Bastian Quell", ["technician"], "IT provider", "Europe/Berlin"],
  ["ruth", "Ruth Abernathy", ["requester"], "Design Studio", "Europe/Berlin"],
  ["kofi", "Kofi Marsh", ["requester"], "Finance", "Europe/Berlin"],
  ["ana", "Ana Feld", ["approver", "requester"], "Finance", "Europe/Berlin"],
  ["dev", "Devika Raman", ["approver", "requester"], "Design Studio", "Europe/Berlin"],
  ["jonas", "Jonas Brandt", ["approver", "requester"], "Studio Operations", "Europe/Berlin"],
  ["mae", "Mae Castellan", ["manager", "requester"], "Design Studio", "Europe/Berlin"],
  ["hugo", "Hugo Varga", ["manager", "requester"], "Finance", "Europe/Lisbon"],
];

const DIRECTORY: Array<[string, string, number, string]> = [
  ["design", "Design staff", 45, "Design Studio"],
  ["fin", "Finance staff", 6, "Finance"],
  ["ops", "Operations staff", 13, "Studio Operations"],
  ["lead", "Leadership staff", 6, "Leadership"],
];

const HOURS_OFFICE = { mon: [["08:00", "17:00"]], tue: [["08:00", "17:00"]], wed: [["08:00", "17:00"]], thu: [["08:00", "17:00"]], fri: [["08:00", "17:00"]], sat: [], sun: [] };
const HOURS_ALWAYS = Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, [["00:00", "24:00"]]]));

const TARGETS = (seconds: number[]): Record<string, number> => Object.fromEntries(seconds.map((s, i) => [String(i + 1), s]));

const SERVICES: Array<[string, number, boolean, { departments: string[]; people: string[] }]> = [
  ["Payroll", 3, true, { departments: ["Finance", "Leadership"], people: ["ops01"] }],
  ["Project files", 3, true, { departments: ["Design Studio", "Studio Operations"], people: [] }],
  ["Mail", 3, true, { departments: ["Design Studio", "Finance", "Studio Operations", "Leadership"], people: [] }],
  ["Sign-in", 3, true, { departments: ["Design Studio", "Finance", "Studio Operations", "Leadership"], people: [] }],
  ["Remote access", 2, false, { departments: ["Design Studio", "Leadership"], people: [] }],
  ["Printing", 1, false, { departments: ["Design Studio", "Studio Operations"], people: [] }],
];

const ITEMS: Array<[string, string, number, Record<string, unknown>]> = [
  ["Payroll app", "Application", 3, {}],
  ["Mail relay", "Application", 3, {}],
  ["Directory", "Application", 3, {}],
  ["File gateway", "Application", 3, {}],
  ["Print server", "Application", 1, {}],
  ["payroll-vm", "Virtual server", 3, {}],
  ["mail-vm", "Virtual server", 3, {}],
  ["dir-vm", "Virtual server", 3, {}],
  ["print-vm", "Virtual server", 1, {}],
  ["host-a", "Server", 2, {}],
  ["host-b", "Server", 2, {}],
  ["host-c", "Server", 2, {}],
  ["Host cluster", "Cluster", 3, { required_healthy: 2 }],
  ["File cluster", "Cluster", 3, { required_healthy: 2 }],
  ["fs-node-1", "Server", 2, {}],
  ["fs-node-2", "Server", 2, {}],
  ["fs-node-3", "Server", 2, {}],
  ["Core switch", "Network device", 3, {}],
  ["VPN gateway", "Network device", 2, {}],
  ["Main storage array", "Storage", 3, {}],
];

const RELATIONSHIPS: Array<[string, string, string]> = [
  ["Payroll", "depends on", "Payroll app"],
  ["Payroll", "depends on", "Sign-in"],
  ["Project files", "depends on", "File gateway"],
  ["Project files", "depends on", "Sign-in"],
  ["Mail", "depends on", "Mail relay"],
  ["Mail", "depends on", "Sign-in"],
  ["Sign-in", "depends on", "Directory"],
  ["Remote access", "depends on", "VPN gateway"],
  ["Remote access", "depends on", "Sign-in"],
  ["Printing", "depends on", "Print server"],
  ["Payroll app", "runs on", "payroll-vm"],
  ["Mail relay", "runs on", "mail-vm"],
  ["Directory", "runs on", "dir-vm"],
  ["Print server", "runs on", "print-vm"],
  ["File gateway", "runs on", "File cluster"],
  ["payroll-vm", "hosted by", "Host cluster"],
  ["mail-vm", "hosted by", "Host cluster"],
  ["dir-vm", "hosted by", "Host cluster"],
  ["print-vm", "hosted by", "Host cluster"],
  ["host-a", "member of", "Host cluster"],
  ["host-b", "member of", "Host cluster"],
  ["host-c", "member of", "Host cluster"],
  ["fs-node-1", "member of", "File cluster"],
  ["fs-node-2", "member of", "File cluster"],
  ["fs-node-3", "member of", "File cluster"],
  ["Host cluster", "depends on", "Main storage array"],
  ["Host cluster", "depends on", "Core switch"],
  ["File cluster", "depends on", "Core switch"],
  ["VPN gateway", "depends on", "Core switch"],
];

const select = (name: string, label: string, choices: Array<[string, string, { variable: string; equals: string } | null]>, required = true): Record<string, unknown> => ({
  name,
  label,
  type: "select",
  required,
  default: null,
  choices: choices.map(([value, text, when]) => ({ value, label: text, when })),
});

const CATALOG = [
  {
    id: "laptop",
    name: "Laptop",
    workflow: "Laptop fulfilment",
    variables: [
      select("model", "Model", [["standard14", "Standard 14-inch", null], ["studio16", "Studio 16-inch", null]]),
      select("memory", "Memory", [["16", "16 GB", { variable: "model", equals: "standard14" }], ["32", "32 GB", { variable: "model", equals: "studio16" }], ["64", "64 GB", { variable: "model", equals: "studio16" }]]),
      { name: "justification", label: "Why you need it", type: "multiline", required: false, default: null, choices: [] },
    ],
  },
  {
    id: "software-licence",
    name: "Software licence",
    workflow: "Standard fulfilment",
    variables: [
      select("seat", "Seat type", [["cad", "CAD seat", null], ["render", "Rendering seat", null], ["suite", "Design suite", null]]),
      { name: "cost_centre", label: "Cost centre", type: "text", required: false, default: { requester: "department" }, choices: [] },
    ],
  },
  {
    id: "building-pass",
    name: "Building pass",
    workflow: "Standard fulfilment",
    variables: [
      select("office", "Office", [["kanal", "Kanal office", null], ["hafen", "Hafen office", null]]),
      { name: "start_date", label: "Start date", type: "date", required: true, default: null, choices: [] },
    ],
  },
  {
    id: "shared-drive",
    name: "Shared drive access",
    workflow: "Drive access",
    variables: [
      select("drive", "Drive", [["projects", "Projects", null], ["finance", "Finance", null], ["archive", "Archive", null]]),
      select("access", "Access level", [["read", "Read", null], ["write", "Write", { variable: "drive", equals: "projects" }], ["write", "Write", { variable: "drive", equals: "finance" }]]),
    ],
  },
];

const trigger = (id: string, items: string[]): Step => ({ id, type: "trigger", name: "Ordered", on: "item_ordered", table: "request_item", items, condition: "true", on_error: [] });
const WORKFLOWS: Array<{ name: string; steps: Step[] }> = [
  {
    name: "Laptop fulfilment",
    steps: [
      trigger("t", ["laptop"]),
      { id: "check", type: "if", name: "Studio model?", condition: 'variables.model = "studio16"', then: [{ id: "approve", type: "approval", name: "Department approval", approvers: { kind: "department_approvers", user: null }, rule: "any", on_error: [] }], else: [], on_error: [] },
      { id: "task", type: "create_task", name: "Prepare laptop", group: "Desk", short_description: "Prepare laptop", wait: true, on_error: [] },
      { id: "done", type: "set_fields", name: "Delivered", fields: { state: '"delivered"' }, on_error: [] },
    ],
  },
  {
    name: "Standard fulfilment",
    steps: [
      trigger("t", ["software-licence", "building-pass"]),
      { id: "task", type: "create_task", name: "Fulfil request", group: "Desk", short_description: "Fulfil request", wait: true, on_error: [] },
      { id: "done", type: "set_fields", name: "Delivered", fields: { state: '"delivered"' }, on_error: [] },
    ],
  },
  {
    name: "Drive access",
    steps: [
      trigger("t", ["shared-drive"]),
      { id: "check", type: "if", name: "Write access?", condition: 'variables.access = "write"', then: [{ id: "approve", type: "approval", name: "Department approval", approvers: { kind: "department_approvers", user: null }, rule: "any", on_error: [] }], else: [], on_error: [] },
      { id: "task", type: "create_task", name: "Grant drive access", group: "Desk", short_description: "Grant drive access", wait: true, on_error: [] },
      { id: "done", type: "set_fields", name: "Delivered", fields: { state: '"delivered"' }, on_error: [] },
    ],
  },
];

const ARTICLES: Array<[number, string, string[], string, number, number, { roles: string[]; departments: string[] }, string | null]> = [
  [1, "Clearing an A1 plotter jam", ["plotter", "jam", "paper"], "Open the front cover, lift the green lever and pull the sheet towards you. Reload the roll before closing.", 4, 0, { roles: [], departments: [] }, null],
  [2, "Connecting to Remote access from home", ["vpn", "remote", "home"], "Start the Remote access client, choose Marlowe Office and sign in with your usual password. If it drops, restart your home router.", 2, 1, { roles: [], departments: [] }, null],
  [3, "Resetting your sign-in password", ["password", "reset", "locked"], "Use the Reset password link on the sign-in page. After five failed tries the account locks for fifteen minutes.", 0, 0, { roles: [], departments: [] }, null],
  [4, "Payroll export checklist", ["payroll", "export", "contractors"], "Check that every contractor has a cost centre before running the monthly export.", 0, 0, { roles: [], departments: ["Finance"] }, null],
  [5, "Installing the old plotter driver", ["plotter", "driver"], "Download the driver from the print server share and run the installer.", 0, 0, { roles: [], departments: [] }, "2026-06-30"],
];

const DASHBOARD_WIDGETS = [
  { id: "open-by-priority", title: "Open by priority", kind: "bar", table: "incident", filter: 'state in ["new", "assigned", "in_progress", "on_hold"]', group_by: "priority", bucket: null },
  { id: "breached", title: "Breached SLAs", kind: "count", table: "incident", filter: 'sla_breached = true and state in ["new", "assigned", "in_progress", "on_hold"]', group_by: null, bucket: null },
  { id: "opened-per-day", title: "Opened per day", kind: "trend", table: "incident", filter: "", group_by: null, bucket: "day" },
  { id: "open-major", title: "Open major incidents", kind: "count", table: "incident", filter: 'is_major = true and state in ["new", "assigned", "in_progress", "on_hold"]', group_by: null, bucket: null },
];

const EVENTS = ["assigned", "mentioned", "sla_threshold_50", "sla_threshold_75", "sla_breach", "page", "page_exhausted", "vote_requested", "vote_result", "approval_reset", "approval_requested", "workaround_published", "major_incident_proposed", "export_finished"];

async function put(tx: Tx, kind: string, name: string, content: unknown): Promise<number> {
  return configPut(tx, "live", kind, name, content, content);
}

export async function seedIfEmpty(): Promise<void> {
  const seeded = await query("SELECT 1 FROM meta WHERE key = 'seeded'");
  if (seeded.length > 0) return;
  await transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(7402)");
    if ((await tx.query("SELECT 1 FROM meta WHERE key = 'seeded'")).length > 0) return;
    for (const d of ["Design Studio", "Finance", "Studio Operations", "Leadership", "IT provider"]) await tx.query("INSERT INTO departments (name) VALUES ($1)", [d]);
    for (const [username, display, roles, department, zone] of USERS) {
      await tx.query("INSERT INTO people (username, display_name, department) VALUES ($1, $2, $3)", [username, display, department]);
      await tx.query("INSERT INTO users (username, password_hash, roles, time_zone) VALUES ($1, $2, $3, $4)", [username, await hashPassword(`${username}${PASSWORD_SUFFIX}`), roles, zone]);
    }
    for (const [prefix, label, count, department] of DIRECTORY) {
      for (let i = 1; i <= count; i++) {
        const number = String(i).padStart(2, "0");
        await tx.query("INSERT INTO people (username, display_name, department) VALUES ($1, $2, $3)", [`${prefix}${number}`, `${label} ${number}`, department]);
      }
    }
    await tx.query("INSERT INTO groups (name, members, escalation_policy) VALUES ('Desk', ARRAY['oona','teodor','bastian'], 'Desk ladder'), ('Triage', '{}', NULL)");
    await put(tx, "schedule", "Office hours", { name: "Office hours", time_zone: "Europe/Berlin", hours: HOURS_OFFICE, holidays: ["2026-01-01", "2026-04-03", "2026-04-06", "2026-05-01", "2026-05-14", "2026-05-25", "2026-10-03", "2026-12-25", "2026-12-26"] });
    await put(tx, "schedule", "Around the clock", { name: "Around the clock", time_zone: "Europe/Berlin", hours: HOURS_ALWAYS, holidays: [] });
    const min = (n: number): number => n * 60;
    const hour = (n: number): number => n * 3600;
    await put(tx, "sla_definition", "Incident response", { name: "Incident response", table: "incident", start: "true", pause: 'state = "on_hold"', stop: 'state != "new"', schedule: "Office hours", targets: TARGETS([min(15), min(30), hour(1), hour(4), hour(8)]) });
    await put(tx, "sla_definition", "Incident resolution", { name: "Incident resolution", table: "incident", start: "true", pause: 'state = "on_hold"', stop: 'state in ["resolved", "closed", "cancelled"]', schedule: "Office hours", targets: TARGETS([hour(4), hour(9), hour(18), hour(36), hour(72)]) });
    await put(tx, "sla_definition", "Request fulfilment", { name: "Request fulfilment", table: "request_item", start: "true", pause: 'state = "awaiting_approval"', stop: 'state in ["delivered", "closed", "rejected", "cancelled"]', schedule: "Office hours", targets: TARGETS([hour(27), hour(27), hour(27), hour(27), hour(27)]) });
    for (const [name, crit, bc, usedBy] of SERVICES) {
      await tx.query("INSERT INTO cis (name, class, criticality, business_critical, owner_department, attributes, used_by) VALUES ($1, 'Business service', $2, $3, 'IT provider', '{}', $4)", [name, crit, bc, JSON.stringify(usedBy)]);
    }
    for (const [name, cls, crit, attributes] of ITEMS) {
      await tx.query("INSERT INTO cis (name, class, criticality, business_critical, owner_department, attributes) VALUES ($1, $2, $3, false, 'IT provider', $4)", [name, cls, crit, JSON.stringify(attributes)]);
    }
    for (const [source, type, target] of RELATIONSHIPS) await tx.query("INSERT INTO relationships (source, type, target) VALUES ($1, $2, $3)", [source, type, target]);
    await tx.query("INSERT INTO freeze_windows (name, start_at, end_at, time_zone, scope) VALUES ('Payroll freeze', '2026-11-25T00:00:00+01:00', '2026-12-01T00:00:00+01:00', 'Europe/Berlin', $1), ('Year-end freeze', '2026-12-21T00:00:00+01:00', '2027-01-04T00:00:00+01:00', 'Europe/Berlin', '\"all\"')", [JSON.stringify({ items: ["Payroll"] })]);
    await tx.query("INSERT INTO boards (name, rule, n, threshold_percent, window_hours, members) VALUES ('Change board', 'weighted', NULL, 60, 48, $1), ('Emergency board', 'any', NULL, NULL, 1, $2)", [
      JSON.stringify([{ username: "ana", weight: 2 }, { username: "dev", weight: 1 }, { username: "jonas", weight: 1 }]),
      JSON.stringify([{ username: "ana", weight: 1 }, { username: "dev", weight: 1 }, { username: "jonas", weight: 1 }]),
    ]);
    await tx.query("INSERT INTO rotations (name, time_zone, handover_weekday, handover_time, members, anchor_date) VALUES ('Weekly on-call', 'Europe/Berlin', 'monday', '09:00', ARRAY['teodor','bastian'], '2026-01-05')");
    await tx.query("INSERT INTO escalation_policies (name, levels) VALUES ('Desk ladder', $1)", [JSON.stringify([{ target: { rotation: "Weekly on-call" }, ack_minutes: null }, { target: { user: "oona" }, ack_minutes: null }])]);
    await put(tx, "assignment_rule", "Payroll to Desk", { name: "Payroll to Desk", order: 100, table: "incident", condition: 'configuration_item.name = "Payroll"', group: "Desk", active: true });
    await put(tx, "assignment_rule", "Everything to Desk", { name: "Everything to Desk", order: 200, table: "incident", condition: "true", group: "Desk", active: true });
    await put(tx, "business_rule", "Major incidents are resolved", { name: "Major incidents are resolved", table: "incident", when: "before", order: 100, operations: ["insert", "update"], condition: 'is_major = true and changes_to(state, "cancelled")', actions: [{ abort: "Major incidents are resolved, not cancelled." }], active: true });
    await put(tx, "access_rule", "Affected person hidden from managers", { name: "Affected person hidden from managers", type: "field", table: "incident", field: "affected_person", operation: "read", roles: ["manager"], condition: null, active: true });
    await put(tx, "access_rule", "Confidential incidents", { name: "Confidential incidents", type: "row", table: "incident", field: null, operation: "read", roles: ["technician", "manager", "approver"], condition: "confidential = true", active: true });
    const policy = (name: string, table: string | null, item: string | null, order: number, condition: string, actions: unknown[]): Promise<number> => put(tx, "form_policy", name, { name, table, catalog_item: item, order, condition, actions });
    await policy("Studio laptops need a reason", null, "laptop", 100, 'variables.model = "studio16"', [{ field: "justification", mandatory: true, visible: true, read_only: null }]);
    await policy("Laptop reason hidden otherwise", null, "laptop", 50, "true", [{ field: "justification", mandatory: false, visible: false, read_only: null }]);
    await policy("Cost centre is fixed", null, "software-licence", 100, "true", [{ field: "cost_centre", mandatory: null, visible: null, read_only: true }]);
    await policy("Hold reason when on hold", "incident", null, 100, 'state = "on_hold"', [{ field: "hold_reason", mandatory: true, visible: true, read_only: null }]);
    await policy("Hold reason hidden otherwise", "incident", null, 50, "true", [{ field: "hold_reason", mandatory: null, visible: false, read_only: null }]);
    for (const item of CATALOG) await put(tx, "catalog_item", item.name, item);
    await tx.query("INSERT INTO guides (id, name, questions, rules) VALUES ('new-starter', 'New starter', $1, $2)", [
      JSON.stringify([select("role", "New starter's role", [["architect", "Architect", null], ["finance", "Finance", null], ["operations", "Operations", null]])]),
      JSON.stringify([{ item: "laptop", condition: "true" }, { item: "software-licence", condition: 'answers.role = "architect"' }, { item: "shared-drive", condition: "true" }, { item: "building-pass", condition: "true" }]),
    ]);
    for (const event of EVENTS) await put(tx, "inbox_rule", event, { name: event, event, roles: ALL_ROLES, enabled: true });
    const widgets = JSON.stringify(DASHBOARD_WIDGETS);
    await tx.query("INSERT INTO dashboards (id, name, roles, widgets) VALUES ('desk-overview', 'Desk overview', ARRAY['operator','technician'], $1), ('department-standing', 'Department standing', ARRAY['manager','operator'], $1)", [widgets]);
    for (const [name, filter] of [
      ["Open incidents", 'state in ["new", "assigned", "in_progress", "on_hold"]'],
      ["My work", 'assigned_to.username = me() and state in ["new", "assigned", "in_progress", "on_hold"]'],
      ["Unassigned", 'is_empty(assigned_to) and state in ["new", "assigned"]'],
      ["Awaiting requester", 'state = "on_hold" and hold_reason = "awaiting_requester"'],
      ["Major incidents", 'is_major = true and state in ["new", "assigned", "in_progress", "on_hold"]'],
    ] as const) {
      await tx.query("INSERT INTO filters (name, table_name, filter, shared, owner) VALUES ($1, 'incident', $2, true, 'oona')", [name, filter]);
    }
    for (const [number, title, keywords, body, yes, no, audience, validUntil] of ARTICLES) {
      const code = `ART-${String(number).padStart(6, "0")}`;
      await tx.query("INSERT INTO articles (number, version, title, body, keywords, state, valid_until, audience, author, published_at, helpful_yes, helpful_no) VALUES ($1, 1, $2, $3, $4, 'published', $5, $6, 'oona', $7, $8, $9)", [code, title, body, keywords, validUntil, JSON.stringify(audience), new Date(now()).toISOString(), yes, no]);
    }
    await tx.query("INSERT INTO sequences (name, value) VALUES ('article', 5) ON CONFLICT (name) DO NOTHING");
    await seedRecords(tx);
    await tx.query("INSERT INTO meta (key, value) VALUES ('seeded', 'true')");
  });
  await seedWorkflows();
}

async function seedRecords(tx: Tx): Promise<void> {
  const env = await Env.create(tx, SYSTEM);
  const createdAt = new Date(now()).toISOString();
  const incident = (fields: Record<string, unknown>, state: string): Promise<unknown> =>
    save(env, {
      table: "incident",
      number: null,
      submitted: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { value: v as never }])),
      system: true,
      fixture: { createdAt, createdBy: "oona", state, history: [{ state, at: createdAt }] },
    });
  await incident({ short_description: "Plotter on level 2 jams on A1 sheets", caller: "ruth", configuration_item: "Printing", impact: 3, urgency: 2, assignment_group: "Desk", assigned_to: "teodor", problem: "ROOT-000001" }, "assigned");
  await incident({ short_description: "Payroll export missing two contractors", caller: "kofi", configuration_item: "Payroll", impact: 2, urgency: 1, assigned_to: "oona" }, "in_progress");
  await incident({ short_description: "Remote access drops every 20 minutes from home", caller: "dev", configuration_item: "Remote access", impact: 3, urgency: 3 }, "new");
  await save(env, { table: "problem", number: null, submitted: { short_description: { value: "Plotter jams on large sheets" } }, system: true, fixture: { createdAt, createdBy: "oona", state: "assessing", history: [{ state: "assessing", at: createdAt }] } });
  await save(env, {
    table: "change",
    number: null,
    submitted: { title: { value: "Patch print server" }, model: { value: "normal" }, configuration_item: { value: "Print server" } },
    system: true,
    fixture: { createdAt, createdBy: "oona", state: "draft", history: [{ state: "draft", at: createdAt }] },
  });
}

async function seedWorkflows(): Promise<void> {
  await transaction(async (tx) => {
    for (const flow of WORKFLOWS) {
      const content: WorkflowContent = { name: flow.name, kind: "flow", inputs: [], outputs: [], draft: flow.steps };
      const id = await put(tx, "workflow", flow.name, content);
      await tx.query("INSERT INTO workflow_versions (workflow_id, version, steps) VALUES ($1, 1, $2) ON CONFLICT DO NOTHING", [id, JSON.stringify(flow.steps)]);
      await tx.query("UPDATE config_items SET promoted = $2 WHERE id = $1", [id, JSON.stringify({ ...content, published: { version: 1, steps: flow.steps } })]);
    }
  });
}
