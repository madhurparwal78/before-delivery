import type { MemberRole, RoutineRepeats, TaskStatus, WorkspaceState } from '../../shared/types.js';

export interface WorkspaceRow {
  id: string;
  name: string;
  created_at: Date;
  trial_ends_at: Date;
  killbill_account_id: string | null;
  seed_key: string | null;
}

export interface MemberRow {
  id: string;
  workspace_id: string | null;
  name: string;
  email: string;
  email_lower: string;
  password_hash: string;
  role: MemberRole;
  time_zone: string;
  threshold_minutes: number;
  status: 'active' | 'invited' | 'pending_billing' | 'removed';
  feed_token: string | null;
  invite_token: string | null;
  invite_used_at: Date | null;
  killbill_subscription_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface TaskRow {
  id: string;
  member_id: string;
  workspace_id: string;
  title: string;
  estimate_minutes: number | null;
  day_date: string | null;
  position: number;
  status: TaskStatus;
  source: string | null;
  external_id: string | null;
  due_date: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

export interface SessionRow {
  id: string;
  task_id: string;
  member_id: string;
  local_date: string;
  start_time: string;
  end_time: string;
  start_instant: Date;
  end_instant: Date;
  version: number;
  created_at: Date;
  updated_at: Date;
}

export interface RoutineRow {
  id: string;
  member_id: string;
  name: string;
  start_time: string;
  duration_minutes: number;
  repeats: RoutineRepeats;
  created_at: Date;
}

export interface MeetingRow {
  id: string;
  member_id: string;
  uid: string;
  summary: string;
  start_instant: Date;
  end_instant: Date;
  created_at: Date;
  updated_at: Date;
}

export interface BillingEventRow {
  event_id: string;
  workspace_id: string;
  type: string;
  occurred_at: Date;
  seats: number | null;
  received_at: Date;
}

export interface OutboxRow {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  dedupe_key: string | null;
  status: 'pending' | 'sent';
  attempts: number;
  next_attempt_at: Date;
  created_at: Date;
  sent_at: Date | null;
}

export interface WorkspaceView {
  row: WorkspaceRow;
  state: WorkspaceState;
  billedSeats: number | null;
}
