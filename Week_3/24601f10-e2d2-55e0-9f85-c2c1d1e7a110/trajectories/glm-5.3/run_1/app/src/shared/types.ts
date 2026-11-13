export type TournamentFormat = "single_elimination" | "double_elimination" | "round_robin" | "swiss";
export type TournamentState = "draft" | "checkin_open" | "checkin_closed" | "running" | "finished";
export type TrophyFill = "lilac" | "lemon" | "mint";
export type BracketName = "winners" | "losers" | "final" | "main";
export type MatchState =
  | "pending"
  | "called"
  | "reported"
  | "confirmed"
  | "disputed"
  | "resolved"
  | "bye"
  | "not_needed"
  | "waiting";

export const FORMAT_LABELS: Record<TournamentFormat, string> = {
  single_elimination: "Single elimination",
  double_elimination: "Double elimination",
  round_robin: "Round robin",
  swiss: "Swiss",
};

export interface EntrantRef {
  entrant_id: string;
  name: string;
}
export type SlotValue = EntrantRef | { bye: true } | null;

export interface MatchReport {
  by: string;
  upper_games: number;
  lower_games: number;
  reported_at: string;
  auto_confirm_at: string;
}
export interface MatchDispute {
  by: string;
  upper_games: number;
  lower_games: number;
  disputed_at: string;
}

export interface Match {
  id: string;
  tournament_id: string;
  label: string;
  bracket: BracketName;
  round: number;
  number: number;
  upper: SlotValue;
  lower: SlotValue;
  state: MatchState;
  upper_games: number | null;
  lower_games: number | null;
  winner: "upper" | "lower" | "draw" | null;
  report: MatchReport | null;
  dispute: MatchDispute | null;
  called_at: string | null;
  overdue?: boolean;
  version: number;
  updated_by?: string;
}

export interface Tournament {
  id: string;
  name: string;
  format: TournamentFormat;
  state: TournamentState;
  fill: TrophyFill;
  time_zone: string;
  organizer: string;
  checkin_closes_at: string | null;
  server_time: string;
  field_size: number;
  entrant_count: number;
  checked_in_count: number;
  current_round: { bracket: BracketName; round: number };
  swiss_rounds: number | null;
  logo_url: string | null;
  seeding_version: number;
  my_role: "organizer" | "co_organizer" | "player" | "viewer";
  share_url: string | null;
  co_organizers: string[] | null;
}

export interface Entrant {
  id: string;
  name: string;
  seed: number;
  username: string | null;
  checked_in: boolean;
}

export interface StandingRow {
  place: number;
  entrant_id: string;
  name: string;
  played: number;
  match_points: number;
  head_to_head?: number;
  game_difference?: number;
  games_won?: number;
  buchholz_cut_1?: number;
  buchholz?: number;
  sonneborn_berger?: number;
  seed: number;
  decided_by: string;
}
export interface Standings {
  columns: string[];
  rows: StandingRow[];
}

export interface HistoryRow {
  tournament_id: string;
  tournament_name: string;
  place: number;
  field_size: number;
  finished_on: string;
  text: string;
}

export interface DependentPreview {
  match_id: string;
  label: string;
  state: MatchState;
}
export interface EditPreviewResponse {
  dependents: DependentPreview[];
  count: number;
  confirmed_count: number;
  preview_token: string;
}

export interface ApiConfig {
  server_time: string;
  confirm_window_ms: number;
  match_limit_ms: number;
  swiss_round_ms: number;
  toast_ms: number;
  roster_max_bytes: number;
  logo_max_bytes: number;
}

export type LiveMessageType =
  | "match.updated"
  | "matches.reset"
  | "standings.updated"
  | "checkin.updated"
  | "entrants.updated"
  | "tournament.updated"
  | "announcement";

export interface LiveMessage {
  seq: number;
  type: LiveMessageType;
  at: string;
  data: {
    match?: Match;
    matches?: Match[];
    rows?: StandingRow[];
    checked_in_count?: number;
    entrant?: { name: string; checked_in: boolean };
    entrants?: Entrant[];
    tournament?: Tournament;
    text?: string;
  };
}

export const ERROR_MESSAGES = {
  too_large_json: (limit: number) => `The request body is larger than ${limit} bytes.`,
  too_large_file: (limit: number) => `This file is larger than ${limit} bytes.`,
  unauthenticated: "Sign in to continue.",
  bad_credentials: "Username or password is wrong.",
  username_taken: "That username is taken.",
  rate_limited_login: "Too many sign-in attempts. Wait a minute and try again.",
  rate_limited_report: "Too many score reports. Wait a minute and try again.",
  not_found_tournament: "We couldn't find that tournament.",
  not_found_link: "This link no longer works.",
  not_found_draft: "This tournament is not public yet.",
  not_found_roster: "No roster file has been added.",
  read_only: "Share links are read-only.",
  forbidden_tournament: "You cannot change this tournament.",
  forbidden_report: "Only the two players in this match or an organizer can report it.",
  forbidden_self_confirm: "You cannot confirm your own report.",
  forbidden_resolve: "Only organizers can resolve disputes.",
  forbidden_organizer_only: "Only the organizer can do this.",
  forbidden_cross_site: "Cross-site requests are refused.",
  stale_match: (username: string, score: string) => `This match was updated by ${username}. Current score: ${score}.`,
  already_resolved: (username: string, score: string) =>
    `This dispute was already resolved by ${username}. Result: ${score}.`,
  stale_preview: "The bracket changed since this preview. Review the edit again.",
  stale_seeding: (username: string) => `The seeding was changed by ${username}. The list now shows their order.`,
  checkin_closed: "Check-in is closed.",
  ws_match_has_result: "This match already has a result.",
  ws_match_disputed: "This match is disputed. An organizer will resolve it.",
  ws_already_reported: "You already reported this match.",
  ws_no_report: "There is no report to answer.",
  ws_no_dispute: "There is no open dispute.",
  ws_not_ready: "This match is not ready to play.",
  ws_edit_only: "Only confirmed or resolved results can be edited.",
  ws_not_running: "The tournament is not running.",
  ws_finished: "This tournament is finished. Its results can no longer change.",
  ws_already_started: "The tournament has already started.",
  ws_checkin_not_open: "Check-in is not open.",
  ws_close_checkin: "Close check-in before starting.",
  ws_need_2: "At least 2 entrants are needed to start.",
  ws_need_2_checked: "At least 2 checked-in entrants are needed to start.",
  ws_finish_round: (n: number) => `Finish every match in round ${n} first.`,
  ws_no_pairing: "No pairing without a rematch exists.",
  ws_checkin_already_open: "Check-in is already open.",
  ws_checkin_already_closed: "Check-in has already closed. Go back to draft to open it again.",
  ws_already_draft: "The tournament is already a draft.",
  ws_not_swiss: "Only Swiss tournaments have a next round.",
  ws_standings_format: "Standings exist only for round robin and Swiss.",
  validation_fields: "Check the highlighted fields.",
  validation_winner: "Elimination matches need a winner.",
  validation_one_game: "A score needs at least one game.",
  validation_change_score: "Change the score to dispute it.",
  validation_logo: "Logos must be PNG or JPEG images.",
  roster_invalid: "The roster was not added. Fix these lines and upload again.",
  storage_unavailable: "File storage is unavailable. Nothing was added. Try again in a moment.",
} as const;

export const FIELD_ERRORS = {
  username: "Use 3 to 24 characters: a-z, 0-9 or _.",
  password: "Use at least 8 characters.",
  name: "Enter a name of 1 to 60 characters.",
  format: "Choose a format.",
  fill: "Choose a trophy fill.",
  time_zone: "Choose a time zone from the list.",
  entrant_name: "Enter a name of 1 to 40 characters.",
  duplicate_entrant: "That name is already in the field.",
  games: "Enter a whole number from 0 to 99.",
  no_account: (username: string) => `No account named @${username}.`,
  repeat_co: (username: string) => `@${username} is already a co-organizer.`,
  organizer_co: "You already organize this tournament.",
  closes_at_past: "Choose a time after now.",
  closes_at_format: "Enter the time as YYYY-MM-DD HH:MM or YYYY-MM-DD HH:MM:SS.",
} as const;

export const ROSTER_ERRORS = {
  not_utf8: "The roster file is not UTF-8 text.",
  empty: "The roster file is empty.",
  extension: "Roster files end in .cupfold.txt.",
  count: (n: number) => `The roster has ${n} entrants. A roster needs 2 to 128.`,
  seed_range: (n: number) => `Line ${n}: seed must be a whole number from 1 to 128`,
  seed_larger: (n: number, s: number, m: number) => `Line ${n}: seed ${s} is larger than the number of entrants (${m})`,
  seed_used: (n: number, s: number, m: number) => `Line ${n}: seed ${s} is already used on line ${m}`,
  name_empty: (n: number) => `Line ${n}: name is empty`,
  name_long: (n: number) => `Line ${n}: name is longer than 40 characters`,
  duplicate_name: (n: number, first: string, m: number) =>
    `Line ${n}: duplicate name "${first}" (first on line ${m})`,
  no_account: (n: number, username: string) => `Line ${n}: no account named @${username}`,
  username_used: (n: number, username: string, m: number) =>
    `Line ${n}: @${username} is already on line ${m}`,
} as const;

export function slotName(slot: SlotValue): string {
  if (slot === null) return "to be decided";
  if ("bye" in slot) return "bye";
  return slot.name;
}

export function scoreText(m: { upper_games: number | null; lower_games: number | null }): string {
  if (m.upper_games === null || m.lower_games === null) return "not played";
  return `${m.upper_games}-${m.lower_games}`;
}

export function matchCardName(m: Match): string {
  const upper = slotName(m.upper);
  const lower = slotName(m.lower);
  const pair = `${upper} vs ${lower}`;
  if (m.state === "bye") return `${m.label}: ${upper === "bye" ? lower : upper} vs bye`;
  if (m.state === "not_needed") return `${m.label}: not needed`;
  if (m.state === "waiting") {
    return m.upper !== null && m.lower !== null
      ? `${m.label}: ${pair}, not played`
      : "Grand final reset: waiting for grand final";
  }
  switch (m.state) {
    case "pending":
      return `${m.label}: ${pair}, not played`;
    case "called":
      return `${m.label}: ${pair}, called`;
    case "reported":
      return `${m.label}: ${pair}, ${m.upper_games}-${m.lower_games} reported by ${m.report?.by ?? ""}, awaiting ${opponentName(m)}`;
    case "disputed":
      return `${m.label}: ${pair}, disputed`;
    case "confirmed":
    case "resolved": {
      const w = m.winner === "draw" ? "draw" : m.winner === "upper" ? upper : lower;
      return `${m.label}: ${pair}, ${m.upper_games}-${m.lower_games}, ${w} wins`;
    }
  }
}

function opponentName(m: Match): string {
  const by = m.report?.by ?? "";
  if (m.upper && "entrant_id" in m.upper && m.upper.name === by) {
    return m.lower && "entrant_id" in m.lower ? m.lower.name : "";
  }
  return m.upper && "entrant_id" in m.upper ? m.upper.name : "";
}

export const STATE_WORDS: Record<MatchState, string> = {
  pending: "Pending",
  called: "Called",
  reported: "Awaiting confirmation",
  confirmed: "Confirmed",
  disputed: "Disputed",
  resolved: "Resolved",
  bye: "Bye",
  not_needed: "Not needed",
  waiting: "Waiting",
};

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

export function resetCountSentence(count: number, confirmed: number): string {
  if (count === 0) return "No later matches will reset.";
  if (count === 1) return confirmed === 1 ? "1 match will reset, it is confirmed" : "1 match will reset, it is not confirmed";
  return `${count} matches will reset, ${confirmed} of them confirmed`;
}
