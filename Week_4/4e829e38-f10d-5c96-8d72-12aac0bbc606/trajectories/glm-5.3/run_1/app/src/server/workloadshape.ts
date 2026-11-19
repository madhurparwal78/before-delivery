export interface WorkloadTaskRow {
  id: string;
  name: string;
  assignee_id: string | null;
  start_date: string | null;
  due_date: string | null;
  effort: string | null;
  completed: boolean;
}
