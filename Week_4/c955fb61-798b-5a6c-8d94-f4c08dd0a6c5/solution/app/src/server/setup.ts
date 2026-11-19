import { WorkCalendar, isIsoDate } from "../shared/calendar";
import { LAG_LIMIT, LINK_TYPES, type ItemKind, type LinkType, type Role } from "../shared/types";
import { hashPassword } from "./auth";
import { inTransaction, newId } from "./db";
import { invalidField } from "./errors";
import { openRoute } from "./http";
import { loopPath } from "./links";
import { loadProject } from "./model";

type Fields = Record<string, unknown>;

function record(value: unknown, path: string): Fields {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalidField(path);
  return value as Fields;
}

function list(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw invalidField(path);
  return value;
}

function str(fields: Fields, key: string, path: string): string {
  const value = fields[key];
  if (typeof value !== "string" || value.trim() === "") throw invalidField(`${path}.${key}`);
  return value;
}

function num(fields: Fields, key: string, path: string, min: number, max: number): number {
  const value = fields[key];
  if (typeof value !== "number" || value < min || value > max) throw invalidField(`${path}.${key}`);
  return value;
}

interface SetupItem {
  key: string;
  name: string;
  kind: ItemKind;
  group: string | null;
  start: string;
  duration: number;
  percent: number;
  assignees: { email: string; hours: number }[];
}

const ROLES: readonly Role[] = ["owner", "editor", "viewer"];
const KINDS: readonly ItemKind[] = ["task", "milestone", "group"];

function parseItem(raw: unknown, path: string): SetupItem {
  const fields = record(raw, path);
  const kind = KINDS.find((candidate) => candidate === fields.kind);
  if (!kind) throw invalidField(`${path}.kind`);
  const isGroup = kind === "group";
  if (!isGroup && !isIsoDate(fields.start)) throw invalidField(`${path}.start`);
  return {
    key: str(fields, "key", path),
    name: str(fields, "name", path),
    kind,
    group: fields.group === null || fields.group === undefined ? null : str(fields, "group", path),
    start: isGroup ? "" : String(fields.start),
    duration: isGroup ? 0 : num(fields, "duration", path, 0, 999),
    percent: isGroup ? 0 : num(fields, "percent", path, 0, 100),
    assignees: list(fields.assignees ?? [], `${path}.assignees`).map((entry, index) => {
      const assignee = record(entry, `${path}.assignees[${index}]`);
      return { email: str(assignee, "email", `${path}.assignees[${index}]`).toLowerCase(), hours: num(assignee, "hours", `${path}.assignees[${index}]`, 0.5, 24) };
    }),
  };
}

openRoute(
  "POST",
  "/api/grading/setup",
  async ({ body }) => {
    const users = list(body.users, "users").map((raw, index) => {
      const fields = record(raw, `users[${index}]`);
      const path = `users[${index}]`;
      const email = str(fields, "email", path);
      return { email, lower: email.toLowerCase(), name: str(fields, "name", path), password: str(fields, "password", path), capacity: num(fields, "capacity", path, 0.5, 24) };
    });
    const workspace = record(body.workspace, "workspace");
    const members = list(workspace.members, "workspace.members").map((raw, index) => {
      const fields = record(raw, `workspace.members[${index}]`);
      const role = ROLES.find((candidate) => candidate === fields.role);
      if (!role) throw invalidField(`workspace.members[${index}].role`);
      return { email: str(fields, "email", `workspace.members[${index}]`).toLowerCase(), role };
    });
    const workspaceName = str(workspace, "name", "workspace");
    const projects = list(body.projects, "projects").map((raw, index) => {
      const path = `projects[${index}]`;
      const fields = record(raw, path);
      return {
        name: str(fields, "name", path),
        holidays: list(fields.holidays ?? [], `${path}.holidays`).map((entry, at) => {
          const holiday = record(entry, `${path}.holidays[${at}]`);
          if (!isIsoDate(holiday.date)) throw invalidField(`${path}.holidays[${at}].date`);
          return { date: holiday.date, name: str(holiday, "name", `${path}.holidays[${at}]`) };
        }),
        items: list(fields.items, `${path}.items`).map((entry, at) => parseItem(entry, `${path}.items[${at}]`)),
        links: list(fields.links ?? [], `${path}.links`).map((entry, at) => {
          const link = record(entry, `${path}.links[${at}]`);
          const type: LinkType | undefined = LINK_TYPES.find((candidate) => candidate === link.type);
          if (!type) throw invalidField(`${path}.links[${at}].type`);
          return { from: str(link, "from", `${path}.links[${at}]`), to: str(link, "to", `${path}.links[${at}]`), type, lag: num(link, "lag", `${path}.links[${at}]`, -LAG_LIMIT, LAG_LIMIT) };
        }),
        baseline: fields.baseline === null || fields.baseline === undefined ? null : str(record(fields.baseline, `${path}.baseline`), "name", `${path}.baseline`),
      };
    });
    const hashes = await Promise.all(users.map((user) => hashPassword(user.password)));

    return inTransaction(async (tx) => {
      const userIds = new Map<string, string>();
      for (const [index, user] of users.entries()) {
        const existing = await tx.query("SELECT id FROM users WHERE email = $1", [user.lower]);
        if (existing.rowCount === 0) {
          const id = newId();
          await tx.query("INSERT INTO users (id, name, email, password_hash, capacity) VALUES ($1, $2, $3, $4, $5)", [id, user.name, user.lower, hashes[index], user.capacity]);
          userIds.set(user.lower, id);
        } else {
          await tx.query("UPDATE users SET name = $2, password_hash = $3, capacity = $4 WHERE id = $1", [existing.rows[0].id, user.name, hashes[index], user.capacity]);
          userIds.set(user.lower, existing.rows[0].id);
        }
      }
      const known = (email: string, path: string): string => {
        const id = userIds.get(email);
        if (!id) throw invalidField(path);
        return id;
      };
      const workspaceId = newId();
      await tx.query("INSERT INTO workspaces (id, name) VALUES ($1, $2)", [workspaceId, workspaceName]);
      for (const [index, member] of members.entries()) {
        await tx.query("INSERT INTO members (workspace_id, user_id, role) VALUES ($1, $2, $3)", [workspaceId, known(member.email, `workspace.members[${index}].email`), member.role]);
      }
      const firstOwner = members.find((member) => member.role === "owner") ?? members[0];
      const updatedBy = known(firstOwner.email, "workspace.members");

      const created: { name: string; id: string; items: Record<string, string> }[] = [];
      for (const [index, project] of projects.entries()) {
        const path = `projects[${index}]`;
        const projectId = newId();
        await tx.query("INSERT INTO projects (id, workspace_id, name) VALUES ($1, $2, $3)", [projectId, workspaceId, project.name]);
        for (const holiday of project.holidays) await tx.query("INSERT INTO holidays (project_id, on_date, name) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [projectId, holiday.date, holiday.name]);
        const calendar = new WorkCalendar(project.holidays.map((holiday) => holiday.date));
        const ids: Record<string, string> = Object.fromEntries(project.items.map((item) => [item.key, newId()]));
        for (const [at, item] of project.items.entries()) {
          const group = item.group === null ? null : project.items.find((candidate) => candidate.key === item.group && candidate.kind === "group");
          if (item.group !== null && !group) throw invalidField(`${path}.items[${at}].group`);
          await tx.query(
            `INSERT INTO items (id, project_id, position, name, kind, group_id, chosen_start, duration, percent, updated_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [ids[item.key], projectId, at + 1, item.name, item.kind, group ? ids[group.key] : null, item.kind === "group" ? null : calendar.nextWorking(item.start), item.kind === "milestone" ? 0 : item.duration, item.percent, updatedBy],
          );
        }
        for (const [at, item] of project.items.entries()) {
          for (const assignee of item.assignees) {
            await tx.query("INSERT INTO assignments (item_id, user_id, hours) VALUES ($1, $2, $3)", [ids[item.key], known(assignee.email, `${path}.items[${at}].assignees`), assignee.hours]);
          }
        }
        const placed: { from: string; to: string }[] = [];
        for (const [at, link] of project.links.entries()) {
          if (!(link.from in ids)) throw invalidField(`${path}.links[${at}].from`);
          if (!(link.to in ids)) throw invalidField(`${path}.links[${at}].to`);
          const rowOf = (id: string) => project.items.findIndex((item) => ids[item.key] === id);
          if (link.from === link.to || loopPath(placed, rowOf, ids[link.from], ids[link.to])) throw invalidField(`${path}.links[${at}]`);
          placed.push({ from: ids[link.from], to: ids[link.to] });
          await tx.query("INSERT INTO links (id, project_id, from_id, to_id, type, lag) VALUES ($1, $2, $3, $4, $5, $6)", [newId(), projectId, ids[link.from], ids[link.to], link.type, link.lag]);
        }
        if (project.baseline !== null) {
          const loaded = await loadProject(tx, projectId);
          for (const item of loaded.items) {
            const dates = loaded.schedule.items[item.id];
            if (item.kind !== "group") await tx.query("UPDATE items SET baseline_start = $2, baseline_end = $3 WHERE id = $1", [item.id, dates.start, dates.end]);
          }
          await tx.query("UPDATE projects SET baseline_name = $2, baseline_finish = $3 WHERE id = $1", [projectId, project.baseline, loaded.schedule.finish]);
        }
        created.push({ name: project.name, id: projectId, items: ids });
      }
      return {
        status: 201,
        body: { workspace: { id: workspaceId }, users: users.map((user) => ({ email: user.email, id: userIds.get(user.lower) })), projects: created },
      };
    });
  },
  "grading",
);
