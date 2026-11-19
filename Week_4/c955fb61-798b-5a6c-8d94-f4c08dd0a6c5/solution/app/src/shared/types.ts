import type { IsoDate } from "./calendar";

export type ItemKind = "task" | "milestone" | "group";
export type LinkType = "FS" | "SS" | "FF" | "SF";
export type Role = "owner" | "editor" | "viewer";

export const LINK_TYPES: readonly LinkType[] = ["FS", "SS", "FF", "SF"];
export const LINK_TYPE_WORDS: Record<LinkType, string> = {
  FS: "finish to start",
  SS: "start to start",
  FF: "finish to finish",
  SF: "start to finish",
};
export const LAG_LIMIT = 30;
export const ITEM_KINDS: readonly ItemKind[] = ["task", "milestone", "group"];

export interface Assignee {
  userId: string;
  name: string;
  hours: number;
}

export interface ItemBaseline {
  start: IsoDate;
  end: IsoDate;
  variance: number;
}

export interface Item {
  id: string;
  row: number;
  name: string;
  kind: ItemKind;
  group: string | null;
  chosenStart: IsoDate | null;
  start: IsoDate | null;
  end: IsoDate | null;
  duration: number;
  percent: number;
  critical: boolean;
  float: number | null;
  late: boolean;
  version: number;
  assignees: Assignee[];
  baseline: ItemBaseline | null;
}

export interface Link {
  id: string;
  from: string;
  to: string;
  type: LinkType;
  lag: number;
  critical: boolean;
}

export interface Holiday {
  date: IsoDate;
  name: string;
}

export interface ProjectBaseline {
  name: string;
  finish: IsoDate;
  finishVariance: number;
}

export interface Project {
  id: string;
  name: string;
  finish: IsoDate | null;
  holidays: Holiday[];
  items: Item[];
  links: Link[];
  baseline: ProjectBaseline | null;
}

export interface Moved {
  id: string;
  start: IsoDate;
  end: IsoDate;
}

export interface AppConfig {
  today: IsoDate;
  timeZone: string;
  assignNoticeDelaySeconds: number;
  presenceTimeoutSeconds: number;
  knockOnMs: number;
  knockOnStaggerMs: number;
  finishMotionMs: number;
}

export interface Person {
  id: string;
  name: string;
  email: string;
}

export interface WorkspaceMembership {
  id: string;
  name: string;
  role: Role;
}

export interface ProjectSummary {
  id: string;
  name: string;
  workspace: { id: string; name: string };
  finish: IsoDate | null;
}

export interface Comment {
  id: string;
  author: { userId: string; name: string };
  text: string;
  createdAt: string;
}

export interface StoredExport {
  id: string;
  format: "csv" | "pdf";
  filename: string;
  downloadUrl: string;
  createdAt: string;
}

export interface WorkloadAssignment {
  project: string;
  item: string;
  hours: number;
}

export interface WorkloadDay {
  date: IsoDate;
  hours: number;
  over: boolean;
  assignments: WorkloadAssignment[];
}

export interface WorkloadPerson {
  userId: string;
  name: string;
  capacity: number;
  overDays: number;
  days: WorkloadDay[];
}

export interface Workload {
  from: IsoDate;
  days: IsoDate[];
  people: WorkloadPerson[];
}

export interface PresencePerson {
  userId: string;
  name: string;
  selected: string | null;
}

/** What the last accepted change did, sent with every pushed project snapshot. */
export interface ChangeNote {
  kind: "edit" | "add" | "delete" | "comment" | "holidays" | "baseline";
  actor: { id: string; name: string };
  itemId: string | null;
  itemName: string | null;
  /** Whether the change counts as an edit for the knock-on and the shifted marks. */
  schedule: boolean;
  moved: string[];
  /** Links of the previous schedule, for the knock-on depth of a deleted item. */
  previousLinks: { from: string; to: string }[];
}

export type LiveEvent =
  | { type: "project"; rev: number; project: Project; change: ChangeNote }
  | { type: "workload"; projectId: string }
  | { type: "comment"; projectId: string; itemId: string; itemName: string; actor: { id: string; name: string }; comment: Comment }
  | { type: "presence"; people: PresencePerson[] }
  | { type: "ready"; people: PresencePerson[] };
