import type { Member, Session, FileMeta, Checkpoint } from "../../shared/types";

export interface WorkspaceProject {
  id: string;
  title: string;
  kind: string;
  owner: { id: string; name: string };
  members: Member[];
  sessions: Session[];
}

export interface FileWithContent extends FileMeta {
  content: string;
}

export const PARTICIPANT_TINTS = [
  "#7b8fb5",
  "#9caf88",
  "#c48f9f",
  "#a79fc4",
  "#8ba0b4",
  "#93a894",
  "#bb9a84",
];

export function tintFor(index: number): string {
  return PARTICIPANT_TINTS[index % PARTICIPANT_TINTS.length] as string;
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

export interface CheckpointRow extends Checkpoint {
  files?: { file_id: string; path: string; current_path: string | null; sha256: string; size: number }[];
}


