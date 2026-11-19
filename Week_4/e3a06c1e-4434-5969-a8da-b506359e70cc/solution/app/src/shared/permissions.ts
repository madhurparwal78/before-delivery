// The permission table: which roles may take each action. The server enforces it; the console
// uses it to show only the tabs, links and controls a role may use.
import type { Role } from "./types";

export type Action =
  | "profile"
  | "projects.read"
  | "admin"
  | "keys.list"
  | "sessions.operate"
  | "sessions.read"
  | "corrections.list"
  | "corrections.author"
  | "corrections.decide"
  | "usage.read";

const ALLOWED: Record<Action, readonly Role[]> = {
  profile: ["admin", "developer", "reviewer", "approver", "billing"],
  "projects.read": ["admin", "developer", "reviewer", "approver", "billing"],
  admin: ["admin"],
  "keys.list": ["admin", "developer"],
  "sessions.operate": ["admin", "developer"],
  "sessions.read": ["admin", "developer", "reviewer", "approver"],
  "corrections.list": ["admin", "developer", "reviewer", "approver"],
  "corrections.author": ["reviewer", "approver"],
  "corrections.decide": ["approver"],
  "usage.read": ["admin", "billing"],
};

export function allows(role: Role, action: Action): boolean {
  return ALLOWED[action].includes(role);
}

export function landing(role: Role): string {
  return role === "billing" ? "/console/usage" : "/console/projects";
}

export type ProjectTab = "keys" | "sessions" | "review" | "synthesis" | "settings";

/** The action that opens each project tab. */
export const TAB_ACTION: Record<ProjectTab, Action> = {
  keys: "keys.list",
  sessions: "sessions.read",
  review: "corrections.list",
  synthesis: "sessions.operate",
  settings: "admin",
};
