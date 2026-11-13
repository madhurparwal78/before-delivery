/** Shapes that cross the wire between the browser and the server. */

import type { Characters, LogEntry } from "./engine";
import type { QuoteGroup, QuoteId } from "./texts";

export type Mode = "time" | "words" | "quote" | "custom";
export type TicketLength = 15 | 30 | 60 | 120 | 10 | 25 | 50 | 100 | QuoteGroup | "all" | null;

export interface TicketRequest {
  readonly mode: Mode;
  readonly length: TicketLength;
  readonly punctuation: boolean;
  readonly numbers: boolean;
  readonly text: string | null;
}

export interface Ticket {
  readonly ticketId: string;
  readonly seed: number | null;
  readonly words: string[];
  readonly quoteId: QuoteId | null;
  readonly expiresAt: string;
}

export interface Settings {
  theme: "sand" | "cobalt" | "carbon" | "ledger";
  caret: "line" | "block" | "underline" | "off";
  smoothCaret: boolean;
  fontSize: 1 | 1.5 | 2 | 3;
  blindMode: boolean;
  quickRestart: "tab" | "enter";
}

export const DEFAULT_SETTINGS: Settings = { theme: "sand", caret: "line", smoothCaret: true, fontSize: 1.5, blindMode: false, quickRestart: "tab" };

export interface ClientConfig {
  readonly focusWarningMs: number;
  readonly maxExtraLetters: number;
  readonly raceCountdownSeconds: number;
  readonly raceRejoinSeconds: number;
}

export interface Me {
  readonly id: string;
  readonly name: string;
  readonly verified: boolean;
}

/** The run a browser submits for a ticket; a race finish is the same without `ticketId`. */
export interface RunBody {
  readonly ticketId?: string;
  readonly text: string[];
  readonly log: LogEntry[];
  readonly duration: number;
  readonly speed: number;
  readonly raw: number;
  readonly accuracy: number;
  readonly consistency: number;
  readonly characters: Characters;
}

export type RefusalCode =
  | "wrong_text"
  | "impossible_interval"
  | "duration_mismatch"
  | "replay_mismatch"
  | "ticket_expired"
  | "invalid_log"
  | "log_too_long"
  | "ticket_not_found";

export interface StoredRun {
  readonly runId: string;
  readonly mode: Mode;
  readonly length: number | string | null;
  readonly punctuation: boolean;
  readonly numbers: boolean;
  readonly quoteId: QuoteId | null;
  readonly words: string[];
  readonly log: unknown;
  readonly duration: number | null;
  readonly speed: number | null;
  readonly raw: number | null;
  readonly accuracy: number | null;
  readonly consistency: number | null;
  readonly characters: Characters | null;
  readonly errorsByKey: Record<string, number> | null;
  readonly perSecond: { second: number; speed: number; raw: number; errors: number }[] | null;
  readonly verdict: "counted" | "not_counted";
  readonly reason: RefusalCode | null;
  readonly finishedAt: string;
  readonly proofKey: string | null;
}

export interface HistoryRow {
  readonly runId: string;
  readonly finishedAt: string;
  readonly mode: Mode;
  readonly length: number | string | null;
  readonly speed: number | null;
  readonly raw: number | null;
  readonly accuracy: number | null;
  readonly consistency: number | null;
  readonly verdict: "counted" | "not_counted";
}

export interface PersonalBest {
  readonly mode: Mode;
  readonly length: number | string | null;
  readonly punctuation: boolean;
  readonly numbers: boolean;
  readonly speed: number;
  readonly accuracy: number;
  readonly finishedAt: string;
  readonly runId: string;
}

export interface Account {
  readonly name: string;
  readonly email: string;
  readonly verified: boolean;
  readonly testsCounted: number;
  readonly personalBests: PersonalBest[];
}

export type BoardKind = "daily" | "alltime";
export type BoardLength = 15 | 60;

export interface BoardRow {
  readonly rank: number;
  readonly name: string;
  readonly speed: number;
  readonly accuracy: number;
  readonly finishedAt: string;
}

export type RoomState = "open" | "countdown" | "racing" | "finished";

export interface RacerView {
  /** Identifies the racer's seat inside the room; names are not unique. */
  readonly seat: number;
  readonly name: string;
  readonly host: boolean;
  readonly left: boolean;
  readonly progress: number;
  readonly place: number | null;
  /** True once the racer's finish was refused or came too late. */
  readonly dnf: boolean;
  readonly speed: number | null;
  readonly accuracy: number | null;
}

export interface RoomView {
  readonly code: string;
  readonly state: RoomState;
  readonly racers: RacerView[];
  readonly words: string[] | null;
  readonly elapsedMs: number | null;
}

export type RoomEvent =
  | { readonly kind: "joined"; readonly seat: number; readonly racer: string }
  | { readonly kind: "left"; readonly seat: number; readonly racer: string }
  | { readonly kind: "host"; readonly seat: number; readonly racer: string }
  | { readonly kind: "finished"; readonly seat: number; readonly racer: string; readonly place: number; readonly speed: number }
  | { readonly kind: "over" }
  | { readonly kind: "step"; readonly step: string };

export interface RoomEventRecord {
  readonly id: number;
  readonly event: RoomEvent;
}

/** Messages a browser sends over the live channel. */
export type LiveRequest =
  | { readonly type: "board"; readonly board: BoardKind; readonly length: BoardLength }
  | { readonly type: "room"; readonly code: string; readonly since: number | null }
  | { readonly type: "entries"; readonly code: string; readonly entries: LogEntry[] };

interface BoardChange {
  readonly name: string;
  readonly rank: number;
  readonly speed: number;
}

/** Messages the server pushes over the live channel. */
export type LivePush =
  | { readonly type: "board"; readonly board: BoardKind; readonly length: BoardLength; readonly rows: BoardRow[]; readonly mine: number | null; readonly change: BoardChange | null }
  | { readonly type: "room"; readonly room: RoomView; readonly events: RoomEventRecord[]; /** The racer's own entries as the server holds them; only a fresh subscription carries them. */ readonly entries: LogEntry[] | null; readonly you: number; readonly through: number }
  | { readonly type: "room-gone"; readonly code: string };
