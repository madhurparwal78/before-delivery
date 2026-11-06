// Shared browser helpers: API access, copy strings, time formatting.

export interface InputSourceExhibit {
  kind: "exhibit";
  restatement_id: string;
  accession: string;
  sha256: string;
  page: number;
  row: string;
}
export interface InputSourceTick {
  kind: "tick";
  id: string;
  at: string;
}
export interface InputSourceOfficialClose {
  kind: "official_close";
  date: string;
}
export type InputSource = InputSourceExhibit | InputSourceTick | InputSourceOfficialClose;

export interface ComputationInput {
  key: string;
  label: string;
  clock: "equity" | "eth" | "holdings";
  value: string;
  display: string;
  as_of: string;
  sets_as_of: boolean;
  source: InputSource;
}

export interface Restated {
  on: string;
  reason: string;
  superseded_by: string;
  superseding_computation_id: string;
}

export interface Computation {
  id: string;
  figure: string;
  label: string;
  value: string;
  display: string;
  as_of: string;
  computed_at: string;
  restatement_id: string | null;
  restated: Restated | null;
  inputs: ComputationInput[];
}

export interface HistoryRow {
  restatement_id: string;
  week_ending: string;
  state: "published" | "superseded";
  beginning_balance: string | null;
  eth_acquired: string | null;
  staking_rewards: string | null;
  ending_balance: string | null;
  cumulative_staking_rewards: string | null;
  diluted_shares: string | null;
  eth_per_1000_diluted: { computation_id: string; value: string; display: string } | null;
  exhibit: { accession: string; sha256: string; page: number } | null;
  published_at: string | null;
  restated: { on: string; reason: string; superseded_by: string } | null;
}

export interface Board {
  server_time: string;
  market_date: string;
  vault: "available" | "unavailable";
  clocks: {
    equity: {
      status: "open" | "closed";
      closes_at: string | null;
      last_trade: { id: string; price: string; at: string } | null;
      official_close: { date: string; price: string } | null;
    };
    eth: {
      status: "live" | "stale";
      last_tick: { id: string; price: string; at: string } | null;
    };
    holdings: { week_ending: string; as_of: string; restatement_id: string } | null;
  };
  figures: Computation[];
  history: HistoryRow[];
}

export const FIGURE_LABELS: Record<string, string> = {
  "eth-held": "Total ETH held",
  "staking-rewards": "Cumulative staking rewards",
  "eth-per-1000-diluted": "ETH per 1,000 diluted shares",
  mnav: "mNAV",
};

export const ROW_LABELS: Record<string, string> = {
  "beginning-balance": "Beginning ETH balance",
  "eth-acquired": "ETH acquired",
  "staking-rewards": "Staking rewards",
  "ending-balance": "Ending ETH balance",
  "cumulative-staking-rewards": "Cumulative staking rewards",
  "diluted-shares": "Assumed diluted shares",
};

export const ROW_KEYS = [
  "beginning-balance",
  "eth-acquired",
  "staking-rewards",
  "ending-balance",
  "cumulative-staking-rewards",
  "diluted-shares",
] as const;

export interface StaffUser {
  id: string;
  name: string;
  email: string;
  roles: string[];
}

export interface ShareEvent {
  id: string;
  kind: string;
  shares: string;
  effective_date: string;
}

export interface Restatement {
  id: string;
  version: number;
  week_ending: string;
  state: "draft" | "in_review" | "returned" | "cleared" | "queued" | "published" | "superseded";
  supersedes: string | null;
  correction_reason: string | null;
  rows: Record<string, string | null>;
  share_events: ShareEvent[];
  accession: string | null;
  exhibit_page: number | null;
  exhibit: { status: "verified" | "rejected"; sha256: string; bytes: number; key: string | null } | null;
  prepared_by: { id: string; name: string };
  cleared_by: { id: string; name: string } | null;
  released_by: { id: string; name: string } | null;
  return_note: string | null;
  release_at: string | null;
  published_at: string | null;
  superseded_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuditEntry {
  version: number;
  action: string;
  actor: { id: string; name: string } | null;
  at: string;
  from_state: string | null;
  to_state: string;
  note: string | null;
}

// ---------------------------------------------------------------------------
// The copy, rendered character for character.

export const COPY = {
  loading: "Loading figures...",
  refreshFailed: "Figures could not be refreshed. Showing the last loaded figures.",
  sessionClose: (date: string) => `Equity session closed. Share price is now the ${date} official close.`,
  sessionOpen: (time: string) => `Session open — closes at ${time} ET`,
  marketClosed: (date: string) => `Market closed — share price is the ${date} official close`,
  ethLive: (time: string) => `Live — last tick ${time} ET`,
  ethStale: (time: string) => `Stale — no ETH tick since ${time} ET`,
  ethStaleNever: "Stale — no ETH tick received",
  holdings: (week: string, asOf: string) => `Week ending ${week} — as of ${asOf} 23:59:59 ET`,
  asOfLine: (date: string, time: string) => `As of ${date} ${time} ET`,
  citation: (accession: string, page: number) => `Accession ${accession} · p. ${page}`,
  vaultNotice: "Filing vault unavailable — exhibits are temporarily unavailable. Figures shown are unchanged.",
  exhibitVaultDown: "Filing vault unavailable — this exhibit cannot be downloaded right now. Figures shown are unchanged.",
  exhibitUnexpected: "Something went wrong. Nothing was changed.",
  restated: "Restated",
  restatedLine: (date: string, reason: string) => `Restated on ${date}: ${reason}`,
  provisional: (date: string) => `Provisional — ${date} has not ended; this figure may still change.`,
  notFound: "No published figure for that date.",
  signInFailed: "Email or password is incorrect.",
  sessionEndedDialog: "Your session ended. Sign in again to finish this action.",
  sessionEndedStaff: "Your session ended. Sign in to save your changes.",
  differentUser: (name: string) => `Signed in as ${name}. The interrupted action was not sent.`,
  draftSaved: "Draft saved.",
  sent: "Sent to disclosure counsel.",
  sendNeedsExhibit: "Attach a verified exhibit before sending to disclosure counsel.",
  returned: "Returned to the treasury analyst.",
  cleared: "Cleared for release.",
  versionConflict: "This restatement changed since you opened it. Reload to see the current version.",
  withdrawn: "Release withdrawn — the restatement is cleared again.",
  withdrawRefused: "This restatement has already published or changed. Refresh to see its current state.",
  uploading: "Uploading exhibit and checking SHA-256...",
  uploaded: (sha: string) => `Exhibit verified — SHA-256 ${sha} matches the vault copy.`,
  hashMismatch: "Exhibit rejected — the vault copy's SHA-256 does not match the file you chose.",
  notPdf: "Choose a PDF file.",
  notSafe: "This PDF contains active content, links, embedded files or encryption. Print it to a new PDF and try again.",
  tooLarge: "The exhibit is larger than the size limit.",
  noAccession: "Save the accession number before attaching an exhibit.",
  vaultDownUpload: "Filing vault unavailable — the exhibit was not stored. Try again when the vault is back.",
  timingQueues: (time: string, date: string) => `Releasing now queues it to the ${time} ET session close on ${date}.`,
  timingPublishes: "Releasing now publishes it at once.",
  releaseQueued: (time: string, date: string) => `Release queued — publishes at the ${time} ET session close on ${date}.`,
  releasedNow: (time: string, date: string) => `Released — published at ${time} ET on ${date}.`,
  releaseUnconfirmed: "The release could not be confirmed. Press Release to try again; it will not be released twice.",
  releaseTwoPerson: "You prepared or cleared this restatement, so another disclosure officer must release it.",
  releaseStateChanged: "This restatement is no longer cleared. Refresh to see its current state.",
  unexpected: "Something went wrong. Nothing was changed.",
  tapePlaying: (n: number) => `Tape playing at position ${n}`,
  tapePaused: (n: number) => `Tape paused at position ${n}`,
  marketClock: (date: string, time: string) => `Market clock ${date} ${time} ET`,
  tapePausedStatus: "Tape paused.",
  tapePlayingStatus: "Tape playing.",
  clockSet: (date: string, time: string) => `Clock set to ${date} ${time} ET.`,
  clockReal: "Clock follows real time.",
  invalidClock: "Enter a time as YYYY-MM-DD HH:MM:SS in New York time.",
  open: "Open",
  closed: "Closed",
  live: "Live",
  stale: "Stale",
  weekShort: (week: string) => `Week ${week}`,
  sharePriceTrade: "Share price — last trade",
  officialClose: (date: string) => `Official close ${date}`,
  ethPrice: "ETH price",
  lastTick: (time: string) => `Last tick ${time} ET`,
  officialCloseLine: (date: string, time: string) => `Official close ${date} at ${time} ET`,
  setsAsOf: "Sets as-of",
  viewSuperseding: "View superseding entry",
  citeThisFigure: "Cite this figure",
} as const;

// ---------------------------------------------------------------------------
// Time helpers. The server sends ISO strings with the New York offset; the
// browser only reformats them and never consults its own clock.

export function parseIso(iso: string): number {
  return Date.parse(iso);
}

function nyParts(iso: string): { date: string; time: string; hhmm: string } {
  // The ISO string already carries the New York wall time before its offset.
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(iso);
  if (!m) return { date: iso, time: "", hhmm: "" };
  const date = m[1] ?? "";
  const hh = m[2] ?? "";
  const mm = m[3] ?? "";
  const ss = m[4] ?? "00";
  return { date, time: `${hh}:${mm}:${ss}`, hhmm: `${hh}:${mm}` };
}

export function nyTime(iso: string): string {
  return nyParts(iso).time;
}

export function nyHm(iso: string): string {
  return nyParts(iso).hhmm;
}

export function nyDate(iso: string): string {
  return nyParts(iso).date;
}

export function etWall(iso: string): string {
  return iso.replace("T", " ").replace(/-0[45]:00$/, "").replace(/(\.\d+)?([+-]\d{2}:\d{2}|Z)$/, "");
}

export function etWallSeconds(iso: string): string {
  return nyParts(iso).date + " " + nyParts(iso).time;
}

// ---------------------------------------------------------------------------
// API access.

export class ApiFailure extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string> | null;

  constructor(status: number, code: string, message: string, fields: Record<string, string> | null) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export async function apiJson<T>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
  const init: RequestInit = {
    method,
    headers: { "Content-Type": "application/json", ...(headers ?? {}) },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  const response = await fetch(path, init);
  if (!response.ok) {
    let code = "internal";
    let message = "";
    let fields: Record<string, string> | null = null;
    try {
      const parsed = (await response.json()) as { error?: { code?: string; message?: string; fields?: Record<string, string> } };
      code = parsed.error?.code ?? code;
      message = parsed.error?.message ?? message;
      fields = parsed.error?.fields ?? null;
    } catch {
      // Non-JSON error bodies keep the defaults.
    }
    throw new ApiFailure(response.status, code, message, fields);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function isDesktopViewport(): boolean {
  return window.innerWidth >= 768;
}
