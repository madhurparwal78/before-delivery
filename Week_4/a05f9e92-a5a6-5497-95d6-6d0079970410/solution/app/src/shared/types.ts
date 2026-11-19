export const ROLES = ["operator", "technician", "approver", "manager", "requester"] as const;
export type Role = (typeof ROLES)[number];

export type Table = "incident" | "problem" | "change" | "request_item" | "task";
export const TABLES: Table[] = ["incident", "problem", "change", "request_item", "task"];

export const TABLE_LABELS: Record<Table, string> = {
  incident: "Incident",
  problem: "Problem",
  change: "Change",
  request_item: "Request item",
  task: "Task",
};

export interface SessionUser {
  username: string;
  display_name: string;
  roles: Role[];
  department: string;
  time_zone: string;
}

export function homeScreen(roles: readonly string[]): string {
  if (roles.includes("operator") || roles.includes("technician")) return "/desk";
  if (roles.includes("approver")) return "/approve";
  return "/portal";
}
