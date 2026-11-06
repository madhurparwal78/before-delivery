import { query, queryOne } from "../db.js";
import { errors } from "../errors.js";
import { type UserRow } from "./accounts.js";
import { orderById, type OrderRow } from "./orders.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireUuid(value: string | undefined): string {
  if (!value || !UUID_PATTERN.test(value)) throw errors.notFound();
  return value;
}

export interface ProjectRow {
  id: string;
  orderId: string;
  accountId: string;
  closedAt: Date | null;
}

interface ProjectRecord {
  id: string;
  order_id: string;
  account_id: string;
  closed_at: Date | null;
}

function toProject(record: ProjectRecord): ProjectRow {
  return {
    id: record.id,
    orderId: record.order_id,
    accountId: record.account_id,
    closedAt: record.closed_at,
  };
}

export async function projectById(id: string): Promise<ProjectRow | null> {
  const record = await queryOne<ProjectRecord>(
    `select id, order_id, account_id, closed_at from projects where id = $1`,
    [id],
  );
  return record ? toProject(record) : null;
}

export async function assignedContractorIds(projectId: string): Promise<string[]> {
  const rows = await query<{ contractor_id: string }>(
    `select contractor_id from project_assignments where project_id = $1`,
    [projectId],
  );
  return rows.map((row) => row.contractor_id);
}

/** The one place a project's visibility is decided. */
export async function visibleProject(user: UserRow, projectId: string): Promise<ProjectRow> {
  const project = await projectById(requireUuid(projectId));
  if (!project) throw errors.notFound();
  if (user.role === "studio_owner") return project;
  if (user.role === "client_owner" || user.role === "teammate") {
    if (user.accountId !== project.accountId) throw errors.notFound();
    return project;
  }
  const assigned = await assignedContractorIds(project.id);
  if (!assigned.includes(user.id)) throw errors.notFound();
  if (project.closedAt) throw errors.accessEnded();
  return project;
}

export async function projectsVisibleTo(user: UserRow): Promise<ProjectRow[]> {
  if (user.role === "studio_owner") {
    const records = await query<ProjectRecord>(
      `select id, order_id, account_id, closed_at from projects order by created_at asc`,
    );
    return records.map(toProject);
  }
  if (user.role === "contractor") {
    const records = await query<ProjectRecord>(
      `select p.id, p.order_id, p.account_id, p.closed_at from projects p
         join project_assignments a on a.project_id = p.id
        where a.contractor_id = $1 and p.closed_at is null
        order by p.created_at asc`,
      [user.id],
    );
    return records.map(toProject);
  }
  const records = await query<ProjectRecord>(
    `select id, order_id, account_id, closed_at from projects where account_id = $1 order by created_at asc`,
    [user.accountId],
  );
  return records.map(toProject);
}

/** The one place an order's visibility is decided. */
export async function visibleOrder(
  user: UserRow | null,
  sessionId: string | null,
  orderId: string,
): Promise<OrderRow> {
  const order = await orderById(requireUuid(orderId));
  if (!order) throw errors.notFound();
  if (order.state === "quoted") {
    if (!sessionId || order.sessionId !== sessionId) throw errors.notFound();
    return order;
  }
  if (!user) throw errors.notFound();
  if (user.role === "studio_owner") return order;
  if (user.role === "client_owner" && user.accountId === order.accountId) return order;
  if (user.role === "teammate" && user.accountId === order.accountId) throw errors.forbidden();
  throw errors.notFound();
}

export async function canUploadDeliverable(user: UserRow, project: ProjectRow): Promise<boolean> {
  if (user.role === "studio_owner") return true;
  if (user.role !== "contractor") return false;
  const assigned = await assignedContractorIds(project.id);
  return assigned.includes(user.id);
}

export function canUploadAsset(user: UserRow): boolean {
  return user.role === "client_owner" || user.role === "teammate";
}
