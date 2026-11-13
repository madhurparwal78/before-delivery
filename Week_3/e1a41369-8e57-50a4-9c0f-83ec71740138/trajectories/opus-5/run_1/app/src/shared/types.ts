export type TaskType = 'habit' | 'daily' | 'todo' | 'reward';
export type Difficulty = 'trivial' | 'easy' | 'medium' | 'hard';
export type Weekday = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';
export type BandName = 'Crimson' | 'Amber' | 'Sand' | 'Teal' | 'Blue';
export type QuestState = 'invited' | 'active' | 'defeated' | 'abandoned';
export type LedgerKind = 'task' | 'reward' | 'quest' | 'faint' | 'undo';
export type NoticeKind = 'level_up' | 'faint';

export interface Notice {
  id: string;
  kind: NoticeKind;
  level: number;
  goldLost: number;
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

export interface ChecklistItem {
  id: string;
  text: string;
  checked: boolean;
}

export interface Task {
  id: string;
  type: TaskType;
  title: string;
  difficulty: Difficulty | null;
  value: number | null;
  band: BandName | null;
  streak: number | null;
  done: boolean | null;
  dueToday: boolean | null;
  weekdays: Weekday[] | null;
  checklist: ChecklistItem[] | null;
  price: number | null;
  position: number;
  updatedAt: string;
}

export interface TaskLists {
  habits: Task[];
  dailies: Task[];
  todos: Task[];
  rewards: Task[];
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
  delta: { experience: number; gold: number; health: number; damage: number };
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

export interface QuestMemberDamage {
  username: string;
  damage: number;
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
  members: QuestMemberDamage[];
  events: StrikeEvent[];
}

export interface ChatMessage {
  id: string;
  username: string;
  text: string;
  createdAt: string;
}

export interface LedgerEntry {
  id: string;
  kind: LedgerKind;
  amount: number;
  taskId: string | null;
  createdAt: string;
}

export interface ImportLine {
  line: number;
  taskId: string | null;
  type: string | null;
  title: string | null;
}

export interface ImportLineError {
  line: number;
  message: string;
}

export interface ImportRecord {
  id: string;
  filename: string;
  size: number;
  status: 'imported' | 'rejected';
  createdAt: string;
  taskCount: number;
  errorCount: number;
  lines: ImportLine[];
  errors: ImportLineError[];
}

export interface Invite {
  id: string;
  partyId: string;
  partyName: string;
  from: string;
}

export interface QuestFixture {
  name: string;
  boss: string;
  maxHealth: number;
  power: number;
  rewardGold: number;
  rewardExperience: number;
}
