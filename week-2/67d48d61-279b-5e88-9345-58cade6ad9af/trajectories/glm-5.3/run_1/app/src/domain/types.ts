import type { Status, Priority, CascadeEntry } from "./model.js";
import { idFromNumber } from "./model.js";

export interface TaskRow {
  number: number;
  title: string;
  details: string;
  department: string;
  label: string | null;
  status: Status;
  priority: Priority;
  owner: string | null;
  cycle: string | null;
  parent: number | null;
  duplicate_of: number | null;
  request: string | null;
  version: number;
  updated_at: Date;
}

export interface TaskJson {
  id: string; number: number; title: string; details: string; department: string;
  label: string | null; status: Status; priority: Priority; owner: string | null;
  cycle: string | null; parent: string | null; subtasks: { done: number; total: number } | null;
  blocked_by: string[]; blocks: string[]; blocked: boolean; duplicate_of: string | null;
  request: string | null; version: number; updated_at: string;
}

export interface SnapshotJson {
  seq: number; triage: number;
  columns: Record<string, number>; blocked: number;
  cycles: { key: string; name: string; starts_at: string; ends_at: string | null; current: boolean; done: number; total: number }[];
}

export interface ActivityJson {
  id: number; task: string; at: string; actor: { handle: string; name: string } | null;
  kind: string; changes: Record<string, { from: unknown; to: unknown }>; change: number | null;
}

export interface ChangeResult {
  change: number; undoable: boolean; tasks: TaskJson[];
  cascade: CascadeEntry[]; reblocked: { id: string; order: number }[]; snapshot: SnapshotJson;
  kind?: string; request?: RequestJson | null;
}

export interface RequestJson {
  id: string; title: string; details: string; requester: string; department: string;
  status: string; task: string | null; created: string; decided_at: string | null;
}

export interface AttachmentJson {
  id: string; task: string; file_name: string; kind: string; size: number;
  content_type: string; created_at: string; current: boolean;
}

export interface ProductionJson {
  theatre: string; show: string; time_zone: string; today: string; opening_night: string;
  days_to_opening: number; current_cycle: string;
  departments: { key: string; name: string; labels: { key: string; name: string }[] }[];
  crew: { handle: string; name: string; role: string; department: string | null }[];
}

export interface StoredUndo {
  change: number; crew: string; kind: "edit" | "bulk";
  before: TaskBefore[]; after_versions: { number: number; version: number }[];
  cascade: CascadeEntry[];
}

/** Snapshot of every restored field of one task (DP-15). */
export interface TaskBefore {
  number: number; status: Status; priority: Priority; owner: string | null;
  title: string; details: string; label: string | null; cycle: string | null;
}

export function taskToJson(t: TaskRow, rel: { blockedBy: number[]; blocks: number[]; subtasks: { done: number; total: number } | null, blocked: boolean }): TaskJson {
  return {
    id: idFromNumber(t.number), number: t.number, title: t.title, details: t.details,
    department: t.department, label: t.label, status: t.status, priority: t.priority,
    owner: t.owner, cycle: t.cycle, parent: t.parent === null ? null : idFromNumber(t.parent),
    subtasks: rel.subtasks, blocked_by: rel.blockedBy.map(idFromNumber), blocks: rel.blocks.map(idFromNumber),
    blocked: rel.blocked, duplicate_of: t.duplicate_of === null ? null : idFromNumber(t.duplicate_of),
    request: t.request, version: t.version, updated_at: t.updated_at.toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
}
