export type RoundStatus = "drafted" | "open" | "closed" | "marked" | "published";
export type RoundKind = "standard" | "picture";
export type Role = "quizmaster" | "marker" | "captain";
export type RulingValue = "upheld" | "dismissed";
export type DisputeStatus = "raised" | "upheld" | "dismissed";
export type NoteState = "queued" | "sent";

export interface SheetInfo {
  readonly status: "stored" | "not_stored";
  readonly key: string | null;
  readonly size: number | null;
  readonly sha256: string | null;
  readonly width: number | null;
  readonly height: number | null;
}

export interface Round {
  readonly number: number;
  readonly title: string;
  readonly kind: RoundKind;
  readonly status: RoundStatus;
  readonly opened_at: string | null;
  readonly closes_at: string | null;
  readonly closed_at: string | null;
  readonly seconds_left: number | null;
  readonly sheet: SheetInfo | null;
}

export interface Answer {
  readonly id: number;
  readonly round: number;
  readonly team_id: number;
  readonly team_name: string;
  readonly question: number;
  readonly text: string;
  readonly submitted_at: string;
  readonly current: boolean;
  readonly mark: number | null;
  readonly ruled: number | null;
}

export interface Dispute {
  readonly id: number;
  readonly answer_id: number;
  readonly team_id: number;
  readonly round: number;
  readonly question: number;
  readonly answer_text: string;
  readonly reason: string;
  readonly status: DisputeStatus;
  readonly raised_at: string;
  readonly ruled_at: string | null;
  readonly note: NoteState | null;
}

export interface TableTeam {
  readonly position: number;
  readonly team_id: number;
  readonly name: string;
  readonly total: number;
  readonly last_round: { readonly round: number; readonly score: number } | null;
}

export interface Table {
  readonly night: number;
  readonly version: number;
  readonly last_published_round: number | null;
  readonly teams: readonly TableTeam[];
}

export interface SessionInfo {
  readonly role: Role;
  readonly team_id: number | null;
  readonly team_name: string | null;
}
