export type ISODate = string;
export type ISODateTime = string;

export interface TaskValues { [fieldName: string]: FieldValue; }
export type FieldValue = number | string | boolean | ISODate | string[] | null;

export interface Task {
  id: string;
  projectId: string;
  name: string;
  description: string;
  section: string;
  position: number;
  parentId: string | null;
  assigneeId: string | null;
  start: ISODate | null;
  due: ISODate | null;
  effort: number | null;
  completed: boolean;
  version: number;
  recurrence: string | null;
  dueStatus: 'overdue' | 'today' | 'later' | 'none';
  values: TaskValues;
}

export interface TaskDetail extends Task {
  attachments: AttachmentInfo[];
  approval: { status: ApprovalStatus; approverId: string | null };
  blocks: string[];
  blockedBy: string[];
  history: { text: string; createdAt: ISODateTime }[];
  viewing: { id: string; name: string }[];
}

export type ApprovalStatus = 'none' | 'awaiting' | 'approved' | 'changes_requested' | 'rejected';

export interface AttachmentInfo { id: string; name: string; size: number; }

export interface FieldRecord {
  id: string;
  name: string;
  type: 'text' | 'number' | 'date' | 'single_select' | 'multi_select' | 'formula';
  options: string[] | null;
  formula: string | null;
}

export interface SectionRecord { id: string; name: string; position: number; }

export interface RuleRecord {
  id: string;
  projectId: string;
  name: string;
  position: number;
  trigger: RuleTrigger;
  condition: RuleCondition | null;
  action: RuleAction;
}

export type RuleTrigger =
  | { type: 'task_added' }
  | { type: 'field_changed'; field: string; value?: string }
  | { type: 'moved_to_section'; section: string }
  | { type: 'due_date_arrives' }
  | { type: 'approval_decided' };

export interface RuleCondition { field: string; op: 'is' | 'is_not' | 'is_blank' | 'is_greater_than'; value?: string; }
export type RuleAction =
  | { type: 'set_field'; target: string; value: string }
  | { type: 'move_to_section'; target: string }
  | { type: 'assign_to'; target: string }
  | { type: 'add_subtask'; value: string }
  | { type: 'send_to_inbox'; value?: string };

export interface RuleRunEntry {
  id: string;
  depth: number;
  summary: string;
  detail: string;
  createdAt: ISODateTime;
}

export interface GoalRecord {
  id: string;
  name: string;
  parentId: string | null;
  weight: number;
  manualValue: number;
  ownerId: string;
  progress: number;
  percent: number;
  projects: { projectId: string; name: string; weight: number; progress: number }[];
}

export interface InboxItem {
  id: string;
  text: string;
  taskId: string | null;
  kind: string;
  read: boolean;
  createdAt: ISODateTime;
}
