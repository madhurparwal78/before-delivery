import type { TaskType, Difficulty, Band, LedgerKind, QuestState, Weekday } from './rules.js';

export interface PlayerRow {
  id: string;
  username: string;
  level: number;
  experience: number;
  healthTenths: number;
  goldCents: number;
  timeZone: string;
  dayStartHour: number;
  resting: boolean;
  openDate: string;
}

export interface Player {
  id: string;
  username: string;
  level: number;
  experience: number;
  experienceToLevel: number;
  health: number;
  maxHealth: number;
  gold: number;
  timeZone: string;
  dayStartHour: number;
  resting: boolean;
  today: string;
  nextCloseAt: string;
  nextDayStart: string;
  partyId: string | null;
  notices: Notice[];
}

export interface Notice {
  id: string;
  kind: 'level_up' | 'faint';
  level: number;
  goldLost: number | null;
}

export interface ChecklistItem {
  id: string;
  text: string;
  checked: boolean;
}

export interface Task {
  id: string;
  type: TaskType;
  title: string;
  difficulty: Difficulty;
  value: number;
  band: Band;
  streak: number;
  done: boolean;
  dueToday: boolean | null;
  weekdays: Weekday[] | null;
  checklist: ChecklistItem[] | null;
  price: number | null;
  position: number;
  updatedAt: string;
}

export interface Delta {
  experience: number;
  gold: number;
  health: number;
  damage: number;
}

export interface StrikeEvent {
  id: string;
  seq: number;
  kind: 'strike' | 'strikeback';
  username: string;
  amount: number;
  missed: number | null;
  bossHealthAfter: number;
  createdAt: string;
}

export interface ActionResult {
  task: Task;
  player: Player;
  delta: Delta;
  strike: StrikeEvent | null;
  levelUp: boolean;
  fainted: boolean;
}

export interface PartyMember {
  username: string;
  level: number;
  health: number;
  resting: boolean;
}

export interface Party {
  id: string;
  name: string;
  leader: string;
  members: PartyMember[];
  pendingInvites: string[];
  bannerUrl: string | null;
  questId: string | null;
}

export interface Quest {
  id: string;
  partyId: string;
  name: string;
  boss: string;
  maxHealth: number;
  bossHealth: number;
  power: number;
  state: QuestState;
  invitedAt: string;
  expiresAt: string;
  acceptedBy: string[];
  startedAt: string | null;
  endedAt: string | null;
  defeatedBy: string | null;
  members: { username: string; damage: number }[];
  events: StrikeEvent[];
}

export interface LedgerEntry {
  id: string;
  kind: LedgerKind;
  amount: number;
  taskId: string | null;
  createdAt: string;
}

export interface ImportRecord {
  id: string;
  filename: string;
  size: number;
  status: 'imported' | 'rejected';
  createdAt: string;
  taskCount: number;
  errorCount: number;
  lines: { line: number; taskId: string | null; type: TaskType | null; title: string | null }[];
  errors: { line: number; message: string }[];
}

export interface ChatMessage {
  id: string;
  username: string;
  text: string;
  createdAt: string;
}

export function formatGold(cents: number): string {
  return (cents / 100).toFixed(2);
}
