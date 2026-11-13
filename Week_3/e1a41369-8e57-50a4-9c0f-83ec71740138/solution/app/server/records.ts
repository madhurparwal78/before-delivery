import type { Difficulty, LedgerKind, QuestState, TaskType, Weekday } from "../shared/api.js";

export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  time_zone: string;
  day_start_hour: number;
  resting: boolean;
  level: number;
  experience: number;
  health_tenths: number;
  open_date: string;
  next_close_at: Date;
  party_id: string | null;
  joined_party_at: Date | null;
}

export interface TaskRow {
  id: string;
  user_id: string;
  type: TaskType;
  title: string;
  difficulty: Difficulty | null;
  value: number | null;
  streak: number | null;
  done: boolean | null;
  weekdays: Weekday[] | null;
  price_cents: number | null;
  position: number;
  updated_at: Date;
}

export interface ChecklistRow {
  id: string;
  task_id: string;
  text: string;
  checked: boolean;
  position: number;
}

export interface PartyRow {
  id: string;
  name: string;
  leader_id: string;
  deleted: boolean;
}

export interface QuestRow {
  id: string;
  party_id: string;
  name: string;
  state: QuestState;
  boss_health_tenths: number;
  invited_at: Date;
  started_at: Date | null;
  ended_at: Date | null;
  defeated_by: string | null;
}

export interface EventRow {
  id: string;
  quest_id: string;
  seq: number;
  kind: "strike" | "strikeback";
  user_id: string;
  amount_tenths: number;
  missed: number | null;
  boss_health_after_tenths: number;
  created_at: Date;
}

export interface LedgerRow {
  id: string;
  kind: LedgerKind;
  amount_cents: number;
  task_id: string | null;
  created_at: Date;
}
