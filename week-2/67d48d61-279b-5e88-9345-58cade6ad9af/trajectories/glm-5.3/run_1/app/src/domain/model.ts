export type Status =
  | "triage" | "backlog" | "todo" | "in_progress" | "done" | "cancelled" | "duplicate";
export type Priority = 0 | 1 | 2 | 3 | 4;
export type DepartmentKey = "carpentry" | "paint" | "lighting" | "sound" | "wardrobe" | "props";
export type CycleKey = "rehearsal-1" | "rehearsal-2" | "rehearsal-3" | "tech" | "previews";
export type UndoKind = "edit" | "bulk";
export type ActivityKind =
  | "created" | "edited" | "auto_closed" | "auto_reopened" | "linked" | "unlinked"
  | "attached" | "decided" | "rolled" | "undo";

export interface CrewMember { handle: string; name: string; role: string; department: DepartmentKey | null }
export interface Label { key: string; name: string }
export interface Department { key: DepartmentKey; name: string; labels: Label[] }

export const CREW: CrewMember[] = [
  { handle: "maya", name: "Maya Okonjo", role: "Stage manager", department: null },
  { handle: "devi", name: "Devi Rangan", role: "Production carpenter", department: "carpentry" },
  { handle: "sasha", name: "Sasha Bell", role: "Scenic charge painter", department: "paint" },
  { handle: "ines", name: "Ines Hart", role: "Lighting lead", department: "lighting" },
  { handle: "kofi", name: "Kofi Mensah", role: "Sound lead", department: "sound" },
  { handle: "ruth", name: "Ruth Alder", role: "Costume lead", department: "wardrobe" },
  { handle: "oren", name: "Oren Vale", role: "Props lead", department: "props" },
  { handle: "leon", name: "Leon Park", role: "Director", department: null },
];

export const DEPARTMENTS: Department[] = [
  { key: "carpentry", name: "Carpentry", labels: [] },
  { key: "paint", name: "Paint", labels: [] },
  { key: "lighting", name: "Lighting", labels: [
    { key: "focus", name: "Focus" }, { key: "programming", name: "Programming" }, { key: "electrics", name: "Electrics" },
  ] },
  { key: "sound", name: "Sound", labels: [{ key: "cues", name: "Cues" }, { key: "system", name: "System" }] },
  { key: "wardrobe", name: "Wardrobe", labels: [
    { key: "fitting", name: "Fitting" }, { key: "alteration", name: "Alteration" }, { key: "quick-change", name: "Quick-change" },
  ] },
  { key: "props", name: "Props", labels: [] },
];

export const STATUS_NAMES: Record<Status, string> = {
  triage: "Triage", backlog: "Backlog", todo: "Todo", in_progress: "In progress",
  done: "Done", cancelled: "Cancelled", duplicate: "Duplicate",
};
export const STATUS_ORDER: Status[] = ["backlog", "todo", "in_progress", "done", "cancelled"];
export const PRIORITY_NAMES: Record<Priority, string> = {
  0: "No priority", 1: "Urgent", 2: "High", 3: "Medium", 4: "Low",
};
export const PRIORITY_ORDER: Priority[] = [1, 2, 3, 4, 0];

export const CYCLES: { key: CycleKey; name: string }[] = [
  { key: "rehearsal-1", name: "Rehearsal 1" },
  { key: "rehearsal-2", name: "Rehearsal 2" },
  { key: "rehearsal-3", name: "Rehearsal 3" },
  { key: "tech", name: "Tech" },
  { key: "previews", name: "Previews" },
];
export const CYCLE_INDEX: Record<CycleKey, number> = {
  "rehearsal-1": 0, "rehearsal-2": 1, "rehearsal-3": 2, tech: 3, previews: 4,
};

export const OPEN_STATUSES: Status[] = ["backlog", "todo", "in_progress"];
export const CLOSED_STATUSES: Status[] = ["done", "cancelled", "duplicate"];
export const EDITABLE_STATUSES: Status[] = ["backlog", "todo", "in_progress", "done", "cancelled"];

export function isStatus(s: unknown): s is Status { return typeof s === "string" && s in STATUS_NAMES }
export function isPriority(p: unknown): p is Priority {
  return typeof p === "number" && Number.isInteger(p) && p >= 0 && p <= 4;
}
export function isCycleKey(c: unknown): c is CycleKey { return typeof c === "string" && c in CYCLE_INDEX }
export function isDepartmentKey(d: unknown): d is DepartmentKey {
  return typeof d === "string" && DEPARTMENTS.some((x) => x.key === d);
}
export function isCrewHandle(h: unknown): h is string {
  return typeof h === "string" && CREW.some((c) => c.handle === h);
}
export function isLabelFor(department: DepartmentKey, label: string): boolean {
  return DEPARTMENTS.find((d) => d.key === department)?.labels.some((l) => l.key === label) ?? false;
}
export function crewName(handle: string | null): string | null {
  return handle === null ? null : (CREW.find((c) => c.handle === handle)?.name ?? null);
}
export function departmentName(key: string): string {
  return DEPARTMENTS.find((d) => d.key === key)?.name ?? key;
}
export function cycleName(key: string): string {
  return CYCLES.find((c) => c.key === key)?.name ?? key;
}

/** The one place that decides legal status moves (DP-44). */
export function legalStatusMove(from: Status, to: Status): boolean {
  if (from === to) return false;
  if (from === "triage" || from === "duplicate") return false;
  if (from === "done") return to === "todo" || to === "in_progress";
  if (from === "cancelled") return to === "backlog";
  return to === "backlog" || to === "todo" || to === "in_progress" || to === "done" || to === "cancelled";
}

/** The one place that decides the blocked overlay (DP-10). */
export function isBlocked(status: Status, anyOpenBlocker: boolean): boolean {
  return OPEN_STATUSES.includes(status) && anyOpenBlocker;
}

export interface CascadeEntry { id: string; depth: number; order: number; freed_by: string }
export interface ReblockedEntry { id: string; order: number }

/**
 * The one place that computes the cascade order (DP-11).
 * freed: each task that went from blocked to unblocked while staying open, with its blockers that closed in this change.
 */
export function computeCascade(
  freed: { id: string; blockersClosedInChange: { id: string; number: number; level: number }[] }[],
): CascadeEntry[] {
  const entries: (CascadeEntry & { num: number })[] = freed.map((f) => {
    let best = f.blockersClosedInChange[0]!;
    for (const b of f.blockersClosedInChange) {
      if (b.level > best.level || (b.level === best.level && b.number > best.number)) best = b;
    }
    const num = numberFromId(f.id);
    return { id: f.id, depth: best.level + 1, order: 0, freed_by: best.id, num };
  });
  entries.sort((a, b) => (a.depth - b.depth) || (a.num - b.num));
  entries.forEach((e, i) => { e.order = i + 1 });
  return entries.map(({ num: _num, ...e }) => e);
}

export function numberFromId(id: string): number {
  const m = /^STG-(\d+)$/.exec(id);
  return m ? Number(m[1]) : 0;
}
export function idFromNumber(n: number): string { return `STG-${n}` }
