import type { Role } from "./types.js";

interface Screen {
  pattern: RegExp;
  /** Roles that may open it; undefined means anyone. */
  roles?: Role[];
}

const all: Role[] = ["operator", "technician", "approver", "manager", "requester"];

/** The published role-to-screen table. Paths are matched after trailing slashes are removed. */
const SCREENS: Screen[] = [
  { pattern: /^\/$/ },
  { pattern: /^\/login$/ },
  { pattern: /^\/portal(\/.*)?$/, roles: all },
  { pattern: /^\/inbox$/, roles: all },
  { pattern: /^\/desk$/, roles: ["operator", "technician", "approver", "manager"] },
  { pattern: /^\/desk\/lists\/[^/]+$/, roles: ["operator", "technician", "approver", "manager"] },
  { pattern: /^\/desk\/records\/[^/]+$/, roles: ["operator", "technician", "approver", "manager"] },
  { pattern: /^\/desk\/records\/new\/(incident|problem|task)$/, roles: ["operator", "technician"] },
  { pattern: /^\/desk\/records\/new\/change$/, roles: ["operator"] },
  { pattern: /^\/desk\/map$/, roles: ["operator", "technician", "manager"] },
  { pattern: /^\/desk\/major\/[^/]+$/, roles: ["operator", "technician", "manager"] },
  { pattern: /^\/desk\/changes\/calendar$/, roles: ["operator", "technician", "approver"] },
  { pattern: /^\/desk\/boards\/[^/]+$/, roles: ["operator", "technician", "approver"] },
  { pattern: /^\/approve$/, roles: ["operator", "approver"] },
  { pattern: /^\/desk\/oncall$/, roles: ["operator", "technician"] },
  { pattern: /^\/pages$/, roles: ["operator", "technician"] },
  { pattern: /^\/desk\/runs\/[^/]+$/, roles: ["operator", "technician"] },
  { pattern: /^\/desk\/dashboards\/[^/]+$/, roles: ["operator", "technician"] },
  { pattern: /^\/desk\/exports$/, roles: ["operator", "technician", "manager"] },
  { pattern: /^\/dashboards\/[^/]+$/, roles: ["operator", "manager"] },
  { pattern: /^\/desk\/workflows\/[^/]+$/, roles: ["operator"] },
  { pattern: /^\/desk\/admin\/[^/]+$/, roles: ["operator"] },
  { pattern: /^\/desk\/config-sets$/, roles: ["operator"] },
  { pattern: /^\/desk\/imports$/, roles: ["operator"] },
];

export const ADMIN_KINDS: Record<string, { plural: string; singular: string }> = {
  "business-rules": { plural: "Business rules", singular: "business rule" },
  "access-rules": { plural: "Access rules", singular: "access rule" },
  "assignment-rules": { plural: "Assignment rules", singular: "assignment rule" },
  "form-policies": { plural: "Form policies", singular: "form policy" },
  "sla-definitions": { plural: "SLA definitions", singular: "SLA definition" },
  schedules: { plural: "Business schedules", singular: "business schedule" },
  "escalation-policies": { plural: "Escalation policies", singular: "escalation policy" },
  boards: { plural: "Change boards", singular: "change board" },
  "freeze-windows": { plural: "Freeze windows", singular: "freeze window" },
  "catalog-items": { plural: "Catalog items", singular: "catalog item" },
  "inbox-rules": { plural: "Inbox rules", singular: "inbox rule" },
  users: { plural: "Users", singular: "user" },
  "audit-log": { plural: "Audit log", singular: "(read-only list of impersonation entries)" },
};

type ScreenVerdict = "public" | "allowed" | "login" | "missing";

function normalisePath(path: string): string {
  const clean = path.split("?")[0]!.split("#")[0]!;
  return clean.length > 1 ? clean.replace(/\/+$/, "") : clean;
}

/** Who may open a path: public, allowed for these roles, needs sign-in, or unknown (not found). */
export function judgeScreen(path: string, roles: readonly string[] | null): ScreenVerdict {
  const clean = normalisePath(path);
  const screen = SCREENS.find((s) => s.pattern.test(clean));
  if (!screen) return "missing";
  if (clean.startsWith("/desk/admin/") && !(clean.slice("/desk/admin/".length) in ADMIN_KINDS)) return "missing";
  if (!screen.roles) return "public";
  if (!roles) return "login";
  return roles.some((role) => screen.roles!.includes(role as Role)) ? "allowed" : "missing";
}
