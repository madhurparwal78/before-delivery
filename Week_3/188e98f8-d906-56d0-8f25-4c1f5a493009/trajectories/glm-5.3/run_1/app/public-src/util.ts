export function normalise(text: string): string {
  return text.normalize("NFC").trim();
}

/** The one counting rule, shared with the server: NFC, trim, then code points. */
export function countText(text: string): number {
  return [...normalise(text)].length;
}

export const LIMITS = { name: 40, answer: 120, query: 80, reason: 280 } as const;

export type Status = "drafted" | "open" | "closed" | "marked" | "published";

export const STATUS_LABEL: Record<Status, string> = {
  drafted: "Drafted",
  open: "Open",
  closed: "Closed",
  marked: "Marked",
  published: "Published",
};

export interface Round {
  readonly number: number;
  readonly title: string;
  readonly kind: "standard" | "picture";
  readonly status: Status;
  readonly opened_at: string | null;
  readonly closes_at: string | null;
  readonly closed_at: string | null;
  readonly seconds_left: number | null;
  readonly sheet: {
    readonly status: "stored" | "not_stored";
    readonly key: string | null;
    readonly size: number | null;
    readonly sha256: string | null;
    readonly width: number | null;
    readonly height: number | null;
  } | null;
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
  readonly status: "raised" | "upheld" | "dismissed";
  readonly raised_at: string;
  readonly ruled_at: string | null;
  readonly note: "queued" | "sent" | null;
}

export interface TableTeam {
  readonly position: number;
  readonly team_id: number;
  readonly name: string;
  readonly total: number;
  readonly last_round: { readonly round: number; readonly score: number } | null;
}

export interface LeagueTable {
  readonly night: number;
  readonly version: number;
  readonly last_published_round: number | null;
  readonly teams: readonly TableTeam[];
}

/** The one archive time-sent format: the UTC HH:MM:SS of submitted_at. */
export function timeSent(iso: string): string {
  return iso.slice(11, 19);
}

export function formatCountdown(seconds: number): string {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")} left`;
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export const POLL_DELAY_MS = 3000;
export const MESSAGE_LIFETIME_MS = 6000;
