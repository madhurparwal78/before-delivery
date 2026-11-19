export interface Section { id: string; name: string; position: number }
export type FieldType = "text" | "number" | "date" | "single_select" | "multi_select" | "formula";
export interface Field { id: string; name: string; type: FieldType; options: string[]; formula: string | null }
export interface Member { id: string; name: string; email: string }
export interface ProjectInfo {
  id: string; name: string; teamId: string; progress: number; members: Member[]; sections: Section[]; fields: Field[]; trace: string[];
}
export type FieldValue = string | number | boolean | string[] | null;
export interface Task {
  id: string; projectId: string; name: string; description: string; section: string; position: number; parentId: string | null;
  assigneeId: string | null; start: string | null; due: string | null; effort: number | null; completed: boolean; version: number;
  recurrence: string | null; dueStatus: "overdue" | "today" | "later" | "none"; values: Record<string, FieldValue>; blocks: string[];
}
export interface Hold { field: string; holder: { id: string; name: string }; expiresAt: string }
export interface Approval { id: string | null; status: "requested" | "approved" | "changes_requested" | "rejected" | null; approverId: string | null; requesterId: string | null }
export interface TaskDetail extends Omit<Task, "blocks"> {
  attachments: Array<{ id: string; name: string; size: number }>;
  approval: Approval;
  blocks: string[]; blockedBy: string[];
  history: Array<{ text: string; createdAt: string }>;
  viewing: Array<{ id: string; name: string }>;
  holds: Hold[];
}
export interface RuleRun { id: string; depth: number; summary: string; detail: string; createdAt: string }
export interface Trigger { type: string; field?: string; value?: unknown; section?: string }
export interface Condition { field: string; op: string; value?: unknown }
export interface Action { type: string; target?: string; value?: unknown }
export interface Rule { id: string; name: string; position: number; trigger: Trigger; condition: Condition | null; action: Action }
export interface Team { id: string; name: string; role: "coordinator" | "member" }
export interface Me { id: string; name: string; email: string; verified: boolean; teams: Team[] }
export interface Goal {
  id: string; name: string; parentId: string | null; weight: number; manualValue: number; ownerId: string | null;
  progress: number; percent: number; projects: Array<{ projectId: string; name: string; weight: number; progress: number }>;
}
export interface WorkloadCell { date: string; total: number; capacity: number; over: boolean; text: string; tasks: Array<{ id: string; name: string }> }
export interface Workload { from: string; days: string[]; teamName: string; people: Array<{ id: string; name: string; cells: WorkloadCell[] }> }
export interface InboxItem { id: string; text: string; taskId: string | null; kind: string; read: boolean; createdAt: string; pending: boolean }
export interface Config { moveMs: number; progressMs: number; toastMs: number; holdTimeoutMs: number }
export interface LiveEvent { t: string; team?: string; project?: string; task?: string; person?: string; [extra: string]: unknown }
