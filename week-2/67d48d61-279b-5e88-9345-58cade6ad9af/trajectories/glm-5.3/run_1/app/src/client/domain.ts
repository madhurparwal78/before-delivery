/** Client types plus the production-driven display helpers. The crew list,
 * departments and labels come from /api/production; nothing is duplicated. */

export interface TaskJson {
  id: string; number: number; title: string; details: string; department: string;
  label: string | null; status: string; priority: number; owner: string | null;
  cycle: string | null; parent: string | null; subtasks: { done: number; total: number } | null;
  blocked_by: string[]; blocks: string[]; blocked: boolean; duplicate_of: string | null;
  request: string | null; version: number; updated_at: string;
}
export interface CycleStat { key: string; name: string; starts_at: string; ends_at: string | null; current: boolean; done: number; total: number }
export interface SnapshotJson {
  seq: number; triage: number; columns: Record<string, number>; blocked: number; cycles: CycleStat[];
}
export interface CascadeEntry { id: string; depth: number; order: number; freed_by: string }
export interface ChangeResult {
  change: number; undoable: boolean; tasks: TaskJson[]; cascade: CascadeEntry[];
  reblocked: { id: string; order: number }[]; snapshot: SnapshotJson; kind?: string; request?: unknown;
}
export interface ActivityJson {
  id: number; task: string; at: string; actor: { handle: string; name: string } | null;
  kind: string; changes: Record<string, { from: unknown; to: unknown }>; change: number | null;
}
export interface AttachmentJson {
  id: string; task: string; file_name: string; kind: string; size: number;
  content_type: string; created_at: string; current: boolean;
}
export interface RequestJson {
  id: string; title: string; details: string; requester: string; department: string;
  status: string; task: string | null; created: string; decided_at: string | null;
}
export interface CrewEntry { handle: string; name: string; role: string; department: string | null }
export interface ProductionJson {
  theatre: string; show: string; time_zone: string; today: string; opening_night: string;
  days_to_opening: number; current_cycle: string;
  departments: { key: string; name: string; labels: { key: string; name: string }[] }[];
  crew: CrewEntry[];
}

export const CYCLE_KEYS = ["rehearsal-1", "rehearsal-2", "rehearsal-3", "tech", "previews"];
export const STATUS_ORDER = ["backlog", "todo", "in_progress", "done", "cancelled"];
export const DEPT_ORDER = ["carpentry", "paint", "lighting", "sound", "wardrobe", "props"];

let prod: ProductionJson | null = null;
export function setProduction(p: ProductionJson): void { prod = p }
export function production(): ProductionJson {
  if (!prod) throw new Error("production not loaded");
  return prod;
}

export const STATUS_NAMES: Record<string, string> = {
  triage: "Triage", backlog: "Backlog", todo: "Todo", in_progress: "In progress",
  done: "Done", cancelled: "Cancelled", duplicate: "Duplicate",
};
export const PRIORITY_NAMES: Record<number, string> = {
  0: "No priority", 1: "Urgent", 2: "High", 3: "Medium", 4: "Low",
};
export function statusName(s: string): string { return STATUS_NAMES[s] ?? s }
export function priorityName(p: number): string { return PRIORITY_NAMES[p] ?? String(p) }
export function crewName(handle: string | null): string | null {
  return handle === null ? null : production().crew.find((c) => c.handle === handle)?.name ?? handle;
}
export function departmentName(key: string): string {
  return production().departments.find((d) => d.key === key)?.name ?? key;
}
export function cycleName(key: string): string {
  const c = { "rehearsal-1": "Rehearsal 1", "rehearsal-2": "Rehearsal 2", "rehearsal-3": "Rehearsal 3", tech: "Tech", previews: "Previews" } as Record<string, string>;
  return c[key] ?? key;
}
export function labelName(dept: string, label: string | null): string | null {
  if (label === null) return null;
  return production().departments.find((d) => d.key === dept)?.labels.find((l) => l.key === label)?.name ?? label;
}
/** A whole number with 1-task singular copy: "<n> tasks" reads "1 task". */
export function taskWord(n: number): string { return n === 1 ? "task" : "tasks" }

/** The countdown text (DP-38, DP-50). */
export function countdownText(days: number): string {
  if (days > 1) return `${days} days to opening`;
  if (days === 1) return "1 day to opening";
  if (days === 0) return "Opening tonight";
  return "Now running";
}
